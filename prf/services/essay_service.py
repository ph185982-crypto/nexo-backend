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

TEMA DA REDAÇÃO: {theme}

REDAÇÃO DO CANDIDATO:
{text}
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

    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        return _fallback_correction(text, theme, total_lines)

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")

        prompt = SYSTEM_PROMPT_CORRECTION.format(theme=theme, text=text)
        response = model.generate_content(prompt)
        raw = response.text.strip()

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

        diagnosis = json.loads(raw)
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
        return _fallback_correction(text, theme, total_lines)


async def ocr_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Extract text from a handwritten essay photo via Gemini Vision."""
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not set — cannot perform OCR")

    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash")

    response = model.generate_content([
        SYSTEM_PROMPT_OCR,
        {"mime_type": mime_type, "data": image_bytes},
    ])
    return response.text.strip()


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


def _fallback_correction(text: str, theme: str, total_lines: int) -> dict:
    """Basic fallback when Gemini is unavailable."""
    return {
        "nc_score": 0,
        "ne_count": 0,
        "total_lines": total_lines,
        "penalty": 0,
        "final_score": 0,
        "diagnosis": {
            "error": "Correção automática indisponível — GOOGLE_API_KEY não configurada",
            "macro": {},
            "errors": [],
            "weak_points": [],
            "improvement_plan": [],
        },
        "feedback_text": "Correção automática indisponível. Configure GOOGLE_API_KEY para habilitar.",
    }
