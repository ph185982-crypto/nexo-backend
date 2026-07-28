"""
Essay correction service — CEBRASPE discursive evaluation.

Supports text input and image upload (OCR via Gemini Vision).
Applies the official CEBRASPE scoring formula:
  final_score = NC - k * (NE / TL)
where NC = content score (macrostructural), NE = error count, TL = total lines.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

CORRECTION_K = 2.0

SYSTEM_PROMPT_CORRECTION = """Você é um corretor especialista em provas discursivas do CEBRASPE/CESPE para concursos da PRF e PF.

Avalie a redação abaixo de acordo com os critérios oficiais:

## ASPECTOS MACROESTRUTURAIS (nota de conteúdo — NC, de 0 a 20)
1. **Apresentação** (0-5): Estrutura dissertativo-argumentativa, introdução-desenvolvimento-conclusão, legibilidade
2. **Desenvolvimento do tema** (0-15): Abordagem dos tópicos solicitados, argumentação consistente, informações pertinentes, coerência

## ASPECTOS MICROESTRUTURAIS (contagem de erros — NE)
Identifique CADA erro gramatical por linha:
- Ortografia e acentuação
- Morfossintaxe (concordância, regência, crase, colocação pronominal)
- Propriedade vocabular

## RESPONDA EM JSON com exatamente este formato:
{
  "nc_score": <float 0-20>,
  "macro": {
    "apresentacao": {"score": <0-5>, "feedback": "<comentário>"},
    "desenvolvimento": {"score": <0-15>, "feedback": "<comentário>"}
  },
  "errors": [
    {"line": <int>, "original": "<trecho errado>", "correction": "<correção>", "type": "<ortografia|morfossintaxe|vocabular>", "explanation": "<explicação curta>"}
  ],
  "ne_count": <int total de erros>,
  "weak_points": ["<ponto fraco 1>", "<ponto fraco 2>"],
  "strengths": ["<ponto forte 1>"],
  "improvement_plan": ["<ação 1>", "<ação 2>", "<ação 3>"]
}
"""

SYSTEM_PROMPT_OCR = """Transcreva o texto manuscrito da imagem abaixo com máxima fidelidade.
Mantenha a quebra de linhas original. Não corrija erros — transcreva exatamente como está escrito.
Se algum trecho for ilegível, marque com [ilegível]. Numere cada linha no formato "L1: texto..."."""


async def correct_essay(
    text: str,
    theme: str,
    total_lines: Optional[int] = None,
) -> dict:
    """Correct an essay using Gemini and return structured diagnosis."""
    if not total_lines:
        total_lines = max(1, len([l for l in text.strip().split("\n") if l.strip()]))

    from prf.services import llm_service

    if llm_service.active_provider() is None:
        return _fallback_correction(
            total_lines,
            "Correção automática indisponível: nenhum provedor de IA configurado. "
            "Defina OPENAI_API_KEY ou GOOGLE_API_KEY.",
        )

    try:
        # The prompt embeds a literal JSON schema, so it must not go through
        # str.format — the braces would be read as format placeholders.
        diagnosis = await llm_service.chat_json([
            {"role": "system", "content": SYSTEM_PROMPT_CORRECTION},
            {"role": "user", "content": (
                f"TEMA DA REDAÇÃO:\n{theme}\n\n"
                f"REDAÇÃO DO CANDIDATO:\n{text}"
            )},
        ])
        nc = float(diagnosis.get("nc_score", 0))
        ne = int(diagnosis.get("ne_count", 0))
        penalty = CORRECTION_K * (ne / max(total_lines, 1))
        final = max(0, nc - penalty)

        return {
            "nc_score": round(nc, 2),
            "ne_count": ne,
            "total_lines": total_lines,
            "penalty": round(penalty, 2),
            "final_score": round(final, 2),
            "diagnosis": diagnosis,
            "feedback_text": _build_feedback(diagnosis, nc, ne, total_lines, final),
        }
    except Exception as e:
        logger.error(f"Essay correction error: {e}")
        return _fallback_correction(
            total_lines,
            f"A correção por IA falhou: {e}. Verifique se a chave de API é válida "
            "e se há créditos disponíveis.",
        )


async def ocr_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Extract text from a handwritten essay photo via a vision model."""
    from prf.services import llm_service

    if llm_service.active_provider() is None:
        raise ValueError("Nenhum provedor de IA configurado — OCR indisponível")

    return await llm_service.vision(SYSTEM_PROMPT_OCR, image_bytes, mime_type)


def _build_feedback(diagnosis: dict, nc: float, ne: int, tl: int, final: float) -> str:
    lines = []
    lines.append(f"NOTA FINAL ESTIMADA: {final:.1f}/20")
    lines.append(f"  Conteúdo (NC): {nc:.1f}/20")
    lines.append(f"  Erros gramaticais: {ne} em {tl} linhas")
    lines.append(f"  Penalidade: -{CORRECTION_K} × ({ne}/{tl}) = -{CORRECTION_K * ne / max(tl, 1):.2f}")
    lines.append("")

    macro = diagnosis.get("macro", {})
    ap = macro.get("apresentacao", {})
    dv = macro.get("desenvolvimento", {})
    lines.append(f"APRESENTAÇÃO ({ap.get('score', '?')}/5): {ap.get('feedback', '')}")
    lines.append(f"DESENVOLVIMENTO ({dv.get('score', '?')}/15): {dv.get('feedback', '')}")
    lines.append("")

    errors = diagnosis.get("errors", [])
    if errors:
        lines.append(f"ERROS ENCONTRADOS ({len(errors)}):")
        for e in errors[:15]:
            lines.append(f"  L{e.get('line', '?')}: \"{e.get('original', '')}\" → \"{e.get('correction', '')}\" ({e.get('type', '')})")
    lines.append("")

    wp = diagnosis.get("weak_points", [])
    if wp:
        lines.append("PONTOS FRACOS:")
        for w in wp:
            lines.append(f"  • {w}")

    plan = diagnosis.get("improvement_plan", [])
    if plan:
        lines.append("\nPLANO DE MELHORIA:")
        for p in plan:
            lines.append(f"  1. {p}")

    return "\n".join(lines)


def _fallback_correction(total_lines: int, reason: str) -> dict:
    """Placeholder result carrying the real reason the correction did not run."""
    return {
        "nc_score": 0,
        "ne_count": 0,
        "total_lines": total_lines,
        "penalty": 0,
        "final_score": 0,
        "diagnosis": {
            "error": reason,
            "macro": {},
            "errors": [],
            "weak_points": [],
            "improvement_plan": [],
        },
        "feedback_text": reason,
    }
