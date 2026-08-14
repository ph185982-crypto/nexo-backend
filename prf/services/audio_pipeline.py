"""
Produção de áudio — a fila que transforma o edital em aulas para o carro.

Até aqui, cada aula e cada drill só nasciam quando alguém abria o endpoint de
manutenção e disparava à mão, um por chamada. Quem depende do áudio é o
candidato dirigindo 80 minutos por dia; a cobertura crescia na velocidade em
que alguém lembrava de apertar o botão.

Este módulo é o miolo dessa geração, separado das rotas para que a tarefa
agendada (prf/routers/cron.py) e o endpoint de manutenção chamem exatamente o
mesmo caminho — sem duas implementações que divergem com o tempo.

Uma peça por chamada, de propósito: são dez blocos de roteiro via LLM por aula
e oito por drill, e a função serverless não comporta os dois na mesma execução.
A fila converge com o agendador rodando todo dia, sem nunca estourar o tempo.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Versão do roteiro. Suba este número sempre que a metodologia do áudio mudar
# de forma que o conteúdo já gravado fique desatualizado — o pipeline passa a
# tratar tudo abaixo dele como pendente de refação, sem ninguém precisar
# apagar nada à mão.
#
#   1 — formato original: 8 blocos, sem jurisprudência e sem debate de tese.
#   2 — 10 blocos, com "Jurisprudência e a tese que divide" e "Caso difícil,
#       do começo ao fim"; os dois apresentadores discordam ao menos uma vez
#       por bloco; duração ajustada ao trajeto real de 40 minutos.
SCRIPT_VERSION = 2


def build_units(topics: list[dict]) -> list[dict]:
    """Agrupa os tópicos em unidades de aula.

    Tópico magro entra no agrupamento curado (TOPIC_CLUSTERS); os demais
    viram unidade sozinhos. A unidade é a coisa que vira uma série de aulas.
    """
    from prf.seeds.topic_clusters import cluster_for_topic

    by_slug = {(t["subject_slug"], t["slug"]): t for t in topics}
    units: dict[str, dict] = {}

    for t in topics:
        cluster = cluster_for_topic(t["subject_slug"], t["slug"])
        if cluster:
            name, slugs = cluster
            key = f"{t['subject_slug']}:{name}"
            membros = [by_slug[(t["subject_slug"], sl)] for sl in slugs
                       if (t["subject_slug"], sl) in by_slug]
        else:
            name = t["name"]
            key = f"{t['subject_slug']}:{t['slug']}"
            membros = [t]

        if key in units:
            continue
        units[key] = {
            "unit_slug": key,
            "name": name,
            "subject_id": membros[0]["subject_id"],
            "subject_name": membros[0]["subject_name"],
            "topic_id": membros[0]["id"],          # tópico âncora
            "topic_ids": [m["id"] for m in membros],
            "peso": membros[0]["peso"],
            "chars": sum(m["chars"] for m in membros),
        }

    return sorted(units.values(), key=lambda u: (-u["peso"], -u["chars"]))


async def refazer_episodio_antigo(repo, kind: str = "aula") -> dict:
    """Regrava um episódio que ficou num formato de roteiro anterior.

    Troca em duas etapas: grava a versão nova e só então aposenta a antiga.
    Se a geração falhar no meio, o candidato continua com a aula velha em vez
    de ficar sem áudio nenhum naquele tópico.
    """
    from prf.services import podcast_service

    antigo = await repo.get_outdated_episode(SCRIPT_VERSION, kind=kind)
    if not antigo:
        return {"generated": False, "reason": f"Nenhum {kind} em formato antigo"}

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = build_units([dict(t) for t in topics])
    unidade = next((u for u in units if u["unit_slug"] == antigo.get("unit_slug")), None)
    if not unidade:
        return {"generated": False, "reason": f"Unidade '{antigo.get('unit_slug')}' saiu do plano"}

    artigos = await repo.get_articles_for_topics(unidade["topic_ids"], limit=300)
    partes = podcast_service.plan_parts([dict(a) for a in artigos])
    idx = (antigo.get("part") or 1) - 1
    if idx >= len(partes):
        return {"generated": False, "reason": "Parte não existe mais no plano atual"}

    if kind == "aula":
        novo = await podcast_service.generate_episode(
            antigo["title"], antigo.get("subject_name") or unidade["subject_name"], partes[idx]
        )
    else:
        novo = await podcast_service.generate_drill(
            antigo["title"], antigo.get("subject_name") or unidade["subject_name"], partes[idx]
        )
    if not novo["turns"]:
        return {"generated": False, "reason": "Geração falhou — verifique a chave do provedor de IA"}

    mins = round(novo["duration_secs"] / 60)
    salvo = await repo.create_podcast_episode({
        "subject_id": antigo["subject_id"],
        "topic_id": antigo["topic_id"],
        "title": antigo["title"],
        "topic": antigo["topic"],
        "description": antigo.get("description"),
        "turns": novo["turns"],
        "segment_count": novo["segment_count"],
        "duration_secs": novo["duration_secs"],
        "word_count": novo["word_count"],
        "kind": kind,
        "part": antigo.get("part", 1),
        "total_parts": antigo.get("total_parts", 1),
        "parent_episode_id": antigo.get("parent_episode_id"),
        "unit_slug": antigo.get("unit_slug"),
        "script_version": SCRIPT_VERSION,
    })
    await repo.retire_episode(antigo["id"])

    restantes = await repo.count_outdated_episodes(SCRIPT_VERSION)
    return {
        "generated": True,
        "kind": kind,
        "replaced": antigo["title"],
        "episode_id": str(salvo.get("id")),
        "duration_mins": mins,
        "words": novo["word_count"],
        "remaining": (restantes.get("aulas") or 0) + (restantes.get("drills") or 0),
    }


async def gerar_proxima_aula(repo, unit_slug: str | None = None) -> dict:
    """Gera a próxima aula pendente (a da ida, ~40 min).

    Devolve sempre um dicionário — inclusive quando não há nada a fazer ou a
    geração falha. Quem chama é uma tarefa agendada: levantar exceção aqui
    derrubaria o cron inteiro por causa de uma unidade problemática.
    """
    from prf.services import podcast_service

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = build_units([dict(t) for t in topics])
    if unit_slug:
        units = [u for u in units if u["unit_slug"] == unit_slug]
    if not units:
        return {"generated": False, "reason": "Unidade não encontrada"}

    existing = await repo.get_existing_episode_units()
    feitas = {(e["unit_slug"], e["part"]) for e in existing if e["kind"] == "aula"}

    alvo = None
    pendentes = 0
    for u in units:
        artigos = await repo.get_articles_for_topics(u["topic_ids"], limit=300)
        partes = podcast_service.plan_parts([dict(a) for a in artigos])
        u["partes"] = partes
        for i in range(len(partes)):
            if (u["unit_slug"], i + 1) not in feitas:
                pendentes += 1
                if alvo is None:
                    alvo = (u, i + 1, partes[i], len(partes))

    if alvo is None:
        return {"generated": False, "reason": "Nenhuma aula pendente", "remaining": 0}

    u, part, artigos_da_parte, total_parts = alvo
    titulo = u["name"] if total_parts == 1 else f"{u['name']} — Parte {part} de {total_parts}"

    episode = await podcast_service.generate_episode(
        titulo, u["subject_name"], artigos_da_parte
    )
    if not episode["turns"]:
        return {
            "generated": False,
            "reason": "Geração de roteiro falhou — verifique a chave do provedor de IA",
            "remaining": pendentes,
        }

    mins = round(episode["duration_secs"] / 60)
    saved = await repo.create_podcast_episode({
        "subject_id": u["subject_id"],
        "topic_id": u["topic_id"],
        "title": titulo,
        "topic": u["name"],
        "description": (
            f"{u['subject_name']} · aula de {mins} min com leitura comentada da "
            f"lei, jurisprudência, caso difícil e revisão por perguntas."
        ),
        "turns": episode["turns"],
        "segment_count": episode["segment_count"],
        "duration_secs": episode["duration_secs"],
        "word_count": episode["word_count"],
        "kind": "aula",
        "part": part,
        "total_parts": total_parts,
        "unit_slug": u["unit_slug"],
        "script_version": SCRIPT_VERSION,
    })

    return {
        "generated": True,
        "kind": "aula",
        "episode_id": str(saved.get("id")),
        "subject": u["subject_name"],
        "unit": u["name"],
        "part": f"{part}/{total_parts}",
        "duration_mins": mins,
        "words": episode["word_count"],
        "articles_used": len(artigos_da_parte),
        "remaining": pendentes - 1,
    }


async def gerar_proximo_drill(repo) -> dict:
    """Gera o drill da volta para a próxima aula que ainda não tem um.

    Chamada separada da aula porque, juntas, as dezoito idas ao LLM passam do
    tempo limite da função.
    """
    from prf.services import podcast_service

    aula = await repo.get_aula_without_drill()
    if not aula:
        return {"generated": False, "reason": "Nenhuma aula sem drill", "remaining": 0}

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = build_units([dict(t) for t in topics])
    unidade = next((u for u in units if u["unit_slug"] == aula["unit_slug"]), None)
    if not unidade:
        return {"generated": False, "reason": f"Unidade '{aula['unit_slug']}' não encontrada"}

    artigos = await repo.get_articles_for_topics(unidade["topic_ids"], limit=300)
    partes = podcast_service.plan_parts([dict(a) for a in artigos])
    idx = (aula["part"] or 1) - 1
    if idx >= len(partes):
        return {"generated": False, "reason": "Parte da aula não existe mais no plano atual"}

    drill = await podcast_service.generate_drill(
        aula["title"], aula.get("subject_name") or unidade["subject_name"], partes[idx]
    )
    if not drill["turns"]:
        return {
            "generated": False,
            "reason": "Geração do drill falhou — verifique a chave do provedor de IA",
        }

    mins = round(drill["duration_secs"] / 60)
    saved = await repo.create_podcast_episode({
        "subject_id": aula["subject_id"],
        "topic_id": aula["topic_id"],
        "title": f"Drill — {aula['title']}",
        "topic": aula["topic"],
        "description": (
            f"Recuperação de {mins} min sobre a aula da ida: perguntas, pausa "
            f"para você responder e confirmação curta."
        ),
        "turns": drill["turns"],
        "segment_count": drill["segment_count"],
        "duration_secs": drill["duration_secs"],
        "word_count": drill["word_count"],
        "kind": "drill",
        "part": aula["part"],
        "total_parts": aula["total_parts"],
        "parent_episode_id": aula["id"],
        "unit_slug": aula["unit_slug"],
        "script_version": SCRIPT_VERSION,
    })

    restantes = await repo._fetchval(
        """SELECT COUNT(*) FROM podcast_episodes pe
            WHERE pe.is_active AND pe.kind = 'aula'
              AND NOT EXISTS (SELECT 1 FROM podcast_episodes d
                               WHERE d.parent_episode_id = pe.id
                                 AND d.kind = 'drill' AND d.is_active)"""
    )

    return {
        "generated": True,
        "kind": "drill",
        "episode_id": str(saved.get("id")),
        "for_aula": aula["title"],
        "duration_mins": mins,
        "words": drill["word_count"],
        "remaining": restantes,
    }
