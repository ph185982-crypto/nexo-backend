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


# Com a chave do provedor inválida, cada roteiro pedia dez blocos em paralelo,
# levava dez 401 e só então caía no roteiro da lei — 2,5s e dez chamadas
# jogadas fora em toda aula que o candidato abre. O cooldown curto evita isso
# sem travar a volta do LLM: passados cinco minutos ele tenta de novo, então
# uma chave nova entra em serviço sozinha, sem deploy.
_LLM_DOWN_UNTIL = 0.0
_LLM_COOLDOWN_SECS = 300.0


def _llm_worth_trying() -> bool:
    import time
    return time.monotonic() >= _LLM_DOWN_UNTIL


def _mark_llm_down() -> None:
    import time
    global _LLM_DOWN_UNTIL
    _LLM_DOWN_UNTIL = time.monotonic() + _LLM_COOLDOWN_SECS


async def build_script(topic_id: str) -> dict:
    store = get_store()
    topic = store.get_topic(topic_id)
    if not topic:
        raise PodcastLocalError("Tópico não encontrado")
    subj = store.get_subject(str(topic["subject_id"]))
    subj_name = subj["name"] if subj else ""

    arts = store.get_articles(topic_id_=topic_id, limit=100000)
    if not arts:
        return _question_script(topic, subj_name, store)

    from prf.services import podcast_service

    articles_in = [_for_podcast(a) for a in arts]
    parts = podcast_service.plan_parts(articles_in)
    if not parts:
        raise PodcastLocalError("Não foi possível planejar a aula")

    # O roteiro LLM é o preferido — inventa a ocorrência de rua, a
    # jurisprudência e a assertiva no estilo da banca, que é o que o seed não
    # tem. Mas ele é o único pedaço do modo local que depende de credencial, e
    # com a chave inválida o episódio simplesmente não saía (503). O roteiro
    # derivado da lei entra no lugar: mais curto, sem material inventado, e
    # sempre disponível. Assim que existir chave válida o LLM volta a ganhar,
    # sem mudar nada aqui.
    engine = "llm"
    episode = None
    if _llm_worth_trying():
        try:
            episode = await podcast_service.generate_episode(topic["name"], subj_name, parts[0])
        except Exception as e:
            logger.warning(f"[LOCAL] Roteiro LLM falhou ({e}); usando roteiro da lei")
        if not episode or not episode.get("turns"):
            _mark_llm_down()

    if not episode or not episode.get("turns"):
        from prf.local.script_builder import build_episode
        episode = build_episode(topic["name"], subj_name, parts[0])
        engine = "lei"

    if not episode.get("turns"):
        raise PodcastLocalError("Conteúdo insuficiente para montar a aula deste tópico")

    return {
        "topic_id": str(topic["id"]),
        "title": topic["name"],
        "subject_name": subj_name,
        "turns": episode["turns"],
        "segment_count": episode["segment_count"],
        "duration_secs": episode["duration_secs"],
        "word_count": episode["word_count"],
        "total_parts": len(parts),
        "engine": engine,
    }


# Um tópico sem lei seca não é um tópico sem aula: 80 dos 138 não têm artigo
# cadastrado (Português e Raciocínio Lógico não têm lei nenhuma, por natureza)
# e têm questão comentada. Antes isso era 503 e o áudio desses tópicos
# simplesmente não existia.
def _question_script(topic: dict, subj_name: str, store) -> dict:
    from prf.local.script_builder import build_question_episode

    questions = store.get_questions(topic_id_=str(topic["id"]), limit=40)
    if not questions:
        raise PodcastLocalError("Tópico sem lei seca e sem questões cadastradas")

    episode = build_question_episode(topic["name"], subj_name, questions)
    if not episode.get("turns"):
        raise PodcastLocalError("Conteúdo insuficiente para montar a aula deste tópico")

    return {
        "topic_id": str(topic["id"]),
        "title": topic["name"],
        "subject_name": subj_name,
        "turns": episode["turns"],
        "segment_count": episode["segment_count"],
        "duration_secs": episode["duration_secs"],
        "word_count": episode["word_count"],
        "total_parts": 1,
        "engine": "questoes",
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

    if not all(r[1] for r in results):
        raise PodcastLocalError("Síntese de áudio indisponível — nenhuma voz respondeu")

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
