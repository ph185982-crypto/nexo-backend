"""
Mission Builder Engine — constructs the daily study mission.

A mission is composed of ordered blocks:
  1. Overdue reviews (always first if any)
  2. Highest-priority subject questions
  3. Legal reading or flashcards
  4. Commute audio block (if applicable)
  5. Error-based flashcards

The builder respects:
  - Available time
  - Energy level
  - Study mode
  - Interleaving (mixes subjects within blocks)
  - Microlearning (fits blocks into 5-45 minute windows)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from uuid import UUID, uuid4

from prf.models.user import EnergyLevel, StudyMode
from prf.engines.priority import PriorityResult, PriorityContext


@dataclass
class MissionBlock:
    id: UUID = field(default_factory=uuid4)
    block_type: str = "questions"       # review, questions, legal_reading, flashcards, audio_lesson
    subject_id: Optional[UUID] = None
    subject_name: Optional[str] = None
    topic_id: Optional[UUID] = None
    title: str = ""
    description: str = ""
    estimated_mins: int = 10
    display_order: int = 0
    content_ids: list[UUID] = field(default_factory=list)
    is_optional: bool = False
    mode: str = "focus"


@dataclass
class Mission:
    id: UUID = field(default_factory=uuid4)
    date: date = field(default_factory=date.today)
    greeting: str = ""
    estimated_mins: int = 0
    blocks: list[MissionBlock] = field(default_factory=list)
    mode_suggested: str = "focus"
    energy_detected: Optional[str] = None


GREETINGS_BY_ENERGY = {
    EnergyLevel.VERY_LOW: [
        "Dia difícil? Vamos com calma — consistência importa mais que intensidade.",
        "Missão leve hoje. O importante é não parar.",
    ],
    EnergyLevel.LOW: [
        "Energia baixa, mas você está aqui. Isso já conta.",
        "Sessão reduzida hoje. Qualidade > quantidade.",
    ],
    EnergyLevel.MEDIUM: [
        "Bora? Sua missão de hoje está pronta.",
        "Mais um dia de preparação. Vamos nessa.",
    ],
    EnergyLevel.HIGH: [
        "Energia boa! Vamos aproveitar ao máximo.",
        "Hoje o rendimento vai ser alto. Missão completa te espera.",
    ],
    EnergyLevel.VERY_HIGH: [
        "Disposição total! Preparei uma missão mais intensa hoje.",
        "Energia máxima detectada. Hora de avançar forte.",
    ],
}

COMMUTE_GREETINGS = [
    "No trânsito? Aproveite: preparei conteúdo em áudio.",
    "Modo deslocamento ativado. Ouvir é estudar.",
]


def build_mission(
    priorities: list[PriorityResult],
    context: PriorityContext,
    reviews_due: int = 0,
    review_card_ids: list[UUID] | None = None,
    error_flashcard_ids: list[UUID] | None = None,
    commute_lesson_ids: list[UUID] | None = None,
    question_pool: dict[UUID, list[UUID]] | None = None,
    legal_article_ids: dict[UUID, list[UUID]] | None = None,
    is_pm: bool = False,
) -> Mission:
    """
    Build a complete daily mission from priority results and available content.

    Args:
        priorities: ranked subjects from the priority engine
        context: user's current study context
        reviews_due: number of review cards due
        review_card_ids: IDs of due review cards
        error_flashcard_ids: IDs of flashcards generated from errors
        commute_lesson_ids: IDs of audio lessons for commute
        question_pool: {subject_id: [question_ids]} available questions
        legal_article_ids: {subject_id: [article_ids]} articles to read
    """
    review_card_ids = review_card_ids or []
    error_flashcard_ids = error_flashcard_ids or []
    commute_lesson_ids = commute_lesson_ids or []
    question_pool = question_pool or {}
    legal_article_ids = legal_article_ids or {}

    blocks: list[MissionBlock] = []
    remaining_mins = context.available_minutes
    order = 0

    energy = context.energy
    mode = context.mode

    # Determine greeting
    import random
    if mode == StudyMode.COMMUTE:
        greeting = random.choice(COMMUTE_GREETINGS)
    else:
        pool = GREETINGS_BY_ENERGY.get(energy, GREETINGS_BY_ENERGY[EnergyLevel.MEDIUM])
        greeting = random.choice(pool)

    # 1. REVIEWS — always come first
    if reviews_due > 0 and remaining_mins >= 5:
        review_mins = _clamp_block_mins(min(reviews_due * 2, 15), remaining_mins, mode)
        count = min(reviews_due, review_mins * 2)
        blocks.append(MissionBlock(
            block_type="review",
            title=f"Revisão espaçada — {count} itens",
            description="Revise os cartões vencidos antes de avançar.",
            estimated_mins=review_mins,
            display_order=order,
            content_ids=review_card_ids[:count],
            mode=mode.value,
        ))
        order += 1
        remaining_mins -= review_mins

    # 2. MAIN SUBJECT BLOCKS — interleaved from top priorities
    subjects_used = 0
    legal_reading_used = 0
    max_subjects = 3 if remaining_mins >= 30 else 2 if remaining_mins >= 15 else 1
    # Tampa lei seca em 2 por missão — matéria nova não pode engolir o tempo
    # todo só com teoria, questão sempre entra na jornada do dia.
    MAX_LEGAL_READING = 2

    for p in priorities[:max_subjects]:
        if remaining_mins < 5:
            break

        fmt = p.recommended_format
        if fmt == "legal_reading" and legal_reading_used >= MAX_LEGAL_READING:
            fmt = "questions"
        block_mins = _clamp_block_mins(p.recommended_mins, remaining_mins, mode)

        if fmt == "questions" and p.subject_id in question_pool:
            q_count = max(3, block_mins // 3)
            q_ids = question_pool[p.subject_id][:q_count]
            if q_ids:
                blocks.append(MissionBlock(
                    block_type="questions",
                    subject_id=p.subject_id,
                    subject_name=p.subject_name,
                    title=f"Questões — {p.subject_name}",
                    description=p.reason,
                    estimated_mins=block_mins,
                    display_order=order,
                    content_ids=q_ids,
                    mode=mode.value,
                ))
                order += 1
                remaining_mins -= block_mins
                subjects_used += 1

        elif fmt == "legal_reading" and p.subject_id in legal_article_ids:
            a_ids = legal_article_ids[p.subject_id][:3]
            if a_ids:
                blocks.append(MissionBlock(
                    block_type="legal_reading",
                    subject_id=p.subject_id,
                    subject_name=p.subject_name,
                    title=f"Lei seca — {p.subject_name}",
                    description="Artigo oficial + explicação simplificada antes das questões.",
                    estimated_mins=block_mins,
                    display_order=order,
                    content_ids=a_ids,
                    mode=mode.value,
                ))
                order += 1
                remaining_mins -= block_mins
                subjects_used += 1
                legal_reading_used += 1

        elif fmt == "flashcards":
            blocks.append(MissionBlock(
                block_type="flashcards",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                title=f"Flashcards — {p.subject_name}",
                description="Revisão rápida dos pontos-chave.",
                estimated_mins=min(block_mins, 10),
                display_order=order,
                mode=mode.value,
            ))
            order += 1
            remaining_mins -= min(block_mins, 10)
            subjects_used += 1

        elif fmt == "audio" and commute_lesson_ids and not is_pm:
            blocks.append(MissionBlock(
                block_type="audio_lesson",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                title=f"Áudio — {p.subject_name}",
                description="Ouça e aprenda no deslocamento.",
                estimated_mins=block_mins,
                display_order=order,
                content_ids=commute_lesson_ids[:2],
                mode="commute",
                is_optional=False,
            ))
            order += 1
            remaining_mins -= block_mins

    # 3. ERROR FLASHCARDS — if time remains
    if error_flashcard_ids and remaining_mins >= 5:
        err_mins = min(10, remaining_mins)
        blocks.append(MissionBlock(
            block_type="flashcards",
            title="Revisão de erros",
            description="Flashcards gerados a partir dos seus erros recentes.",
            estimated_mins=err_mins,
            display_order=order,
            content_ids=error_flashcard_ids[:10],
            is_optional=True,
            mode=mode.value,
        ))
        order += 1
        remaining_mins -= err_mins

    # 4. COMMUTE AUDIO — added separately if user has commute time (not for PM exams)
    if not is_pm and mode != StudyMode.COMMUTE and commute_lesson_ids and context.available_minutes >= 30:
        blocks.append(MissionBlock(
            block_type="audio_lesson",
            title="Áudio para o deslocamento",
            description="Conteúdo preparado para ouvir no trânsito.",
            estimated_mins=45,
            display_order=order,
            content_ids=commute_lesson_ids[:3],
            is_optional=True,
            mode="commute",
        ))
        order += 1

    total_mins = sum(b.estimated_mins for b in blocks if not b.is_optional)

    return Mission(
        date=context.today,
        greeting=greeting,
        estimated_mins=total_mins,
        blocks=blocks,
        mode_suggested=mode.value,
        energy_detected=energy.value if energy else None,
    )


def _clamp_block_mins(ideal: int, remaining: int, mode: StudyMode) -> int:
    """Clamp block duration to available time and mode constraints."""
    if mode == StudyMode.MICRO:
        return min(ideal, remaining, 10)
    if mode == StudyMode.TIRED:
        return min(ideal, remaining, 15)
    return min(ideal, remaining)
