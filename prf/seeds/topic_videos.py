"""
Videoaula do tópico do dia.

A missão precisa entregar uma aula em vídeo do MESMO assunto que o áudio, a lei
seca e as questões daquele dia. Duas fontes, nessa ordem:

1. **Curadoria por matéria** — vídeos gratuitos já verificados no repositório
   (`external_resources.py`), embutidos no app via player do YouTube.
2. **Busca por tópico** — quando a matéria não tem vídeo curado, o bloco abre uma
   busca pronta no YouTube com o nome exato do tópico. Não embute (o YouTube não
   permite embutir uma página de resultado), mas sempre existe e nunca quebra.

Por que não um vídeo fixo por tópico: são 91 tópicos no edital PMGO e um ID de
vídeo curado hoje pode ser removido pelo canal amanhã — um link morto no meio da
missão é pior que uma busca que sempre devolve aula. Onde há curadoria, ela
ganha; onde não há, a busca cobre.
"""
from __future__ import annotations

from urllib.parse import quote_plus

# Vídeos gratuitos por matéria, na ordem em que devem ser oferecidos.
# Só entram URLs de vídeo único (watch?v=) ou playlist — ver _split_url.
SUBJECT_VIDEOS: dict[str, list[dict]] = {
    "legislacao-institucional-pm": [
        {"title": "Correção da Prova Soldado PMGO AOCP 2022",
         "url": "https://www.youtube.com/watch?v=Vc7ymM6Wf3A",
         "source": "YouTube"},
    ],
    "direito-penal-militar": [
        {"title": "Saber Direito — Direito Penal Militar Aula 1 (TV Justiça)",
         "url": "https://www.youtube.com/watch?v=hBlhM84LCss",
         "source": "TV Justiça"},
        {"title": "Crimes contra Autoridade ou Disciplina Militar — Prof. Muniz",
         "url": "https://www.youtube.com/watch?v=7J9ST8srHSs",
         "source": "YouTube"},
        {"title": "Playlist CPM completa — Código Penal Militar",
         "url": "https://www.youtube.com/playlist?list=PL8N0g0H3P2ExzSQ6PKfzMjCkYoD-eEIy4",
         "source": "YouTube"},
    ],
    "direito-processual-penal-militar": [
        {"title": "DPPM — IPM Arts. 9 ao 28 (Prof. Pedro Sillas)",
         "url": "https://www.youtube.com/watch?v=3-e14IA9Kto",
         "source": "YouTube"},
        {"title": "Playlist CPPM — Decreto-lei 1.002/1969",
         "url": "https://www.youtube.com/playlist?list=PL64hzxlE6uurO4ZmbEwBjLEGg4U8QuFEL",
         "source": "YouTube"},
    ],
    "realidade-goias": [
        {"title": "História e Geografia de Goiás — Prof. Chagas Sousa",
         "url": "https://www.youtube.com/watch?v=bcDab5O6phA",
         "source": "YouTube"},
        {"title": "Geo-história de Goiás — Maratona SEFAZ/ALEGO",
         "url": "https://www.youtube.com/watch?v=_nOyRgq_MKY",
         "source": "YouTube"},
        {"title": "História e Geografia de Goiás — Resumo para concursos",
         "url": "https://www.youtube.com/watch?v=0mpBiBQ91B0",
         "source": "YouTube"},
        {"title": "Formação Econômica de Goiás",
         "url": "https://www.youtube.com/watch?v=omJH50ugCFE",
         "source": "YouTube"},
    ],
    "criminologia": [
        {"title": "Noções de Criminologia — Questões CEBRASPE (Laécio Carneiro)",
         "url": "https://www.youtube.com/watch?v=hpXciWz9Dxc",
         "source": "YouTube"},
        {"title": "Noções de Criminologia em Questões — PMCE",
         "url": "https://www.youtube.com/watch?v=KUXs_7kh_BY",
         "source": "YouTube"},
        {"title": "Criminologia na PCPE — Parte 1",
         "url": "https://www.youtube.com/watch?v=qBzJQTuZx_g",
         "source": "YouTube"},
    ],
    "medicina-legal": [
        {"title": "Morte e Tanatognose — Medicina Legal",
         "url": "https://www.youtube.com/watch?v=SM8xrAk67oQ",
         "source": "YouTube"},
        {"title": "Medicina Legal — Tanatologia Forense",
         "url": "https://www.youtube.com/watch?v=P7IvsgDi72w",
         "source": "YouTube"},
        {"title": "Med Legal Aula 15 — Tanatologia IV + Sexologia Forense I",
         "url": "https://www.youtube.com/watch?v=NrIL8uVU9p0",
         "source": "YouTube"},
        {"title": "Med Legal — Prof. Janiel Santana (Polícia Civil)",
         "url": "https://www.youtube.com/watch?v=1Tczq7wJXS4",
         "source": "YouTube"},
    ],
}

# Complemento da busca por matéria. O nome do tópico entra na frente; isto só
# amarra o contexto de concurso para o YouTube não devolver aula de faculdade.
SEARCH_HINTS: dict[str, str] = {
    "direito-constitucional": "direito constitucional aula concurso policial",
    "direito-penal": "direito penal aula concurso policial",
    "direito-processual-penal": "processo penal aula concurso policial",
    "direito-administrativo": "direito administrativo aula concurso",
    "lingua-portuguesa": "português aula concurso",
    "legislacao-especial": "legislação penal especial aula concurso",
    "direitos-humanos": "direitos humanos aula concurso policial",
    "informatica": "informática aula concurso",
    "raciocinio-logico": "raciocínio lógico aula concurso",
    "etica-servico-publico": "ética no serviço público aula concurso",
    "direito-penal-militar": "direito penal militar aula concurso",
    "direito-processual-penal-militar": "processo penal militar aula concurso",
    "legislacao-institucional-pm": "legislação institucional PM Goiás aula",
    "criminologia": "criminologia aula concurso",
    "medicina-legal": "medicina legal aula concurso",
    "realidade-goias": "Goiás história geografia concurso",
}


def _split_url(url: str) -> tuple[str | None, str | None]:
    """(video_id, playlist_id) — só video_id pode ser embutido no app."""
    if "watch?v=" in url:
        return url.split("watch?v=")[1].split("&")[0], None
    if "list=" in url:
        return None, url.split("list=")[1].split("&")[0]
    return None, None


def search_url(subject_slug: str, subject_name: str, topic_name: str) -> str:
    hint = SEARCH_HINTS.get(subject_slug) or f"{subject_name} aula concurso"
    return "https://www.youtube.com/results?search_query=" + quote_plus(
        f"{topic_name} {hint}"
    )


def video_for_topic(
    subject_slug: str,
    subject_name: str,
    topic_name: str,
    rotation: int = 0,
) -> dict:
    """Videoaula para o tópico do dia.

    `rotation` gira a curadoria da matéria para o candidato não receber sempre
    o mesmo vídeo — use um contador estável (ex.: dias desde o início) para a
    escolha ser a mesma dentro do mesmo dia.
    """
    curated = SUBJECT_VIDEOS.get(subject_slug) or []
    if curated:
        pick = curated[rotation % len(curated)]
        video_id, playlist_id = _split_url(pick["url"])
        return {
            "title": pick["title"],
            "url": pick["url"],
            "source": pick.get("source", "YouTube"),
            "video_id": video_id,
            "playlist_id": playlist_id,
            "is_search": False,
            "topic_name": topic_name,
        }

    return {
        "title": f"Videoaula — {topic_name}",
        "url": search_url(subject_slug, subject_name, topic_name),
        "source": "Busca no YouTube",
        "video_id": None,
        "playlist_id": None,
        "is_search": True,
        "topic_name": topic_name,
    }
