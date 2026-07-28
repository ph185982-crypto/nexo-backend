"""Maintenance endpoints — bulk repairs on the question bank.

The A-E to Certo/Errado conversion kept only each alternative's text and threw
away the stem, so a large share of the bank reads as a bare fragment
("Verde.", "10 pontos.") that cannot be judged. These endpoints rewrite those
rows into self-contained CEBRASPE items, preserving each item's truth value.
"""
from __future__ import annotations

import logging
import os

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
perdeu — sobrou apenas o texto de uma alternativa. Reescreva cada um como um item de
julgamento no padrão CEBRASPE.

REGRAS:
1. O item reescrito precisa ser uma AFIRMAÇÃO completa e autossuficiente, compreensível
   sem o enunciado original. Nada de frases nominais soltas ("Verde.", "10 pontos.").
2. Use a explicação e a base legal para recuperar o assunto de que o fragmento trata e
   reconstruir a afirmação em torno dele.
3. PRESERVE O GABARITO. Se o gabarito é CERTO, a afirmação reescrita tem de ser
   verdadeira. Se é ERRADO, ela tem de ser falsa — mantendo o mesmo erro que o
   fragmento original carregava.
4. Escreva de 2 a 4 linhas, em linguagem técnica e formal, sem pronomes sem referente.
5. Escreva também um texto-base curto ("context") no padrão
   "Acerca de <assunto específico>, julgue o item a seguir." — específico do assunto do
   item, não genérico da disciplina.
6. Não revele o gabarito dentro do texto do item.

ITENS:{''.join(lines)}

Responda com este JSON, um objeto por item, na mesma ordem:
{{"items": [{{"index": 0, "context": "...", "statement": "..."}}]}}"""


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
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Rewrite a batch of fragment items into self-contained CEBRASPE items.

    Returns the old and new text of every row it touched so the seed JSON can be
    brought in line with the database.
    """
    _require_admin(x_maintenance_token)

    rows = await repo._fetch(
        """SELECT q.id, q.text, q.context_text, q.explanation, q.legal_basis,
                  s.name AS subject_name, s.slug AS subject_slug,
                  (SELECT a.is_correct
                     FROM question_alternatives a
                    WHERE a.question_id = q.id AND a.letter = 'C') AS is_certo
             FROM questions q
             JOIN subjects s ON s.id = q.subject_id
            WHERE q.is_active AND length(q.text) < $1
            ORDER BY q.created_at
            LIMIT $2""",
        FRAGMENT_MAX_CHARS, limit,
    )
    if not rows:
        return {"rewritten": 0, "remaining": 0, "items": []}

    items = [dict(r) for r in rows]
    for it in items:
        it["is_certo"] = bool(it.get("is_certo"))

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": REWRITE_SYSTEM},
                {"role": "user", "content": _rewrite_prompt(items)},
            ],
            temperature=0.4,
            max_tokens=4000,
        )
    except llm_service.LLMUnavailable as e:
        raise HTTPException(503, f"IA indisponível: {e}")

    by_index = {}
    for entry in data.get("items") or []:
        try:
            by_index[int(entry.get("index"))] = entry
        except (TypeError, ValueError):
            continue

    touched = []
    for i, it in enumerate(items):
        entry = by_index.get(i)
        if not entry:
            continue
        statement = (entry.get("statement") or "").strip()
        context = (entry.get("context") or "").strip()
        if len(statement) < FRAGMENT_MAX_CHARS:
            logger.warning("[maintenance] rewrite too short for %s", it["id"])
            continue

        await repo._execute(
            "UPDATE questions SET text = $1, context_text = COALESCE($2, context_text) WHERE id = $3",
            statement, context or None, it["id"],
        )
        touched.append({
            "id": str(it["id"]),
            "subject_slug": it["subject_slug"],
            "old_text": it["text"],
            "new_text": statement,
            "new_context": context or it["context_text"],
        })

    remaining = await repo._fetchval(
        "SELECT COUNT(*) FROM questions WHERE is_active AND length(text) < $1",
        FRAGMENT_MAX_CHARS,
    )

    return {"rewritten": len(touched), "remaining": remaining, "items": touched}
