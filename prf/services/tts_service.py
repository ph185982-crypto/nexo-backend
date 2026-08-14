"""
TTS Service — Text-to-Speech synthesis.

Primary backend is the OpenAI speech API (works on serverless, no websockets).
Falls back to edge-tts when OPENAI_API_KEY is absent and edge-tts is installed.

Cache lives under /tmp because serverless filesystems are read-only elsewhere.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import tempfile
from pathlib import Path
from typing import AsyncIterator

logger = logging.getLogger(__name__)

AUDIO_CACHE_DIR = Path(tempfile.gettempdir()) / "prf_audio_cache"

# OpenAI voices that read Brazilian Portuguese naturally
OPENAI_VOICES = {
    "female": "nova",
    "male": "onyx",
    "calm": "shimmer",
    "narrator": "alloy",
}

# Modelo padrão. `tts-1` é o modelo básico e soa sintético — locução de rádio
# antiga. `gpt-4o-mini-tts` aceita direção de atuação (o campo `instructions`),
# que é o que separa "sintetizador lendo texto" de "duas pessoas conversando".
DEFAULT_TTS_MODEL = "gpt-4o-mini-tts"

# Direção de atuação por voz. Vai junto de cada requisição no modelo que
# aceita `instructions`; nos modelos antigos é ignorada silenciosamente (o
# código detecta a recusa e repete a chamada sem o campo).
VOICE_DIRECTION = {
    "onyx": (
        "Você é Marcos, instrutor de formação policial, ex-praça com quinze anos "
        "de rua. Voz masculina grave, peito cheio, ritmo pausado e seguro. Fala "
        "como quem já viu a ocorrência acontecer: direto, sem formalidade "
        "acadêmica, com pausas curtas antes do ponto importante. Quando faz "
        "pergunta ao ouvinte, levanta levemente o tom e espera. Português "
        "brasileiro coloquial, nada de locução de propaganda."
    ),
    "nova": (
        "Você é Julia, professora de Direito. Voz feminina clara e acolhedora, "
        "ritmo didático, calorosa sem ser infantil. Quando lê o texto da lei, "
        "desacelera e articula cada palavra, com pausa nas vírgulas — é leitura "
        "literal, solene. Quando explica, volta ao tom de conversa e enfatiza "
        "as palavras que mudam o sentido do dispositivo. Português brasileiro "
        "natural, nada de leitura robótica."
    ),
}

EDGE_VOICES = {
    "female": "pt-BR-FranciscaNeural",
    "male": "pt-BR-AntonioNeural",
}


class TTSService:
    VOICE_FEMALE = "nova"
    VOICE_MALE = "onyx"
    MAX_CHUNK_CHARS = 3800

    def __init__(self, voice: str | None = None, cache_dir: Path | None = None):
        self.voice = self._normalize_voice(voice)
        self.cache_dir = cache_dir or AUDIO_CACHE_DIR
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning(f"[TTS] Cache dir unavailable: {e}")

    @staticmethod
    def _normalize_voice(voice: str | None) -> str:
        if not voice:
            return "nova"
        if voice in OPENAI_VOICES:
            return OPENAI_VOICES[voice]
        # Map legacy edge-tts voice names onto OpenAI equivalents
        if voice == EDGE_VOICES["male"]:
            return "onyx"
        if voice == EDGE_VOICES["female"]:
            return "nova"
        return voice

    def _cache_path(self, text: str) -> Path:
        """Chave do cache: texto + voz + MODELO + direção de atuação.

        A chave levava só texto e voz. Trocar `tts-1` por `gpt-4o-mini-tts`
        não mudava a chave, então todo áudio já sintetizado continuaria sendo
        servido do cache no timbre antigo — a melhoria de voz simplesmente não
        chegaria a nenhum episódio existente. O mesmo valeria para qualquer
        ajuste na direção de atuação.
        """
        model = os.getenv("OPENAI_TTS_MODEL", DEFAULT_TTS_MODEL)
        direction = VOICE_DIRECTION.get(self.voice, "")
        chave = f"{text}:{self.voice}:{model}:{direction}"
        h = hashlib.md5(chave.encode()).hexdigest()
        return self.cache_dir / f"{h}.mp3"

    async def synthesize(self, text: str) -> bytes:
        """Synthesize text to MP3 bytes. Returns b'' if no backend is available."""
        if not text or not text.strip():
            return b""

        cached = self._cache_path(text)
        try:
            if cached.exists():
                return cached.read_bytes()
        except OSError:
            pass

        audio = b""
        if os.getenv("OPENAI_API_KEY"):
            audio = await self._synthesize_openai(text)
        if not audio:
            audio = await self._synthesize_edge(text)

        if audio:
            try:
                cached.write_bytes(audio)
            except OSError as e:
                logger.warning(f"[TTS] Cache write failed: {e}")
        return audio

    async def _synthesize_openai(self, text: str) -> bytes:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            model = os.getenv("OPENAI_TTS_MODEL", DEFAULT_TTS_MODEL)
            direction = VOICE_DIRECTION.get(self.voice)

            parts = []
            for chunk in self._split_text(text):
                kwargs = {
                    "model": model,
                    "voice": self.voice,
                    "input": chunk,
                    "response_format": "mp3",
                }
                if direction:
                    kwargs["instructions"] = direction
                try:
                    resp = await client.audio.speech.create(**kwargs)
                except Exception:
                    # Modelo antigo (tts-1/tts-1-hd) não conhece `instructions`
                    # e recusa a requisição inteira. Repete sem o campo em vez
                    # de deixar o episódio mudo.
                    if not direction:
                        raise
                    kwargs.pop("instructions")
                    resp = await client.audio.speech.create(**kwargs)
                parts.append(resp.content)
            return b"".join(parts)
        except Exception as e:
            logger.error(f"[TTS] OpenAI synthesis failed: {e}")
            return b""

    async def _synthesize_edge(self, text: str) -> bytes:
        try:
            import edge_tts
        except ImportError:
            logger.warning("[TTS] No TTS backend available")
            return b""

        voice = EDGE_VOICES["male"] if self.voice == "onyx" else EDGE_VOICES["female"]
        try:
            parts = []
            for chunk in self._split_text(text):
                communicate = edge_tts.Communicate(chunk, voice)
                buf = io.BytesIO()
                async for msg in communicate.stream():
                    if msg["type"] == "audio":
                        buf.write(msg["data"])
                parts.append(buf.getvalue())
            return b"".join(parts)
        except Exception as e:
            logger.error(f"[TTS] edge-tts synthesis failed: {e}")
            return b""

    async def stream_synthesis(self, text: str) -> AsyncIterator[bytes]:
        """Yield MP3 bytes in chunks (synthesizes fully, then streams)."""
        audio = await self.synthesize(text)
        chunk_size = 8192
        for i in range(0, len(audio), chunk_size):
            yield audio[i:i + chunk_size]

    def _split_text(self, text: str) -> list[str]:
        if len(text) <= self.MAX_CHUNK_CHARS:
            return [text]

        chunks: list[str] = []
        sentences = text.replace(". ", ".\n").split("\n")
        current = ""
        for sentence in sentences:
            if len(current) + len(sentence) + 1 > self.MAX_CHUNK_CHARS:
                if current:
                    chunks.append(current.strip())
                current = sentence
            else:
                current = f"{current} {sentence}" if current else sentence
        if current.strip():
            chunks.append(current.strip())
        return chunks
