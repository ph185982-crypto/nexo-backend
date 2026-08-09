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

_RISK_LABELS = {
    "muito_alto": "Risco muito alto",
    "alto": "Risco alto",
    "medio": "Risco médio",
    "baixo": "Risco baixo",
}

# Duas aulas por dia, uma para cada trecho do deslocamento (ida e volta).
MAX_AUDIO_LESSONS = 2
# Teto de lei seca por missão: matéria nova não pode engolir a noite toda
# em teoria, questão sempre precisa entrar na jornada do dia.
MAX_LEGAL_READING = 2


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
    topic_plan: dict[UUID, dict] | None = None,
) -> Mission:
    """
    Monta a missão do dia a partir das prioridades e do conteúdo disponível.

    A missão segue o dia real do candidato: as aulas em áudio vão na frente
    porque são ouvidas no deslocamento, e a lei seca e as questões daquele
    MESMO tópico vêm depois, para a noite. Ouvir, ler e praticar o mesmo
    assunto no mesmo dia é o que fixa — antes disso cada etapa caía num
    assunto diferente e o dia não fechava em lugar nenhum.

    Args:
        priorities: matérias ranqueadas pelo Impact Score
        context: contexto de estudo do usuário
        reviews_due: quantidade de cartões de revisão vencidos
        review_card_ids: ids dos cartões vencidos
        error_flashcard_ids: flashcards gerados a partir dos erros
        commute_lesson_ids: aulas de áudio antigas (formato locução única)
        question_pool: {subject_id: [question_ids]} fallback por matéria
        legal_article_ids: {subject_id: [article_ids]} fallback por matéria
        is_pm: certame da PM, muda o formato das questões e o simulado
        topic_plan: {subject_id: {topic_id, topic_name, episode_ids,
                    article_ids, question_ids}} — o tópico do dia de cada
                    matéria, que amarra áudio, lei seca e questões
    """
    review_card_ids = review_card_ids or []
    error_flashcard_ids = error_flashcard_ids or []
    commute_lesson_ids = commute_lesson_ids or []
    question_pool = question_pool or {}
    legal_article_ids = legal_article_ids or {}
    topic_plan = topic_plan or {}

    blocks: list[MissionBlock] = []
    remaining_mins = context.available_minutes
    order = 0

    energy = context.energy
    mode = context.mode

    import random
    if mode == StudyMode.COMMUTE:
        greeting = random.choice(COMMUTE_GREETINGS)
    else:
        pool = GREETINGS_BY_ENERGY.get(energy, GREETINGS_BY_ENERGY[EnergyLevel.MEDIUM])
        greeting = random.choice(pool)

    # 1. REVISÕES — sempre primeiro
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

    # 2. ÁUDIO DO DESLOCAMENTO — a aula na ida e o drill do MESMO conteúdo
    # na volta. Duas aulas novas por dia dariam mais cobertura e menos
    # retenção: o que fixa é recuperar o conteúdo algumas horas depois da
    # primeira exposição, não ouvir o dobro de matéria nova.
    # Não descontam de remaining_mins: são ouvidos no carro e não roubam o
    # tempo de estudo da noite, que é o que esse orçamento representa.
    audio_plan = None
    for p in priorities:
        plan = topic_plan.get(p.subject_id)
        if plan and plan.get("episode_ids"):
            audio_plan = (p, plan)
            break

    if audio_plan:
        p, plan = audio_plan
        rotulo = plan.get("topic_name") or p.subject_name
        blocks.append(MissionBlock(
            block_type="podcast",
            subject_id=p.subject_id,
            subject_name=p.subject_name,
            topic_id=plan.get("topic_id"),
            title=f"Aula em áudio — {rotulo}",
            description="Ouça na ida. É a primeira passagem do conteúdo de hoje.",
            estimated_mins=plan.get("episode_mins") or 40,
            display_order=order,
            content_ids=plan["episode_ids"][:1],
            mode="commute",
        ))
        order += 1

        if plan.get("drill_ids"):
            blocks.append(MissionBlock(
                block_type="podcast_drill",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                topic_id=plan.get("topic_id"),
                title=f"Drill de recall — {rotulo}",
                description="Ouça na volta. Responda antes deles: recuperar é o que fixa.",
                estimated_mins=plan.get("drill_mins") or 22,
                display_order=order,
                content_ids=plan["drill_ids"][:1],
                mode="commute",
            ))
            order += 1

    audio_subject_ids = {audio_plan[0].subject_id} if audio_plan else set()

    # 3. ESTUDO DA NOITE — lei seca e questões do MESMO tópico do áudio.
    # As matérias que tiveram áudio vêm primeiro e sempre nesse par, porque
    # é o encadeamento que o dia inteiro está construindo.
    legal_reading_used = 0
    max_subjects = 3 if remaining_mins >= 30 else 2 if remaining_mins >= 15 else 1

    ordered = [p for p in priorities if p.subject_id in audio_subject_ids]
    ordered += [p for p in priorities if p.subject_id not in audio_subject_ids]

    for p in ordered[:max_subjects]:
        if remaining_mins < 5:
            break

        plan = topic_plan.get(p.subject_id) or {}
        topic_label = plan.get("topic_name") or p.subject_name
        heard = p.subject_id in audio_subject_ids
        risk_tag = _RISK_LABELS.get(p.risk_level, "Risco médio")

        a_ids = plan.get("article_ids") or legal_article_ids.get(p.subject_id) or []
        q_ids = plan.get("question_ids") or question_pool.get(p.subject_id) or []

        # Matéria que teve áudio hoje sempre fecha o ciclo com lei seca +
        # questões; nas demais, o formato continua sendo decidido pelo motor
        # de prioridade.
        fmt = "legal_reading" if heard else p.recommended_format
        if fmt == "legal_reading" and legal_reading_used >= MAX_LEGAL_READING:
            fmt = "questions"
        block_mins = _clamp_block_mins(p.recommended_mins, remaining_mins, mode)

        if fmt == "legal_reading" and a_ids:
            a_count = max(5, block_mins // 2)
            picked = a_ids[:a_count]
            blocks.append(MissionBlock(
                block_type="legal_reading",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                topic_id=plan.get("topic_id"),
                title=f"Lei seca — {topic_label} ({len(picked)} artigos)",
                description=(
                    "Leia a lei do tópico que você ouviu hoje de manhã."
                    if heard else f"{risk_tag} · {p.reason} · leia antes de validar com questões."
                ),
                estimated_mins=block_mins,
                display_order=order,
                content_ids=picked,
                mode=mode.value,
            ))
            order += 1
            remaining_mins -= block_mins
            legal_reading_used += 1

            # Validação imediata: ler sem praticar não fixa. Entra um bloco
            # curto de questões do MESMO tópico, enquanto está fresco.
            if remaining_mins >= 5 and q_ids:
                val_mins = min(12, remaining_mins)
                blocks.append(MissionBlock(
                    block_type="questions",
                    subject_id=p.subject_id,
                    subject_name=p.subject_name,
                    topic_id=plan.get("topic_id"),
                    title=f"Questões — {topic_label}",
                    description="Pratique agora o que acabou de ouvir e ler.",
                    estimated_mins=val_mins,
                    display_order=order,
                    content_ids=q_ids[:8],
                    mode=mode.value,
                ))
                order += 1
                remaining_mins -= val_mins

        elif fmt == "questions" and q_ids:
            q_count = max(3, block_mins // 3)
            blocks.append(MissionBlock(
                block_type="questions",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                topic_id=plan.get("topic_id"),
                title=f"Questões — {topic_label}",
                description=f"{risk_tag} · {p.reason}",
                estimated_mins=block_mins,
                display_order=order,
                content_ids=q_ids[:q_count],
                mode=mode.value,
            ))
            order += 1
            remaining_mins -= block_mins

        elif fmt == "flashcards" and plan.get("flashcard_ids"):
            blocks.append(MissionBlock(
                block_type="flashcards",
                subject_id=p.subject_id,
                subject_name=p.subject_name,
                topic_id=plan.get("topic_id"),
                title=f"Flashcards — {topic_label}",
                description="Complete a lacuna de memória: as palavras que a banca troca.",
                estimated_mins=min(block_mins, 10),
                display_order=order,
                content_ids=plan["flashcard_ids"][:12],
                mode=mode.value,
            ))
            order += 1
            remaining_mins -= min(block_mins, 10)

    # 3b. FLASHCARDS DO TÓPICO — fecham o ciclo do dia com memorização das
    # expressões que a banca troca, depois de ouvir, ler e praticar.
    if audio_plan and remaining_mins >= 5:
        _p, _plan = audio_plan
        if _plan.get("flashcard_ids"):
            fc_mins = min(10, remaining_mins)
            blocks.append(MissionBlock(
                block_type="flashcards",
                subject_id=_p.subject_id,
                subject_name=_p.subject_name,
                topic_id=_plan.get("topic_id"),
                title=f"Flashcards — {_plan.get('topic_name') or _p.subject_name}",
                description="Fixe as expressões que a banca troca nesse tópico.",
                estimated_mins=fc_mins,
                display_order=order,
                content_ids=_plan["flashcard_ids"][:12],
                mode=mode.value,
            ))
            order += 1
            remaining_mins -= fc_mins

    # 4. FLASHCARDS DE ERRO — se sobrar tempo
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

    # O tempo estimado é o do estudo sentado; o áudio do deslocamento fica
    # de fora para não inflar o que o candidato precisa reservar à noite.
    total_mins = sum(
        b.estimated_mins for b in blocks
        if not b.is_optional and b.block_type != "podcast"
    )

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
