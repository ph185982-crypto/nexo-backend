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
