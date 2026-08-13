"""
Study Priority Engine — decides what the user should study next.

O ranking é um Impact Score: peso no edital × risco de erro × esquecimento
× urgência da prova. A pergunta que a fórmula responde não é "quanto falta
estudar essa matéria" e sim "quantos pontos essa matéria pode custar na
prova se ficar do jeito que está".

  1. Peso no edital (weight_prf/weight_pm) — matéria que vale mais pontos
  2. Taxa de erro — 1 - acurácia recente
  3. Gap de domínio — 1 - mastery
  4. Esquecimento — curva de decaimento desde o último contato
  5. Urgência — quanto mais perto da prova, mais o peso pesa
  6. Revisões vencidas e erros recorrentes — bumps aditivos (sinais
     discretos, não multiplicativos)
  7. Energia do usuário — casa dificuldade do conteúdo com a energia
  8. Itens no blueprint do edital — quantos pontos a matéria vale de fato
  9. Guarda de recência — gira dentro do blueprint, não para fora dele
  10. Regra do zero — matéria projetando menos de 1 acerto fura a fila,
      porque zerar uma área elimina o candidato mesmo com nota alta
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from prf.models.user import EnergyLevel, StudyMode

# Ebbinghaus-like: sem revisar, a retenção despenca nos primeiros dias e
# depois desacelera. Usado para fazer matérias "esquecidas" subirem de
# prioridade mesmo com mastery historicamente boa.
FORGETTING_HALF_LIFE_DAYS = 7.0


@dataclass
class SubjectState:
    subject_id: UUID
    subject_name: str
    weight_prf: float = 1.0
    mastery: float = 0.0           # 0.0 to 1.0
    accuracy: float = 0.0
    total_attempts: int = 0
    error_count: int = 0
    reviews_due: int = 0
    last_studied: Optional[datetime] = None
    study_time_mins: float = 0
    recurring_errors: int = 0
    is_priority: bool = False
    # Itens que a matéria vale no blueprint do edital. É o que converte
    # "matéria importante" em "pontos na mesa": Direito Penal com 5 itens
    # peso 2 vale 10 dos 85 pontos; Informática, fora do blueprint, vale 0.
    exam_items: int = 0
    # Contagem BRUTA de itens no blueprint (sem multiplicar pelo peso do
    # bloco) — é o que a regra do zero usa pra saber quantos itens dessa
    # matéria caem na prova, não quantos pontos eles valem.
    blueprint_item_count: int = 0


@dataclass
class PriorityResult:
    subject_id: UUID
    subject_name: str
    score: float
    reason: str
    recommended_format: str        # 'questions', 'legal_reading', 'flashcards', 'audio'
    recommended_mins: int
    risk_level: str = "medio"      # muito_alto, alto, medio, baixo
    expected_lost_points: float = 0.0  # pontos estimados perdidos na prova hoje, nessa matéria


@dataclass
class PriorityContext:
    energy: EnergyLevel = EnergyLevel.MEDIUM
    mode: StudyMode = StudyMode.FOCUS
    available_minutes: int = 30
    hour_of_day: int = 12
    days_until_exam: Optional[int] = None
    today: date = field(default_factory=date.today)
    study_level: str = "intermediate"   # beginner, intermediate, advanced
    exam_total_items: int = 50          # itens da prova, usado só p/ estimar pontos em risco


def compute_priorities(
    subjects: list[SubjectState],
    context: PriorityContext,
    recently_studied_subjects: set[UUID] | None = None,
) -> list[PriorityResult]:
    """
    Rank subjects by Impact Score, highest first — a matéria que mais
    ameaça pontos na prova, não a que "falta mais estudar".

    Args:
        subjects: lista de SubjectState
        context: PriorityContext com hora, energia, tempo disponível
        recently_studied_subjects: set de UUIDs de matérias estudadas nos
                                   últimos dias — serão penalizadas para
                                   forçar rotação entre matérias
    """
    recently_studied_subjects = recently_studied_subjects or set()
    results = []
    total_weight = sum(s.weight_prf for s in subjects) or 1.0
    for s in subjects:
        score = _compute_subject_score(s, context, recently_studied_subjects)
        fmt = _recommend_format(s, context)
        mins = _recommend_duration(s, context)
        reason = _explain_priority(s, context, score)
        risk = _risk_level(s)
        lost_points = _expected_lost_points(s, context, total_weight)

        results.append(PriorityResult(
            subject_id=s.subject_id,
            subject_name=s.subject_name,
            score=round(score, 2),
            reason=reason,
            recommended_format=fmt,
            recommended_mins=mins,
            risk_level=risk,
            expected_lost_points=lost_points,
        ))

    results.sort(key=lambda r: r.score, reverse=True)
    return results


def _forgetting_factor(last_studied: Optional[datetime], today: date) -> float:
    """1.0 = conhecimento fresco. Sobe conforme os dias passam sem contato,
    até um teto de ~1.6x (matéria nunca mais vista pesa mais que matéria
    revisada ontem, mesmo com mastery parecida)."""
    if last_studied is None:
        return 1.3  # nunca estudado formalmente — trate como já esquecendo
    days_since = (datetime.combine(today, datetime.min.time()) - last_studied.replace(tzinfo=None)).days
    days_since = max(0, days_since)
    decay = 1.0 - 0.5 ** (days_since / FORGETTING_HALF_LIFE_DAYS)
    return round(1.0 + decay * 0.6, 3)


def _risk_level(s: SubjectState) -> str:
    """Classifica o quanto essa matéria ameaça pontos: combina peso no
    edital com o quanto ainda falta dominar."""
    risk_score = s.weight_prf * max(0.0, 1.0 - s.mastery)
    if risk_score >= 1.4:
        return "muito_alto"
    if risk_score >= 0.9:
        return "alto"
    if risk_score >= 0.4:
        return "medio"
    return "baixo"


def _expected_lost_points(s: SubjectState, ctx: PriorityContext, total_weight: float) -> float:
    """Estimativa de pontos perdidos hoje na prova, nessa matéria, se a
    prova fosse hoje: fração normalizada do edital × gap de domínio ×
    total de itens da prova."""
    norm_weight = s.weight_prf / total_weight if total_weight else 0.0
    gap = max(0.0, 1.0 - s.mastery)
    return round(norm_weight * gap * ctx.exam_total_items, 1)


def _compute_subject_score(
    s: SubjectState,
    ctx: PriorityContext,
    recently_studied_subjects: set[UUID] | None = None,
) -> float:
    recently_studied_subjects = recently_studied_subjects or set()

    # Núcleo do Impact Score: peso × risco de erro × gap de domínio × esquecimento.
    error_rate = (1.0 - s.accuracy) if s.total_attempts > 0 else 0.5
    mastery_gap = max(0.0, 1.0 - s.mastery)
    forgetting = _forgetting_factor(s.last_studied, ctx.today)

    impact = s.weight_prf * (0.5 + error_rate) * (0.5 + mastery_gap) * forgetting

    # Sinais discretos fortes somam em vez de multiplicar — revisão vencida
    # e erro recorrente são urgentes por si só, não proporcionais ao resto.
    if s.reviews_due > 0:
        impact += min(s.reviews_due * 4, 20)
    if s.recurring_errors > 0:
        impact += min(s.recurring_errors * 3, 15)

    # Urgência da prova: quanto mais perto, mais o peso no edital pesa.
    if ctx.days_until_exam is not None and ctx.days_until_exam < 60:
        urgency = max(0.5, 1 + (60 - ctx.days_until_exam) / 60)
        if s.weight_prf >= 2.0:
            impact *= urgency

    # Pontos que a matéria realmente vale na prova. Matéria fora do
    # blueprint do último edital não é descartada — o edital muda e a banca
    # muda — mas não compete de igual para igual com matéria confirmada.
    if s.exam_items > 0:
        impact *= 1.0 + s.exam_items / 10.0
    else:
        impact *= 0.5

    # Rotação — dentro do blueprint, não para fora dele.
    # O bloco de Conhecimentos Específicos é 35 dos 50 itens e 70 dos 85
    # pontos: ele precisa aparecer praticamente todo dia. O que gira é qual
    # matéria do bloco e qual tópico dentro dela, não a presença do bloco.
    # Uma penalidade cega aqui (a versão anterior usava 0.2 para qualquer
    # matéria vista ontem) empurrava justamente as matérias que mais valem
    # pontos para fora do plano, e puxava matérias de peso 1 que sequer
    # estão no blueprint.
    if s.subject_id in recently_studied_subjects:
        impact *= 0.8 if s.exam_items > 0 else 0.3
    elif s.last_studied:
        hours_since = (datetime.utcnow() - s.last_studied.replace(tzinfo=None)).total_seconds() / 3600
        if hours_since < 4:
            impact *= 0.5
        elif hours_since < 24:
            impact *= 0.85

    # Energia do usuário — casa dificuldade do conteúdo com a energia.
    impact *= _energy_multiplier(ctx.energy, s.mastery)

    # Prioridade manual do usuário — ele marcou essa matéria como fraca e
    # quer que ela suba na fila, independente do que o Impact Score sozinho diria.
    if s.is_priority:
        impact *= 1.3

    # Regra do zero — sobrevivência antes de otimização.
    # O Impact Score sozinho sempre manda matéria de peso 1 e poucos itens
    # (ex.: Realidade de Goiás, 5 itens) pro fim da fila. Mas zerar QUALQUER
    # matéria do blueprint elimina o candidato, mesmo com 84 dos 85 pontos
    # nas outras. Se a acurácia projetada nessa matéria não chega a 1 item
    # certo (ou a matéria nunca foi tentada), ela fura a fila até sair do
    # risco — depois volta a competir pelo Impact Score normal.
    if s.blueprint_item_count > 0:
        projected_correct = s.accuracy * s.blueprint_item_count if s.total_attempts > 0 else 0.0
        if projected_correct < 1.0:
            impact = max(impact, 500.0 + s.weight_prf * 10.0)

    return impact


def _energy_multiplier(energy: EnergyLevel, mastery: float) -> float:
    """
    When energy is low, favor easier/mastered content (review).
    When energy is high, favor challenging content (new/weak areas).
    """
    if energy in (EnergyLevel.VERY_LOW, EnergyLevel.LOW):
        return 1.2 if mastery > 0.5 else 0.7
    if energy in (EnergyLevel.HIGH, EnergyLevel.VERY_HIGH):
        return 1.2 if mastery < 0.5 else 0.9
    return 1.0


def _recommend_format(s: SubjectState, ctx: PriorityContext) -> str:
    if ctx.mode == StudyMode.COMMUTE:
        return "audio"
    if ctx.mode == StudyMode.MICRO:
        return "flashcards"
    if ctx.mode == StudyMode.TIRED:
        return "flashcards" if s.reviews_due > 0 else "legal_reading"
    if s.reviews_due > 0:
        return "flashcards"

    # Jornada da matéria: lei seca primeiro (teoria), depois questão (prática),
    # revisão de erro reforça de novo com lei seca antes de nova rodada de questão.
    # O nível de estudo desloca quanto tempo cada matéria fica na fase de teoria:
    # iniciante precisa de mais contato com o texto antes de treinar; avançado
    # já pula pra prática e só volta pra lei seca se estiver de fato errando.
    if s.total_attempts == 0:
        return "legal_reading"

    if ctx.study_level == "beginner":
        theory_window, error_threshold = 5, 0.55
    elif ctx.study_level == "advanced":
        theory_window, error_threshold = 0, 0.35
    else:
        theory_window, error_threshold = 2, 0.5

    if s.total_attempts <= theory_window:
        return "legal_reading"
    if s.accuracy < error_threshold and s.total_attempts >= 3:
        return "legal_reading"
    return "questions"


def _recommend_duration(s: SubjectState, ctx: PriorityContext) -> int:
    base = min(ctx.available_minutes, 30)
    if ctx.mode == StudyMode.MICRO:
        return min(10, ctx.available_minutes)
    if ctx.mode == StudyMode.TIRED:
        return min(15, ctx.available_minutes)
    if ctx.mode == StudyMode.COMMUTE:
        return min(ctx.available_minutes, 45)
    return base


def _explain_priority(s: SubjectState, ctx: PriorityContext, score: float) -> str:
    parts = []
    if s.is_priority:
        parts.append("você marcou como prioridade")
    if s.total_attempts == 0:
        parts.append("primeiro contato — comece pela lei seca")
    if s.reviews_due > 0:
        parts.append(f"{s.reviews_due} revisões pendentes")
    if s.accuracy < 0.5 and s.total_attempts > 3:
        parts.append(f"acurácia baixa ({s.accuracy:.0%})")
    if s.weight_prf >= 2.0:
        parts.append("alto peso no edital")
    if s.recurring_errors > 2:
        parts.append(f"{s.recurring_errors} erros recorrentes")
    if s.mastery < 0.3:
        parts.append("nível de domínio baixo")
    if not parts:
        parts.append("manutenção regular")
    return "; ".join(parts)
