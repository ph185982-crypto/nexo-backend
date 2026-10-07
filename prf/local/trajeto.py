"""
Aula de trajeto: episódios de ~40 min por matéria, para ouvir indo e voltando
do serviço.

O episódio por tópico (script_builder) cobre só a Parte 1 da lei e dura de 2
a 22 min — curto demais para quem tem 40 min de ida e 40 de volta. Aqui cada
tópico entra inteiro (toda a lei do tópico, em ordem de artigo, e todas as
questões comentadas), e scripts/gerar_audios.py junta tópicos da mesma
matéria em sequência até fechar ~40 min.

Didática, sem inventar conteúdo:
- a Julia (voz Thalita, a mais natural em pt-BR) conduz: lê a lei devagar,
  traduz, marca o que a banca troca e dá o gabarito com o motivo;
- o Marcos (Antônio) faz as deixas curtas e lê as questões;
- silêncio de verdade antes de cada gabarito, para o ouvinte decidir;
- revisão no fim de cada tópico, uma frase por artigo (recall);
- a lei é lida como se fala: "Art. 14, § 1º" vira "artigo 14, parágrafo
  primeiro", "CPP" vira "Código de Processo Penal".

Cada unidade é uma lista de falas (voz, texto, estilo, pausa_depois). O
gerador sintetiza unidade por unidade e decide onde cortar os episódios pela
duração real do áudio.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from prf.local.script_builder import (
    _clean,
    _highlights,
    _is_true_false,
    _listing,
    _question_origin,
    _split_segments,
    _usable_question,
)
from prf.services.podcast_service import HOST_A, HOST_B

MAX_QUESTIONS_PER_TOPIC = 30
THINK_PAUSE = 3.0


@dataclass
class Unit:
    """Trecho indivisível do episódio — o corte entre episódios só acontece
    entre unidades, nunca no meio de um artigo ou de uma questão."""
    topic_id: str
    kind: str  # abertura | artigo | transicao | questao | revisao
    turns: list[tuple[str, str, str, float]] = field(default_factory=list)

    def say(self, speaker: str, text: str, style: str = "fala", pause: float = 0.35) -> None:
        text = speak(text)
        if not text:
            return
        # Falas seguidas da mesma voz, sem pausa longa entre elas, saem numa
        # síntese só: a entonação corre natural em vez de três recortes colados.
        if self.turns:
            last_speaker, last_text, last_style, last_pause = self.turns[-1]
            if last_speaker == speaker and last_style == style and last_pause <= 0.45:
                self.turns[-1] = (speaker, f"{last_text} {text}", style, pause)
                return
        self.turns.append((speaker, text, style, pause))


# ── Leitura falada ──────────────────────────────────────────────────────────

DOCUMENTS = {
    "CP": "Código Penal",
    "CPP": "Código de Processo Penal",
    "CPM": "Código Penal Militar",
    "CPPM": "Código de Processo Penal Militar",
    "CTB": "Código de Trânsito Brasileiro",
    "ECA": "Estatuto da Criança e do Adolescente",
    "CF/88": "Constituição Federal",
    "CF": "Constituição Federal",
    "Lei 11.343/06": "Lei de Drogas",
    "Lei 11.340/06": "Lei Maria da Penha",
    "Lei 13.869/19": "Lei de Abuso de Autoridade",
    "Lei 10.826/03": "Estatuto do Desarmamento",
    "Lei 12.850/13": "Lei das Organizações Criminosas",
    "Lei 7.716/89": "Lei dos Crimes de Racismo",
    "Lei 8.072/90": "Lei dos Crimes Hediondos",
    "Lei 9.455/97": "Lei de Tortura",
}

_ORDINAL_M = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto",
              "sexto", "sétimo", "oitavo", "nono", "décimo"]
_ORDINAL_F = ["", "primeira", "segunda", "terceira", "quarta", "quinta",
              "sexta", "sétima", "oitava", "nona", "décima"]
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def _roman(value: str) -> int:
    total = 0
    for i, ch in enumerate(value):
        n = _ROMAN[ch]
        total += -n if i + 1 < len(value) and _ROMAN[value[i + 1]] > n else n
    return total


def _ordinal(n: int, feminine: bool = False) -> str:
    words = _ORDINAL_F if feminine else _ORDINAL_M
    return words[n] if 0 < n < len(words) else str(n)


def _law_number(match: re.Match) -> str:
    year = int(match.group(2))
    return f"{match.group(1)}, de {1900 + year if year >= 30 else 2000 + year}"


_ABBREV = re.compile(r"\b(CPPM|CPP|CPM|CP|CTB|ECA|CF/88|CF)\b")


def speak(text: str) -> str:
    """Texto legal do jeito que se lê em voz alta.

    Sem isso a voz soletra o que é sigla ("cê pê pê"), lê "§" como símbolo e
    "II -" como "i i hífen" — o ouvinte perde o fio justamente na lei, que é
    a parte que ele precisa ouvir com precisão.
    """
    if not text:
        return ""
    t = text.replace("°", "º")
    t = re.sub(r"§§", "parágrafos", t)
    t = re.sub(r"§\s*(\d+)\s*º", lambda m: f"parágrafo {_ordinal(int(m.group(1)))}"
               if int(m.group(1)) < 10 else f"parágrafo {m.group(1)}", t)
    t = re.sub(r"§\s*(\d+)", lambda m: f"parágrafo {m.group(1)}", t)
    t = re.sub(r"\b[Aa]rts\.\s*", "artigos ", t)
    t = re.sub(r"\b[Aa]rt\.\s*(\d+)\s*º", lambda m: f"artigo {_ordinal(int(m.group(1)))}"
               if int(m.group(1)) < 10 else f"artigo {m.group(1)}", t)
    t = re.sub(r"\b[Aa]rt\.\s*", "artigo ", t)
    t = re.sub(r"\bn\.?\s*º\s*", "número ", t)
    t = re.sub(r"\b(\d{1,2}\.\d{3})/(\d{2})\b", _law_number, t)
    t = re.sub(r"(?<![\w.])(\d{1,2})º", lambda m: _ordinal(int(m.group(1))), t)
    t = re.sub(r"(?<![\w.])(\d{1,2})ª", lambda m: _ordinal(int(m.group(1)), True), t)
    t = re.sub(r"^([IVXLC]{1,6})\s*[-–—]\s*", lambda m: f"Inciso {_roman(m.group(1))}: ", t)
    t = re.sub(r"\b(incisos?)\s+([IVXLC]{1,6})\b", lambda m: f"{m.group(1)} {_roman(m.group(2))}", t)
    t = re.sub(r"\b(artigo \w+), ([IVXLC]{1,7})\b", lambda m: f"{m.group(1)}, inciso {_roman(m.group(2))}", t)
    t = re.sub(r"^([a-z])\)\s*", lambda m: f"Alínea {m.group(1)}: ", t)
    t = re.sub(r"^(parágrafo \w+|Parágrafo único)\s*[-–—.:]?\s*", lambda m: m.group(1)[0].upper() + m.group(1)[1:] + ": ", t)
    t = _ABBREV.sub(lambda m: DOCUMENTS[m.group(1)], t)
    t = re.sub(r"\bCESPE\s*/\s*CEBRASPE\b|\bCEBRASPE\b|\bCESPE\b", "Cebraspe", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:1].upper() + t[1:]


def document_name(raw: str) -> str:
    raw = _clean(raw)
    return DOCUMENTS.get(raw, raw) or "texto legal"


def article_order(article: dict) -> tuple:
    """Lei se ouve em ordem de artigo; a ordem por incidência pulava do 14
    para o 18 e voltava ao 13, e o ouvinte perdia o encadeamento."""
    number = article.get("article_number") or ""
    m = re.search(r"(\d+)(?:-([A-Z]))?", number)
    return (
        _clean(article.get("document_name")),
        int(m.group(1)) if m else 10**6,
        m.group(2) or "" if m else "",
    )


# ── Unidades de um tópico ───────────────────────────────────────────────────

_ASK = (
    "E o que isso quer dizer, na prática?",
    "Traduz para mim.",
    "Explica isso como se eu nunca tivesse lido.",
    "Na linguagem da rua, como fica?",
)
_EXPLAIN = ("Em outras palavras:", "Traduzindo:", "Na prática:", "Ou seja:")
_MORE = ("E continua.", "Segue.", "Tem mais.", "E depois?")
_WAIT = ("Decide agora.", "Certo ou errado?", "Pensa antes de ouvir.", "Qual é a sua resposta?")


def topic_units(topic: dict, subject_name: str, articles: list[dict],
                questions: list[dict]) -> list[Unit]:
    tid = str(topic["id"])
    articles = sorted([a for a in articles if _clean(a.get("official_text"))], key=article_order)
    questions = [q for q in questions if _usable_question(q)][:MAX_QUESTIONS_PER_TOPIC]
    if not articles and not questions:
        return []

    units: list[Unit] = []
    opening = Unit(tid, "abertura")
    docs = []
    for a in articles:
        name = document_name(a.get("document_name"))
        if name not in docs:
            docs.append(name)
    plan = []
    if articles:
        prep = "da" if docs[0].startswith(("Lei", "Constituição")) else "do"
        plan.append(f"{_spoken_count(len(articles), 'dispositivo', 'dispositivos')} {prep} {docs[0]}")
    if questions:
        plan.append(_spoken_count(len(questions), "questão de prova", "questões de prova"))
    opening.say(HOST_B, f"Próximo tópico: {topic['name']}.", pause=0.5)
    opening.say(HOST_B, f"Vamos ver {' e depois '.join(plan)}.", pause=0.6)
    units.append(opening)

    for index, article in enumerate(articles):
        units.append(_article_unit(tid, article, index))

    if questions:
        bridge = Unit(tid, "transicao")
        bridge.say(HOST_A, "Agora, como isso cai na prova.", pause=0.3)
        bridge.say(HOST_B, "Eu leio, você decide de cabeça, e só depois vem o gabarito "
                           "com o motivo. Vale mais errar pensando do que acertar no chute.",
                   pause=0.8)
        units.append(bridge)
        previous_context = ""
        for index, question in enumerate(questions):
            unit, previous_context = _question_unit(tid, question, index, previous_context)
            units.append(unit)

    recap = _recap_unit(tid, topic["name"], articles)
    if recap.turns:
        units.append(recap)
    return units


def _spoken_count(n: int, singular: str, plural: str) -> str:
    if n == 1:
        return f"{'uma' if singular.startswith('questão') else 'um'} {singular}"
    return f"{n} {plural}"


def _article_unit(tid: str, article: dict, index: int) -> Unit:
    unit = Unit(tid, "artigo")
    number = article.get("article_number") or ""
    doc = document_name(article.get("document_name"))
    prep = "da" if doc.startswith(("Lei", "Constituição")) else "do"
    unit.say(HOST_A, f"{number} {prep} {doc}." if number else f"Próximo dispositivo {prep} {doc}.",
             pause=0.4)

    segments = _split_segments(_clean(article.get("official_text")))
    if not segments:
        return unit
    unit.say(HOST_B, segments[0]["text"], style="lei", pause=0.7)

    simple = _clean(article.get("simple_text"))
    if simple:
        unit.say(HOST_A, _ASK[index % len(_ASK)], pause=0.3)
        unit.say(HOST_B, f"{_EXPLAIN[index % len(_EXPLAIN)]} {simple}", pause=0.8)

    for i, segment in enumerate(segments[1:]):
        rubric = segments[i]["rubric"]
        unit.say(HOST_A, f"Agora: {rubric}." if rubric else _MORE[i % len(_MORE)], pause=0.3)
        unit.say(HOST_B, segment["text"], style="lei", pause=0.7)

    highlights = _highlights(article)
    if highlights:
        unit.say(HOST_B, f"Para a prova, grave: {_listing(highlights)}. "
                         "É trocando uma dessas palavras que a banca torna o item errado.",
                 pause=1.0)
    return unit


def _question_unit(tid: str, question: dict, index: int,
                   previous_context: str) -> tuple[Unit, str]:
    unit = Unit(tid, "questao")
    origin = _question_origin(question)
    unit.say(HOST_A, f"Questão {index + 1}. {origin}" if origin else f"Questão {index + 1}.", pause=0.3)

    context = _clean(question.get("context_text"))
    if context and context != previous_context:
        unit.say(HOST_A, context, pause=0.3)
        previous_context = context
    unit.say(HOST_A, _clean(question.get("text")), pause=0.4)

    alternatives = question.get("alternatives") or []
    true_false = _is_true_false(alternatives)
    if not true_false:
        for alt in alternatives:
            letter, text = _clean(alt.get("letter")), _clean(alt.get("text"))
            if letter and text:
                unit.say(HOST_A, f"Letra {letter.lower()}: {text}", pause=0.35)

    unit.say(HOST_A, _WAIT[index % len(_WAIT)], pause=THINK_PAUSE)

    correct = next((a for a in alternatives if a.get("is_correct")), None)
    if correct:
        if true_false:
            answer = f"Gabarito: {_clean(correct.get('text')).lower()}."
        else:
            answer = f"Gabarito: letra {_clean(correct.get('letter')).lower()}."
        explanation = _clean(question.get("explanation"))
        unit.say(HOST_B, f"{answer} {explanation}" if explanation else answer, pause=1.2)
    return unit, previous_context


def _recap_unit(tid: str, topic_name: str, articles: list[dict]) -> Unit:
    """Repetir a ideia de cada artigo no fim é o que transforma ouvir em
    lembrar: o ouvinte tenta recuperar antes de a frase terminar."""
    unit = Unit(tid, "revisao")
    lines = [
        f"{a.get('article_number')}: {_clean(a.get('simple_text'))}"
        for a in articles
        if a.get("article_number") and _clean(a.get("simple_text"))
    ]
    if not lines:
        unit.say(HOST_B, f"Fechamos {topic_name}.", pause=1.5)
        return unit
    unit.say(HOST_A, f"Revisão rápida de {topic_name}.", pause=0.4)
    for line in lines[:12]:
        unit.say(HOST_B, line, pause=0.6)
    unit.say(HOST_B, f"Fechamos {topic_name}.", pause=1.5)
    return unit


def episode_intro(subject_name: str, number: int, topic_titles: list[str]) -> Unit:
    unit = Unit("", "abertura")
    unit.say(HOST_B, f"{subject_name}, episódio {number}.", pause=0.4)
    unit.say(HOST_B, f"Neste episódio: {_listing(topic_titles)}.", pause=0.5)
    unit.say(HOST_A, "Bora. Fone no ouvido e atenção na estrada.", pause=0.8)
    return unit


def episode_outro(subject_name: str, number: int, next_title: str | None) -> Unit:
    unit = Unit("", "revisao")
    if next_title:
        unit.say(HOST_B, f"Fim do episódio {number} de {subject_name}. No próximo: {next_title}.", pause=0.4)
    else:
        unit.say(HOST_B, f"Fim do episódio {number}, o último de {subject_name}.", pause=0.4)
    unit.say(HOST_A, "Bons estudos e bom serviço.", pause=0.5)
    return unit


def continuation_intro(topic_name: str) -> Unit:
    unit = Unit("", "abertura")
    unit.say(HOST_B, f"Continuando {topic_name}.", pause=0.6)
    return unit
