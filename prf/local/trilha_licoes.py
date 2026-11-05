"""
Trilha no estilo Duolingo: o edital vira um caminho único de unidades curtas.

Por que esse formato prende e ensina (é o que o Duolingo faz):
- a pessoa nunca decide "o que estudar agora": aperta o próximo nó;
- lições de ~5 min, que cabem no intervalo do serviço;
- cada passo exige lembrar (completar, escolher), não reler — é a recuperação
  ativa que fixa;
- correção na hora, com o porquê; o erro volta no fim da mesma lição;
- unidades intercaladas entre matérias, na proporção do peso no edital: quem
  estuda Penal hoje encontra Institucional amanhã, e o peso maior aparece
  mais vezes.

Todo exercício sai do conteúdo que já viaja no deploy, sem IA e sem inventar:
- lacuna: o próprio texto da lei com a palavra que a banca troca apagada —
  prazo, fração de pena, reclusão/detenção, "poderá"/"deverá",
  "privativamente"/"exclusivamente", ou a palavra-chave marcada no seed. A
  resposta certa é sempre a palavra da lei;
- questões reais do banco (certo/errado e múltipla escolha);
- "em qual artigo está isto?", com o resumo do seed.

Determinístico por (lição, tentativa): a mesma tentativa monta a mesma lição,
e refazer embaralha de novo. O servidor não guarda progresso: o navegador
guarda (StudyState.trail).
"""
from __future__ import annotations

import math
import random
import re
from functools import lru_cache
from typing import Optional

from prf.local.content import get_store
from prf.local.script_builder import (
    _clean,
    _is_true_false,
    _question_origin,
    _split_segments,
    _usable_question,
)
from prf.local.trajeto import article_order, document_name

ARTICLES_PER_LESSON = 3
MAX_LAW_LESSONS = 8
QUESTIONS_PER_LESSON = 6
MAX_QUESTION_LESSONS = 4
REVIEW_SIZE = 10
CARD_MAX_CHARS = 900

# ── Lacunas: o que a banca troca ────────────────────────────────────────────

_QTY = re.compile(
    r"\b(\d{1,4})\s*\(([^)]{2,40})\)\s*"
    r"(dias?|anos?|m[eê]s(?:es)?|horas?|minutos?|sal[aá]rios?[- ]m[ií]nimos?)\b",
    re.IGNORECASE,
)
_COMMON_NUMBERS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 45, 48, 60, 72, 90, 120, 180, 360]
_FRACTIONS = ["um sexto", "um quinto", "um quarto", "um terço", "metade", "dois terços", "o dobro", "o triplo"]
_FRAC = re.compile(r"\b(" + "|".join(_FRACTIONS) + r")\b", re.IGNORECASE)
_PENALTY = re.compile(r"\b(reclusão|detenção)\b", re.IGNORECASE)
_MODAL = re.compile(r"\b(poderá|poderão|deverá|deverão)\b", re.IGNORECASE)
_COMPETENCE = re.compile(r"\b(privativamente|exclusivamente|concorrentemente)\b", re.IGNORECASE)
_NEGATION = re.compile(r"\b(não|ninguém|nenhum[a]?|nem|jamais|nunca)\b[^.;:]*$", re.IGNORECASE)
_PERMISSION = re.compile(r"\b(é vedad[oa]|é permitid[oa]|é facultad[oa]|é obrigatóri[oa])\b", re.IGNORECASE)


_SINGULAR = {"dias": "dia", "anos": "ano", "meses": "mês", "horas": "hora", "minutos": "minuto"}


def _unit_word(n: int, unit: str) -> str:
    """"30 dias", "1 ano", "2 salários mínimos" — a unidade concordando com o número."""
    base = unit.lower().replace("-", " ")
    if base.startswith("sal"):
        return "salário mínimo" if n == 1 else "salários mínimos"
    base = {"dia": "dias", "ano": "anos", "mês": "meses", "mes": "meses", "meses": "meses",
            "hora": "horas", "minuto": "minutos"}.get(base, base)
    return _SINGULAR.get(base, base) if n == 1 else base


def _qty_options(n: int, unit: str, rng: random.Random) -> list[str]:
    near = sorted(_COMMON_NUMBERS, key=lambda v: (abs(math.log(v) - math.log(max(n, 1))), v))
    picks = [v for v in near if v != n][:5]
    rng.shuffle(picks)
    return [f"{v} {_unit_word(v, unit)}" for v in picks[:3]]


def _match_case(word: str, like: str) -> str:
    return word[:1].upper() + word[1:] if like[:1].isupper() else word


def _candidates(text: str, highlights: list[str], hl_pool: list[str], rng: random.Random) -> list[dict]:
    """Lacunas possíveis num dispositivo, da mais à menos valiosa."""
    found: list[dict] = []

    for m in _QTY.finditer(text):
        n, unit = int(m.group(1)), m.group(3)
        answer = f"{n} {_unit_word(n, unit)}"
        found.append({"start": m.start(), "end": m.end(), "answer": answer,
                      "wrong": _qty_options(n, unit, rng), "kind": "prazo"})

    for m in _FRAC.finditer(text):
        word = m.group(1)
        wrong = [f for f in _FRACTIONS if f.lower() != word.lower()]
        found.append({"start": m.start(), "end": m.end(), "answer": word,
                      "wrong": [_match_case(w, word) for w in rng.sample(wrong, 3)], "kind": "fração"})

    for m in _PENALTY.finditer(text):
        word = m.group(1)
        other = "detenção" if word.lower() == "reclusão" else "reclusão"
        found.append({"start": m.start(), "end": m.end(), "answer": word,
                      "wrong": [_match_case(other, word), _match_case("prisão simples", word)], "kind": "pena"})

    for m in _MODAL.finditer(text):
        word = m.group(1)
        # "ninguém poderá", "não poderá": a negação já está na frase e
        # "não poderá" viraria opção absurda.
        if _NEGATION.search(text[max(0, m.start() - 30):m.start()]):
            continue
        plural = word.lower().endswith("ão")
        options = ["poderão", "deverão", "não poderão"] if plural else ["poderá", "deverá", "não poderá"]
        found.append({"start": m.start(), "end": m.end(), "answer": word,
                      "wrong": [_match_case(o, word) for o in options if o != word.lower()], "kind": "verbo"})

    for m in _COMPETENCE.finditer(text):
        word = m.group(1)
        options = ["privativamente", "exclusivamente", "concorrentemente"]
        found.append({"start": m.start(), "end": m.end(), "answer": word,
                      "wrong": [_match_case(o, word) for o in options if o != word.lower()], "kind": "competência"})

    for m in _PERMISSION.finditer(text):
        phrase = m.group(1)
        fem = phrase.lower().endswith("a")
        options = [f"é {w}{'a' if fem else 'o'}" for w in ("vedad", "permitid", "facultad", "obrigatóri")]
        found.append({"start": m.start(), "end": m.end(), "answer": phrase,
                      "wrong": [_match_case(o, phrase) for o in options if o != phrase.lower()][:3],
                      "kind": "permissão"})

    # Palavra-chave marcada no seed: só com distratores do mesmo feitio (mesmo
    # número de palavras, tamanho parecido) — "abuso de autoridade" contra
    # "custear" e "JECRIM" entrega a resposta.
    for h in highlights:
        if len(h) < 4:
            continue
        i = text.lower().find(h.lower())
        if i < 0:
            continue
        n_words = len(h.split())
        pool = [p for p in hl_pool if p.lower() != h.lower() and p.lower() not in text.lower()
                and len(p.split()) == n_words and 0.6 <= len(p) / len(h) <= 1.6]
        if len(pool) >= 3:
            # O pool vem com as palavras do próprio tópico na frente: o
            # distrator "parente" (outro instituto da mesma lei) é o que a
            # banca usa.
            found.append({"start": i, "end": i + len(h), "answer": text[i:i + len(h)],
                          "wrong": rng.sample(pool[:8], 3), "kind": "palavra-chave"})
    return found


def _window(text: str, start: int, end: int) -> tuple[str, str]:
    before, after = text[:start], text[end:]
    if len(before) > 220:
        cut = before[-220:]
        before = "…" + cut[cut.find(" ") + 1:] if " " in cut else "…" + cut
    if len(after) > 170:
        cut = after[:170]
        after = (cut[:cut.rfind(" ")] if " " in cut else cut) + "…"
    return before, after


def _ref(article: dict) -> str:
    return f"{article.get('article_number') or 'Dispositivo'} · {document_name(article.get('document_name'))}"


def _clozes(article: dict, hl_pool: list[str], rng: random.Random, limit: int = 2) -> list[dict]:
    out: list[dict] = []
    for seg in _split_segments(_clean(article.get("official_text"))):
        text = seg["text"]
        cands = _candidates(text, [_clean(h) for h in article.get("highlights") or []], hl_pool, rng)
        if not cands:
            continue
        c = cands[0]
        options = list(dict.fromkeys([c["answer"], *c["wrong"]]))
        if len(options) < 3:
            continue
        rng.shuffle(options)
        before, after = _window(text, c["start"], c["end"])
        out.append({
            "type": "lacuna", "ref": _ref(article), "kind": c["kind"],
            "before": before, "after": after, "options": options, "answer": c["answer"],
            "source": text, "said": text[c["start"]:c["end"]], "article_id": str(article["id"]),
        })
        if len(out) >= limit:
            break
    return out


def _card(article: dict) -> dict:
    segments = [s["text"] for s in _split_segments(_clean(article.get("official_text")))]
    text = "\n".join(segments)
    truncated = len(text) > CARD_MAX_CHARS
    if truncated:
        text = text[:CARD_MAX_CHARS].rsplit(" ", 1)[0] + "…"
    return {
        "type": "card", "ref": _ref(article), "chapter": _clean(article.get("chapter")),
        "text": text, "truncated": truncated, "simple": _clean(article.get("simple_text")),
        "highlights": [_clean(h) for h in article.get("highlights") or [] if _clean(h)],
        "article_id": str(article["id"]),
    }


def _which_article(article: dict, siblings: list[dict], rng: random.Random) -> Optional[dict]:
    number = article.get("article_number")
    others = list(dict.fromkeys(a.get("article_number") for a in siblings
                                if a.get("article_number") and a.get("article_number") != number))
    if not number or len(others) < 2:
        return None
    quote = _clean(article.get("simple_text"))
    if not quote:
        segs = _split_segments(_clean(article.get("official_text")))
        if not segs:
            return None
        quote = segs[0]["text"]
        quote = quote if len(quote) <= 180 else quote[:180].rsplit(" ", 1)[0] + "…"
    options = [number, *rng.sample(others, min(3, len(others)))]
    rng.shuffle(options)
    return {"type": "artigo", "ref": document_name(article.get("document_name")), "quote": quote,
            "options": options, "answer": number, "article_id": str(article["id"])}


def _question(q: dict) -> Optional[dict]:
    if not _usable_question(q):
        return None
    alts = q.get("alternatives") or []
    correct = next((a for a in alts if a.get("is_correct")), None)
    base = {
        "question_id": str(q["id"]), "subject_id": str(q.get("subject_id") or ""),
        "topic_id": str(q.get("topic_id") or ""), "context": _clean(q.get("context_text")),
        "statement": _clean(q.get("text")), "explanation": _clean(q.get("explanation")),
        "origin": _question_origin(q).rstrip("."),
    }
    if _is_true_false(alts):
        return {**base, "type": "certo_errado", "answer": _clean(correct.get("letter")).upper()}
    return {**base, "type": "multipla", "answer": _clean(correct.get("letter")).upper(),
            "options": [{"letter": _clean(a.get("letter")).upper(), "text": _clean(a.get("text"))} for a in alts]}


# ── Caminho ─────────────────────────────────────────────────────────────────

def _law_articles(topic_id: str) -> list[dict]:
    """Os artigos de maior incidência do tópico (até 8 lições de 3), na ordem
    da lei — ler o 13, o 14 e o 15 em sequência faz sentido; pular do 14
    para o 18 e voltar ao 13, não."""
    arts = [a for a in get_store().get_articles(topic_id_=topic_id, limit=100000) if _clean(a.get("official_text"))]
    keep = sorted(arts, key=lambda a: -(a.get("frequency_score") or 0))[:ARTICLES_PER_LESSON * MAX_LAW_LESSONS]
    return sorted(keep, key=article_order)


def _topic_questions(topic_id: str) -> list[dict]:
    qs = [x for x in (_question(q) for q in get_store().get_questions(topic_id_=topic_id, limit=1000)) if x]
    return qs[:QUESTIONS_PER_LESSON * MAX_QUESTION_LESSONS]


def _chunks(items: list, size: int) -> list[list]:
    """Divide em lições de tamanho parecido: 7 questões viram 4 + 3, não 6 + 1."""
    if not items:
        return []
    n = math.ceil(len(items) / size)
    base, extra = divmod(len(items), n)
    out, i = [], 0
    for k in range(n):
        step = base + (1 if k < extra else 0)
        out.append(items[i:i + step])
        i += step
    return out


@lru_cache(maxsize=32)
def _highlight_pool(subject_id: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(_clean(h) for a in get_store().get_articles(subject_id_=subject_id, limit=100000)
                               for h in a.get("highlights") or [] if _clean(h)))


def _span(arts: list[dict]) -> str:
    nums = [a.get("article_number") for a in arts if a.get("article_number")]
    if not nums:
        return "Lei seca"
    return f"Lei seca · {nums[0]}" if len(nums) == 1 else f"Lei seca · {nums[0]} a {nums[-1].replace('Art. ', '')}"


@lru_cache(maxsize=4)
def build_path(exam: str = "PMGO") -> dict:
    from prf.local.podcast_local import prebuilt_episode

    store = get_store()
    key = "weight_pm" if exam.upper().startswith("PM") else "weight_prf"
    queues: list[dict] = []
    for subject in store.get_subjects():
        weight = subject.get(key) or 0
        if weight <= 0:
            continue
        topics = []
        for t in store.get_topics(subject["slug"]):
            tid = str(t["id"])
            if _law_articles(tid) or _topic_questions(tid):
                topics.append(t)
        if topics:
            queues.append({"subject": subject, "weight": weight, "topics": topics, "pass": 0.0})

    # Agendamento por passo (stride): cada matéria avança 1/peso por unidade
    # tirada, então peso 3 aparece três vezes mais que peso 1, intercalado.
    units = []
    while any(q["topics"] for q in queues):
        q = min((q for q in queues if q["topics"]),
                key=lambda q: (q["pass"], -q["weight"], q["subject"].get("display_order") or 0))
        topic = q["topics"].pop(0)
        q["pass"] += 1.0 / q["weight"]
        tid = str(topic["id"])
        arts, qs = _law_articles(tid), _topic_questions(tid)
        lessons = []
        for n, chunk in enumerate(_chunks(arts, ARTICLES_PER_LESSON)):
            lessons.append({"id": f"{tid}.l{n + 1}", "kind": "lei", "title": _span(chunk)})
        for n in range(len(_chunks(qs, QUESTIONS_PER_LESSON))):
            lessons.append({"id": f"{tid}.q{n + 1}", "kind": "questoes", "title": f"Questões de prova {n + 1}"})
        if prebuilt_episode(tid):
            lessons.append({"id": f"{tid}.a", "kind": "audio", "title": "Ouça no trajeto"})
        lessons.append({"id": f"{tid}.r", "kind": "revisao", "title": "Revisão da unidade"})
        subject = q["subject"]
        units.append({
            "id": tid, "number": len(units) + 1, "topic_name": topic["name"],
            "subject_id": str(subject["id"]), "subject_name": subject["name"],
            "subject_slug": subject["slug"], "color": subject.get("color") or "#2D4CC8",
            "lessons": lessons,
        })
    return {"exam": exam.upper(), "units": units,
            "lessons_total": sum(len(u["lessons"]) for u in units)}


def build_lesson(lesson_id: str, attempt: int = 0) -> Optional[dict]:
    if "." not in lesson_id:
        return None
    tid, code = lesson_id.rsplit(".", 1)
    store = get_store()
    topic = store.get_topic(tid)
    if not topic:
        return None
    rng = random.Random(f"{lesson_id}:{attempt}")
    arts, qs = _law_articles(tid), _topic_questions(tid)
    topic_hl = [_clean(h) for a in store.get_articles(topic_id_=tid, limit=100000) for h in a.get("highlights") or []]
    hl_pool = list(dict.fromkeys([h for h in topic_hl if h] + list(_highlight_pool(str(topic["subject_id"])))))
    law_chunks, question_chunks = _chunks(arts, ARTICLES_PER_LESSON), _chunks(qs, QUESTIONS_PER_LESSON)
    extra: dict = {}
    steps: list[dict] = []

    if code.startswith("l") and code[1:].isdigit():
        n = int(code[1:])
        if not 1 <= n <= len(law_chunks):
            return None
        chunk = law_chunks[n - 1]
        for a in chunk:
            steps.append(_card(a))
            practice = _clozes(a, hl_pool, rng) or [x for x in [_which_article(a, arts, rng)] if x]
            steps.extend(practice)
        for q in rng.sample(qs, min(2, len(qs))):
            steps.append(q)
        kind, title = "lei", _span(chunk)
    elif code.startswith("q") and code[1:].isdigit():
        n = int(code[1:])
        if not 1 <= n <= len(question_chunks):
            return None
        steps = list(question_chunks[n - 1])
        rng.shuffle(steps)
        kind, title = "questoes", f"Questões de prova {n}"
    elif code == "r":
        pool: list[dict] = []
        for a in rng.sample(arts, min(len(arts), 8)):
            pool.extend(_clozes(a, hl_pool, rng, limit=1))
        pool = pool[:5]
        pool.extend(rng.sample(qs, min(len(qs), REVIEW_SIZE - len(pool))))
        if len(pool) < REVIEW_SIZE:
            for a in arts:
                x = _which_article(a, arts, rng)
                if x and len(pool) < REVIEW_SIZE:
                    pool.append(x)
        if not pool:
            return None
        rng.shuffle(pool)
        steps, kind, title = pool, "revisao", "Revisão da unidade"
    elif code == "a":
        from prf.local.podcast_local import prebuilt_episode

        episode = prebuilt_episode(tid)
        if not episode:
            return None
        kind, title, extra = "audio", "Ouça no trajeto", {"episode": episode}
    else:
        return None

    subject = store.get_subject(str(topic["subject_id"]))
    return {
        "id": lesson_id, "kind": kind, "title": title, "attempt": attempt,
        "topic_id": tid, "topic_name": topic["name"],
        "subject_id": str(topic["subject_id"]), "subject_name": subject["name"] if subject else "",
        "color": (subject or {}).get("color") or "#2D4CC8",
        "pass_ratio": 0.8 if kind == "revisao" else 0.0,
        "steps": steps, **extra,
    }
