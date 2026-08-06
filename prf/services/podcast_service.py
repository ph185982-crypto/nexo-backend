"""
Podcast Service — episódios em áudio no formato dois comentaristas.

O modo commute antigo era leitura de resumo por uma voz só: funciona como
revisão, mas não ensina quem ainda não sabe o tema. Aqui o episódio é um
diálogo entre dois personagens fixos com papéis complementares, porque é a
tensão entre eles que faz o conteúdo explicar a si mesmo:

  MARCOS — instrutor, ex-praça. Traz a ocorrência real, o exemplo de rua,
           a pergunta que o aluno faria. Linguagem direta.
  JULIA  — professora de Direito. Traz a precisão técnica, o dispositivo,
           a exceção, o erro que a banca explora.

Um episódio tem seis blocos temáticos. Cada bloco vira um segmento de áudio
independente: o player toca em sequência e o segmento seguinte é sintetizado
enquanto o anterior ainda está tocando, o que mantém cada requisição dentro
do limite de tempo do serverless.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ~150 palavras por minuto é o ritmo do TTS em pt-BR. Seis blocos de 800
# palavras dão ~32 min, com folga sobre o mínimo de 30 pedido.
WORDS_PER_MINUTE = 150
WORDS_PER_BLOCK = 800
TARGET_MIN_MINUTES = 30

HOST_A = "MARCOS"
HOST_B = "JULIA"

SYSTEM_PROMPT = f"""Você escreve roteiros de podcast educativo para candidatos ao concurso da Polícia Militar de Goiás (banca Instituto AOCP).

O programa tem dois apresentadores fixos:

{HOST_A} — instrutor de formação policial, ex-praça com 15 anos de rua. Ele NÃO
lê lei. Ele conta ocorrência, dá exemplo concreto, faz a pergunta que o aluno
faria em voz alta, provoca a colega, resume em linguagem de quartel. Fala como
gente fala, com frases curtas.

{HOST_B} — professora de Direito, especialista em legislação policial. Ela traz
a precisão: o que o dispositivo diz exatamente, onde está a exceção, qual
palavra muda tudo, como a banca troca um termo para tornar o item errado.
Corrige o {HOST_A} quando ele simplifica demais, mas sem arrogância.

REGRAS ABSOLUTAS:
- É CONVERSA, não é leitura. Eles se interrompem, discordam, retomam,
  brincam. Um completa a frase do outro. Ninguém dá palestra de 200 palavras.
- PROIBIDO ler o texto da lei em voz corrida. Se precisar citar, cita o
  trecho curto e IMEDIATAMENTE traduz para o português do dia a dia.
- Todo conceito abstrato precisa de um exemplo concreto de ocorrência
  policial real logo em seguida. Sem exceção.
- É áudio para ouvir dirigindo. Nada de "como vocês veem na tela",
  "no slide", "na tabela abaixo". Nada de listar "primeiro, segundo,
  terceiro" em sequência longa — quem dirige não decora lista.
- Português do Brasil falado, natural, com marcas de oralidade
  ("olha", "então", "peraí", "exatamente isso").
- Cada fala entre 15 e 90 palavras. Alterna os dois apresentadores.
- Não escreva efeitos sonoros, rubricas, nem "[risos]".

Responda SEMPRE em JSON válido."""


def _block_briefs(topic: str) -> list[dict]:
    """Os seis blocos do episódio. Briefs distintos para que os blocos
    possam ser gerados em paralelo sem um repetir o outro."""
    return [
        {
            "title": "Abertura e por que isso cai",
            "brief": (
                f"Abram o episódio apresentando o tema '{topic}'. {HOST_A} chega "
                "contando um caso de ocorrência em que esse assunto decidiu se o "
                "policial agiu certo ou errado. A partir do caso, expliquem por que "
                "esse tema cai muito na prova da PMGO e o que o candidato costuma "
                "errar nele. Fechem dizendo o que o ouvinte vai dominar até o fim "
                "do episódio. NÃO entrem ainda no detalhe técnico."
            ),
        },
        {
            "title": "O conceito do zero",
            "brief": (
                f"Construam o conceito central de '{topic}' do zero, assumindo que o "
                f"ouvinte nunca estudou isso. {HOST_B} explica a lógica por trás da "
                f"regra — por que ela existe, que problema ela resolve. {HOST_A} "
                "traduz cada pedaço com analogia do cotidiano e testa se entendeu, "
                "às vezes entendendo errado de propósito para ela corrigir."
            ),
        },
        {
            "title": "A letra que a banca cobra",
            "brief": (
                f"Destrinchem o texto legal de '{topic}' na parte que a banca "
                f"realmente cobra. {HOST_B} aponta as palavras exatas que mudam o "
                "sentido do dispositivo (prazos, quem pode, em que hipótese, o que é "
                f"vedado). {HOST_A} pergunta 'e se fosse ao contrário?' para forçar a "
                "explicação das exceções. Foquem nos pontos onde trocar uma palavra "
                "torna o item errado."
            ),
        },
        {
            "title": "Na rua",
            "brief": (
                f"Levem '{topic}' para a prática. {HOST_A} narra duas ou três "
                "ocorrências completas e diferentes entre si, e a cada uma pergunta "
                f"para {HOST_B} qual seria a conduta correta e o fundamento. Ela "
                "responde ligando o caso ao dispositivo. Mostrem também um caso de "
                "conduta errada e a consequência disso para o policial."
            ),
        },
        {
            "title": "Como o Instituto AOCP cobra",
            "brief": (
                f"Simulem o raciocínio de prova sobre '{topic}'. Apresentem em voz "
                "alta três assertivas no estilo da banca, uma por vez. Depois de cada "
                "uma façam uma pausa curta na fala ('pensa aí'), digam se está certa "
                "ou errada e expliquem exatamente qual palavra entrega a pegadinha. "
                "Comentem os erros clássicos de candidato nesse tema."
            ),
        },
        {
            "title": "Fechamento e memorização",
            "brief": (
                f"Fechem o episódio consolidando '{topic}'. Retomem os pontos que o "
                "ouvinte precisa levar na memória, do jeito que ele conseguiria "
                f"lembrar dirigindo. {HOST_A} arrisca um resumo e {HOST_B} ajusta o "
                "que ficou impreciso. Terminem com uma frase-gatilho curta que "
                "resuma o tema e uma despedida natural."
            ),
        },
    ]


def _source_material(articles: list[dict]) -> str:
    """Monta o material de apoio a partir dos artigos de lei da matéria."""
    parts = []
    for a in articles:
        doc = a.get("document_name") or ""
        num = a.get("article_number") or ""
        official = (a.get("official_text") or "").strip()
        simple = (a.get("simple_text") or "").strip()
        block = f"{doc} — {num}\nTEXTO OFICIAL: {official[:900]}"
        if simple:
            block += f"\nEM LINGUAGEM SIMPLES: {simple[:600]}"
        parts.append(block)
    return "\n\n".join(parts)


async def _generate_block(
    topic: str,
    material: str,
    block_index: int,
    block: dict,
    outline: str,
) -> list[dict]:
    """Gera as falas de um bloco. Devolve [] se o provedor falhar — o
    episódio ainda sai, só mais curto, em vez de quebrar inteiro."""
    from prf.services import llm_service

    prompt = f"""TEMA DO EPISÓDIO: {topic}

ROTEIRO GERAL DO EPISÓDIO (para você saber o que NÃO abordar agora):
{outline}

VOCÊ ESTÁ ESCREVENDO APENAS O BLOCO {block_index + 1}: {block['title']}

O QUE ESTE BLOCO PRECISA FAZER:
{block['brief']}

MATERIAL DE APOIO (base legal real — use como fonte, não copie corrido):
{material[:7000]}

Escreva no mínimo {WORDS_PER_BLOCK} palavras de diálogo neste bloco, alternando
os dois apresentadores. Não repita o conteúdo dos outros blocos do roteiro geral.

Responda em JSON:
{{"turns": [{{"speaker": "{HOST_A}", "text": "fala"}}, {{"speaker": "{HOST_B}", "text": "fala"}}]}}"""

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.85,
            max_tokens=4000,
        )
    except Exception as e:
        logger.error(f"[PODCAST] Bloco {block_index} falhou: {e}")
        return []

    turns = []
    for t in data.get("turns") or []:
        if not isinstance(t, dict):
            continue
        text = (t.get("text") or "").strip()
        if not text:
            continue
        speaker = (t.get("speaker") or "").strip().upper()
        # Qualquer coisa que não seja explicitamente a Julia vira Marcos:
        # nome inventado pelo modelo não pode virar uma terceira voz.
        speaker = HOST_B if speaker.startswith(HOST_B[:3]) else HOST_A
        turns.append({"speaker": speaker, "text": text, "block": block_index})
    return turns


def estimate_duration_secs(turns: list[dict]) -> int:
    words = sum(len((t.get("text") or "").split()) for t in turns)
    return int(words / WORDS_PER_MINUTE * 60)


async def generate_episode(topic: str, articles: list[dict]) -> dict:
    """Gera um episódio completo. Os blocos vão em paralelo — em série
    a soma das chamadas estoura o tempo da função no serverless."""
    material = _source_material(articles)
    blocks = _block_briefs(topic)
    outline = "\n".join(f"{i + 1}. {b['title']}: {b['brief'][:130]}..." for i, b in enumerate(blocks))

    results = await asyncio.gather(*[
        _generate_block(topic, material, i, b, outline)
        for i, b in enumerate(blocks)
    ])

    turns: list[dict] = []
    for block_turns in results:
        turns.extend(block_turns)

    duration = estimate_duration_secs(turns)
    filled_blocks = sorted({t["block"] for t in turns})

    return {
        "topic": topic,
        "turns": turns,
        "blocks": filled_blocks,
        "segment_count": len(filled_blocks),
        "duration_secs": duration,
        "word_count": sum(len(t["text"].split()) for t in turns),
    }


async def synthesize_segment(turns: list[dict]) -> bytes:
    """Sintetiza as falas de um segmento, cada apresentador com sua voz.

    As falas vão em lotes paralelos porque, em série, um segmento de cinco
    minutos passa do tempo limite da função. A ordem é preservada porque
    asyncio.gather devolve os resultados na ordem dos argumentos.
    """
    from prf.services.tts_service import TTSService

    voices = {HOST_A: TTSService(voice="male"), HOST_B: TTSService(voice="female")}
    parts: list[bytes] = []

    for start in range(0, len(turns), 6):
        chunk = turns[start:start + 6]
        audios = await asyncio.gather(*[
            voices.get(t.get("speaker"), voices[HOST_A]).synthesize(t.get("text") or "")
            for t in chunk
        ])
        parts.extend(a for a in audios if a)

    return b"".join(parts)
