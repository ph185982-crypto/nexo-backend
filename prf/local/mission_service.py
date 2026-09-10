"""
Missão do dia sem banco — mesmos motores puros de sempre (priority.py,
mission.py), alimentados pelo ContentStore e pelo estado que o cliente
manda a cada chamada, em vez de linhas lidas do Postgres.

A missão não é salva em lugar nenhum aqui: o cliente guarda o resultado e
manda de volta o progresso (blocks_done, ids concluídos) na próxima
chamada. O "banco" é o localStorage do candidato — ver prf/local/state.py.
"""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from prf.engines.priority import SubjectState, PriorityContext, compute_priorities
from prf.engines.mission import build_mission, MissionBlock, Mission
from prf.engines.schedule import day_kind, CONTEUDO, SIMULADO, REVISAO
from prf.engines.exam_profile import exam_profile_for
from prf.models.user import EnergyLevel, StudyMode
from prf.local.content import get_store

BRT = timezone(timedelta(hours=-3))


def _mode_for_hour(hour: int, energy: str) -> StudyMode:
    if energy in ("very_low", "low"):
        return StudyMode.TIRED
    if 6 <= hour <= 9 or 17 <= hour <= 20:
        return StudyMode.COMMUTE
    return StudyMode.FOCUS


def generate_mission(client_state: dict) -> dict:
    """Gera a missão do dia a partir do estado que o navegador mandou.

    `client_state` é o que prf/local/state.py define: mastery por matéria,
    matérias estudadas recentemente (rotação), tópicos pulados hoje (botão
    de pular missão) e o perfil (exame alvo, energia).
    """
    store = get_store()
    profile = client_state.get("profile") or {}
    is_pm = str(profile.get("target_exam") or "PMGO").upper().startswith("PM")
    weight_key = "weight_pm" if is_pm else "weight_prf"

    today = date.today()
    kind = day_kind(today)

    hour = datetime.now(BRT).hour
    energy_str = profile.get("energy") or "medium"
    energy = EnergyLevel(energy_str) if energy_str in EnergyLevel._value2member_map_ else EnergyLevel.MEDIUM
    mode = _mode_for_hour(hour, energy_str)
    available_mins = int(profile.get("available_minutes") or 60)

    mastery = client_state.get("mastery") or {}
    recent_subject_ids = {UUID(x) for x in (client_state.get("recent_subjects") or []) if _is_uuid(x)}
    skip_topic_ids = {str(x) for x in (client_state.get("skip_topic_ids") or [])}

    exam_profile = exam_profile_for(is_pm)

    subject_states: list[SubjectState] = []
    for s in store.get_subjects():
        w = s.get(weight_key) or 0
        if w <= 0:
            continue
        m = mastery.get(str(s["id"])) or {}
        subject_states.append(SubjectState(
            subject_id=s["id"],
            subject_name=s["name"],
            weight_prf=w,
            mastery=m.get("mastery_level", 0) or 0,
            accuracy=m.get("accuracy", 0) or 0,
            total_attempts=m.get("total_attempts", 0) or 0,
            error_count=m.get("error_count", 0) or 0,
            reviews_due=0,
            last_studied=_parse_dt(m.get("last_studied")),
            study_time_mins=m.get("study_time_mins", 0) or 0,
            recurring_errors=m.get("recurring_errors", 0) or 0,
            is_priority=s.get("slug") in (profile.get("priority_subjects") or []),
            exam_items=exam_profile.items_per_subject.get(s["slug"], 0) * exam_profile.block_weight_of(s["slug"]),
            blueprint_item_count=exam_profile.items_of(s["slug"]),
        ))

    days_until_exam = None
    if profile.get("exam_date"):
        try:
            ed = date.fromisoformat(profile["exam_date"])
            days_until_exam = (ed - today).days
        except ValueError:
            pass

    ctx = PriorityContext(
        energy=energy, mode=mode, available_minutes=available_mins,
        hour_of_day=hour, days_until_exam=days_until_exam, today=today,
        study_level=profile.get("study_level", "intermediate"),
        exam_total_items=50 if is_pm else 120,
    )

    priorities = compute_priorities(subject_states, ctx, recent_subject_ids)

    review_due_ids = [UUID(x) for x in (client_state.get("reviews_due_ids") or []) if _is_uuid(x)]
    error_flashcard_ids = [UUID(x) for x in (client_state.get("error_flashcard_ids") or []) if _is_uuid(x)]

    topic_plan: dict = {}
    for p in priorities[:4]:
        subj = store.get_subject(str(p.subject_id))
        if not subj:
            continue
        topic = store.pick_study_topic(subj["slug"], exclude_topic_ids=skip_topic_ids)
        if not topic:
            continue
        arts = store.get_articles(topic_id_=str(topic["id"]), limit=15)
        qtype = None if is_pm else "certo_errado"
        qs = store.get_questions(topic_id_=str(topic["id"]), limit=12, question_type=qtype)
        if not qs:
            qs = store.get_questions(topic_id_=str(topic["id"]), limit=12)
        fcs = store.get_flashcards(str(topic["id"]), limit=12)
        if not (arts or qs):
            continue
        topic_plan[p.subject_id] = {
            "topic_id": topic["id"],
            "topic_name": topic["name"],
            # Não existe episódio pré-gravado: o id do tópico é o marcador
            # que o player usa para gerar roteiro + áudio na hora.
            "episode_ids": [topic["id"]],
            "episode_mins": 40,
            "article_ids": [a["id"] for a in arts],
            "question_ids": [q["id"] for q in qs],
            "flashcard_ids": [c["id"] for c in fcs],
        }

    video = None
    for p in priorities:
        plan = topic_plan.get(p.subject_id)
        if not plan:
            continue
        subj = store.get_subject(str(p.subject_id))
        from prf.seeds.topic_videos import video_for_topic
        video = video_for_topic(
            subject_slug=subj["slug"] if subj else "",
            subject_name=p.subject_name,
            topic_name=plan.get("topic_name") or p.subject_name,
            rotation=today.toordinal(),
        )
        break

    mission = build_mission(
        priorities=priorities,
        context=ctx,
        reviews_due=len(review_due_ids),
        review_card_ids=review_due_ids,
        error_flashcard_ids=error_flashcard_ids,
        is_pm=is_pm,
        topic_plan=topic_plan,
        is_rest_day=False,
        day_kind=kind,
        video=video,
    )

    return _serialize_mission(mission, store)


def _serialize_mission(mission: Mission, store) -> dict:
    blocks_out = []
    for b in mission.blocks:
        blocks_out.append(_serialize_block(b, store))
    return {
        "id": str(mission.id),
        "date": mission.date.isoformat(),
        "status": "pending",
        "estimated_mins": mission.estimated_mins,
        "mode_suggested": mission.mode_suggested,
        "energy_detected": mission.energy_detected,
        "greeting": mission.greeting,
        "day_kind": mission.day_kind,
        "topic_label": mission.topic_label,
        "carried_over": False,
        "blocks": blocks_out,
        "blocks_total": len(blocks_out),
        "blocks_done": 0,
    }


def _serialize_block(b: MissionBlock, store) -> dict:
    payload = dict(b.payload or {})
    if b.block_type in ("questions", "review"):
        qs = store.get_questions_by_ids([str(c) for c in b.content_ids])
        payload["questions"] = [_public_question(q) for q in qs]
    elif b.block_type == "legal_reading":
        arts = store.get_articles_by_ids([str(c) for c in b.content_ids])
        payload["articles"] = [_public_article(a) for a in arts]
    elif b.block_type == "flashcards":
        cards = [store.get_flashcard(str(c)) for c in b.content_ids]
        payload["cards"] = [_public_flashcard(c) for c in cards if c]
    elif b.block_type in ("podcast", "podcast_drill"):
        # content_ids[0] é o topic_id — o player pede roteiro+áudio na hora.
        payload["topic_id"] = str(b.content_ids[0]) if b.content_ids else None

    return {
        "id": str(b.id),
        "block_type": b.block_type,
        "subject_id": str(b.subject_id) if b.subject_id else None,
        "subject_name": b.subject_name,
        "topic_id": str(b.topic_id) if b.topic_id else None,
        "title": b.title,
        "description": b.description,
        "estimated_mins": b.estimated_mins,
        "display_order": b.display_order,
        "content_ids": [str(c) for c in b.content_ids],
        "is_optional": b.is_optional,
        "is_completed": False,
        "mode": b.mode,
        "payload": payload,
        "unit_key": b.unit_key,
    }


def _public_question(q: dict) -> dict:
    return {
        "id": str(q["id"]),
        "subject_id": str(q["subject_id"]),
        "topic_id": str(q["topic_id"]) if q.get("topic_id") else None,
        "question_type": q.get("question_type", "certo_errado"),
        "context_text": q.get("context_text"),
        "text": q["text"],
        "difficulty": q.get("difficulty", "medium"),
        "source": q.get("source"),
        "year": q.get("year"),
        "examiner": q.get("examiner"),
        "alternatives": [
            {"id": str(a["id"]), "letter": a["letter"], "text": a["text"], "display_order": i}
            for i, a in enumerate(q.get("alternatives") or [])
        ],
    }


def _public_article(a: dict) -> dict:
    return {
        "id": str(a["id"]),
        "subject_id": str(a["subject_id"]),
        "topic_id": str(a["topic_id"]) if a.get("topic_id") else None,
        "document_name": a.get("document_name"),
        "article_number": a.get("article_number"),
        "chapter": a.get("chapter"),
        "official_text": a.get("official_text"),
        "simple_text": a.get("simple_text"),
        "highlights": a.get("highlights") or [],
    }


def _public_flashcard(c: dict) -> dict:
    return {
        "id": str(c["id"]),
        "front": c.get("front"),
        "back": c.get("back"),
        "tags": c.get("tags") or [],
    }


def _is_uuid(x) -> bool:
    try:
        UUID(str(x))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v)
    except (ValueError, TypeError):
        return None
