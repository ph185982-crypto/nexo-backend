"""
Roteiro de aula sem LLM — montado a partir da lei estruturada.

Existe porque o roteiro LLM é o único pedaço do modo local que precisa de
credencial: sem chave de provedor válida, `generate_episode` devolve zero
falas e o episódio não sai. Aqui o roteiro é derivado dos campos que já
viajam no deploy (`official_text`, `simple_text`, `highlights`), então o
áudio funciona sempre, de graça, sem chave nenhuma.

O que ele faz e o que não faz: lê o dispositivo na íntegra, traduz com o
resumo já revisado do seed, treina as expressões que a banca troca e fecha
com recall. Não inventa ocorrência de rua, jurisprudência nem assertiva de
prova — isso exige conhecimento que não está no seed, e inventar num
material de estudo é pior que não ter. Quando existe chave válida o roteiro
LLM continua sendo o preferido (ver podcast_local.build_script); este é o
piso, não o teto.

Saída no mesmo formato de `podcast_service.generate_episode`, para que TTS,
fronteiras de segmento, player e cache no IndexedDB não mudem nada.
"""
from __future__ import annotations

import re
from typing import Optional

from prf.services.podcast_service import HOST_A, HOST_B, estimate_duration_secs

# Artigos por bloco de leitura. Os blocos viram as fronteiras que o player
# usa para navegar, então nem um bloco gigante nem trinta minúsculos.
ARTICLES_PER_BLOCK = 3
MAX_READING_BLOCKS = 7

_ANNOUNCE = (
    "Vamos para o {num}, do {doc}.",
    "{num}. Lê para mim.",
    "Agora o {num}.",
    "Próximo dispositivo: {num}, do {doc}.",
)

_ASK_TRANSLATION = (
    "Traduz isso para mim.",
    "O que isso quer dizer na prática?",
    "Na linguagem da rua, o que é isso?",
    "Me explica como se eu nunca tivesse lido esse artigo.",
)

_ASK_MORE = (
    "E continua?",
    "Tem mais.",
    "Segue.",
    "E o que vem depois?",
)

# "Parágrafo único", "§ 2º", "II -", "a)" — o que marca o início de um
# dispositivo novo dentro do mesmo artigo.
#
# O `(?<![^\s])` exige que o marcador venha depois de espaço (ou do começo do
# texto), e não é detalhe cosmético: sem ele o numeral "II -" casa duas vezes,
# uma em cada "I", e a divisão entrega "I" seguido de "I - tentado" — ou seja,
# o inciso II passa a ser lido ao ouvinte como inciso I. Num material de
# estudo para prova isso é erro de conteúdo, não de formatação.
_MARKER = r"(?:§\s*\d+|Parágrafo\s+único|[IVXLC]{1,5}\s*[-–—]\s|[a-z]\)\s)"
_SEGMENT_START = re.compile(rf"(?<![^\s])(?={_MARKER})")
_LINE_IS_DISPOSITIVO = re.compile(_MARKER)

# Rubrica marginal do código grudada no fim do dispositivo anterior — o seed
# traz "...definição legal; Tentativa" e "Diz-se o crime: Crime consumado".
# Lida no meio da frase é ruído; extraída, vira o anúncio do dispositivo
# seguinte, que é a função que ela tem no texto impresso.
_TRAILING_RUBRIC = re.compile(r"(?<=[;.:])\s+([A-ZÀ-Ý][^.;:!?,]{2,58})$")
MAX_RUBRIC_WORDS = 7

_LETTERS = re.compile(r"[A-Za-zÀ-ÿ]")

# Cabeçalho de capítulo grudado no fim do texto oficial (o seed traz
# "... satisfação pessoal. CAPÍTULO II DOS SUJEITOS DO CRIME"). Lido em voz
# alta vira ruído no meio da frase, então sai.
_TRAILING_HEADER = re.compile(
    r"\s+(?:CAPÍTULO|TÍTULO|SEÇÃO|SUBSEÇÃO|LIVRO)\s+[IVXLC0-9]+.*$"
)


def build_episode(
    topic_name: str,
    subject_name: str,
    articles: list[dict],
) -> dict:
    """Monta o episódio inteiro. `articles` no formato do ContentStore."""
    usable = [a for a in articles if _clean(a.get("official_text"))]
    if not usable:
        return {"topic": topic_name, "turns": [], "blocks": [],
                "segment_count": 0, "duration_secs": 0, "word_count": 0}

    blocks: list[list[tuple[str, str]]] = [
        _opening(topic_name, subject_name, usable)
    ]

    per_block = max(ARTICLES_PER_BLOCK, -(-len(usable) // MAX_READING_BLOCKS))
    for start in range(0, len(usable), per_block):
        chunk = usable[start:start + per_block]
        block: list[tuple[str, str]] = []
        for offset, article in enumerate(chunk):
            block.extend(_read_article(article, start + offset))
        blocks.append(block)

    terms = _terms_drill(usable)
    if terms:
        blocks.append(terms)
    blocks.append(_recall(topic_name, usable))

    turns = [
        {"speaker": speaker, "text": text, "block": index}
        for index, block in enumerate(blocks)
        for speaker, text in block
    ]
    return {
        "topic": topic_name,
        "turns": turns,
        "blocks": list(range(len(blocks))),
        "segment_count": len(blocks),
        "duration_secs": estimate_duration_secs(turns),
        "word_count": sum(len(t["text"].split()) for t in turns),
    }


def _opening(topic: str, subject: str, articles: list[dict]) -> list[tuple[str, str]]:
    numbers = [a.get("article_number", "") for a in articles if a.get("article_number")]
    doc = _main_document(articles)
    chapter = next((a.get("chapter") for a in articles if a.get("chapter")), None)

    turns = [
        (HOST_A, f"Aula de hoje: {topic}. Matéria: {subject}."),
        (HOST_B, "E hoje a gente faz do jeito que funciona para prova: eu leio o "
                 "dispositivo exatamente como está escrito na lei, e a gente "
                 "destrincha em seguida. Sem resumo por cima."),
    ]
    if doc:
        turns.append((HOST_A, f"A base é o {doc}."))
    if numbers:
        turns.append((
            HOST_A,
            f"São {len(numbers)} dispositivos hoje: {_listing(numbers)}.",
        ))
    if chapter:
        turns.append((HOST_B, f"Tudo dentro de {_clean(chapter)}."))
    turns.append((
        HOST_A,
        "No fim do episódio eu te faço as perguntas, então presta atenção nas "
        "expressões que a Julia marcar — é nelas que a banca mexe.",
    ))
    return turns


def _read_article(article: dict, position: int) -> list[tuple[str, str]]:
    number = article.get("article_number") or "próximo artigo"
    doc = _clean(article.get("document_name")) or "texto legal"
    segments = _split_segments(_clean(article.get("official_text")))
    if not segments:
        return []

    turns = [
        (HOST_A, _ANNOUNCE[position % len(_ANNOUNCE)].format(num=number, doc=doc)),
        (HOST_B, segments[0]["text"]),
    ]

    simple = _clean(article.get("simple_text"))
    if simple:
        turns.append((HOST_A, _ASK_TRANSLATION[position % len(_ASK_TRANSLATION)]))
        turns.append((HOST_B, simple))

    for index, segment in enumerate(segments[1:]):
        rubric = segments[index]["rubric"]
        cue = f"Agora: {rubric}." if rubric else _ASK_MORE[index % len(_ASK_MORE)]
        turns.append((HOST_A, cue))
        turns.append((HOST_B, segment["text"]))

    highlights = _highlights(article)
    if highlights:
        turns.append((
            HOST_B,
            f"Guarda estas expressões do {number}: {_listing(highlights)}. "
            "É trocando uma palavra dessas que a banca torna o item errado.",
        ))
    return turns


def _terms_drill(articles: list[dict]) -> list[tuple[str, str]]:
    seen: list[str] = []
    for article in articles:
        for term in _highlights(article):
            if term.lower() not in {s.lower() for s in seen}:
                seen.append(term)
    if not seen:
        return []

    turns = [
        (HOST_A, "Antes da revisão, as palavras que valem a questão."),
        (HOST_B, f"São {len(seen)} expressões. Eu digo uma por vez e você "
                 "repete em voz alta, mesmo dirigindo."),
    ]
    for index, term in enumerate(seen):
        turns.append((HOST_B, f"{term}."))
        if index % 4 == 3:
            turns.append((HOST_A, "Repetindo de cabeça."))
    return turns


def _recall(topic: str, articles: list[dict]) -> list[tuple[str, str]]:
    turns = [
        (HOST_A, "Agora a revisão. Eu pergunto, você responde de cabeça, e a "
                 "Julia confirma depois."),
    ]
    asked = 0
    for article in articles:
        simple = _clean(article.get("simple_text"))
        number = article.get("article_number")
        if not simple or not number:
            continue
        turns.append((HOST_A, f"O que diz o {number}?"))
        turns.append((HOST_A, "Pensa antes de ouvir a resposta."))
        turns.append((HOST_B, simple))
        asked += 1

    if not asked:
        turns.append((HOST_B, f"Releia os dispositivos de {topic} na lei seca "
                              "do aplicativo para fechar o ciclo."))

    turns.append((HOST_B, f"É isso de {topic} por hoje."))
    turns.append((HOST_A, "Amanhã tem mais. Bons estudos."))
    return turns


def _split_segments(text: str) -> list[dict]:
    """Caput primeiro, depois cada parágrafo, inciso ou alínea por vez.

    A leitura comentada só existe se a Julia puder parar entre dispositivos —
    lido tudo de uma vez o ouvinte perde onde um acaba e o outro começa.

    Cada item leva o texto e a rubrica que estava grudada no fim dele, que
    rotula o dispositivo seguinte.

    As quebras de linha do seed misturam estrutura real com quebra de largura
    ("...pune-se a tentativa com a\\npena correspondente..."), então só começa
    dispositivo novo a linha que abre com marcador. Sem isso a Julia para no
    meio da frase, e a rubrica solta numa linha própria ("Pena de tentativa")
    é lida como se fosse o texto da norma.
    """
    if not text:
        return []

    logical: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if logical and not _LINE_IS_DISPOSITIVO.match(line):
            logical[-1] = f"{logical[-1]} {line}"
        else:
            logical.append(line)

    raw: list[str] = []
    for line in logical:
        raw.extend(part.strip() for part in _SEGMENT_START.split(line) if part.strip())

    segments: list[dict] = []
    for piece in raw:
        # Fragmento sem letra suficiente (um "a)" solto de dado malformado)
        # sintetiza como áudio vazio, e uma fala vazia hoje derruba o episódio
        # inteiro em synthesize_segment. Fora antes de virar fala.
        if len(_LETTERS.findall(piece)) < 2:
            continue
        body, rubric = _strip_rubric(piece)
        if body:
            segments.append({"text": body, "rubric": rubric})
    return segments


def _strip_rubric(segment: str) -> tuple[str, str]:
    match = _TRAILING_RUBRIC.search(segment)
    if not match:
        return segment, ""
    rubric = match.group(1).strip()
    if len(rubric.split()) > MAX_RUBRIC_WORDS:
        return segment, ""
    return segment[:match.start()].strip(), rubric


def _highlights(article: dict) -> list[str]:
    values = article.get("highlights") or []
    return [_clean(v) for v in values if _clean(v)][:4]


def _main_document(articles: list[dict]) -> Optional[str]:
    counts: dict[str, int] = {}
    for article in articles:
        name = _clean(article.get("document_name"))
        if name:
            counts[name] = counts.get(name, 0) + 1
    if not counts:
        return None
    return max(counts, key=lambda name: counts[name])


def _listing(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return items[0] if items else ""
    return f"{', '.join(items[:-1])} e {items[-1]}"


def _clean(value) -> str:
    if not value:
        return ""
    return _TRAILING_HEADER.sub("", str(value).strip()).strip()
