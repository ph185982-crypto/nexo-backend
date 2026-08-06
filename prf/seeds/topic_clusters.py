"""Agrupamento de tópicos do edital em unidades de aula.

Medindo o volume de lei por tópico, a distribuição é muito desigual: alguns
tópicos têm menos de 2 kchars de texto legal (Concurso de pessoas tem 0,8) e
outros passam de 200 (Processo penal militar tem 224). Nem um extremo nem o
outro vira uma boa aula de 40 min — o tópico magro obriga o roteiro a encher
linguiça, que foi exatamente como nasceu o "geralzão", e o gigante não cabe
em episódio nenhum.

Este mapa resolve a ponta magra: junta tópicos que respondem à MESMA pergunta
jurídica e que a banca cobra misturados. O critério é cadeia de raciocínio,
não semelhança de nome — juntar por afinidade vaga devolveria o problema que
o agrupamento deveria resolver.

A ponta gorda é resolvida em outro lugar (podcast_service.plan_parts), que
fatia o material em partes numeradas em vez de comprimir.

Os agrupamentos moram aqui, escritos à mão, pelo mesmo motivo que
ARTICLE_TOPIC_RANGES mora em article_topics.py: o vínculo é um julgamento
estável e verificável, e não deve mudar a cada execução.
"""
from __future__ import annotations

# subject_slug -> lista de unidades de aula.
# Cada unidade: (nome exibido, [topic_slugs que a compõem], motivo do agrupamento)
# Só aparecem aqui os tópicos que NÃO se sustentam sozinhos; qualquer tópico
# ausente deste mapa vira uma unidade própria.
TOPIC_CLUSTERS: dict[str, list[tuple[str, list[str], str]]] = {
    "direito-penal": [
        (
            "Excludentes, culpabilidade e concurso de pessoas",
            ["excludentes-ilicitude", "culpabilidade", "concurso-pessoas"],
            "os três respondem quando e a quem se atribui — ou se afasta — a "
            "punição pelo fato típico, e a banca mistura os três na mesma questão",
        ),
    ],
    "direito-constitucional": [
        (
            "Princípios fundamentais e Administração Pública",
            ["principios-fundamentais", "adm-publica-cf"],
            "ambos tratam dos princípios que regem o Estado e a atuação da "
            "Administração, e os arts. 1º a 4º são a base de leitura do art. 37",
        ),
    ],
    "direitos-humanos": [
        (
            "Vedação à tortura e proteção de grupos vulneráveis",
            ["tortura-degradante", "minorias-vulneraveis"],
            "os dois delimitam o que o Estado não pode fazer com a pessoa sob "
            "seu poder, que é o recorte de direitos humanos cobrado da PM",
        ),
        (
            "Instrumentos internacionais e sistema interamericano",
            ["dudh", "pacto-san-jose", "sistema-interamericano"],
            "a DUDH e o Pacto são a fonte e o sistema interamericano é o "
            "mecanismo que os aplica — separados, nenhum se sustenta",
        ),
    ],
    "direito-processual-penal": [
        (
            "Ação penal e competência",
            ["acao-penal", "competencia-cpp"],
            "quem promove a ação e perante qual juízo são a mesma decisão "
            "prática na cadeia do processo",
        ),
    ],
}


def cluster_for_topic(subject_slug: str, topic_slug: str) -> tuple[str, list[str]] | None:
    """Devolve (nome da unidade, topic_slugs) se o tópico faz parte de um
    agrupamento; None quando ele vira unidade sozinho."""
    for name, slugs, _motivo in TOPIC_CLUSTERS.get(subject_slug, []):
        if topic_slug in slugs:
            return name, slugs
    return None
