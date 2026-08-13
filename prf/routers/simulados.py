"""Simulados router — exam simulation with block scoring (PRF/PMGO)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from uuid import UUID

from prf.routers.deps import get_repo, get_current_user_id, get_study_service
from prf.database.repository import PRFRepository
from prf.services.study_service import StudyService
from prf.seeds.seed_data import (
    EXAM_BLOCKS, ITEMS_PER_SUBJECT_SIMULADO,
    EXAM_BLOCKS_PM, ITEMS_PER_SUBJECT_SIMULADO_PM,
)

router = APIRouter()


@router.post("/generate")
async def generate_simulado(
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Generate a full exam simulation adapted to the user's target exam."""
    profile = await repo._fetchrow(
        "SELECT target_exam FROM user_profiles WHERE user_id = $1", user_id,
    ) or {}
    target = (profile.get("target_exam") or "PMGO").upper()
    is_pm = target.startswith("PM")

    exam_blocks = EXAM_BLOCKS_PM if is_pm else EXAM_BLOCKS
    items_map = ITEMS_PER_SUBJECT_SIMULADO_PM if is_pm else ITEMS_PER_SUBJECT_SIMULADO
    time_limit = 240 if is_pm else 270
    exam_label = "PMGO" if is_pm else "PRF"
    q_type = "multipla_escolha" if is_pm else "certo_errado"

    block_nums = sorted(exam_blocks.keys())
    questions_by_block = {bn: [] for bn in block_nums}
    subject_rows = await repo._fetch("SELECT id, slug FROM subjects WHERE is_active IS NOT FALSE")
    slug_to_id = {r["slug"]: r["id"] for r in subject_rows}

    for block_num, block_info in exam_blocks.items():
        for subj_slug in block_info["subjects"]:
            subj_id = slug_to_id.get(subj_slug)
            if not subj_id:
                continue
            needed = items_map.get(subj_slug, 5)
            rows = await repo._fetch(
                """SELECT id FROM questions
                   WHERE subject_id = $1 AND question_type = $2
                     AND is_active = TRUE
                   ORDER BY RANDOM() LIMIT $3""",
                subj_id, q_type, needed,
            )
            questions_by_block[block_num].extend([r["id"] for r in rows])

    all_ids = []
    block_map = {}
    for bn in block_nums:
        for qid in questions_by_block[bn]:
            block_map[str(qid)] = bn
            all_ids.append(qid)

    total = len(all_ids)
    min_required = 10 if is_pm else 20
    if total < min_required:
        fmt = "múltipla escolha" if is_pm else "C/E"
        raise HTTPException(
            400,
            f"Banco insuficiente para simulado: apenas {total} questões {fmt} disponíveis"
        )

    import json
    block_scores_init = {
        f"bloco_{bn}": {
            "total": len(questions_by_block[bn]),
            "certas": 0, "erradas": 0,
            "branco": len(questions_by_block[bn]),
            "score": 0,
        }
        for bn in block_nums
    }

    row = await repo._fetchrow(
        """INSERT INTO simulated_exams
           (user_id, title, exam_type, total_questions, time_limit_mins, questions, block_scores)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, started_at""",
        user_id,
        f"Simulado {exam_label} — {total} {'questões' if is_pm else 'itens'}",
        f"simulado_{exam_label.lower()}",
        total,
        time_limit,
        [str(q) for q in all_ids],
        block_scores_init,
    )

    return {
        "id": row["id"],
        "total_questions": total,
        "blocks": {
            f"bloco_{bn}": {
                "total": len(questions_by_block[bn]),
                "subjects": exam_blocks[bn]["subjects"],
                "name": exam_blocks[bn].get("name", f"Bloco {bn}"),
            }
            for bn in block_nums
        },
        "time_limit_mins": time_limit,
        "started_at": row["started_at"],
        "exam_type": exam_label,
        "question_format": "multipla_escolha" if is_pm else "certo_errado",
    }


@router.get("/{exam_id}/questions")
async def get_exam_questions(
    exam_id: UUID,
    block: Optional[int] = Query(None, ge=1, le=3),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get questions for an ongoing exam, optionally filtered by block."""
    import json
    exam = await repo._fetchrow(
        "SELECT * FROM simulated_exams WHERE id = $1 AND user_id = $2",
        exam_id, user_id,
    )
    if not exam:
        raise HTTPException(404, "Simulado não encontrado")

    q_ids = json.loads(exam["questions"]) if isinstance(exam["questions"], str) else exam["questions"]
    block_scores = json.loads(exam["block_scores"]) if isinstance(exam["block_scores"], str) else exam["block_scores"]

    is_pm = exam.get("exam_type", "").startswith("simulado_pm")
    active_blocks = EXAM_BLOCKS_PM if is_pm else EXAM_BLOCKS

    results = []
    for qid_str in q_ids:
        q = await repo._fetchrow(
            """SELECT q.id, q.question_type, q.context_text, q.text, q.difficulty,
                      s.name as subject_name, s.slug as subject_slug
               FROM questions q JOIN subjects s ON q.subject_id = s.id
               WHERE q.id = $1""",
            qid_str if isinstance(qid_str, UUID) else UUID(qid_str),
        )
        if not q:
            continue

        subj_slug = q["subject_slug"]
        q_block = None
        for bn, bi in active_blocks.items():
            if subj_slug in bi["subjects"]:
                q_block = bn
                break

        if block and q_block != block:
            continue

        alts = await repo._fetch(
            "SELECT id, letter, text FROM question_alternatives WHERE question_id = $1 ORDER BY display_order",
            q["id"],
        )
        results.append({
            "id": q["id"],
            "block": q_block,
            "question_type": q["question_type"],
            "context_text": q.get("context_text"),
            "text": q["text"],
            "subject_name": q["subject_name"],
            "alternatives": [{"id": a["id"], "letter": a["letter"], "text": a["text"]} for a in alts],
        })

    return {"questions": results, "total": len(results)}


@router.post("/{exam_id}/answer")
async def answer_exam_question(
    exam_id: UUID,
    question_id: UUID,
    selected: str,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Answer a single question in the exam."""
    import json
    valid_answers = {"A", "B", "C", "D", "E"}
    if selected.upper() not in valid_answers:
        raise HTTPException(400, "Resposta deve ser A, B, C, D ou E")

    exam = await repo._fetchrow(
        "SELECT * FROM simulated_exams WHERE id = $1 AND user_id = $2",
        exam_id, user_id,
    )
    if not exam:
        raise HTTPException(404, "Simulado não encontrado")
    if exam["is_completed"]:
        raise HTTPException(400, "Simulado já finalizado")

    correct_alt = await repo._fetchrow(
        "SELECT letter FROM question_alternatives WHERE question_id = $1 AND is_correct = TRUE",
        question_id,
    )
    if not correct_alt:
        raise HTTPException(404, "Questão não encontrada no simulado")

    is_correct = selected.upper() == correct_alt["letter"]

    answers = json.loads(exam["answers"]) if isinstance(exam["answers"], str) else exam["answers"]
    answers[str(question_id)] = {"selected": selected.upper(), "correct": is_correct}

    await repo._execute(
        "UPDATE simulated_exams SET answers = $1 WHERE id = $2",
        answers, exam_id,
    )

    return {"is_correct": is_correct, "correct_answer": correct_alt["letter"]}


@router.post("/{exam_id}/finish")
async def finish_exam(
    exam_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
    study: StudyService = Depends(get_study_service),
):
    """Finish the exam and calculate scoring (CEBRASPE for PRF, AOCP for PMGO)."""
    import json
    from datetime import datetime, timezone

    exam = await repo._fetchrow(
        "SELECT * FROM simulated_exams WHERE id = $1 AND user_id = $2",
        exam_id, user_id,
    )
    if not exam:
        raise HTTPException(404, "Simulado não encontrado")

    already_finished = bool(exam["is_completed"])

    q_ids = json.loads(exam["questions"]) if isinstance(exam["questions"], str) else exam["questions"]
    answers = json.loads(exam["answers"]) if isinstance(exam["answers"], str) else exam["answers"]

    is_pm = exam.get("exam_type", "").startswith("simulado_pm")
    active_blocks = EXAM_BLOCKS_PM if is_pm else EXAM_BLOCKS
    block_nums = sorted(active_blocks.keys())

    block_stats = {bn: {"certas": 0, "erradas": 0, "branco": 0, "total": 0} for bn in block_nums}

    for qid_str in q_ids:
        q = await repo._fetchrow(
            "SELECT s.slug FROM questions q JOIN subjects s ON q.subject_id = s.id WHERE q.id = $1",
            qid_str if isinstance(qid_str, UUID) else UUID(qid_str),
        )
        if not q:
            continue
        q_block = None
        for bn, bi in active_blocks.items():
            if q["slug"] in bi["subjects"]:
                q_block = bn
                break
        if not q_block:
            continue

        block_stats[q_block]["total"] += 1
        ans = answers.get(str(qid_str) if isinstance(qid_str, UUID) else qid_str)
        if not ans:
            block_stats[q_block]["branco"] += 1
        elif ans.get("correct"):
            block_stats[q_block]["certas"] += 1
        else:
            block_stats[q_block]["erradas"] += 1

    if is_pm:
        for bn in block_stats:
            s = block_stats[bn]
            weight = active_blocks[bn].get("weight", 1)
            s["score"] = s["certas"] * weight

        total_score = sum(s["score"] for s in block_stats.values())
        max_score = sum(
            block_stats[bn]["total"] * active_blocks[bn].get("weight", 1)
            for bn in block_nums
        )
        percentage = round(total_score / max(max_score, 1) * 100, 1)
        eliminated = percentage < 60
        any_zero = any(
            block_stats[bn]["certas"] == 0 and block_stats[bn]["total"] > 0
            for bn in block_nums
        )
        if any_zero:
            eliminated = True

        score_liquid = total_score
        score_raw = sum(s["certas"] for s in block_stats.values())
    else:
        for bn in block_stats:
            s = block_stats[bn]
            s["score"] = s["certas"] - s["erradas"]

        total_certas = sum(s["certas"] for s in block_stats.values())
        total_erradas = sum(s["erradas"] for s in block_stats.values())
        score_liquid = total_certas - total_erradas
        score_raw = total_certas
        percentage = round(score_liquid / max(len(q_ids), 1) * 100, 1)
        eliminated = any(s["score"] < 0 for s in block_stats.values())

    block_scores_json = {
        f"bloco_{bn}": block_stats[bn] for bn in block_nums
    }

    await repo._execute(
        """UPDATE simulated_exams
           SET is_completed = TRUE, ended_at = $1, score = $2, score_raw = $3,
               block_scores = $4, eliminated = $5
           WHERE id = $6""",
        datetime.now(timezone.utc), score_liquid, score_raw,
        block_scores_json, eliminated, exam_id,
    )

    # As respostas viram tentativas reais: domínio, caderno de erros, revisão
    # e estatística do dia. Só na primeira finalização — o endpoint pode ser
    # chamado de novo pelo resume, e isso duplicaria o histórico.
    absorbed = {"recorded": 0}
    if not already_finished:
        try:
            absorbed = await study.absorb_exam_answers(user_id, answers or {})
        except Exception:
            # Nota do simulado nunca deve ser perdida por falha na absorção.
            pass

    result = {
        "score": score_liquid,
        "score_raw": score_raw,
        "total_questions": len(q_ids),
        "certas": sum(s["certas"] for s in block_stats.values()),
        "erradas": sum(s["erradas"] for s in block_stats.values()),
        "branco": sum(s["branco"] for s in block_stats.values()),
        "blocks": block_scores_json,
        "eliminated": eliminated,
        "percentage": percentage,
        "answers_absorbed": absorbed.get("recorded", 0),
    }

    if is_pm:
        result["scoring_method"] = "aocp_weighted"
        result["max_score"] = max_score
        result["passing_threshold"] = "60%"
    else:
        result["scoring_method"] = "cebraspe"

    return result


@router.get("/history")
async def simulado_history(
    limit: int = Query(default=10, ge=1, le=50),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Get user's simulado history."""
    exams = await repo._fetch(
        """SELECT id, title, total_questions, score, score_raw, block_scores,
                  eliminated, is_completed, started_at, ended_at
           FROM simulated_exams WHERE user_id = $1
           ORDER BY started_at DESC LIMIT $2""",
        user_id, limit,
    )
    return {"exams": [dict(e) for e in exams], "total": len(exams)}


@router.get("/{exam_id}")
async def get_exam_state(
    exam_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Estado completo do simulado para retomar após reload/app fechado.

    Registrado por último no arquivo de propósito: como é um path dinâmico
    de segmento único (`/{exam_id}`), se viesse antes de `/history` ele
    "roubaria" a rota estática — toda chamada a /simulados/history cairia
    aqui tentando validar "history" como UUID e quebraria com 422.

    O timer do simulado antes só existia na memória do JS — se a aba
    recarregasse, o navegador matasse o processo em background, ou o
    celular travasse a tela durante as 4h30 de prova, o candidato perdia
    a tentativa inteira, sem chance de recuperar. Tudo que precisa pra
    reconstruir o estado (perguntas, respostas já dadas, tempo restante)
    já ficava salvo no banco a cada resposta — só faltava expor aqui.
    """
    import json
    exam = await repo._fetchrow(
        "SELECT * FROM simulated_exams WHERE id = $1 AND user_id = $2",
        exam_id, user_id,
    )
    if not exam:
        raise HTTPException(404, "Simulado não encontrado")

    q_ids = json.loads(exam["questions"]) if isinstance(exam["questions"], str) else exam["questions"]
    answers = json.loads(exam["answers"]) if isinstance(exam["answers"], str) else exam["answers"]

    is_pm = exam.get("exam_type", "").startswith("simulado_pm")
    active_blocks = EXAM_BLOCKS_PM if is_pm else EXAM_BLOCKS
    exam_label = "PMGO" if is_pm else "PRF"

    block_counts: dict[int, int] = {bn: 0 for bn in active_blocks}
    for qid_str in q_ids:
        q = await repo._fetchrow(
            "SELECT s.slug FROM questions q JOIN subjects s ON q.subject_id = s.id WHERE q.id = $1",
            qid_str if isinstance(qid_str, UUID) else UUID(qid_str),
        )
        if not q:
            continue
        for bn, bi in active_blocks.items():
            if q["slug"] in bi["subjects"]:
                block_counts[bn] += 1
                break

    return {
        "id": exam["id"],
        "total_questions": len(q_ids),
        "blocks": {
            f"bloco_{bn}": {
                "total": block_counts[bn],
                "subjects": active_blocks[bn]["subjects"],
                "name": active_blocks[bn].get("name", f"Bloco {bn}"),
            }
            for bn in sorted(active_blocks.keys()) if block_counts[bn] > 0
        },
        "time_limit_mins": exam["time_limit_mins"],
        "started_at": exam["started_at"],
        "exam_type": exam_label,
        "question_format": "multipla_escolha" if is_pm else "certo_errado",
        "is_completed": exam["is_completed"],
        "answers": {str(k): v for k, v in (answers or {}).items()},
    }
