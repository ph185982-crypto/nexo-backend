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
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

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


# Áudio pronto: gerado uma vez por scripts/gerar_audios.py e publicado na
# branch `audios` do repositório. O manifesto (só metadados) viaja com o
# código; o MP3 o celular baixa direto do GitHub, que responde com CORS
# aberto, e guarda no IndexedDB para tocar offline.
AUDIO_BASE_URL = os.getenv(
    "PRF_AUDIO_BASE_URL",
    "https://raw.githubusercontent.com/ph185982-crypto/nexo-backend/audios/",
)
_MANIFEST_PATH = Path(__file__).with_name("audio_manifest.json")


@lru_cache(maxsize=1)
def _audio_manifest() -> tuple[dict, dict]:
    """(episódios por id, tópico → {episode, start}). Episódios de trajeto
    têm ~40 min e juntam vários tópicos da mesma matéria, ver
    scripts/gerar_audios.py."""
    try:
        data = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}, {}
    if data.get("version") != 2:
        return {}, {}
    episodes = {e["id"]: e for e in data.get("episodes") or []}
    return episodes, data.get("topics") or {}


def prebuilt_episodes() -> list[dict]:
    return [dict(e, url=AUDIO_BASE_URL + e["file"]) for e in _audio_manifest()[0].values()]


def prebuilt_episode(key: str) -> Optional[dict]:
    """Aceita o id do episódio ou o de um tópico. Pelo tópico (bloco de áudio
    da missão), devolve o episódio que o contém e o segundo em que ele começa,
    para o player abrir direto na matéria do dia."""
    episodes, topics = _audio_manifest()
    key = str(key)
    if key in episodes:
        episode, start, topic_id = episodes[key], 0.0, None
    elif key in topics and topics[key]["episode"] in episodes:
        episode, start, topic_id = episodes[topics[key]["episode"]], topics[key]["start"], key
    else:
        return None
    return dict(episode, url=AUDIO_BASE_URL + episode["file"], start=start, topic_id=topic_id)


def _load_topic(topic_id: str):
    store = get_store()
    topic = store.get_topic(topic_id)
    if not topic:
        raise PodcastLocalError("Tópico não encontrado")
    subj = store.get_subject(str(topic["subject_id"]))
    subj_name = subj["name"] if subj else ""
    arts = store.get_articles(topic_id_=topic_id, limit=100000)
    return store, topic, subj_name, arts


def _plan(arts: list[dict]) -> list[list[dict]]:
    from prf.services import podcast_service

    parts = podcast_service.plan_parts([_for_podcast(a) for a in arts])
    if not parts:
        raise PodcastLocalError("Não foi possível planejar a aula")
    return parts


def build_offline_script(topic_id: str) -> dict:
    """Roteiro sem IA — o mesmo que gerou o áudio pronto da branch `audios`
    (scripts/gerar_audios.py). Determinístico: mesmo conteúdo, mesmo roteiro."""
    from prf.local.script_builder import build_episode

    store, topic, subj_name, arts = _load_topic(topic_id)
    if not arts:
        return _question_script(topic, subj_name, store)
    parts = _plan(arts)
    episode = build_episode(topic["name"], subj_name, parts[0])
    if not episode.get("turns"):
        raise PodcastLocalError("Conteúdo insuficiente para montar a aula deste tópico")
    return _pack(topic, subj_name, episode, len(parts), "lei")


async def build_script(topic_id: str) -> dict:
    store, topic, subj_name, arts = _load_topic(topic_id)
    if not arts:
        return _question_script(topic, subj_name, store)

    from prf.services import podcast_service

    parts = _plan(arts)

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
        return build_offline_script(topic_id)

    return _pack(topic, subj_name, episode, len(parts), engine)


def _pack(topic: dict, subj_name: str, episode: dict, total_parts: int, engine: str) -> dict:
    return {
        "topic_id": str(topic["id"]),
        "title": topic["name"],
        "subject_name": subj_name,
        "turns": episode["turns"],
        "segment_count": episode["segment_count"],
        "duration_secs": episode["duration_secs"],
        "word_count": episode["word_count"],
        "total_parts": total_parts,
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
    return _pack(topic, subj_name, episode, 1, "questoes")


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
