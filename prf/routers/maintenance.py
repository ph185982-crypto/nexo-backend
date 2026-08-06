"""Maintenance endpoints — bulk repairs on the question bank.

The A-E to Certo/Errado conversion kept only each alternative's text and threw
away the stem, so a large share of the bank reads as a bare fragment
("Verde.", "10 pontos.") that cannot be judged. These endpoints rewrite those
rows into self-contained CEBRASPE items, preserving each item's truth value.
"""
from __future__ import annotations

import logging
import os

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, Query

from prf.routers.deps import get_repo, get_study_service
from prf.database.repository import PRFRepository
from prf.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Items shorter than this are alternative fragments rather than CEBRASPE items.
FRAGMENT_MAX_CHARS = 80

REWRITE_SYSTEM = (
    "Você é examinador do CEBRASPE. Reescreve fragmentos de alternativas de "
    "múltipla escolha como itens de julgamento (Certo/Errado) autossuficientes. "
    "Responde exclusivamente em JSON válido."
)


def _rewrite_prompt(items: list[dict]) -> str:
    lines = []
    for i, it in enumerate(items):
        lines.append(
            f"""
ITEM {i}
  disciplina: {it['subject_name']}
  gabarito: {'CERTO' if it['is_certo'] else 'ERRADO'}
  fragmento: {it['text']}
  explicação: {(it.get('explanation') or '(sem explicação)')[:700]}
  base legal: {it.get('legal_basis') or '(não informada)'}"""
        )

    return f"""Cada ITEM abaixo veio de uma questão de múltipla escolha cujo enunciado se
perdeu — sobrou apenas o texto de uma alternativa. Sua tarefa é RESTAURAR O ENUNCIADO em
volta do fragmento, transformando-o num item de julgamento no padrão CEBRASPE.

A REGRA MAIS IMPORTANTE — não altere o que o fragmento afirma:
- Você está apenas devolvendo ao fragmento o sujeito e o contexto que ele perdeu.
- NÃO acrescente e NÃO remova negações ("não", "nunca", "é vedado", "salvo").
- NÃO corrija o conteúdo do fragmento, mesmo que ele esteja juridicamente errado — se o
  gabarito é ERRADO, o item reescrito PRECISA continuar falso, carregando exatamente o
  mesmo erro. Corrigir o fragmento inverteria o gabarito e estragaria a questão.
- Se o gabarito é CERTO, o item reescrito precisa continuar verdadeiro.
Antes de responder, releia sua frase e confirme que ela tem o mesmo valor de verdade
indicado no campo "gabarito".

DEMAIS REGRAS:
1. O item reescrito é uma AFIRMAÇÃO completa e autossuficiente, compreensível sem o
   enunciado original. Nada de frases nominais soltas ("Verde.", "10 pontos.").
2. Use a explicação e a base legal apenas para descobrir DE QUE o fragmento fala — o
   sujeito da afirmação —, nunca para consertar o que ele afirma.
3. COMPRIMENTO MÍNIMO: cada "statement" tem de passar de 140 caracteres. Um item curto
   é rejeitado automaticamente. Para chegar lá sem inventar conteúdo novo, explicite o
   instituto de que o fragmento trata, o dispositivo que o rege e a situação concreta em
   que a afirmação se aplica — tudo isso já está na explicação e na base legal.
4. Escreva de 2 a 4 linhas, em linguagem técnica e formal, sem pronomes sem referente.
5. Escreva também um texto-base curto ("context") no padrão
   "Acerca de <assunto específico>, julgue o item a seguir." — específico do assunto do
   item, não genérico da disciplina.
6. Não revele o gabarito dentro do texto do item.

EXEMPLO (gabarito ERRADO):
  fragmento: "Legalidade, moralidade, eficiência e publicidade."
  explicação: "Os atributos dos atos administrativos são presunção de legitimidade,
               imperatividade, autoexecutoriedade e tipicidade."
  correto  : "Os atributos do ato administrativo são legalidade, moralidade, eficiência
              e publicidade."  (continua falso — mantém o erro)
  ERRADO   : "Os atributos do ato administrativo são presunção de legitimidade,
              imperatividade, autoexecutoriedade e tipicidade."  (virou verdadeiro —
              inverteu o gabarito)

ITENS:{''.join(lines)}

Responda com este JSON, um objeto por item, na mesma ordem. Confira, antes de enviar,
que todo "statement" passa de 140 caracteres:
{{"items": [{{"index": 0, "context": "...", "statement": "..."}}]}}"""


# Only direct sentence negators, which are what actually flips an item's truth
# value. Qualifiers like "salvo" or "exceto" show up naturally when a fragment is
# expanded into a full sentence and must not count as a flip.
NEGATIONS = ("não ", "nao ", "nunca", "jamais", "inexiste")


def _negation_count(text: str) -> int:
    low = text.lower()
    return sum(low.count(n) for n in NEGATIONS)


def _polarity_flipped(old: str, new: str) -> bool:
    """Flag rewrites that added or dropped a negation the fragment did not have.

    Restoring the stem should never change what the fragment asserts. A change in
    negation count is the cheap signal that the model 'corrected' the item and
    silently inverted its answer key.
    """
    return _negation_count(new) != _negation_count(old)


def _require_admin(token: str | None):
    expected = os.getenv("MAINTENANCE_TOKEN")
    if not expected:
        raise HTTPException(503, "MAINTENANCE_TOKEN não configurado no ambiente")
    if token != expected:
        raise HTTPException(403, "Token de manutenção inválido")


@router.get("/fragments/count")
async def count_fragments(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """How many items still read as bare alternative fragments."""
    _require_admin(x_maintenance_token)
    rows = await repo._fetch(
        """SELECT s.name AS subject_name, COUNT(*) AS n
             FROM questions q
             JOIN subjects s ON s.id = q.subject_id
            WHERE q.is_active AND length(q.text) < $1
            GROUP BY s.name
            ORDER BY n DESC""",
        FRAGMENT_MAX_CHARS,
    )
    total = sum(r["n"] for r in rows)
    return {"total": total, "by_subject": [dict(r) for r in rows]}


@router.post("/fragments/rewrite")
async def rewrite_fragments(
    limit: int = Query(12, ge=1, le=24),
    ids: str | None = Query(None, description="Comma-separated question ids to redo"),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Rewrite a batch of fragment items into self-contained CEBRASPE items.

    Returns the old and new text of every row it touched so the seed JSON can be
    brought in line with the database. Pass `ids` to redo specific rows that a
    previous pass rewrote badly.
    """
    _require_admin(x_maintenance_token)

    select_cols = """q.id, q.text, q.context_text, q.explanation, q.legal_basis,
                     s.name AS subject_name, s.slug AS subject_slug,
                     (SELECT a.is_correct
                        FROM question_alternatives a
                       WHERE a.question_id = q.id AND a.letter = 'C') AS is_certo"""

    if ids:
        try:
            id_list = [UUID(x.strip()) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, "Lista de ids inválida")
        rows = await repo._fetch(
            f"""SELECT {select_cols}
                  FROM questions q JOIN subjects s ON s.id = q.subject_id
                 WHERE q.id = ANY($1::uuid[])""",
            id_list,
        )
    else:
        rows = await repo._fetch(
            f"""SELECT {select_cols}
                  FROM questions q JOIN subjects s ON s.id = q.subject_id
                 WHERE q.is_active AND length(q.text) < $1
                 ORDER BY random()
                 LIMIT $2""",
            FRAGMENT_MAX_CHARS, limit,
        )
    if not rows:
        return {"rewritten": 0, "remaining": 0, "items": []}

    items = [dict(r) for r in rows]
    for it in items:
        it["is_certo"] = bool(it.get("is_certo"))

    async def _ask(batch: list[dict]) -> dict[int, dict]:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": REWRITE_SYSTEM},
                {"role": "user", "content": _rewrite_prompt(batch)},
            ],
            temperature=0.4,
            max_tokens=4000,
        )
        out: dict[int, dict] = {}
        for entry in data.get("items") or []:
            try:
                out[int(entry.get("index"))] = entry
            except (TypeError, ValueError):
                continue
        return out

    try:
        by_index = await _ask(items)

        # The model routinely answers a few items too tersely to clear the
        # fragment bar. Re-ask for just those instead of dropping the batch,
        # which is what stalled the queue.
        short_idx = [
            i for i, it in enumerate(items)
            if len((by_index.get(i, {}).get("statement") or "").strip()) < FRAGMENT_MAX_CHARS
        ]
        if short_idx:
            retry = await _ask([items[i] for i in short_idx])
            for pos, orig_i in enumerate(short_idx):
                if pos in retry:
                    by_index[orig_i] = retry[pos]
    except llm_service.LLMUnavailable as e:
        raise HTTPException(503, f"IA indisponível: {e}")

    touched = []
    rejected = []
    for i, it in enumerate(items):
        entry = by_index.get(i)
        if not entry:
            continue
        statement = (entry.get("statement") or "").strip()
        context = (entry.get("context") or "").strip()

        if len(statement) < FRAGMENT_MAX_CHARS:
            rejected.append({"id": str(it["id"]), "reason": "too_short"})
            continue
        if _polarity_flipped(it["text"], statement):
            # The model "fixed" the fragment instead of restoring its stem, which
            # would leave a true statement sitting behind an ERRADO answer key.
            rejected.append({"id": str(it["id"]), "reason": "polarity_flipped"})
            continue

        await repo._execute(
            "UPDATE questions SET text = $1, context_text = COALESCE($2, context_text) WHERE id = $3",
            statement, context or None, it["id"],
        )
        touched.append({
            "id": str(it["id"]),
            "subject_slug": it["subject_slug"],
            "is_certo": it["is_certo"],
            "old_text": it["text"],
            "new_text": statement,
            "new_context": context or it["context_text"],
        })

    remaining = await repo._fetchval(
        "SELECT COUNT(*) FROM questions WHERE is_active AND length(text) < $1",
        FRAGMENT_MAX_CHARS,
    )

    return {
        "rewritten": len(touched),
        "rejected": rejected,
        "remaining": remaining,
        "items": touched,
    }


@router.post("/seed/articles")
async def seed_articles_now(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Grava toda a lei seca pendente de uma vez, sem o teto por boot.

    O seed do startup escreve em pedaços para não estourar o tempo limite da
    função. Depois de um deploy que traz muitos artigos novos, isto termina a
    carga numa chamada só, em vez de esperar o acervo convergir em vários
    cold starts.
    """
    _require_admin(x_maintenance_token)

    from prf.seeds.seeder import (
        _seed_subjects, _seed_topics, _seed_legal_documents,
        _seed_legal_articles_from_json,
    )

    pool = repo._pool
    subject_map = await _seed_subjects(pool)
    topic_map = await _seed_topics(pool, subject_map)
    doc_map = await _seed_legal_documents(pool)
    result = await _seed_legal_articles_from_json(
        pool, doc_map, subject_map, topic_map, max_writes=None,
    )

    total = await repo._fetchval("SELECT COUNT(*) FROM legal_articles")
    return {**(result or {}), "articles_in_db": total}


@router.post("/legal/purge-legacy")
async def purge_legacy_articles(
    dry_run: bool = Query(True, description="Só conta; não apaga"),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Remove os artigos gravados no formato antigo, agora duplicados.

    O acervo anterior guardava recortes de artigo ("Art. 5°, I", "Art. 5°,
    caput") com o grau e a vírgula na numeração. O texto oficial do Planalto
    entra como artigo inteiro ("Art. 5"), então os dois formatos não colidem no
    índice único e a mesma norma passou a aparecer duas vezes na biblioteca.

    O recorte antigo é subconjunto do texto novo, e a explicação que ele
    carregava volta a ser gerada sob demanda em cima do artigo completo.
    """
    _require_admin(x_maintenance_token)

    # A numeração nova nunca traz grau nem vírgula, então o padrão isola
    # exatamente o acervo antigo.
    LEGACY = r"[°º,]"

    rows = await repo._fetch(
        """SELECT ld.slug, COUNT(*) AS n
             FROM legal_articles la
             JOIN legal_documents ld ON ld.id = la.document_id
            WHERE la.article_number ~ $1
            GROUP BY ld.slug ORDER BY n DESC""",
        LEGACY,
    )
    total = sum(r["n"] for r in rows)

    if dry_run:
        return {"dry_run": True, "would_delete": total, "by_document": [dict(r) for r in rows]}

    bookmarked = await repo._fetchval(
        """SELECT COUNT(*) FROM user_legal_bookmarks b
            JOIN legal_articles la ON la.id = b.article_id
           WHERE la.article_number ~ $1""",
        LEGACY,
    )
    deleted = await repo._fetch(
        "DELETE FROM legal_articles WHERE article_number ~ $1 RETURNING id", LEGACY,
    )
    remaining = await repo._fetchval("SELECT COUNT(*) FROM legal_articles")
    return {
        "deleted": len(deleted),
        "bookmarks_afetados": bookmarked,
        "articles_in_db": remaining,
    }


@router.post("/fragments/purge-duplicates")
async def purge_duplicates(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Delete fragment rows the seeder re-inserted after a rewrite.

    The seeder looks an existing question up by its text, so once a row is
    rewritten it stops matching and the original fragment is inserted again on
    the next cold start. Those re-inserts carry no attempts, so they are safe to
    drop; the rewritten row they duplicate stays.
    """
    _require_admin(x_maintenance_token)

    rows = await repo._fetch(
        """DELETE FROM questions q
            WHERE length(q.text) < $1
              AND NOT EXISTS (SELECT 1 FROM question_attempts a WHERE a.question_id = q.id)
              AND NOT EXISTS (SELECT 1 FROM review_cards r WHERE r.question_id = q.id)
              AND NOT EXISTS (SELECT 1 FROM error_notebook e WHERE e.question_id = q.id)
          RETURNING q.id""",
        FRAGMENT_MAX_CHARS,
    )
    remaining = await repo._fetchval(
        "SELECT COUNT(*) FROM questions WHERE is_active AND length(text) < $1",
        FRAGMENT_MAX_CHARS,
    )
    return {"deleted": len(rows), "remaining_fragments": remaining}


@router.post("/seed/audio")
async def seed_audio(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Seed missing audio lessons into the database."""
    _require_admin(x_maintenance_token)

    from prf.seeds.audio_lessons import AUDIO_LESSONS

    subject_rows = await repo._fetch("SELECT id, slug FROM subjects")
    subject_map = {r["slug"]: r["id"] for r in subject_rows}

    count = 0
    skipped = []
    async with repo._pool.acquire() as conn:
        for lesson in AUDIO_LESSONS:
            existing = await conn.fetchval(
                "SELECT id FROM audio_lessons WHERE title = $1", lesson["title"],
            )
            if existing:
                continue
            sid = subject_map.get(lesson["subject_slug"])
            if not sid:
                skipped.append(lesson["subject_slug"])
                continue
            await conn.execute(
                """INSERT INTO audio_lessons
                     (subject_id, title, description, script, duration_secs,
                      lesson_type, difficulty, display_order, is_active)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::difficulty_level, $8, TRUE)""",
                sid,
                lesson["title"], lesson.get("description"), lesson["script"],
                lesson.get("duration_secs"), lesson.get("lesson_type", "summary"),
                lesson.get("difficulty", "medium"), lesson.get("display_order", 0),
            )
            count += 1

    total = await repo._fetchval("SELECT COUNT(*) FROM audio_lessons")
    return {"seeded": count, "total": total, "skipped_slugs": skipped}


@router.post("/seed/questions")
async def seed_questions_now(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Seed all pending questions from JSON files into the database."""
    _require_admin(x_maintenance_token)

    from prf.seeds.seeder import _seed_subjects, _seed_topics, _seed_questions_from_json

    pool = repo._pool
    subject_map = await _seed_subjects(pool)
    topic_map = await _seed_topics(pool, subject_map)
    await _seed_questions_from_json(pool, subject_map, topic_map)

    total = await repo._fetchval("SELECT COUNT(*) FROM questions WHERE is_active = TRUE")
    by_type = await repo._fetch(
        "SELECT question_type, COUNT(*) as cnt FROM questions WHERE is_active = TRUE GROUP BY question_type"
    )
    return {
        "total_active": total,
        "by_type": {r["question_type"]: r["cnt"] for r in by_type},
    }


@router.post("/legal/explain-pmgo")
async def explain_pmgo_articles(
    limit: int = Query(30, ge=1, le=60),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Gera texto explicativo (simple_text) para artigos de matérias PMGO sem
    explicação, para a missão de lei seca sempre vir acompanhada de texto simples.

    Roda em lotes pequenos por causa do limite de tempo da função — chame de novo
    para continuar de onde parou (a ordem por frequency_score garante progresso).
    """
    _require_admin(x_maintenance_token)

    from prf.routers.legal_library import EXPLAIN_SYSTEM
    from prf.services import llm_service
    import asyncio

    rows = await repo._fetch(
        """SELECT la.id, la.article_number, la.official_text, ld.name AS document_name
             FROM legal_articles la
             JOIN subjects s ON s.id = la.subject_id
             JOIN legal_documents ld ON ld.id = la.document_id
            WHERE s.weight_pm > 0 AND (la.simple_text IS NULL OR la.simple_text = '')
            ORDER BY la.frequency_score DESC
            LIMIT $1""",
        limit,
    )

    async def _explain_one(article: dict) -> tuple[UUID, bool]:
        prompt = f"""Explique este dispositivo legal para um candidato de concurso policial.

DOCUMENTO: {article['document_name']}
{article['article_number']}
TEXTO OFICIAL:
{article['official_text'][:4000]}

Responda em JSON:
{{"simple_text": "explicação de 3 a 6 linhas, em linguagem direta, dizendo o que o dispositivo determina na prática e qual a pegadinha que a banca costuma fazer com ele",
  "highlights": ["3 a 6 expressões-chave copiadas literalmente do texto oficial, as que a banca troca para tornar o item errado"]}}"""
        try:
            data = await llm_service.chat_json(
                [
                    {"role": "system", "content": EXPLAIN_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=900,
            )
        except llm_service.LLMUnavailable:
            return article["id"], False

        simple = (data.get("simple_text") or "").strip()
        if not simple:
            return article["id"], False
        highlights = [h for h in (data.get("highlights") or []) if isinstance(h, str) and h.strip()]
        await repo._execute(
            "UPDATE legal_articles SET simple_text = $1, highlights = $2 WHERE id = $3",
            simple, highlights[:6], article["id"],
        )
        return article["id"], True

    generated = 0
    failed = 0
    # Lotes de 5 em paralelo — rápido o bastante sem estourar rate limit do provedor.
    for start in range(0, len(rows), 5):
        chunk = [dict(r) for r in rows[start:start + 5]]
        results = await asyncio.gather(*[_explain_one(a) for a in chunk])
        for _id, ok in results:
            generated += 1 if ok else 0
            failed += 0 if ok else 1

    remaining = await repo._fetchval(
        """SELECT COUNT(*) FROM legal_articles la
             JOIN subjects s ON s.id = la.subject_id
            WHERE s.weight_pm > 0 AND (la.simple_text IS NULL OR la.simple_text = '')"""
    )

    return {"generated": generated, "failed": failed, "remaining": remaining}


# ── Podcast (episódios em diálogo para o deslocamento) ──────────────────────

def _build_units(topics: list[dict]) -> list[dict]:
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


@router.post("/podcast/generate")
async def generate_podcast_episode(
    unit_slug: str | None = Query(None, description="Unidade; se omitido, pega a próxima pendente"),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Gera a próxima AULA pendente (a da ida, ~40 min).

    Uma parte por chamada: são oito blocos de roteiro via LLM e o tempo da
    função não comporta mais. Chame em loop até `remaining` zerar.
    """
    _require_admin(x_maintenance_token)

    from prf.services import podcast_service

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = _build_units([dict(t) for t in topics])
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
        raise HTTPException(503, "Geração de roteiro falhou — verifique a chave do provedor de IA")

    mins = round(episode["duration_secs"] / 60)
    saved = await repo.create_podcast_episode({
        "subject_id": u["subject_id"],
        "topic_id": u["topic_id"],
        "title": titulo,
        "topic": u["name"],
        "description": (
            f"{u['subject_name']} · aula de {mins} min com leitura comentada da "
            f"lei, casos de rua e revisão por perguntas."
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


@router.post("/podcast/generate-drill")
async def generate_podcast_drill(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Gera o DRILL da volta (~22 min) para a próxima aula que ainda não tem.

    Vai em chamada separada da aula porque, juntas, as doze chamadas ao LLM
    (oito da aula + quatro do drill) passam do tempo limite da função.
    """
    _require_admin(x_maintenance_token)

    from prf.services import podcast_service

    aula = await repo.get_aula_without_drill()
    if not aula:
        return {"generated": False, "reason": "Nenhuma aula sem drill", "remaining": 0}

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = _build_units([dict(t) for t in topics])
    unidade = next((u for u in units if u["unit_slug"] == aula["unit_slug"]), None)
    if not unidade:
        raise HTTPException(404, f"Unidade '{aula['unit_slug']}' não encontrada")

    artigos = await repo.get_articles_for_topics(unidade["topic_ids"], limit=300)
    partes = podcast_service.plan_parts([dict(a) for a in artigos])
    idx = (aula["part"] or 1) - 1
    if idx >= len(partes):
        raise HTTPException(400, "Parte da aula não existe mais no plano atual")

    drill = await podcast_service.generate_drill(
        aula["title"], aula.get("subject_name") or unidade["subject_name"], partes[idx]
    )
    if not drill["turns"]:
        raise HTTPException(503, "Geração do drill falhou — verifique a chave do provedor de IA")

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


@router.post("/podcast/backfill-units")
async def backfill_podcast_units(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Encaixa as aulas antigas no plano de unidades e partes.

    Elas foram geradas antes do plano existir: cobrem um tópico inteiro, sem
    numeração de parte. Como os artigos já vinham ordenados por incidência,
    o que cada uma cobriu equivale à parte 1 da sua unidade — então em vez de
    descartar o conteúdo, marcamos como parte 1 e o gerador segue da 2 em
    diante.

    Exceção: aula de tópico que virou cluster é aposentada, porque a parte 1
    do cluster precisa cobrir os tópicos agrupados, e não só um deles.
    """
    _require_admin(x_maintenance_token)

    from prf.services import podcast_service
    from prf.seeds.topic_clusters import cluster_for_topic

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = _build_units([dict(t) for t in topics])
    por_topico = {t["id"]: dict(t) for t in topics}

    antigas = await repo._fetch(
        """SELECT id, topic_id, title FROM podcast_episodes
            WHERE is_active AND kind = 'aula' AND unit_slug IS NULL
              AND topic_id IS NOT NULL"""
    )

    encaixadas, aposentadas = 0, 0
    for ep in antigas:
        t = por_topico.get(ep["topic_id"])
        if not t:
            await repo._execute(
                "UPDATE podcast_episodes SET is_active = FALSE WHERE id = $1", ep["id"])
            aposentadas += 1
            continue

        if cluster_for_topic(t["subject_slug"], t["slug"]):
            await repo._execute(
                "UPDATE podcast_episodes SET is_active = FALSE WHERE id = $1", ep["id"])
            aposentadas += 1
            continue

        u = next((x for x in units if ep["topic_id"] in x["topic_ids"]), None)
        if not u:
            await repo._execute(
                "UPDATE podcast_episodes SET is_active = FALSE WHERE id = $1", ep["id"])
            aposentadas += 1
            continue

        artigos = await repo.get_articles_for_topics(u["topic_ids"], limit=300)
        total = max(1, len(podcast_service.plan_parts([dict(a) for a in artigos])))
        titulo = u["name"] if total == 1 else f"{u['name']} — Parte 1 de {total}"
        await repo._execute(
            """UPDATE podcast_episodes
                  SET unit_slug = $1, part = 1, total_parts = $2, title = $3
                WHERE id = $4""",
            u["unit_slug"], total, titulo, ep["id"],
        )
        encaixadas += 1

    return {"encaixadas": encaixadas, "aposentadas": aposentadas}


@router.get("/podcast/plan")
async def podcast_plan(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """O plano completo: unidades, quantas partes cada uma e o que já existe."""
    _require_admin(x_maintenance_token)

    from prf.services import podcast_service

    topics = await repo.get_topics_for_podcast(is_pm=True)
    units = _build_units([dict(t) for t in topics])
    existing = await repo.get_existing_episode_units()
    feitas = {(e["unit_slug"], e["part"]) for e in existing if e["kind"] == "aula"}

    linhas, total_partes, total_mins = [], 0, 0
    for u in units:
        artigos = await repo.get_articles_for_topics(u["topic_ids"], limit=300)
        partes = podcast_service.plan_parts([dict(a) for a in artigos])
        prontas = sum(1 for i in range(len(partes)) if (u["unit_slug"], i + 1) in feitas)
        total_partes += len(partes)
        total_mins += len(partes) * 40
        linhas.append({
            "subject": u["subject_name"],
            "unit": u["name"],
            "topics": len(u["topic_ids"]),
            "kchars": round(u["chars"] / 1000, 1),
            "parts": len(partes),
            "done": prontas,
        })

    return {
        "units": linhas,
        "total_units": len(units),
        "total_parts": total_partes,
        "estimated_hours_aula": round(total_mins / 60, 1),
        "estimated_hours_drill": round(total_partes * 22 / 60, 1),
    }


@router.post("/podcast/retire-subject-episodes")
async def retire_subject_level_episodes(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Desativa os episódios antigos de matéria inteira.

    Eles foram substituídos pelas aulas por tópico: cobriam uma matéria toda
    em 35 min, o que só dava para sobrevoar o assunto sem ler a lei nem
    esgotar nenhum ponto.
    """
    _require_admin(x_maintenance_token)
    n = await repo._fetchval(
        """WITH r AS (
               UPDATE podcast_episodes SET is_active = FALSE
                WHERE topic_id IS NULL AND is_active = TRUE
                RETURNING 1)
           SELECT COUNT(*) FROM r"""
    )
    return {"retired": n or 0}


@router.get("/diag/mission")
async def diagnose_mission_schema(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Diagnóstico do schema que a missão grava.

    Existe porque um 500 na geração da missão não diz qual coluna recusou o
    valor — e a resposta de erro do serverless não carrega o traceback.
    """
    _require_admin(x_maintenance_token)

    col = await repo._fetchrow(
        """SELECT data_type, udt_name FROM information_schema.columns
            WHERE table_name = 'mission_blocks' AND column_name = 'block_type'"""
    )
    enum_vals = await repo._fetch(
        """SELECT e.enumlabel FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'block_type' ORDER BY e.enumsortorder"""
    )
    episodes = await repo._fetchval(
        "SELECT COUNT(*) FROM podcast_episodes WHERE is_active AND topic_id IS NOT NULL"
    )
    topics_with_audio = await repo._fetchval(
        """SELECT COUNT(DISTINCT topic_id) FROM podcast_episodes
            WHERE is_active AND topic_id IS NOT NULL"""
    )
    return {
        "block_type_column": dict(col) if col else None,
        "block_type_enum_values": [r["enumlabel"] for r in enum_vals],
        "topic_episodes_active": episodes,
        "topics_with_audio": topics_with_audio,
    }


@router.post("/diag/mission-build")
async def diagnose_mission_build(
    user_email: str = Query(..., description="E-mail do usuário para simular a geração"),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
    study=Depends(get_study_service),
):
    """Roda a geração da missão devolvendo o traceback em caso de erro."""
    _require_admin(x_maintenance_token)

    user = await repo._fetchrow("SELECT id FROM prf_users WHERE email = $1", user_email)
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    import traceback
    try:
        mission = await study.generate_daily_mission(user["id"], force=True)
        return {
            "ok": True,
            "blocks": [
                {"type": b["block_type"], "title": b["title"]}
                for b in (mission or {}).get("blocks", [])
            ],
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-2000:]}


@router.get("/diag/topic-volume")
async def diagnose_topic_volume(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Volume de material por tópico do edital.

    A duração da aula é ditada pelo volume de texto legal a ler e comentar,
    não pelo número de artigos: um único artigo com 78 incisos rende mais
    que dez artigos curtos. Este mapa é o insumo para decidir quais tópicos
    se agrupam e quais precisam virar duas partes.
    """
    _require_admin(x_maintenance_token)

    rows = await repo._fetch(
        """SELECT s.name AS subject, s.slug AS subject_slug, s.weight_pm,
                  t.name AS topic, t.slug AS topic_slug, t.id AS topic_id,
                  COUNT(la.id) AS artigos,
                  COALESCE(SUM(length(la.official_text)), 0) AS chars
             FROM topics t
             JOIN subjects s ON s.id = t.subject_id
             LEFT JOIN legal_articles la ON la.topic_id = t.id
            WHERE t.is_active AND s.weight_pm > 0
            GROUP BY s.name, s.slug, s.weight_pm, t.name, t.slug, t.id
            ORDER BY s.weight_pm DESC, s.name, t.display_order"""
    )
    return {"topics": [dict(r) for r in rows]}


# ── Flashcards ──────────────────────────────────────────────────────────────

@router.post("/flashcards/generate")
async def generate_flashcards(
    limit_topics: int = Query(6, ge=1, le=40, description="tópicos por chamada"),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Gera os flashcards do sistema a partir dos artigos de lei.

    Não usa IA: os cartões saem dos highlights (as expressões que a banca
    troca) e do simple_text que já estão gravados em cada artigo. Além de
    não custar nada, um cartão feito do texto oficial é mais fiel à prova do
    que um parafraseado por modelo, e não corre risco de inventar conteúdo.

    Roda por lotes de tópicos porque o tempo da função não comporta os 38 de
    uma vez; chame de novo até `remaining` zerar.
    """
    _require_admin(x_maintenance_token)

    from prf.services import flashcard_service

    topicos = await repo._fetch(
        """SELECT t.id, t.name, s.name AS subject_name
             FROM topics t
             JOIN subjects s ON s.id = t.subject_id
            WHERE t.is_active AND s.weight_pm > 0
              AND EXISTS (SELECT 1 FROM legal_articles la WHERE la.topic_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM flashcards f
                               WHERE f.topic_id = t.id AND f.is_active)
            ORDER BY s.weight_pm DESC, t.display_order
            LIMIT $1""",
        limit_topics,
    )

    feitos = []
    for t in topicos:
        artigos = await repo.get_articles_full_for_topic(t["id"], limit=200)
        cartoes = []
        for a in artigos:
            cartoes.extend(flashcard_service.cards_for_article(dict(a)))
        n = await repo.bulk_insert_flashcards(cartoes)
        feitos.append({"topico": t["name"], "materia": t["subject_name"],
                       "artigos": len(artigos), "cartoes": n})

    restantes = await repo._fetchval(
        """SELECT COUNT(*) FROM topics t
             JOIN subjects s ON s.id = t.subject_id
            WHERE t.is_active AND s.weight_pm > 0
              AND EXISTS (SELECT 1 FROM legal_articles la WHERE la.topic_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM flashcards f
                               WHERE f.topic_id = t.id AND f.is_active)"""
    )
    total = await repo._fetchval("SELECT COUNT(*) FROM flashcards WHERE is_active")

    return {"topicos_processados": feitos, "remaining": restantes, "total_no_banco": total}


# ── Escopo do edital ────────────────────────────────────────────────────────

# Leis que aparecem no banco mas NÃO estão no edital da PMGO. Estudar isso
# não é neutro: consome o tempo que deveria ir para o que cai.
FORA_DO_EDITAL = [
    ("Código de Defesa do Consumidor", "8.078"),
    ("CDC", "consumidor"),
    ("Consolidação das Leis do Trabalho", "CLT"),
    ("Código Tributário", "5.172"),
    ("Código Civil", "10.406"),
    ("Código de Processo Civil", "13.105"),
    ("Estatuto do Idoso", "10.741"),
    ("Lei de Licitações", "14.133"),
]


@router.get("/scope/audit")
async def audit_scope(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Questões ativas que citam lei fora do edital da PMGO.

    Checagem determinística sobre o texto e a base legal — não usa IA, então
    funciona mesmo com o provedor fora do ar, e o resultado é auditável:
    cada item vem com o termo que o marcou.
    """
    _require_admin(x_maintenance_token)

    achados = []
    for rotulo, termo in FORA_DO_EDITAL:
        rows = await repo._fetch(
            """SELECT q.id, q.text, q.legal_basis, s.name AS subject_name
                 FROM questions q
                 JOIN subjects s ON s.id = q.subject_id
                WHERE q.is_active AND s.weight_pm > 0
                  AND (q.text ILIKE '%' || $1 || '%'
                       OR COALESCE(q.legal_basis, '') ILIKE '%' || $1 || '%')
                LIMIT 60""",
            termo,
        )
        for r in rows:
            achados.append({
                "id": str(r["id"]), "materia": r["subject_name"],
                "marcado_por": rotulo, "termo": termo,
                "trecho": (r["text"] or "")[:130],
            })

    vistos, unicos = set(), []
    for a in achados:
        if a["id"] in vistos:
            continue
        vistos.add(a["id"])
        unicos.append(a)
    return {"total": len(unicos), "questoes": unicos}


@router.post("/scope/deactivate")
async def deactivate_out_of_scope(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Desativa as questões fora do edital encontradas pela auditoria."""
    _require_admin(x_maintenance_token)

    total = 0
    for _rotulo, termo in FORA_DO_EDITAL:
        n = await repo._fetchval(
            """WITH r AS (
                   UPDATE questions q SET is_active = FALSE
                     FROM subjects s
                    WHERE s.id = q.subject_id AND s.weight_pm > 0 AND q.is_active
                      AND (q.text ILIKE '%' || $1 || '%'
                           OR COALESCE(q.legal_basis, '') ILIKE '%' || $1 || '%')
                    RETURNING 1)
               SELECT COUNT(*) FROM r""",
            termo,
        )
        total += n or 0
    return {"desativadas": total}


@router.post("/fragments/deactivate")
async def deactivate_fragments(
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Tira de circulação os itens que são fragmento de alternativa.

    A reescrita depende de IA e o provedor está sem crédito. Servir um item
    que não dá para julgar é pior que não servir: o candidato erra por falta
    de enunciado e o erro entra na estatística como se fosse dele. Ficam
    inativos até a reescrita poder rodar — nada é apagado.
    """
    _require_admin(x_maintenance_token)
    n = await repo._fetchval(
        """WITH r AS (
               UPDATE questions SET is_active = FALSE
                WHERE is_active AND length(text) < $1
                RETURNING 1)
           SELECT COUNT(*) FROM r""",
        FRAGMENT_MAX_CHARS,
    )
    return {"desativadas": n or 0,
            "obs": "Reative com /fragments/rewrite quando houver crédito de IA"}
