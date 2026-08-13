"""
Essay correction service — CEBRASPE and AOCP discursive evaluation.

Supports text input and image upload (OCR via Gemini Vision).

CEBRASPE aplica a fórmula oficial:
  final_score = NC - k * (NE / TL)
onde NC = nota de conteúdo (macroestrutural), NE = contagem de erros, TL = total de linhas.

AOCP (banca do edital PMGO 2022) não usa essa fórmula — pontua direto por critério,
numa escala de 0 a 10, sem penalidade proporcional a erro/linha. A rubrica abaixo é uma
aproximação do padrão AOCP em provas discursivas de PM (estrutura, desenvolvimento,
coesão, norma culta); o próximo edital pode alterar os critérios — sem edital novo
publicado, isto é a melhor estimativa disponível, não a grade oficial.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

CORRECTION_K = 2.0

RUBRICS = {
    "CEBRASPE": {
        "max_score": 20,
        "formula": "nc_minus_penalty",
    },
    "AOCP": {
        "max_score": 10,
        "formula": "direct_criteria",
    },
}

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

SYSTEM_PROMPT_AOCP = """Você é um corretor especialista em provas discursivas do Instituto AOCP para concursos de Polícia Militar.

Avalie o texto dissertativo-argumentativo abaixo com nota final de 0 a 10, somando os critérios:

1. **Estrutura textual** (0-2): introdução, desenvolvimento e conclusão bem definidos; legibilidade
2. **Desenvolvimento do tema** (0-4): abordagem completa dos tópicos pedidos, argumentação consistente, informações pertinentes e articuladas
3. **Coesão e coerência** (0-2): articulação entre parágrafos e ideias, progressão lógica
4. **Norma culta** (0-2): ortografia, concordância, regência, pontuação — desconte proporcionalmente por densidade de erro, não conte cada erro isoladamente

IMPORTANTE: esta é uma aproximação do padrão AOCP em provas discursivas policiais — o
próximo edital pode trazer critérios diferentes. Avise o candidato disso no feedback.

## RESPONDA EM JSON com exatamente este formato:
{
  "final_score_direct": <float 0-10>,
  "macro": {
    "estrutura": {"score": <0-2>, "feedback": "<comentário>"},
    "desenvolvimento": {"score": <0-4>, "feedback": "<comentário>"},
    "coesao": {"score": <0-2>, "feedback": "<comentário>"},
    "norma_culta": {"score": <0-2>, "feedback": "<comentário>"}
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
    banca: str = "CEBRASPE",
) -> dict:
    """Correct an essay using Gemini and return structured diagnosis.

    banca escolhe a rubrica: CEBRASPE (NC - k*NE/TL, 0-20) ou AOCP (soma
    direta de critérios, 0-10) — ver RUBRICS e o docstring do módulo.
    """
    banca = banca.upper() if banca and banca.upper() in RUBRICS else "CEBRASPE"
    if not total_lines:
        total_lines = max(1, len([l for l in text.strip().split("\n") if l.strip()]))

    from prf.services import llm_service

    if llm_service.active_provider() is None:
        return _fallback_correction(
            total_lines, banca,
            "Correção automática indisponível: nenhum provedor de IA configurado. "
            "Defina OPENAI_API_KEY ou GOOGLE_API_KEY.",
        )

    try:
        # The prompt embeds a literal JSON schema, so it must not go through
        # str.format — the braces would be read as format placeholders.
        prompt = SYSTEM_PROMPT_AOCP if banca == "AOCP" else SYSTEM_PROMPT_CORRECTION
        diagnosis = await llm_service.chat_json([
            {"role": "system", "content": prompt},
            {"role": "user", "content": (
                f"TEMA DA REDAÇÃO:\n{theme}\n\n"
                f"REDAÇÃO DO CANDIDATO:\n{text}"
            )},
        ])
        ne = int(diagnosis.get("ne_count", 0))

        if banca == "AOCP":
            final = round(max(0, float(diagnosis.get("final_score_direct", 0))), 2)
            nc = final
            penalty = 0.0
        else:
            nc = float(diagnosis.get("nc_score", 0))
            penalty = CORRECTION_K * (ne / max(total_lines, 1))
            final = round(max(0, nc - penalty), 2)

        return {
            "banca": banca,
            "max_score": RUBRICS[banca]["max_score"],
            "nc_score": round(nc, 2),
            "ne_count": ne,
            "total_lines": total_lines,
            "penalty": round(penalty, 2),
            "final_score": final,
            "diagnosis": diagnosis,
            "feedback_text": _build_feedback(diagnosis, banca, nc, ne, total_lines, final),
        }
    except Exception as e:
        logger.error(f"Essay correction error: {e}")
        return _fallback_correction(
            total_lines, banca,
            f"A correção por IA falhou: {e}. Verifique se a chave de API é válida "
            "e se há créditos disponíveis.",
        )


async def ocr_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Extract text from a handwritten essay photo via a vision model."""
    from prf.services import llm_service

    if llm_service.active_provider() is None:
        raise ValueError("Nenhum provedor de IA configurado — OCR indisponível")

    return await llm_service.vision(SYSTEM_PROMPT_OCR, image_bytes, mime_type)


def _build_feedback(diagnosis: dict, banca: str, nc: float, ne: int, tl: int, final: float) -> str:
    max_score = RUBRICS[banca]["max_score"]
    lines = []
    lines.append(f"NOTA FINAL ESTIMADA ({banca}): {final:.1f}/{max_score}")
    macro = diagnosis.get("macro", {})

    if banca == "AOCP":
        lines.append(f"  Erros gramaticais identificados: {ne}")
        lines.append("")
        est = macro.get("estrutura", {})
        dv = macro.get("desenvolvimento", {})
        co = macro.get("coesao", {})
        nu = macro.get("norma_culta", {})
        lines.append(f"ESTRUTURA TEXTUAL ({est.get('score', '?')}/2): {est.get('feedback', '')}")
        lines.append(f"DESENVOLVIMENTO ({dv.get('score', '?')}/4): {dv.get('feedback', '')}")
        lines.append(f"COESÃO E COERÊNCIA ({co.get('score', '?')}/2): {co.get('feedback', '')}")
        lines.append(f"NORMA CULTA ({nu.get('score', '?')}/2): {nu.get('feedback', '')}")
        lines.append("")
        lines.append("Rubrica AOCP aproximada — confirme os critérios oficiais quando o próximo edital sair.")
        lines.append("")
    else:
        lines.append(f"  Conteúdo (NC): {nc:.1f}/20")
        lines.append(f"  Erros gramaticais: {ne} em {tl} linhas")
        lines.append(f"  Penalidade: -{CORRECTION_K} × ({ne}/{tl}) = -{CORRECTION_K * ne / max(tl, 1):.2f}")
        lines.append("")
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


def _fallback_correction(total_lines: int, banca: str, reason: str) -> dict:
    """Placeholder result carrying the real reason the correction did not run."""
    return {
        "banca": banca,
        "max_score": RUBRICS[banca]["max_score"],
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
