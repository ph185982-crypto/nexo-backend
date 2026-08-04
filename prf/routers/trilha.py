"""Trilha do edital — o mapa macro do estudo e o conteúdo de cada tópico.

A plataforma já tinha missão diária e questões avulsas, mas nada que
respondesse "quanto do edital eu já cobri e quanto falta". Sem esse mapa o
candidato responde questão solta e não enxerga avanço, que é a queixa que
motivou esta trilha.

São duas visões. A trilha lista as matérias e seus tópicos com a cobertura
real de cada um. O tópico reúne, numa resposta só, a lei que o rege, as
questões que já caíram sobre ele e o áudio da aula — o conteúdo existia, mas
morava em três lugares distintos e o candidato tinha de garimpar.
"""
from __future__ import annotations

import logging
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository

logger = logging.getLogger(__name__)

router = APIRouter()

# Quantas questões de um tópico precisam ser respondidas para considerá-lo
# coberto. Abaixo disso o desempenho ainda é ruído estatístico.
MIN_ATTEMPTS_FOR_COVERAGE = 5


@router.get("")
@router.get("/")
async def get_trilha(
    exam: str | None = Query(None, description="Filtra o certame: PRF ou PM"),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """O mapa do edital: matérias, tópicos e quanto de cada um já foi coberto."""
    profile = await repo._fetchrow(
        "SELECT target_exam, exam_date, weekly_goal_hours FROM user_profiles WHERE user_id = $1",
        user_id,
    ) or {}
    target = (exam or profile.get("target_exam") or "PMGO").upper()
    is_pm = target.startswith("PM")
    weight_col = "s.weight_pm" if is_pm else "s.weight_prf"

    rows = await repo._fetch(
        f"""
        SELECT s.id   AS subject_id, s.name AS subject_name, s.slug AS subject_slug,
               s.color, s.icon, {weight_col} AS weight_exam, s.display_order,
               t.id   AS topic_id, t.name AS topic_name, t.slug AS topic_slug,
               t.weight AS topic_weight,
               (SELECT COUNT(*) FROM questions q
                 WHERE q.topic_id = t.id AND q.is_active)          AS questions_total,
               (SELECT COUNT(*) FROM legal_articles la
                 WHERE la.topic_id = t.id)                          AS articles_total,
               (SELECT COUNT(DISTINCT a.question_id)
                  FROM question_attempts a JOIN questions q2 ON q2.id = a.question_id
                 WHERE q2.topic_id = t.id AND a.user_id = $1)       AS questions_answered,
               (SELECT COUNT(*)
                  FROM question_attempts a JOIN questions q3 ON q3.id = a.question_id
                 WHERE q3.topic_id = t.id AND a.user_id = $1 AND a.is_correct) AS correct,
               (SELECT COUNT(*)
                  FROM question_attempts a JOIN questions q4 ON q4.id = a.question_id
                 WHERE q4.topic_id = t.id AND a.user_id = $1)       AS attempts,
               COALESCE(p.law_read, FALSE)   AS law_read,
               COALESCE(p.audio_done, FALSE) AS audio_done,
               p.last_studied_at
          FROM subjects s
          JOIN topics t ON t.subject_id = s.id
          LEFT JOIN user_topic_progress p ON p.topic_id = t.id AND p.user_id = $1
         WHERE s.is_active AND {weight_col} > 0
         ORDER BY s.display_order, t.display_order
        """,
        user_id,
    )

    subjects: dict[str, dict] = {}
    for r in rows:
        key = str(r["subject_id"])
        sub = subjects.setdefault(key, {
            "subject_id": key,
            "name": r["subject_name"],
            "slug": r["subject_slug"],
            "color": r["color"],
            "icon": r["icon"],
            "weight": float(r["weight_exam"] or 0),
            "topics": [],
        })

        attempts = r["attempts"] or 0
        accuracy = round((r["correct"] or 0) / attempts * 100, 1) if attempts else 0.0
        answered = r["questions_answered"] or 0
        total_q = r["questions_total"] or 0

        # Cobertura mistura o que foi visto com o que foi acertado: responder
        # muito errando tudo não é tópico coberto, é tópico a refazer.
        if total_q:
            seen = min(answered / max(min(total_q, 20), 1), 1.0)
        else:
            seen = 1.0 if r["law_read"] else 0.0
        quality = accuracy / 100 if attempts >= MIN_ATTEMPTS_FOR_COVERAGE else 0.0
        coverage = round((seen * 0.6 + quality * 0.4) * 100, 1)

        sub["topics"].append({
            "topic_id": str(r["topic_id"]),
            "name": r["topic_name"],
            "slug": r["topic_slug"],
            "weight": float(r["topic_weight"] or 0),
            "questions_total": total_q,
            "questions_answered": answered,
            "articles_total": r["articles_total"] or 0,
            "attempts": attempts,
            "accuracy": accuracy,
            "law_read": r["law_read"],
            "audio_done": r["audio_done"],
            "coverage": coverage,
            "status": (
                "dominado" if coverage >= 75 else
                "em-andamento" if coverage > 0 else
                "nao-iniciado"
            ),
            "last_studied_at": r["last_studied_at"],
        })

    for sub in subjects.values():
        tops = sub["topics"]
        sub["coverage"] = round(sum(t["coverage"] for t in tops) / len(tops), 1) if tops else 0.0
        sub["topics_total"] = len(tops)
        sub["topics_done"] = sum(1 for t in tops if t["status"] == "dominado")

    ordered = list(subjects.values())

    # A cobertura do edital pesa cada matéria pelo que ela vale na prova: 1%
    # ganho em Legislação de Trânsito não vale o mesmo que 1% em Espanhol.
    weight_sum = sum(s["weight"] for s in ordered) or 1
    overall = round(sum(s["coverage"] * s["weight"] for s in ordered) / weight_sum, 1)

    exam_date = profile.get("exam_date")
    days_left = (exam_date - date.today()).days if exam_date else None

    pending = sum(
        1 for s in ordered for t in s["topics"] if t["status"] != "dominado"
    )
    return {
        "target_exam": target,
        "exam_date": exam_date,
        "days_left": days_left,
        "coverage": overall,
        "subjects": ordered,
        "topics_total": sum(s["topics_total"] for s in ordered),
        "topics_done": sum(s["topics_done"] for s in ordered),
        "topics_pending": pending,
        # Com prazo conhecido, quantos tópicos por semana ainda faltam fechar.
        "topics_per_week_needed": (
            round(pending / max(days_left / 7, 1), 1)
            if days_left and days_left > 0 and pending else None
        ),
    }


@router.get("/topicos/{topic_id}")
async def get_topico(
    topic_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Tudo de um tópico numa resposta: a lei, as questões e o áudio."""
    topic = await repo._fetchrow(
        """SELECT t.id, t.name, t.slug, t.weight,
                  s.id AS subject_id, s.name AS subject_name, s.slug AS subject_slug,
                  s.color
             FROM topics t JOIN subjects s ON s.id = t.subject_id
            WHERE t.id = $1""",
        topic_id,
    )
    if not topic:
        raise HTTPException(404, "Tópico não encontrado")

    articles = await repo._fetch(
        """SELECT la.id, la.article_number, la.official_text, la.simple_text,
                  la.chapter, ld.name AS document_name, ld.abbreviation,
                  (b.id IS NOT NULL) AS is_bookmarked
             FROM legal_articles la
             JOIN legal_documents ld ON ld.id = la.document_id
             LEFT JOIN user_legal_bookmarks b
                    ON b.article_id = la.id AND b.user_id = $2
            WHERE la.topic_id = $1
            ORDER BY ld.display_order, la.display_order
            LIMIT 400""",
        topic_id, user_id,
    )

    stats = await repo._fetchrow(
        """SELECT COUNT(*) FILTER (WHERE q.is_active)          AS questions_total,
                  COUNT(DISTINCT a.question_id)                AS answered,
                  COUNT(a.id)                                  AS attempts,
                  COUNT(a.id) FILTER (WHERE a.is_correct)      AS correct
             FROM questions q
             LEFT JOIN question_attempts a
                    ON a.question_id = q.id AND a.user_id = $2
            WHERE q.topic_id = $1""",
        topic_id, user_id,
    ) or {}

    lessons = await repo._fetch(
        """SELECT al.id, al.title, al.description, al.duration_secs, al.lesson_type
             FROM audio_lessons al
            WHERE al.is_active AND al.subject_id = $1
            ORDER BY al.display_order LIMIT 10""",
        topic["subject_id"],
    )

    progress = await repo._fetchrow(
        "SELECT law_read, audio_done, notes, last_studied_at "
        "  FROM user_topic_progress WHERE user_id = $1 AND topic_id = $2",
        user_id, topic_id,
    ) or {}

    attempts = stats.get("attempts") or 0
    return {
        "topic": {
            "id": str(topic["id"]),
            "name": topic["name"],
            "slug": topic["slug"],
            "weight": float(topic["weight"] or 0),
            "subject_id": str(topic["subject_id"]),
            "subject_name": topic["subject_name"],
            "color": topic["color"],
        },
        "lei": [
            {
                "id": str(a["id"]),
                "article_number": a["article_number"],
                "document": a["abbreviation"] or a["document_name"],
                "chapter": a["chapter"],
                "official_text": a["official_text"],
                "simple_text": a["simple_text"],
                "is_bookmarked": a["is_bookmarked"],
            }
            for a in articles
        ],
        "questoes": {
            "total": stats.get("questions_total") or 0,
            "respondidas": stats.get("answered") or 0,
            "tentativas": attempts,
            "acuracia": round((stats.get("correct") or 0) / attempts * 100, 1) if attempts else 0.0,
        },
        "audios": [
            {
                "id": str(l["id"]), "title": l["title"],
                "description": l["description"],
                "duration_secs": l["duration_secs"], "type": l["lesson_type"],
            }
            for l in lessons
        ],
        "progresso": {
            "law_read": progress.get("law_read", False),
            "audio_done": progress.get("audio_done", False),
            "notes": progress.get("notes"),
            "last_studied_at": progress.get("last_studied_at"),
        },
    }


@router.post("/topicos/{topic_id}/progresso")
async def set_topico_progresso(
    topic_id: UUID,
    law_read: bool | None = Query(None),
    audio_done: bool | None = Query(None),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Marca a lei como lida ou o áudio como ouvido para este tópico."""
    exists = await repo._fetchval("SELECT 1 FROM topics WHERE id = $1", topic_id)
    if not exists:
        raise HTTPException(404, "Tópico não encontrado")

    row = await repo._fetchrow(
        """INSERT INTO user_topic_progress (user_id, topic_id, law_read, audio_done, last_studied_at)
           VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE), NOW())
           ON CONFLICT (user_id, topic_id) DO UPDATE SET
             law_read   = COALESCE($3, user_topic_progress.law_read),
             audio_done = COALESCE($4, user_topic_progress.audio_done),
             last_studied_at = NOW()
           RETURNING law_read, audio_done, last_studied_at""",
        user_id, topic_id, law_read, audio_done,
    )
    return dict(row or {})


@router.get("/proximo")
async def proximo_passo(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """O que estudar agora — um tópico só, escolhido pelo custo de ignorá-lo.

    A pergunta que o candidato faz todo dia é "o que eu faço hoje". Devolver a
    trilha inteira empurra essa decisão de volta para ele, que é justamente o
    trabalho que a ferramenta deveria tirar do caminho.
    """
    profile = await repo._fetchrow(
        "SELECT target_exam FROM user_profiles WHERE user_id = $1", user_id,
    ) or {}
    target = (profile.get("target_exam") or "PMGO").upper()
    weight_col = "s.weight_pm" if target.startswith("PM") else "s.weight_prf"

    row = await repo._fetchrow(
        f"""
        WITH t AS (
          SELECT tp.id, tp.name, tp.slug, tp.weight, s.name AS subject_name,
                 {weight_col} AS weight_exam, s.color,
                 (SELECT COUNT(*) FROM questions q
                   WHERE q.topic_id = tp.id AND q.is_active) AS q_total,
                 (SELECT COUNT(*) FROM legal_articles la WHERE la.topic_id = tp.id) AS a_total,
                 (SELECT COUNT(DISTINCT a.question_id)
                    FROM question_attempts a JOIN questions q2 ON q2.id = a.question_id
                   WHERE q2.topic_id = tp.id AND a.user_id = $1) AS answered,
                 (SELECT COUNT(*) FROM question_attempts a
                    JOIN questions q3 ON q3.id = a.question_id
                   WHERE q3.topic_id = tp.id AND a.user_id = $1 AND a.is_correct) AS correct,
                 (SELECT COUNT(*) FROM question_attempts a
                    JOIN questions q4 ON q4.id = a.question_id
                   WHERE q4.topic_id = tp.id AND a.user_id = $1) AS attempts
            FROM topics tp JOIN subjects s ON s.id = tp.subject_id
           WHERE s.is_active AND {weight_col} > 0
        )
        SELECT *,
               (COALESCE(weight_exam, 1) * COALESCE(weight, 1))
               * (1.0 - LEAST(answered::float / GREATEST(LEAST(q_total, 20), 1), 1.0))
               * (CASE WHEN attempts >= 5
                       THEN 1.4 - (correct::float / attempts)
                       ELSE 1.0 END) AS prioridade
          FROM t
         WHERE q_total > 0 OR a_total > 0
         ORDER BY prioridade DESC
         LIMIT 1
        """,
        user_id,
    )
    if not row:
        raise HTTPException(404, "Nenhum tópico disponível na trilha")

    attempts = row["attempts"] or 0
    accuracy = round((row["correct"] or 0) / attempts * 100, 1) if attempts else None
    if not attempts:
        motivo = f"Você ainda não respondeu nada de {row['name']}, e é matéria de peso na prova."
    elif accuracy is not None and accuracy < 60:
        motivo = f"Seu aproveitamento em {row['name']} está em {accuracy}% — é onde você mais perde ponto."
    else:
        motivo = f"{row['name']} ainda tem bastante conteúdo que você não viu."

    return {
        "topic_id": str(row["id"]),
        "topic_name": row["name"],
        "subject_name": row["subject_name"],
        "color": row["color"],
        "motivo": motivo,
        "artigos_para_ler": row["a_total"] or 0,
        "questoes_disponiveis": row["q_total"] or 0,
        "ja_respondidas": row["answered"] or 0,
        "acuracia": accuracy,
    }
