"""
TTS Service — Text-to-Speech synthesis using edge-tts.
Provides zero-cost, high-quality Brazilian Portuguese voices.
"""
from __future__ import annotations
import io
import os
import hashlib
import logging
from pathlib import Path
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)

AUDIO_CACHE_DIR = Path(__file__).parent.parent / "audio_cache"


class TTSService:
    VOICE_FEMALE = "pt-BR-FranciscaNeural"
    VOICE_MALE = "pt-BR-AntonioNeural"
    MAX_CHUNK_CHARS = 4000

    def __init__(self, voice: str | None = None, cache_dir: Path | None = None):
        self.voice = voice or self.VOICE_FEMALE
        self.cache_dir = cache_dir or AUDIO_CACHE_DIR
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, text: str) -> Path:
        h = hashlib.md5(f"{text}:{self.voice}".encode()).hexdigest()
        return self.cache_dir / f"{h}.mp3"

    async def synthesize(self, text: str) -> bytes:
        cached = self._cache_path(text)
        if cached.exists():
            return cached.read_bytes()

        try:
            import edge_tts
        except ImportError:
            logger.warning("[TTS] edge-tts not installed — returning empty audio")
            return b""

        chunks = self._split_text(text)
        audio_parts = []

        for chunk in chunks:
            communicate = edge_tts.Communicate(chunk, self.voice)
            buf = io.BytesIO()
            async for msg in communicate.stream():
                if msg["type"] == "audio":
                    buf.write(msg["data"])
            audio_parts.append(buf.getvalue())

        audio = b"".join(audio_parts)

        try:
            cached.write_bytes(audio)
        except Exception as e:
            logger.warning(f"[TTS] Cache write failed: {e}")

        return audio

    async def stream_synthesis(self, text: str) -> AsyncIterator[bytes]:
        cached = self._cache_path(text)
        if cached.exists():
            data = cached.read_bytes()
            chunk_size = 8192
            for i in range(0, len(data), chunk_size):
                yield data[i:i + chunk_size]
            return

        try:
            import edge_tts
        except ImportError:
            return

        communicate = edge_tts.Communicate(text, self.voice)
        async for msg in communicate.stream():
            if msg["type"] == "audio":
                yield msg["data"]

    def _split_text(self, text: str) -> list[str]:
        if len(text) <= self.MAX_CHUNK_CHARS:
            return [text]

        chunks = []
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
