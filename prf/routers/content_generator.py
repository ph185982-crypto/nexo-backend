"""AI-powered content generation — Questions and Audio lessons."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from uuid import UUID
import json

from prf.routers.deps import get_repo, get_current_user_id
from prf.database.repository import PRFRepository
from prf.services.llm_service import LLMService

router = APIRouter(prefix="/api/prf/generate", tags=["generation"])

@router.post("/questions")
async def generate_questions(
    subject_id: UUID,
    topic_name: str,
    count: int = 5,
    difficulty: str = "medio",
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """
    Generate new CEBRASPE-format questions via AI.

    Prompt template follows MASTER specifications:
    - Certo/Errado format
    - 3-4 lines minimum per question
    - Gabarito comentado obrigatório
    - Referência legal
    - Dificuldade e tags
    """
    try:
        # Get subject info
        subject = await repo._fetchrow(
            "SELECT name FROM subjects WHERE id = $1",
            subject_id,
        )
        if not subject:
            raise HTTPException(404, "Subject not found")

        # Build prompt per MASTER spec
        prompt = f"""Você é um especialista em elaborar questões no estilo CEBRASPE/CESPE para o concurso da PRF.

Gere {count} questões sobre o tema: "{topic_name}" da disciplina "{subject['name']}".

REGRAS OBRIGATÓRIAS:
1. Formato Certo/Errado (julgamento de item) — padrão CEBRASPE
2. Enunciado mínimo de 3 linhas, com linguagem técnica e formal
3. Misture questões Certas e Erradas (proporção ~50/50)
4. Inclua pegadinhas comuns: troca de conceitos, exceções que parecem regra, números trocados
5. Para cada questão inclua:
   - Gabarito (Certo ou Errado)
   - Explicação detalhada (mínimo 5 linhas) explicando POR QUE está certo ou errado
   - Referência legal quando aplicável (artigo de lei, súmula)
   - Nível de dificuldade ({difficulty})
   - Tags relevantes

Retorne em JSON válido (array no campo "questions"):
[
  {{
    "statement": "...",
    "correct_answer": true/false,
    "explanation": "...",
    "legal_reference": "...",
    "difficulty": "{difficulty}",
    "tags": ["tag1", "tag2"]
  }}
]"""

        # Call LLM
        llm_svc = LLMService()
        response = await llm_svc.generate_text(prompt)

        # Parse JSON response
        try:
            # Extract JSON from response
            json_start = response.find('[')
            json_end = response.rfind(']') + 1
            json_str = response[json_start:json_end]
            questions_data = json.loads(json_str)
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(500, "Failed to parse AI response")

        # Save questions to DB
        created = []
        for q_data in questions_data[:count]:
            row = await repo._fetchrow(
                """INSERT INTO questions
                   (subject_id, question_type, context_text, text,
                    correct_answer_ce, explanation, legal_basis,
                    difficulty, tags)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   RETURNING id""",
                subject_id,
                "certo_errado",
                None,  # context_text can be added later
                q_data.get("statement", ""),
                q_data.get("correct_answer", True),
                q_data.get("explanation", ""),
                q_data.get("legal_reference", ""),
                q_data.get("difficulty", "medio"),
                q_data.get("tags", []),
            )
            created.append(str(row["id"]))

        return {
            "generated": len(created),
            "question_ids": created,
            "message": f"Geradas {len(created)} questões com sucesso"
        }

    except Exception as e:
        raise HTTPException(500, f"Generation error: {str(e)}")


@router.post("/audio-lesson")
async def generate_audio_lesson(
    subject_id: UUID,
    topic_name: str,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """
    Generate an audio lesson script (15-20 min) via AI.

    Script includes:
    - Introdução (2 min)
    - Teoria (8-10 min) com conceitos, artigos, jurisprudência
    - Como CEBRASPE cobra (3-4 min)
    - Resumo e dicas (2-3 min)
    """
    try:
        subject = await repo._fetchrow(
            "SELECT name FROM subjects WHERE id = $1",
            subject_id,
        )
        if not subject:
            raise HTTPException(404, "Subject not found")

        prompt = f"""Você é um professor especialista em concursos da PRF, preparando uma aula sobre "{topic_name}" da disciplina "{subject['name']}".

Crie um roteiro de áudio-aula de 15-20 minutos com:

1. INTRODUÇÃO (2 min): Contextualização do tema e sua importância para a prova
2. TEORIA (8-10 min): Explicação completa do conteúdo com:
   - Conceitos fundamentais
   - Classificações e subdivisões
   - Artigos de lei relevantes (cite os números)
   - Jurisprudência importante (quando aplicável)
3. COMO A CEBRASPE COBRA (3-4 min):
   - Padrões de questões sobre esse tema
   - Pegadinhas mais comuns
   - Palavras-chave que indicam certo/errado
4. RESUMO E DICAS (2-3 min):
   - Pontos-chave para memorizar
   - Mnemônicos quando possível
   - O que mais cai vs. o que raramente cai

Tom: professoral mas acessível, direto ao ponto, sem enrolação.

Retorne apenas o roteiro de áudio em formato texto, pronto para TTS."""

        llm_svc = LLMService()
        script = await llm_svc.generate_text(prompt)

        # Save lesson to DB (script only, audio will be generated on demand)
        row = await repo._fetchrow(
            """INSERT INTO audio_lessons
               (subject_id, title, description, script, lesson_type, difficulty)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id""",
            subject_id,
            f"Aula: {topic_name}",
            f"Aula profunda sobre {topic_name}",
            script,
            "deep_dive",
            "medium",
        )

        return {
            "lesson_id": str(row["id"]),
            "topic": topic_name,
            "subject": subject["name"],
            "script_length": len(script.split()),
            "message": "Roteiro de aula gerado com sucesso"
        }

    except Exception as e:
        raise HTTPException(500, f"Audio generation error: {str(e)}")


@router.post("/synthesize-audio/{lesson_id}")
async def synthesize_audio(
    lesson_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    repo: PRFRepository = Depends(get_repo),
):
    """
    Synthesize audio from lesson script using TTS.
    """
    try:
        lesson = await repo._fetchrow(
            "SELECT id, script, title FROM audio_lessons WHERE id = $1",
            lesson_id,
        )
        if not lesson:
            raise HTTPException(404, "Lesson not found")

        # Call TTS service
        from prf.services.tts_service import TTSService
        tts = TTSService()
        audio_url = await tts.synthesize(lesson["script"], lesson["title"])

        # Update lesson with audio URL
        await repo._execute(
            "UPDATE audio_lessons SET audio_url = $1 WHERE id = $2",
            audio_url, lesson_id,
        )

        return {
            "lesson_id": str(lesson_id),
            "audio_url": audio_url,
            "message": "Áudio sintetizado com sucesso"
        }

    except Exception as e:
        raise HTTPException(500, f"Synthesis error: {str(e)}")
