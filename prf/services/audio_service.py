"""
Audio/Commute Mode Service — generates audio content for study during commute.

Responsibilities:
  - Generate audio lesson scripts from study material
  - Create interactive audio quizzes
  - Manage commute mode content delivery
  - Track audio-based study progress
"""
from __future__ import annotations
import os
import logging
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)


async def generate_audio_script(
    topic: str,
    content: str,
    style: str = "summary",
) -> dict:
    """
    Generate an audio lesson script from study content.
    Styles: summary, quiz, deep_dive, review
    """
    from prf.services import llm_service

    if llm_service.active_provider() is None:
        return _fallback_script(topic, content, style)

    try:
        script = await llm_service.chat(
            [{"role": "user", "content": _build_script_prompt(topic, content, style)}],
            temperature=0.6,
            max_tokens=1200,
        )

        return {
            "script": script,
            "style": style,
            "topic": topic,
            "estimated_duration_secs": len(script.split()) * 0.5,
        }
    except Exception as e:
        logger.error(f"Audio script generation error: {e}")
        return _fallback_script(topic, content, style)


def _build_script_prompt(topic: str, content: str, style: str) -> str:
    base = f"""Crie um roteiro de áudio para estudo no deslocamento sobre: {topic}

Conteúdo base:
{content}

REGRAS:
- Linguagem clara e objetiva
- Frases curtas (máximo 15 palavras)
- Tom profissional mas acessível
- Sem referências visuais ("veja", "observe")
- Adequado para ouvir no trânsito
- Inclua pausas naturais entre seções
"""

    if style == "quiz":
        base += """
FORMATO: Quiz interativo
- Apresente o tema em 2-3 frases
- Faça 5 perguntas de múltipla escolha
- Após cada pergunta, diga "Pense na resposta... [pausa de 5 segundos]"
- Revele a resposta correta com explicação breve
"""
    elif style == "summary":
        base += """
FORMATO: Resumo narrado
- Introdução de 2 frases
- 5-7 pontos principais
- Cada ponto em 2-3 frases
- Conclusão com os 3 destaques mais importantes
"""
    elif style == "review":
        base += """
FORMATO: Revisão rápida
- Vá direto aos pontos-chave
- Máximo 3 minutos de conteúdo
- Foque nos itens mais cobrados
- Termine com uma pergunta para reflexão
"""

    return base


async def generate_audio_lesson(
    topic: str,
    content: str,
    style: str = "summary",
    synthesize: bool = True,
    voice: Optional[str] = None,
) -> dict:
    """Generate script via Gemini then synthesize to MP3 via edge-tts."""
    script_data = await generate_audio_script(topic, content, style)

    if synthesize:
        try:
            from prf.services.tts_service import TTSService
            tts = TTSService(voice=voice)
            audio_bytes = await tts.synthesize(script_data["script"])
            script_data["audio_bytes"] = audio_bytes
            script_data["audio_format"] = "mp3"
            script_data["has_audio"] = len(audio_bytes) > 0
        except Exception as e:
            logger.warning(f"TTS synthesis failed: {e}")
            script_data["has_audio"] = False

    return script_data


def _fallback_script(topic: str, content: str, style: str) -> dict:
    script = f"Tema de hoje: {topic}. {content[:500]}"
    return {
        "script": script,
        "style": style,
        "topic": topic,
        "estimated_duration_secs": len(script.split()) * 0.5,
    }


def build_commute_playlist(
    lessons: list[dict],
    available_minutes: int = 45,
    include_quiz: bool = True,
) -> list[dict]:
    """
    Build an ordered playlist of audio content for a commute session.
    Fits within the available time window.
    """
    playlist = []
    remaining_secs = available_minutes * 60

    review_lessons = [l for l in lessons if l.get("lesson_type") == "review"]
    summary_lessons = [l for l in lessons if l.get("lesson_type") == "summary"]
    quiz_lessons = [l for l in lessons if l.get("lesson_type") == "quiz"]
    other_lessons = [l for l in lessons if l.get("lesson_type") not in ("review", "summary", "quiz")]

    ordered = review_lessons + summary_lessons
    if include_quiz:
        ordered += quiz_lessons
    ordered += other_lessons

    for lesson in ordered:
        duration = lesson.get("duration_secs", 300)
        if duration <= remaining_secs:
            playlist.append({
                "id": lesson["id"],
                "title": lesson["title"],
                "duration_secs": duration,
                "lesson_type": lesson.get("lesson_type", "summary"),
                "subject": lesson.get("subject_name"),
            })
            remaining_secs -= duration

    return playlist
