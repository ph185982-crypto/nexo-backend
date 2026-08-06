"""
Gerador de flashcards a partir do material que já existe no banco.

Não usa LLM. Cada artigo já carrega dois campos que foram gerados com esse
propósito e nunca foram aproveitados como cartão:

  highlights  — "as expressões-chave copiadas literalmente do texto oficial,
                 as que a banca troca para tornar o item errado"
  simple_text — a explicação do que o dispositivo determina na prática

O primeiro vira cartão de lacuna: apaga do texto oficial exatamente a
expressão que decide a questão e pede que o candidato a recupere. É o mesmo
princípio do leitor de lei seca, agora dentro da repetição espaçada.

Gerar sem LLM não é só economia — é qualidade. Um cartão feito a partir do
texto oficial e da expressão que a banca troca é mais fiel à prova do que
um cartão parafraseado por um modelo, e não corre risco de inventar
conteúdo que não está na lei.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Abaixo disso a lacuna vira adivinhação: uma palavra de três letras no meio
# de um artigo não tem contexto suficiente para ser recuperada.
MIN_HIGHLIGHT_CHARS = 4
# Acima disso o cartão não cabe na tela e o candidato lê em vez de recuperar.
MAX_FRONT_CHARS = 600
# Cartões de lacuna por artigo. Mais que isso satura o mesmo dispositivo e
# a repetição espaçada passa a devolver o artigo inteiro no mesmo dia.
MAX_CLOZE_PER_ARTICLE = 3


def _find_literal(text: str, expr: str) -> Optional[tuple[int, int]]:
    """Posição da expressão no texto, ignorando caixa. None se for paráfrase."""
    at = text.lower().find(expr.lower())
    return (at, at + len(expr)) if at >= 0 else None


def _trim_around(text: str, ini: int, fim: int, budget: int) -> tuple[str, int, int]:
    """Recorta uma janela de contexto em volta da lacuna.

    Artigo longo inteiro na frente do cartão faz o candidato ler em vez de
    recuperar; o que ele precisa é do entorno suficiente para reconhecer de
    que dispositivo se trata.
    """
    if len(text) <= budget:
        return text, ini, fim
    folga = (budget - (fim - ini)) // 2
    ini_ctx = max(0, ini - folga)
    fim_ctx = min(len(text), fim + folga)
    trecho = text[ini_ctx:fim_ctx]
    prefixo = "..." if ini_ctx > 0 else ""
    sufixo = "..." if fim_ctx < len(text) else ""
    desloc = len(prefixo) - ini_ctx
    return prefixo + trecho + sufixo, ini + desloc, fim + desloc


def cloze_cards_for_article(article: dict) -> list[dict]:
    """Cartões de lacuna de um artigo, um por expressão-chave."""
    texto = (article.get("official_text") or "").strip()
    if not texto:
        return []

    doc = article.get("document_name") or ""
    num = article.get("article_number") or ""
    rotulo = f"{doc} — {num}".strip(" —")

    # Do maior para o menor: um highlight curto pode estar contido em outro
    # maior, e apagar o curto primeiro quebraria a lacuna do maior.
    exprs = sorted(
        {(h or "").strip() for h in (article.get("highlights") or [])
         if len((h or "").strip()) >= MIN_HIGHLIGHT_CHARS},
        key=len, reverse=True,
    )

    cartoes = []
    usados: list[tuple[int, int]] = []
    for expr in exprs:
        if len(cartoes) >= MAX_CLOZE_PER_ARTICLE:
            break
        pos = _find_literal(texto, expr)
        if not pos:
            continue
        ini, fim = pos
        if any(ini < u[1] and fim > u[0] for u in usados):
            continue
        usados.append((ini, fim))

        trecho, t_ini, t_fim = _trim_around(texto, ini, fim, MAX_FRONT_CHARS)
        frente = trecho[:t_ini] + "________" + trecho[t_fim:]
        cartoes.append({
            "front": f"{rotulo}\n\n{frente}",
            "back": texto[ini:fim],
            "article_id": article.get("id"),
            "subject_id": article.get("subject_id"),
            "topic_id": article.get("topic_id"),
            "source": "system",
            "tags": ["lacuna", "lei-seca"],
        })
    return cartoes


def concept_card_for_article(article: dict) -> Optional[dict]:
    """Cartão de compreensão: o que o dispositivo determina na prática."""
    simples = (article.get("simple_text") or "").strip()
    if not simples:
        return None
    doc = article.get("document_name") or ""
    num = article.get("article_number") or ""
    return {
        "front": f"O que determina o {num} do {doc}?".replace(" do ?", "?"),
        "back": simples,
        "article_id": article.get("id"),
        "subject_id": article.get("subject_id"),
        "topic_id": article.get("topic_id"),
        "source": "system",
        "tags": ["conceito", "lei-seca"],
    }


def cards_for_article(article: dict) -> list[dict]:
    """Todos os cartões de um artigo: as lacunas e o de compreensão."""
    cartoes = cloze_cards_for_article(article)
    conceito = concept_card_for_article(article)
    if conceito:
        cartoes.append(conceito)
    return cartoes


def card_from_error(question: dict, correct_text: str) -> dict:
    """Cartão do caderno de erros: a questão que o candidato errou.

    A frente é a questão como ela caiu, não um resumo dela — o gatilho de
    recuperação precisa ser o mesmo que ele vai encontrar na prova.
    """
    enunciado = (question.get("text") or "").strip()
    contexto = (question.get("context_text") or "").strip()
    frente = f"{contexto}\n\n{enunciado}" if contexto else enunciado
    verso = correct_text.strip()
    expl = (question.get("explanation") or "").strip()
    if expl:
        verso = f"{verso}\n\n{expl}"
    base = (question.get("legal_basis") or "").strip()
    if base:
        verso = f"{verso}\n\nBase: {base}"
    return {
        "front": frente[:1200],
        "back": verso[:1500],
        "question_id": question.get("id"),
        "subject_id": question.get("subject_id"),
        "topic_id": question.get("topic_id"),
        "source": "error",
        "tags": ["erro"],
    }
