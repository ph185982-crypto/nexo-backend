"""
Calendário fixo da semana.

O motor de prioridade decide QUAL matéria entra na missão. Este módulo decide
QUE TIPO de dia é — e essa parte não é adaptativa de propósito: o candidato
precisa saber, em agosto, que todo sábado tem simulado e todo domingo tem
revisão. Previsibilidade é o que permite ele encaixar o estudo na vida (e o que
permite a tela de trajetória projetar semanas à frente sem inventar).

  segunda a sexta → conteúdo novo (unidade completa do tópico do dia)
  sábado          → simulado no formato do certame
  domingo         → revisão do que passou na semana, sem matéria nova

Dia marcado como descanso na rotina continua valendo para os dias de conteúdo
(vira só o áudio do deslocamento). Sábado e domingo ignoram a marcação: o
simulado e a revisão são o esqueleto do plano e não podem sumir do calendário.
"""
from __future__ import annotations

from datetime import date

CONTEUDO = "conteudo"
SIMULADO = "simulado"
REVISAO = "revisao"

# weekday(): 0 = segunda ... 6 = domingo
WEEK_PLAN: dict[int, str] = {
    0: CONTEUDO,
    1: CONTEUDO,
    2: CONTEUDO,
    3: CONTEUDO,
    4: CONTEUDO,
    5: SIMULADO,
    6: REVISAO,
}

DAY_KIND_LABELS = {
    CONTEUDO: "Conteúdo novo",
    SIMULADO: "Simulado",
    REVISAO: "Revisão da semana",
}


def day_kind(d: date) -> str:
    """Tipo do dia no calendário fixo."""
    return WEEK_PLAN.get(d.weekday(), CONTEUDO)


def is_fixed_day(d: date) -> bool:
    """Dias cujo tipo não cede para a marcação de descanso da rotina."""
    return day_kind(d) in (SIMULADO, REVISAO)


def label_for(kind: str) -> str:
    return DAY_KIND_LABELS.get(kind, "Conteúdo novo")
