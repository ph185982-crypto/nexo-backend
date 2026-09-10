"""
Podcast sem banco — roteiro (LLM) e áudio (TTS) gerados na hora, a partir
do tópico da missão. Nada é salvo aqui: o cliente recebe o roteiro e o
áudio e guarda os dois no IndexedDB do navegador (ver app.html), então a
segunda vez que abre a mesma aula ela toca instantâneo, sem nova chamada.

Sempre a Parte 1 do tópico (o material mais cobrado, por frequency_score) —
tópicos grandes têm partes 2, 3... que ficam para quando o modo local
ganhar rotação entre partes; hoje a prioridade é a parte que mais vale.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional
from uuid import UUID

from prf.local.content import get_store

logger = logging.getLogger(__name__)


class PodcastLocalError(RuntimeError):
    pass


async def build_script(topic_id: str) -> dict:
    store = get_store()
    topic = store.get_topic(topic_id)
    if not topic:
        raise PodcastLocalError("Tópico não encontrado")
    subj = store.get_subject(str(topic["subject_id"]))
    subj_name = subj["name"] if subj else ""

    arts = store.get_articles(topic_id_=topic_id, limit=100000)
    if not arts:
        raise PodcastLocalError("Tópico sem lei seca cadastrada")

    from prf.services import podcast_service

    articles_in = [_for_podcast(a) for a in arts]
    parts = podcast_service.plan_parts(articles_in)
    if not parts:
        raise PodcastLocalError("Não foi possível planejar a aula")

    episode = await podcast_service.generate_episode(topic["name"], subj_name, parts[0])
    if not episode.get("turns"):
        raise PodcastLocalError("Geração do roteiro falhou — verifique a chave do provedor de IA")

    return {
        "topic_id": str(topic["id"]),
        "title": topic["name"],
        "subject_name": subj_name,
        "turns": episode["turns"],
        "segment_count": episode["segment_count"],
        "duration_secs": episode["duration_secs"],
        "word_count": episode["word_count"],
        "total_parts": len(parts),
    }


async def synthesize_audio(turns: list[dict]) -> tuple[bytes, list[int]]:
    """Sintetiza o episódio inteiro num arquivo só. Devolve (mp3, boundaries)
    — boundaries são os limites (em segundos) de cada bloco, no mesmo
    formato do header X-Segment-Boundaries que o player já entende."""
    from prf.services import podcast_service

    blocks = sorted({t.get("block", 0) for t in turns})
    if not blocks:
        raise PodcastLocalError("Roteiro vazio")

    async def _synth(seq: int):
        seg_turns = [t for t in turns if t.get("block") == seq]
        audio = await podcast_service.synthesize_segment(seg_turns)
        return seq, audio, podcast_service.estimate_duration_secs(seg_turns)

    results = await asyncio.gather(*[_synth(b) for b in blocks])
    results.sort(key=lambda r: r[0])

    if not any(r[1] for r in results):
        raise PodcastLocalError("Síntese de áudio indisponível — configure OPENAI_API_KEY")

    full_audio = b"".join(r[1] for r in results if r[1])
    boundaries: list[int] = []
    acc = 0
    for _, _audio, dur in results:
        acc += dur or 0
        boundaries.append(acc)
    return full_audio, boundaries


def _for_podcast(a: dict) -> dict:
    return {
        "id": str(a["id"]),
        "article_number": a.get("article_number", ""),
        "document_name": a.get("document_name", ""),
        "chapter": a.get("chapter", ""),
        "official_text": a.get("official_text", ""),
        "simple_text": a.get("simple_text", ""),
        "highlights": a.get("highlights") or [],
    }
