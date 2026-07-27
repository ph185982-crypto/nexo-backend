"""
AI Tutor Service — Socratic-method tutor using Gemini.

The tutor:
  1. Asks the student to explain their reasoning
  2. Identifies the conceptual gap
  3. Explains simply and concisely
  4. Asks a follow-up question
  5. Records the error type for future adaptation
"""
from __future__ import annotations
import os
import json
import logging
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Você é um tutor socrático para concurso da PRF (Polícia Rodoviária Federal).

REGRAS:
- Seja OBJETIVO e CONCISO. Máximo 3-4 frases por mensagem.
- NUNCA dê a resposta diretamente no início. Primeiro pergunte ao aluno.
- Use o método socrático: guie o aluno a descobrir a resposta.
- Quando o aluno errar, pergunte qual foi o raciocínio dele.
- Identifique se o erro é conceitual, de atenção ou de interpretação.
- Explique em linguagem simples e direta.
- Faça uma pergunta de acompanhamento para verificar compreensão.
- Seja encorajador mas firme. Sem excesso de elogios.
- NÃO use emojis. NÃO seja informal demais.
- Quando citar legislação, cite o artigo específico.
- Se o aluno entendeu, encerre com "Conceito consolidado." ou similar.

FORMATO:
- Frases curtas
- Sem parágrafos longos
- Uma pergunta por vez
- Referência legal quando aplicável"""


async def start_tutor_session(
    question_text: str,
    correct_answer: str,
    student_answer: str,
    explanation: str | None = None,
    legal_basis: str | None = None,
) -> dict:
    """Start a tutoring conversation after the student answers incorrectly."""
    context = f"""Questão: {question_text}
Resposta do aluno: {student_answer}
Resposta correta: {correct_answer}"""

    if legal_basis:
        context += f"\nBase legal: {legal_basis}"
    if explanation:
        context += f"\nExplicação oficial: {explanation}"

    first_message = (
        "Você errou essa questão. Antes de eu explicar, me diz: "
        "qual foi o seu raciocínio para escolher essa alternativa?"
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"CONTEXTO DA QUESTÃO:\n{context}"},
        {"role": "assistant", "content": first_message},
    ]

    return {
        "messages": messages,
        "tutor_message": first_message,
        "context": context,
    }


async def continue_tutor_session(
    messages: list[dict],
    student_message: str,
) -> dict:
    """Continue the tutoring conversation with the student's response."""
    messages = messages.copy()
    messages.append({"role": "user", "content": student_message})

    try:
        api_key = os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            return {
                "messages": messages,
                "tutor_message": _fallback_response(student_message),
                "error_type": None,
                "resolved": False,
            }

        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")

        gemini_messages = []
        system_parts = []
        for m in messages:
            if m["role"] == "system":
                system_parts.append(m["content"])
            elif m["role"] == "user":
                gemini_messages.append({"role": "user", "parts": [m["content"]]})
            elif m["role"] == "assistant":
                gemini_messages.append({"role": "model", "parts": [m["content"]]})

        system_instruction = "\n\n".join(system_parts) if system_parts else None

        chat = model.start_chat(history=gemini_messages[:-1])
        response = chat.send_message(
            gemini_messages[-1]["parts"][0] if gemini_messages else student_message,
        )

        tutor_response = response.text.strip()

        messages.append({"role": "assistant", "content": tutor_response})

        resolved = any(
            phrase in tutor_response.lower()
            for phrase in ["conceito consolidado", "entendeu bem", "exatamente isso", "correto"]
        )

        error_type = _detect_error_type(tutor_response)

        return {
            "messages": messages,
            "tutor_message": tutor_response,
            "error_type": error_type,
            "resolved": resolved,
        }

    except Exception as e:
        logger.error(f"AI tutor error: {e}")
        fallback = _fallback_response(student_message)
        messages.append({"role": "assistant", "content": fallback})
        return {
            "messages": messages,
            "tutor_message": fallback,
            "error_type": None,
            "resolved": False,
        }


def _fallback_response(student_message: str) -> str:
    return (
        "Entendi seu raciocínio. Revise o dispositivo legal relacionado "
        "e tente identificar onde o conceito se aplica de forma diferente do que você pensou. "
        "Qual artigo você acha que fundamenta a resposta correta?"
    )


def _detect_error_type(response: str) -> Optional[str]:
    lower = response.lower()
    if any(w in lower for w in ["conceito", "definição", "fundamento", "princípio"]):
        return "conceptual"
    if any(w in lower for w in ["atenção", "leitura", "cuidado", "detalhe"]):
        return "attention"
    if any(w in lower for w in ["interpretação", "interpretou", "sentido"]):
        return "interpretation"
    return None
