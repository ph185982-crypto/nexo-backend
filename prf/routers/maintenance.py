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

from prf.routers.deps import get_repo
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
