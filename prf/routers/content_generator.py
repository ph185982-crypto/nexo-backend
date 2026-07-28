"""AI-assisted content generation — CEBRASPE questions and audio lesson scripts."""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

QUESTION_SYSTEM = (
    "Você é examinador do CEBRASPE e elabora itens de julgamento (Certo/Errado) "
    "para o concurso da Polícia Rodoviária Federal. Você responde exclusivamente "
    "em JSON válido, sem texto fora do objeto."
)


def _question_prompt(subject: str, topic: str, count: int, difficulty: str) -> str:
    return f"""Elabore {count} itens de julgamento (Certo/Errado) no padrão CEBRASPE sobre
"{topic}", da disciplina "{subject}", para o concurso da PRF.

REGRAS OBRIGATÓRIAS:
1. Cada item traz um texto-base ("context_text") no padrão CEBRASPE, do tipo
   "Acerca de ..., julgue o item a seguir." — o item deve ser compreensível sozinho,
   sem pronomes soltos ("esses", "aqueles") sem referente explícito.
2. O enunciado ("statement") tem no mínimo 3 linhas, em linguagem técnica e formal.
3. Aproximadamente metade dos itens é Certo e metade Errado.
4. Use pegadinhas reais da banca: troca de conceitos, exceção apresentada como regra,
   prazos e números alterados, generalizações indevidas.
5. A explicação tem no mínimo 5 linhas e diz POR QUE o item está certo ou errado,
   citando o dispositivo legal.
6. Dificuldade de todos os itens: "{difficulty}".

Responda com um objeto JSON exatamente nesta forma:
{{
  "questions": [
    {{
      "context_text": "Acerca de ..., julgue o item a seguir.",
      "statement": "...",
      "correct_answer": true,
      "explanation": "...",
      "legal_reference": "Art. 121 do CP",
      "difficulty": "{difficulty}",
      "tags": ["tag1", "tag2"]
    }}
  ]
}}"""


AUDIO_SYSTEM = (
    "Você é professor especialista em concursos policiais e escreve roteiros de "
    "áudio-aula prontos para narração, sem marcações de cena nem formatação markdown."
)


def _audio_prompt(subject: str, topic: str) -> str:
    return f"""Escreva o roteiro de uma áudio-aula de 15 a 20 minutos sobre "{topic}",
da disciplina "{subject}", para quem estuda para a PRF.

Estruture assim, em texto corrido pronto para narração:

1. INTRODUÇÃO (~2 min): por que esse tema cai e qual o peso dele na prova.
2. TEORIA (~10 min): conceitos fundamentais, classificações, artigos de lei citados
   pelo número e jurisprudência relevante.
3. COMO O CEBRASPE COBRA (~4 min): padrões de itens, pegadinhas recorrentes e as
   palavras-chave que costumam denunciar item errado.
4. RESUMO (~3 min): pontos-chave para memorizar, mnemônicos e o que mais cai.

Tom professoral e direto. Não use markdown, títulos numerados soltos, nem asteriscos —
apenas o texto que será lido em voz alta."""


DIFFICULTY_MAP = {
    "facil": "easy", "easy": "easy",
    "medio": "medium", "médio": "medium", "medium": "medium",
    "dificil": "hard", "difícil": "hard", "hard": "hard",
}


@router.post("/questions")
async def generate_questions(
    subject_id: UUID,
    topic_name: str = Query(..., min_length=3),
    count: int = Query(5, ge=1, le=10),
    difficulty: str = Query("medio"),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Generate CEBRASPE-style Certo/Errado items and store them in the bank."""
    subject = await repo._fetchrow("SELECT id, name FROM subjects WHERE id = $1", subject_id)
    if not subject:
        raise HTTPException(404, "Disciplina não encontrada")

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": QUESTION_SYSTEM},
                {"role": "user", "content": _question_prompt(
                    subject["name"], topic_name, count, difficulty
                )},
            ],
            temperature=0.6,
            max_tokens=3500,
        )
    except llm_service.LLMUnavailable as e:
        raise HTTPException(503, f"IA indisponível: {e}")

    items = data.get("questions") or []
    if not items:
        raise HTTPException(502, "A IA não retornou itens utilizáveis")

    db_difficulty = DIFFICULTY_MAP.get(difficulty.lower(), "medium")
    created: list[str] = []

    for item in items[:count]:
        statement = (item.get("statement") or "").strip()
        if not statement:
            continue

        existing = await repo._fetchval(
            "SELECT id FROM questions WHERE subject_id = $1 AND text = $2",
            subject_id, statement,
        )
        if existing:
            continue

        row = await repo._fetchrow(
            """INSERT INTO questions
                 (subject_id, question_type, context_text, text, difficulty,
                  source, examiner, explanation, legal_basis, tags)
               VALUES ($1, 'certo_errado', $2, $3, $4::difficulty_level,
                       'IA/PRF', 'CEBRASPE', $5, $6, $7)
               RETURNING id""",
            subject_id,
            (item.get("context_text") or "").strip() or None,
            statement,
            db_difficulty,
            (item.get("explanation") or "").strip() or None,
            (item.get("legal_reference") or "").strip() or None,
            item.get("tags") or [],
        )
        question_id = row["id"]
        is_certo = bool(item.get("correct_answer"))

        for order, (letter, label) in enumerate((("C", "Certo"), ("E", "Errado"))):
            await repo._execute(
                """INSERT INTO question_alternatives
                     (question_id, letter, text, is_correct, display_order)
                   VALUES ($1, $2, $3, $4, $5)""",
                question_id, letter, label,
                (letter == "C") == is_certo,
                order,
            )
        created.append(str(question_id))

    return {
        "generated": len(created),
        "question_ids": created,
        "subject": subject["name"],
        "topic": topic_name,
    }


@router.post("/audio-lesson")
async def generate_audio_lesson(
    subject_id: UUID,
    topic_name: str = Query(..., min_length=3),
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """Generate a 15–20 minute lesson script and store it for TTS playback."""
    subject = await repo._fetchrow("SELECT id, name FROM subjects WHERE id = $1", subject_id)
    if not subject:
        raise HTTPException(404, "Disciplina não encontrada")

    try:
        script = await llm_service.chat(
            [
                {"role": "system", "content": AUDIO_SYSTEM},
                {"role": "user", "content": _audio_prompt(subject["name"], topic_name)},
            ],
            temperature=0.7,
            max_tokens=4000,
        )
    except llm_service.LLMUnavailable as e:
        raise HTTPException(503, f"IA indisponível: {e}")

    script = script.strip()
    if len(script) < 500:
        raise HTTPException(502, "Roteiro retornado é curto demais")

    title = f"{topic_name} — {subject['name']}"
    # ~150 spoken words per minute
    duration_secs = int(len(script.split()) / 150 * 60)

    row = await repo._fetchrow(
        """INSERT INTO audio_lessons
             (subject_id, title, description, script, duration_secs,
              lesson_type, difficulty, is_active)
           VALUES ($1, $2, $3, $4, $5, 'deep_dive', 'medium'::difficulty_level, TRUE)
           RETURNING id""",
        subject_id,
        title,
        f"Aula aprofundada sobre {topic_name}",
        script,
        duration_secs,
    )

    return {
        "lesson_id": str(row["id"]),
        "title": title,
        "words": len(script.split()),
        "estimated_duration_secs": duration_secs,
    }
