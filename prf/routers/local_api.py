"""
Modo local — a plataforma inteira funcionando sem Postgres.

O banco (Render) está fora do ar por cobrança da conta, sem previsão. Este
router serve o mesmo edital (matérias, tópicos, lei seca, questões,
flashcards, missão adaptativa, podcast) a partir de arquivos que já viajam
no deploy (prf/local/content.py) e dos motores puros que já existiam
(priority.py, mission.py, spaced_review.py) — nenhum deles nunca dependeu
de banco, só de quem chamava.

O que muda: quem guarda o progresso (XP, sequência, respostas, revisão
espaçada) é o navegador do candidato, não uma tabela. Todo endpoint aqui é
sem estado — recebe o que precisa no corpo da requisição e devolve o
resultado, sem persistir nada no servidor.
"""
from __future__ import annotations

import logging
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from prf.local.content import get_store
from prf.local.mission_service import generate_mission
from prf.services.auth_service import create_token

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/register")
async def local_register():
    """Cria uma identidade de dispositivo. Não grava nada — o token JWT já
    é autossuficiente (é o que o resto do app sempre usou para autenticar,
    sem nunca precisar consultar o banco para isso)."""
    uid = uuid4()
    return {"access_token": create_token(uid), "user_id": str(uid)}


@router.get("/subjects")
async def local_subjects():
    store = get_store()
    return {"subjects": [
        {
            "id": str(s["id"]), "name": s["name"], "slug": s["slug"],
            "description": s.get("description"), "weight_prf": s.get("weight_prf"),
            "weight_pm": s.get("weight_pm"), "color": s.get("color"),
            "icon": s.get("icon"), "display_order": s.get("display_order"),
        }
        for s in store.get_subjects()
    ]}


@router.get("/topics")
async def local_topics(subject_id: str = Query(...)):
    store = get_store()
    subj = store.get_subject(subject_id)
    if not subj:
        raise HTTPException(404, "Matéria não encontrada")
    return {"topics": [
        {"id": str(t["id"]), "name": t["name"], "slug": t["slug"], "weight": t.get("weight")}
        for t in store.get_topics(subj["slug"])
    ]}


@router.get("/questions")
async def local_questions(
    subject_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    limit: int = Query(15, ge=1, le=100),
    question_type: Optional[str] = None,
    ids: Optional[str] = None,
):
    store = get_store()
    if ids:
        qs = store.get_questions_by_ids(ids.split(","))
    else:
        qs = store.get_questions(
            subject_id_=subject_id, topic_id_=topic_id, limit=limit,
            question_type=question_type,
        )
    from prf.local.mission_service import _public_question
    return {"questions": [_public_question(q) for q in qs]}


@router.post("/answer")
async def local_answer(body: dict = Body(...)):
    store = get_store()
    qid = body.get("question_id")
    selected = str(body.get("selected_alternative_id") or "")
    q = store.get_question(qid)
    if not q:
        raise HTTPException(404, "Questão não encontrada")

    correct = next((a for a in q["alternatives"] if a["is_correct"]), None)
    selected_alt = next((a for a in q["alternatives"] if str(a["id"]) == selected), None)
    is_correct = bool(correct and selected_alt and str(correct["id"]) == selected)

    def _alt_out(a):
        return {"id": str(a["id"]), "letter": a["letter"], "text": a["text"], "display_order": 0}

    return {
        "is_correct": is_correct,
        "correct_alternative": _alt_out(correct) if correct else None,
        "selected_alternative": _alt_out(selected_alt) if selected_alt else None,
        "explanation": q.get("explanation"),
        "legal_basis": q.get("legal_basis"),
        "alternative_explanations": {
            a["letter"]: a.get("explanation", "") for a in q["alternatives"] if a.get("explanation")
        },
        "review_scheduled": not is_correct,
        "xp_earned": 10 if is_correct else 3,
        "error_recorded": not is_correct,
    }


@router.get("/legal")
async def local_legal(
    subject_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    limit: int = Query(15, ge=1, le=100),
    ids: Optional[str] = None,
):
    store = get_store()
    from prf.local.mission_service import _public_article
    if ids:
        arts = store.get_articles_by_ids(ids.split(","))
    else:
        arts = store.get_articles(subject_id_=subject_id, topic_id_=topic_id, limit=limit)
    return {"articles": [_public_article(a) for a in arts]}


@router.get("/flashcards")
async def local_flashcards(topic_id: str = Query(...), limit: int = Query(12, ge=1, le=50)):
    store = get_store()
    from prf.local.mission_service import _public_flashcard
    cards = store.get_flashcards(topic_id, limit=limit)
    return {"cards": [_public_flashcard(c) for c in cards]}


@router.post("/mission")
async def local_mission(client_state: dict = Body(default_factory=dict)):
    try:
        return generate_mission(client_state or {})
    except Exception as e:
        logger.error(f"[LOCAL] Falha gerando missão: {e}")
        raise HTTPException(500, f"Falha ao gerar missão: {e}")


@router.post("/podcast/script")
async def local_podcast_script(body: dict = Body(...)):
    from prf.local.podcast_local import build_script, PodcastLocalError
    topic_id = body.get("topic_id")
    if not topic_id:
        raise HTTPException(400, "topic_id é obrigatório")
    try:
        return await build_script(topic_id)
    except PodcastLocalError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        logger.error(f"[LOCAL] Falha gerando roteiro: {e}")
        raise HTTPException(500, f"Falha ao gerar roteiro: {e}")


@router.post("/podcast/audio")
async def local_podcast_audio(body: dict = Body(...)):
    """Recebe os `turns` que /podcast/script já devolveu e sintetiza o
    áudio do episódio inteiro. Sem cache no servidor — o cliente guarda o
    blob resultante no IndexedDB e nunca precisa chamar de novo."""
    from prf.local.podcast_local import synthesize_audio, PodcastLocalError
    import io

    turns = body.get("turns")
    if not turns:
        raise HTTPException(400, "turns é obrigatório")
    try:
        audio, boundaries = await synthesize_audio(turns)
    except PodcastLocalError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        logger.error(f"[LOCAL] Falha sintetizando áudio: {e}")
        raise HTTPException(500, f"Falha ao sintetizar áudio: {e}")

    return StreamingResponse(
        io.BytesIO(audio),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(audio)),
            "X-Segment-Boundaries": ",".join(str(b) for b in boundaries),
            "Cache-Control": "no-store",
        },
    )
