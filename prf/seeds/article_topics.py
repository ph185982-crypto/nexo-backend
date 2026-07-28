"""Mapa de artigo -> tópico do edital.

A trilha de estudo mostra um tópico e reúne, numa tela só, a lei que o rege, as
questões que já caíram sobre ele e o áudio da aula. Isso só funciona se cada
artigo souber a que tópico pertence, e o texto do Planalto não traz essa
informação: o capítulo que ele carrega é a divisão interna do código
("CAPÍTULO XV"), não a divisão do edital.

Os intervalos abaixo foram conferidos contra os cabeçalhos extraídos de cada
código, e é por isso que eles moram aqui em vez de sair de um classificador:
o vínculo é estável, verificável e não muda a cada execução.
"""
from __future__ import annotations

import re

# document_slug -> lista de (primeiro_artigo, último_artigo, subject_slug, topic_slug)
ARTICLE_TOPIC_RANGES: dict[str, list[tuple[int, int, str, str]]] = {
    "ctb": [
        (1, 25, "legislacao-transito", "snt"),
        (26, 67, "legislacao-transito", "normas-circulacao"),
        (68, 71, "legislacao-transito", "pedestres"),
        (72, 79, "legislacao-transito", "snt"),
        (80, 90, "legislacao-transito", "sinalizacao"),
        (91, 95, "legislacao-transito", "snt"),
        (96, 119, "legislacao-transito", "veiculos"),
        (120, 135, "legislacao-transito", "registro-licenciamento"),
        (136, 139, "legislacao-transito", "veiculos"),
        (140, 160, "legislacao-transito", "habilitacao"),
        (161, 255, "legislacao-transito", "infracoes"),
        (256, 290, "legislacao-transito", "penalidades"),
        (291, 312, "legislacao-transito", "crimes-transito"),
        (313, 341, "legislacao-transito", "snt"),
    ],
    "cf-88": [
        (1, 4, "direito-constitucional", "principios-fundamentais"),
        (5, 17, "direito-constitucional", "direitos-garantias"),
        (18, 36, "direito-constitucional", "organizacao-estado"),
        (37, 43, "direito-constitucional", "adm-publica-cf"),
        (44, 75, "direito-constitucional", "poder-legislativo"),
        (76, 91, "direito-constitucional", "poder-executivo"),
        (92, 126, "direito-constitucional", "poder-judiciario"),
        (127, 135, "direito-constitucional", "organizacao-estado"),
        (136, 144, "direito-constitucional", "seguranca-publica"),
        # Do art. 145 em diante a Constituição trata de tributação e ordem
        # econômica e social, que o edital destes certames não cobra. Ficam
        # legíveis na biblioteca, mas fora da trilha.
    ],
    "cp": [
        (1, 12, "direito-penal", "aplicacao-lei-penal"),
        (13, 22, "direito-penal", "crime"),
        (23, 25, "direito-penal", "excludentes-ilicitude"),
        (26, 28, "direito-penal", "culpabilidade"),
        (29, 31, "direito-penal", "concurso-pessoas"),
        (32, 120, "direito-penal", "penas"),
        (121, 154, "direito-penal", "crimes-pessoa"),
        (155, 183, "direito-penal", "crimes-patrimonio"),
        (312, 359, "direito-penal", "crimes-adm-publica"),
    ],
    "cpp": [
        (1, 23, "direito-processual-penal", "inquerito-policial"),
        (24, 68, "direito-processual-penal", "acao-penal"),
        (69, 91, "direito-processual-penal", "competencia-cpp"),
        (155, 250, "direito-processual-penal", "provas"),
        (282, 350, "direito-processual-penal", "prisao-liberdade"),
        (574, 667, "direito-processual-penal", "recursos-cpp"),
    ],
}

# Leis inteiras que correspondem a um único tópico do edital.
WHOLE_DOCUMENT_TOPIC: dict[str, tuple[str, str]] = {
    "lei-drogas": ("legislacao-especial", "lei-drogas"),
    "estatuto-desarmamento": ("legislacao-especial", "estatuto-desarmamento"),
    "maria-penha": ("legislacao-especial", "maria-penha"),
    "abuso-autoridade": ("legislacao-especial", "abuso-autoridade"),
    "eca": ("legislacao-especial", "eca"),
    "crimes-hediondos": ("legislacao-especial", "crimes-hediondos"),
    "organizacao-criminosa": ("legislacao-especial", "organizacao-criminosa"),
    # Tortura e racismo são cobrados como Direitos Humanos, não como legislação
    # penal avulsa, e é sob essa matéria que o candidato os procura.
    "tortura": ("direitos-humanos", "tortura-degradante"),
    "racismo": ("direitos-humanos", "minorias-vulneraveis"),
}

# Códigos militares: cobrados na PM, ausentes no edital da PRF.
ARTICLE_TOPIC_RANGES["cpm"] = [
    (1, 28, "direito-penal-militar", "aplicacao-lei-penal-militar"),
    (29, 58, "direito-penal-militar", "crime-militar"),
    (59, 135, "direito-penal-militar", "penas-militares"),
    (136, 204, "direito-penal-militar", "crimes-militares-especie"),
    (205, 410, "direito-penal-militar", "crimes-militares-especie"),
]
ARTICLE_TOPIC_RANGES["cppm"] = [
    (1, 27, "direito-processual-penal-militar", "processo-penal-militar-geral"),
    (28, 100, "direito-processual-penal-militar", "ipm"),
    (101, 300, "direito-processual-penal-militar", "processo-penal-militar-geral"),
    (301, 606, "direito-processual-penal-militar", "processo-penal-militar-geral"),
]


def article_int(article_number: str) -> int | None:
    """'Art. 121', 'Art. 121-A' -> 121."""
    m = re.search(r"(\d+)", article_number or "")
    return int(m.group(1)) if m else None


def resolve_topic(document_slug: str, article_number: str) -> tuple[str | None, str | None]:
    """Devolve (subject_slug, topic_slug) do artigo, ou (None, None)."""
    whole = WHOLE_DOCUMENT_TOPIC.get(document_slug)
    if whole:
        return whole

    n = article_int(article_number)
    if n is None:
        return None, None

    for first, last, subject, topic in ARTICLE_TOPIC_RANGES.get(document_slug, []):
        if first <= n <= last:
            return subject, topic
    return None, None
