"""
Videoaula do tópico do dia.

A missão precisa entregar uma aula em vídeo do MESMO assunto que o áudio, a lei
seca e as questões daquele dia. Duas fontes, nessa ordem:

1. **Curadoria por matéria** — as 16 matérias do edital PMGO têm aula gratuita
   curada aqui, embutida no app via player do YouTube. Todo ID foi verificado
   pelo endpoint oEmbed do YouTube (devolve título e canal só para vídeo
   público e existente); os que voltaram erro ficaram de fora.
2. **Busca por tópico** — rede de segurança: matéria sem curadoria (ou vídeo
   removido pelo canal depois) cai numa busca pronta no YouTube com o nome
   exato do tópico. Não embute — o YouTube não permite embutir página de
   resultado — mas nunca deixa a etapa sem conteúdo.

Por que curadoria por MATÉRIA e não por tópico: são 91 tópicos no edital e um
vídeo específico por tópico envelhece rápido (canal remove, renomeia, tranca).
A rotação por dia dentro da lista da matéria dá variedade sem prometer uma
precisão que não se sustenta no tempo.

Manutenção: para conferir se um vídeo continua no ar,
  curl -s "https://www.youtube.com/oembed?url=https%3A//www.youtube.com/watch%3Fv%3D<ID>&format=json"
Resposta com "title" = vivo. Erro = trocar ou remover a entrada.
"""
from __future__ import annotations

from urllib.parse import quote_plus

# Vídeos gratuitos por matéria. Só URL de vídeo único (watch?v=) ou playlist.
SUBJECT_VIDEOS: dict[str, list[dict]] = {
    # ── Bloco 2 — Conhecimentos Específicos (peso 2) ────────────────────
    "direito-constitucional": [
        {"title": "Curso Completo de Direito Constitucional — Prof. João Trindade",
         "url": "https://www.youtube.com/watch?v=e_KFS87Ydsw", "source": "Estratégia Concursos"},
        {"title": "Direito Constitucional Direto ao Ponto — Prof. Adriane Fauth",
         "url": "https://www.youtube.com/watch?v=1ZMIAVX-abI", "source": "Estratégia Concursos"},
        {"title": "Direito Constitucional do Zero — Básico ao Avançado",
         "url": "https://www.youtube.com/watch?v=qdQl1fOLItc", "source": "Monster Concursos"},
        {"title": "Administração Pública na Constituição — aula completa",
         "url": "https://www.youtube.com/watch?v=IigWLLDZ4Ls", "source": "Nova Concursos"},
        {"title": "Noções de Direito Constitucional para Polícia Penal",
         "url": "https://www.youtube.com/watch?v=bTjmKcHZ5WI", "source": "Gran Cursos Online"},
    ],
    "direito-penal": [
        {"title": "Curso Completo de Direito Penal — Prof. Priscila Silveira",
         "url": "https://www.youtube.com/watch?v=_-j5_fYx0jU", "source": "Estratégia Concursos"},
        {"title": "Direito Penal para a Polícia Federal — Aula 1",
         "url": "https://www.youtube.com/watch?v=M9fgS2bQRsQ", "source": "Direção Concursos"},
        {"title": "Direito Penal para Concursos — Aula 1/2",
         "url": "https://www.youtube.com/watch?v=4LKecwQBCBg", "source": "AlfaCon"},
        {"title": "Culpabilidade e Concurso de Pessoas",
         "url": "https://www.youtube.com/watch?v=wHY3TPx54BA", "source": "Gran Cursos Online"},
    ],
    "direito-processual-penal": [
        {"title": "Curso Completo de Direito Processual Penal — Prof. Priscila Silveira",
         "url": "https://www.youtube.com/watch?v=7ieM3XYi-so", "source": "Estratégia Concursos"},
        {"title": "Processo Penal — Inquérito Policial",
         "url": "https://www.youtube.com/watch?v=KhCuXohkhP0", "source": "Gran Cursos Online"},
        {"title": "Processo Penal — Provas",
         "url": "https://www.youtube.com/watch?v=7akpo1NkWD4", "source": "Gran Cursos Online"},
    ],
    "direito-administrativo": [
        {"title": "Curso Completo de Direito Administrativo — Prof. Herbert Almeida",
         "url": "https://www.youtube.com/watch?v=z7e5sLoJ-zE", "source": "Estratégia Concursos"},
        {"title": "Direito Administrativo DO ZERO — Prof. Herbert Almeida",
         "url": "https://www.youtube.com/watch?v=grclGajkRKg", "source": "Estratégia Concursos"},
        {"title": "Direito Administrativo para Concursos — Aula 1/2",
         "url": "https://www.youtube.com/watch?v=hDRIv5modxY", "source": "AlfaCon"},
        {"title": "Direito Administrativo Curso Completo — Aula 01",
         "url": "https://www.youtube.com/watch?v=Y05eBabb-zI", "source": "Professor Luiz Phelipe"},
    ],
    "legislacao-especial": [
        {"title": "Lei de Drogas (Lei 11.343/06) — aula gratuita",
         "url": "https://www.youtube.com/watch?v=i5lcZyzzP_k", "source": "Dedicação Delta"},
        {"title": "Estatuto do Desarmamento (Lei 10.826/03) — aula gratuita",
         "url": "https://www.youtube.com/watch?v=6WqqpOA5qKs", "source": "Dedicação Delta"},
        {"title": "Principais Leis Penais Especiais e sua aplicação",
         "url": "https://www.youtube.com/watch?v=f1IS1WNaq0U", "source": "Me Julga — Cíntia Brunelli"},
        {"title": "Lei de Drogas esquematizada",
         "url": "https://www.youtube.com/watch?v=AYn7n5NhNAM", "source": "Focus Concursos"},
    ],
    "direito-penal-militar": [
        {"title": "Saber Direito — Direito Penal Militar, Aula 1",
         "url": "https://www.youtube.com/watch?v=hBlhM84LCss", "source": "Rádio e TV Justiça"},
        {"title": "Crimes contra a autoridade ou disciplina militar — Prof. Muniz",
         "url": "https://www.youtube.com/watch?v=7J9ST8srHSs", "source": "Vetorial Concursos"},
        {"title": "Playlist CPM completa — Código Penal Militar",
         "url": "https://www.youtube.com/playlist?list=PL8N0g0H3P2ExzSQ6PKfzMjCkYoD-eEIy4",
         "source": "YouTube"},
    ],
    "direito-processual-penal-militar": [
        {"title": "Inquérito Policial Militar — arts. 9º a 28 do CPPM",
         "url": "https://www.youtube.com/watch?v=3-e14IA9Kto", "source": "Lac Concursos"},
        {"title": "Playlist CPPM — Decreto-lei 1.002/1969",
         "url": "https://www.youtube.com/playlist?list=PL64hzxlE6uurO4ZmbEwBjLEGg4U8QuFEL",
         "source": "YouTube"},
    ],
    "legislacao-institucional-pm": [
        {"title": "Correção da Prova Soldado PMGO AOCP 2022",
         "url": "https://www.youtube.com/watch?v=Vc7ymM6Wf3A", "source": "Instituto Rodolfo Souza"},
    ],
    "criminologia": [
        {"title": "Noções de Criminologia — questões CEBRASPE, Prof. Laécio Carneiro",
         "url": "https://www.youtube.com/watch?v=hpXciWz9Dxc", "source": "Gran Cursos Online"},
        {"title": "Noções de Criminologia em questões — PM CE",
         "url": "https://www.youtube.com/watch?v=KUXs_7kh_BY", "source": "Gran Cursos Online"},
        {"title": "Criminologia na PCPE — Parte 1",
         "url": "https://www.youtube.com/watch?v=qBzJQTuZx_g", "source": "Dedicação Delta"},
    ],
    "medicina-legal": [
        {"title": "Morte e Tanatognose — Medicina Legal",
         "url": "https://www.youtube.com/watch?v=SM8xrAk67oQ", "source": "Dedicação Delta"},
        {"title": "Tanatologia Forense",
         "url": "https://www.youtube.com/watch?v=P7IvsgDi72w", "source": "Prof. Alexandre Herculano"},
        {"title": "Tanatologia Forense IV + Sexologia Forense I — Aula 15",
         "url": "https://www.youtube.com/watch?v=NrIL8uVU9p0", "source": "Andre Uchoa"},
        {"title": "Medicina Legal — Prof. Janiel Santana",
         "url": "https://www.youtube.com/watch?v=1Tczq7wJXS4", "source": "Cursos do Portal"},
    ],
    "direitos-humanos": [
        {"title": "Direitos Humanos para Concursos em UMA AULA — Profª Géssica Ehle",
         "url": "https://www.youtube.com/watch?v=8LEPdVizEmg", "source": "Estratégia Concursos"},
        {"title": "Direitos Humanos para concursos policiais — aula aberta",
         "url": "https://www.youtube.com/watch?v=WwIl9J_Tdl8", "source": "Ceisc Concursos"},
        {"title": "Direitos Humanos — Concurso PM MG",
         "url": "https://www.youtube.com/watch?v=SI_BycLs4bQ", "source": "AlfaCon"},
        {"title": "Direitos Humanos para PM — resumo em uma aula",
         "url": "https://www.youtube.com/watch?v=dDrEEwG-cMY", "source": "Estratégia Concursos"},
        {"title": "Teoria Geral: conceito e premissas filosóficas",
         "url": "https://www.youtube.com/watch?v=A7eTybbqFCc", "source": "Nova Concursos"},
    ],
    "etica-servico-publico": [
        {"title": "Ética no Serviço Público DO ZERO — Prof. Thállius Moraes",
         "url": "https://www.youtube.com/watch?v=AqXhXsrTj8g", "source": "Estratégia Concursos"},
        {"title": "Curso Completo de Ética no Serviço Público — Aula 1",
         "url": "https://www.youtube.com/watch?v=qjkR6ohgOx8", "source": "JUS POLIS"},
        {"title": "Ética no Serviço Público — resumo em uma aula",
         "url": "https://www.youtube.com/watch?v=lfwsj-o8j5s", "source": "Estratégia Concursos"},
    ],

    # ── Bloco 1 — Conhecimentos Gerais (peso 1) ─────────────────────────
    "lingua-portuguesa": [
        {"title": "Curso Completo de Português do Zero — Prof. Felipe Luccas",
         "url": "https://www.youtube.com/watch?v=7YdhNZsa0Dg", "source": "Estratégia Concursos"},
        {"title": "Curso Completo de Português — Prof. Sidney Martins, Aula 01",
         "url": "https://www.youtube.com/watch?v=suYMhlDbbAY", "source": "Focus Concursos"},
        {"title": "Gramática do zero — curso online completo",
         "url": "https://www.youtube.com/watch?v=VKLjF1woWkI", "source": "Mateus Andrade"},
        {"title": "Curso completo de gramática — Professora Pamba",
         "url": "https://www.youtube.com/watch?v=lD8UknBklXw", "source": "Professora Pamba"},
    ],
    "realidade-goias": [
        {"title": "História e Geografia de Goiás — Prof. Chagas Sousa",
         "url": "https://www.youtube.com/watch?v=bcDab5O6phA", "source": "Goianologia"},
        {"title": "Geo-história de Goiás — Maratona SEFAZ/ALEGO",
         "url": "https://www.youtube.com/watch?v=_nOyRgq_MKY", "source": "Moacir Cabral"},
        {"title": "História e Geografia de Goiás — resumo para concursos",
         "url": "https://www.youtube.com/watch?v=0mpBiBQ91B0", "source": "Sérgio Henrique"},
        {"title": "Formação econômica de Goiás",
         "url": "https://www.youtube.com/watch?v=omJH50ugCFE", "source": "Prof. Rafael Caique"},
    ],
    "raciocinio-logico": [
        {"title": "Raciocínio Lógico Polícia Federal — curso completo, aula 1",
         "url": "https://www.youtube.com/watch?v=WCgZ96yi6O0", "source": "Direção Concursos"},
        {"title": "Raciocínio Lógico Matemático — Prof. Brunno Lima",
         "url": "https://www.youtube.com/watch?v=rPonOjajNPw", "source": "Estratégia Concursos"},
        {"title": "Raciocínio Lógico para Concursos — Prof. Brunno Lima",
         "url": "https://www.youtube.com/watch?v=Q-6-lJhawNA", "source": "Estratégia Concursos"},
        {"title": "Como aprender RLM para concurso — Aula 00",
         "url": "https://www.youtube.com/watch?v=5ytuYyjOTJk", "source": "Matemática Rio"},
        {"title": "Raciocínio lógico para concursos — parte 1",
         "url": "https://www.youtube.com/watch?v=7a9ve2MEOWc", "source": "Felippe Loureiro"},
    ],
    "informatica": [
        {"title": "Informática Básica para Concursos — Aula 01, começando do zero",
         "url": "https://www.youtube.com/watch?v=Di-mj4o3CTY", "source": "AlfaCon"},
        {"title": "Informática para Concursos — Aula 1/2",
         "url": "https://www.youtube.com/watch?v=T6vOSAqQKwc", "source": "AlfaCon"},
        {"title": "Noções de Informática para Concursos — aula gratuita",
         "url": "https://www.youtube.com/watch?v=e-w07JpTYvo", "source": "Ceisc Concursos"},
        {"title": "50 aulas de informática para concursos em 1 hora",
         "url": "https://www.youtube.com/watch?v=cYqTVCrED_s", "source": "Prof. Marcelo Narciso"},
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
    o mesmo vídeo — use um contador estável (o app passa o dia em ordinal), pra
    a escolha ser a mesma dentro do mesmo dia e mudar no dia seguinte.
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
            # Busca do tópico junto: a curadoria é por matéria, então quem
            # quiser o tópico exato tem o atalho ali do lado.
            "search_url": search_url(subject_slug, subject_name, topic_name),
        }

    return {
        "title": f"Videoaula — {topic_name}",
        "url": search_url(subject_slug, subject_name, topic_name),
        "source": "Busca no YouTube",
        "video_id": None,
        "playlist_id": None,
        "is_search": True,
        "topic_name": topic_name,
        "search_url": search_url(subject_slug, subject_name, topic_name),
    }
