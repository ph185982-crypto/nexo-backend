"""
Podcast Service — aulas em áudio no formato dois apresentadores.

Um episódio cobre UM tópico do edital, não uma matéria inteira. A primeira
versão gerava um episódio por matéria e o resultado era panorâmico demais:
passava por cima de tudo sem descer em nenhum ponto, não lia a lei e não
ensinava — servia de revisão para quem já sabia. Aqui cada episódio é uma
aula fechada sobre um tópico, que lê o texto legal na íntegra e destrincha
dispositivo por dispositivo.

Dois personagens fixos, com papéis complementares — é a tensão entre eles
que faz o conteúdo se explicar sozinho no áudio:

  MARCOS — instrutor, ex-praça. Traz a ocorrência real, o exemplo de rua,
           a pergunta que o aluno faria. Erra de propósito para ser corrigido.
  JULIA  — professora de Direito. Lê o dispositivo, destrincha expressão por
           expressão, aponta a exceção e o que a banca troca.

O roteiro é engenheirado para retenção em escuta passiva (dirigindo, sem
poder anotar). As técnicas estão descritas em RETENTION_RULES e são
obrigatórias no prompt, porque sem elas o modelo produz exposição corrida,
que é justamente o formato que o ouvinte esquece.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Ritmo medido no áudio real gerado pelo TTS em pt-BR: um segmento de 541
# palavras rendeu 185s, ou seja ~175 palavras por minuto (o palpite inicial
# de 150 inflava a duração estimada em quase 20%).
WORDS_PER_MINUTE = 175
# Pedir blocos maiores não funciona: o modelo satura perto de 800 palavras
# por resposta e ignora o resto do pedido (com alvo de 1100 entregou 800).
# O que escala é o número de blocos — oito de ~800 dão ~6400 palavras,
# ou ~36 min, dentro da faixa de 30-40 min pedida.
WORDS_PER_BLOCK = 1000
TARGET_MIN_MINUTES = 30

# Dimensionamento das partes. Medido: o tópico "Crime" tem 4,2 kchars de lei
# e os oito blocos renderam 43 min cobrindo os 14 artigos com folga. Acima de
# ~7 kchars os oito blocos deixam de dar conta e o roteiro começa a resumir —
# que é justamente o que não pode acontecer. Daí o material ser fatiado em
# partes numeradas em vez de comprimido.
CHARS_PER_PART = 7000
# Teto de partes por unidade. Sem ele o edital inteiro daria 139 h de aula:
# Processo penal militar sozinho pediria 33 partes. O áudio cobre o núcleo de
# maior incidência; a cauda longa fica para a lei seca e as questões, que o
# candidato faz lendo, não dirigindo.
MAX_PARTS = 4
# Duração alvo do drill da volta. Recuperar não precisa do mesmo tempo que
# aprender — o que conta é a quantidade de tentativas de recuperação.
DRILL_WORDS_PER_BLOCK = 950
DRILL_BLOCKS = 4

HOST_A = "MARCOS"
HOST_B = "JULIA"

# Técnicas de retenção para escuta passiva. Vão no prompt como regra dura
# porque são a diferença entre uma aula que gruda e uma exposição que entra
# por um ouvido e sai pelo outro.
RETENTION_RULES = f"""TÉCNICAS DE RETENÇÃO — OBRIGATÓRIAS EM TODO BLOCO:

1. LACUNA DE CURIOSIDADE — nunca entregue a resposta antes da pergunta.
   {HOST_A} pergunta, o ouvinte fica pensando, e só depois {HOST_B} responde.
   Abra ganchos que só fecham mais adiante ("segura essa que já volto nela").

2. RECALL ATIVO — pelo menos duas vezes por bloco, façam o ouvinte responder
   antes de vocês. Frases do tipo "responde aí antes de eu falar", "qual que
   é a pegadinha aqui?", seguidas de uma frase curta de espera e só então a
   resposta. É o que fixa mais do que qualquer explicação.

3. ÂNCORA VISUAL — todo dispositivo abstrato vira uma cena concreta e
   específica na cabeça do ouvinte (um local, uma hora, uma pessoa, uma
   viatura). Sem cena, o dispositivo não gruda.

4. REPETIÇÃO ESPAÇADA INTERNA — o núcleo do tópico volta três vezes no
   episódio, em momentos distantes e com palavras diferentes a cada vez.

5. CONTRASTE — sempre diga o que a coisa NÃO é logo depois de dizer o que
   ela é. O cérebro guarda a fronteira melhor do que a definição.

6. SINALIZAÇÃO DE ATENÇÃO — marque os pontos que caem com aviso explícito
   ("grava isso", "aqui é onde o candidato perde ponto", "essa palavra vale
   a questão inteira"). Use com parcimônia, só no que realmente importa.

7. BLOCOS NOMEADOS — no máximo de três a cinco ideias por bloco, cada uma
   com um nome curto que o ouvinte consiga repetir de cabeça."""

SYSTEM_PROMPT = f"""Você escreve roteiros de AULA em áudio para candidatos ao concurso da Polícia Militar de Goiás (banca Instituto AOCP).

Não é um programa de entretenimento nem um resumo panorâmico. É uma aula
completa e profunda sobre UM tópico específico, em formato de conversa entre
dois professores. O ouvinte está dirigindo: não pode anotar, não pode voltar,
não pode ler nada. Tudo tem que entrar pelo ouvido e ficar.

OS DOIS APRESENTADORES:

{HOST_A} — instrutor de formação policial, ex-praça com 15 anos de rua. Ele
puxa a aula com perguntas, traz a ocorrência concreta, exige exemplo quando a
explicação fica abstrata, e às vezes entende errado de propósito para forçar a
correção. Fala como gente fala, frases curtas.

{HOST_B} — professora de Direito, especialista em legislação policial. É ela
quem LÊ O TEXTO DA LEI em voz alta e destrincha expressão por expressão:
o que cada termo significa, o que muda se trocar uma palavra, qual a exceção,
qual o requisito cumulativo.

REGRAS DE PROFUNDIDADE:
- A lei é LIDA. Quando o roteiro chegar num dispositivo, {HOST_B} lê o texto
  oficial em voz alta, do jeito que está escrito, e SÓ DEPOIS explica. Ler e
  explicar, dispositivo por dispositivo — não pular para o resumo.
- Depois de ler, destrinche em pedaços: cabeça do artigo, depois cada inciso
  ou parágrafo que importa, um de cada vez. Nada de "e os demais incisos
  seguem a mesma lógica".
- Profundidade acima de cobertura. É melhor esgotar três dispositivos do que
  tocar em doze por cima. Este episódio é sobre UM tópico só.
- Todo conceito abstrato precisa de exemplo concreto de ocorrência policial
  logo em seguida. Sem exceção.

REGRAS DE FORMATO:
- É CONVERSA. Eles se interrompem, discordam, retomam. Ninguém dá palestra
  de 200 palavras seguidas.
- É ÁUDIO. Nada de "como vocês veem", "no slide", "na tabela". Nada de
  listar dez itens em sequência — quem dirige não decora lista longa.
- Português do Brasil falado, natural, com marcas de oralidade ("olha",
  "então", "peraí", "exatamente isso"). Ao ler a lei, a leitura é literal
  e pausada; fora dela, é conversa.
- Cada fala entre 15 e 90 palavras. Alterne os dois apresentadores.
- Não escreva efeitos sonoros, rubricas, nem "[risos]". O texto será lido
  por um sintetizador de voz: escreva só o que deve ser falado.

{RETENTION_RULES}

Responda SEMPRE em JSON válido."""


def _format_articles(articles: list[dict], full_text: bool = False) -> str:
    """Material de apoio. `full_text` amplia o corte do texto oficial para os
    blocos que precisam ler a lei na íntegra."""
    limit = 2600 if full_text else 700
    parts = []
    for a in articles:
        doc = a.get("document_name") or ""
        num = a.get("article_number") or ""
        official = (a.get("official_text") or "").strip()
        block = f"{doc} — {num}\nTEXTO OFICIAL (leia literalmente):\n{official[:limit]}"
        simple = (a.get("simple_text") or "").strip()
        if simple and not full_text:
            block += f"\nEM LINGUAGEM SIMPLES: {simple[:400]}"
        parts.append(block)
    return "\n\n".join(parts)


def _block_briefs(topic: str, subject: str, articles: list[dict]) -> list[dict]:
    """Os oito blocos da aula.

    Os briefs são distintos o bastante para que os blocos possam ser gerados
    em paralelo sem um repetir o outro. Os dois blocos de leitura de lei
    recebem metades diferentes dos artigos, para que o episódio percorra
    todo o material em vez de reler os mesmos dispositivos.
    """
    half = max(1, (len(articles) + 1) // 2)
    first_half, second_half = articles[:half], articles[half:] or articles[:half]

    return [
        {
            "title": "Gancho e mapa da aula",
            "articles": articles[:4],
            "brief": (
                f"Abram a aula sobre '{topic}' com uma LACUNA DE CURIOSIDADE: {HOST_A} "
                "narra uma ocorrência real que termina numa dúvida sem resposta — o "
                "policial agiu certo ou errado? — e deixem essa resposta EM ABERTO, "
                "avisando que ela só vem no fim do episódio. Depois digam com precisão "
                "quais dispositivos vão ser lidos e o que exatamente o ouvinte vai "
                "dominar ao terminar. NÃO resolvam o caso agora e NÃO entrem ainda "
                "no detalhe técnico."
            ),
        },
        {
            "title": "A base do conceito",
            "articles": articles[:5],
            "brief": (
                f"Construam o conceito central de '{topic}' do zero, assumindo que o "
                f"ouvinte nunca estudou isso. {HOST_B} explica a lógica por trás da "
                "regra: por que ela existe, que problema ela resolve, de onde ela vem. "
                f"{HOST_A} amarra cada pedaço numa ÂNCORA VISUAL — uma cena concreta "
                "de serviço — e testa o entendimento entendendo errado de propósito. "
                "Fechem o bloco com um recall ativo sobre a definição."
            ),
        },
        {
            "title": "A lei na íntegra, parte 1",
            "articles": first_half,
            "full_text": True,
            "brief": (
                f"Comecem a leitura comentada da lei sobre '{topic}'. {HOST_B} LÊ EM "
                "VOZ ALTA o texto oficial dos dispositivos do material, um por vez, "
                "literalmente como está escrito. Depois de CADA leitura, ela para e "
                "destrincha: primeiro a cabeça do artigo, depois cada inciso ou "
                f"parágrafo que importa, um de cada vez. {HOST_A} interrompe pedindo "
                "tradução sempre que aparecer termo técnico e pergunta o que acontece "
                "na prática em cada hipótese. Não resuma: leia e explique."
            ),
        },
        {
            "title": "A lei na íntegra, parte 2",
            "articles": second_half,
            "full_text": True,
            "brief": (
                f"Continuem a leitura comentada de '{topic}' com os dispositivos "
                f"restantes do material — os que ainda não foram lidos. Mesmo método: "
                f"{HOST_B} lê literalmente, depois destrincha pedaço por pedaço. Deem "
                "atenção especial aos parágrafos, exceções e requisitos cumulativos. "
                f"{HOST_A} pergunta 'e se faltar um desses requisitos?' a cada regra. "
                "Retomem, com outras palavras, o núcleo do conceito visto no começo."
            ),
        },
        {
            "title": "A palavra que vale a questão",
            "articles": articles[:8],
            "brief": (
                f"Foquem nas palavras exatas dos dispositivos de '{topic}' que mudam o "
                f"sentido: prazos, quem pode, em que hipótese, o que é vedado, "
                f"'poderá' contra 'deverá'. {HOST_B} mostra a troca que a banca faz "
                f"para tornar o item errado e {HOST_A} lê a versão adulterada em voz "
                "alta para o ouvinte tentar identificar o erro ANTES da resposta. "
                "Usem CONTRASTE: o que é, seguido do que não é."
            ),
        },
        {
            "title": "O que parece mas não é",
            "articles": articles[:8],
            "brief": (
                f"Ataquem as confusões clássicas de '{topic}' dentro de {subject}: os "
                f"institutos parecidos que o candidato troca na prova. {HOST_B} coloca "
                f"os pares lado a lado e dá o critério que separa um do outro. "
                f"{HOST_A} confunde os dois de propósito, do jeito que o aluno "
                "confundiria, e ela desfaz mostrando um caso em que a diferença muda "
                "completamente a conduta do policial."
            ),
        },
        {
            "title": "Na rua e no raciocínio de prova",
            "articles": articles[:8],
            "brief": (
                f"Apliquem '{topic}' em duas frentes. Primeiro {HOST_A} narra duas "
                f"ocorrências completas e diferentes e pergunta a {HOST_B} a conduta "
                "correta e o fundamento, que ela liga ao dispositivo já lido. Depois "
                "apresentem três assertivas no estilo do Instituto AOCP, uma por vez: "
                "leiam a assertiva, mandem o ouvinte decidir certo ou errado, façam "
                "uma frase curta de espera e só então revelem e expliquem qual palavra "
                "entrega a pegadinha."
            ),
        },
        {
            "title": "Fecho do gancho e revisão ativa",
            "articles": articles[:6],
            "brief": (
                "Voltem ao caso do início do episódio e RESOLVAM ele agora, com o "
                "fundamento completo — é o fechamento da lacuna aberta na abertura. "
                f"Depois façam a revisão final por RECALL: {HOST_A} faz cinco "
                f"perguntas diretas sobre '{topic}', uma por vez, cada uma seguida de "
                "uma frase curta de espera para o ouvinte responder de cabeça, e só "
                f"então {HOST_B} confirma em uma ou duas frases. Terminem com três "
                "frases-gatilho curtas, fáceis de repetir de memória no trânsito, que "
                "resumam o tópico inteiro, e uma despedida natural."
            ),
        },
    ]


async def _generate_block(
    topic: str,
    subject: str,
    block_index: int,
    block: dict,
    outline: str,
) -> list[dict]:
    """Gera as falas de um bloco. Devolve [] se o provedor falhar — o
    episódio ainda sai, só mais curto, em vez de quebrar inteiro."""
    from prf.services import llm_service

    material = _format_articles(block.get("articles") or [], block.get("full_text", False))

    prompt = f"""MATÉRIA: {subject}
TÓPICO DESTE EPISÓDIO: {topic}

ROTEIRO GERAL DO EPISÓDIO (para você saber o que NÃO abordar agora):
{outline}

VOCÊ ESTÁ ESCREVENDO APENAS O BLOCO {block_index + 1}: {block['title']}

O QUE ESTE BLOCO PRECISA FAZER:
{block['brief']}

BASE LEGAL DESTE BLOCO (texto oficial real):
{material[:14000]}

Escreva no mínimo {WORDS_PER_BLOCK} palavras de diálogo neste bloco, alternando
os dois apresentadores. Não repita o conteúdo dos outros blocos do roteiro geral.
Aplique as técnicas de retenção obrigatórias.

Responda em JSON:
{{"turns": [{{"speaker": "{HOST_A}", "text": "fala"}}, {{"speaker": "{HOST_B}", "text": "fala"}}]}}"""

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
            max_tokens=4000,
        )
    except Exception as e:
        logger.error(f"[PODCAST] Bloco {block_index} de '{topic}' falhou: {e}")
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


async def generate_episode(topic: str, subject: str, articles: list[dict]) -> dict:
    """Gera uma aula completa sobre um tópico. Os blocos vão em paralelo —
    em série a soma das chamadas estoura o tempo da função no serverless."""
    blocks = _block_briefs(topic, subject, articles)
    outline = "\n".join(
        f"{i + 1}. {b['title']}: {b['brief'][:120]}..." for i, b in enumerate(blocks)
    )

    results = await asyncio.gather(*[
        _generate_block(topic, subject, i, b, outline)
        for i, b in enumerate(blocks)
    ])

    turns: list[dict] = []
    for block_turns in results:
        turns.extend(block_turns)

    filled_blocks = sorted({t["block"] for t in turns})

    return {
        "topic": topic,
        "turns": turns,
        "blocks": filled_blocks,
        "segment_count": len(filled_blocks),
        "duration_secs": estimate_duration_secs(turns),
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


# ── Planejamento de partes ──────────────────────────────────────────────────

def plan_parts(articles: list[dict]) -> list[list[dict]]:
    """Fatia o material de uma unidade em partes de ~40 min de aula.

    A regra é nunca comprimir: se o material não cabe em oito blocos, ele
    vira Parte 1, Parte 2 e assim por diante, cada uma com o arco pedagógico
    completo sobre a sua fatia. Comprimir para caber foi o que produziu o
    "geralzão" da primeira versão.

    Os artigos chegam ordenados por incidência na prova, então o corte em
    MAX_PARTS não é arbitrário: as partes que sobrevivem são as do material
    mais cobrado, e o que fica de fora é a cauda longa — coberta pela lei
    seca e pelas questões, que o candidato faz lendo, não dirigindo.
    """
    if not articles:
        return []

    parts: list[list[dict]] = []
    current: list[dict] = []
    current_chars = 0

    for a in articles:
        size = len(a.get("official_text") or "")
        # Artigo gigante sozinho já fecha a parte: dividir o texto de um
        # mesmo dispositivo entre duas aulas quebraria a leitura comentada.
        if current and current_chars + size > CHARS_PER_PART:
            parts.append(current)
            current, current_chars = [], 0
            if len(parts) >= MAX_PARTS:
                return parts[:MAX_PARTS]
        current.append(a)
        current_chars += size

    if current:
        parts.append(current)
    return parts[:MAX_PARTS]


# ── Drill de recuperação (o áudio da volta) ─────────────────────────────────

DRILL_SYSTEM = f"""Você escreve roteiros de DRILL DE RECUPERAÇÃO em áudio para candidatos ao concurso da Polícia Militar de Goiás (banca Instituto AOCP).

ISTO NÃO É UMA AULA. O ouvinte já assistiu a aula completa sobre este conteúdo
algumas horas atrás, na ida para o trabalho. Agora ele está voltando para casa
e o objetivo é UM SÓ: fazer ele PUXAR DA MEMÓRIA o que aprendeu. Recuperar é o
que fixa — reexplicar não fixa quase nada, e é o erro que este roteiro não pode
cometer.

OS DOIS APRESENTADORES:

{HOST_A} — instrutor. É ele quem PERGUNTA. Dispara a pergunta, dá o tempo de
espera e cobra. Não explica.

{HOST_B} — professora. É ela quem CONFIRMA, em uma ou duas frases, depois que o
ouvinte já teve a chance de responder. Curta e direta.

A MECÂNICA OBRIGATÓRIA DE CADA ITEM, NESTA ORDEM:
1. {HOST_A} faz a pergunta, de forma fechada e específica.
2. Uma fala curta de espera, para o ouvinte responder em voz alta ou de cabeça
   ("pensa aí", "responde antes de eu falar", "isso, mais três segundos").
3. {HOST_B} dá a resposta em UMA ou DUAS frases. Só isso.
4. Só se a resposta tiver pegadinha, {HOST_A} acrescenta uma frase de alerta.

REGRAS DURAS:
- PROIBIDO reexplicar a matéria do zero. Nada de "vamos relembrar o conceito
  de..." seguido de parágrafo expositivo. Se você se pegar ensinando, você
  errou o formato.
- PROIBIDO resposta longa. A confirmação tem no máximo duas frases.
- Ritmo alto: muitos itens curtos, não poucos itens longos. Isto é um treino
  de repetições, e o número de tentativas de recuperação é o que importa.
- Varie o TIPO de pergunta: definição, completar a letra da lei, julgar
  assertiva certo/errado, decidir a conduta num caso curto, apontar a
  diferença entre dois institutos, dizer o prazo ou o requisito exato.
- É ÁUDIO, ouvido no trânsito: nada de "veja", "na tabela", "anote".
- Não escreva efeitos sonoros nem rubricas. Só o que deve ser falado.

Responda SEMPRE em JSON válido."""


def _drill_briefs(topic: str) -> list[dict]:
    """Os quatro blocos do drill, do recall mais fácil ao mais exigente."""
    return [
        {
            "title": "Aquecimento",
            "brief": (
                f"Comecem retomando o conteúdo de '{topic}' com perguntas diretas de "
                "definição e conceito — o que é, para que serve, quem se aplica. São "
                "as mais fáceis, para o ouvinte entrar no ritmo e ganhar confiança. "
                "No mínimo seis itens, cada um com pergunta, espera e confirmação "
                "curta. Nada de explicação longa."
            ),
        },
        {
            "title": "Complete a lei",
            "brief": (
                f"Agora a recuperação da letra da lei de '{topic}'. {HOST_A} começa a "
                "ler um dispositivo e PARA no meio, para o ouvinte completar de "
                f"cabeça; depois {HOST_B} completa e confirma. Cubram prazos, "
                "requisitos, hipóteses e as palavras exatas que mudam o sentido. No "
                "mínimo seis itens."
            ),
        },
        {
            "title": "Certo ou errado",
            "brief": (
                f"Rodada de assertivas no estilo do Instituto AOCP sobre '{topic}'. "
                f"{HOST_A} lê a assertiva inteira, manda o ouvinte decidir certo ou "
                f"errado, dá a espera, e {HOST_B} revela o gabarito e aponta em uma "
                "frase a palavra que decide. Misturem assertivas certas e erradas, e "
                "usem as trocas clássicas da banca. No mínimo oito assertivas."
            ),
        },
        {
            "title": "Decisão na rua e fechamento",
            "brief": (
                f"Casos curtos de ocorrência envolvendo '{topic}': {HOST_A} narra a "
                "situação em duas ou três frases e pergunta qual a conduta correta e "
                f"o fundamento; espera; {HOST_B} confirma em duas frases. No mínimo "
                "quatro casos. Fechem o drill com três frases-gatilho curtas que o "
                "ouvinte consiga repetir de memória e uma despedida rápida."
            ),
        },
    ]


async def _generate_drill_block(
    topic: str, subject: str, block_index: int, block: dict, material: str,
) -> list[dict]:
    from prf.services import llm_service

    prompt = f"""MATÉRIA: {subject}
CONTEÚDO JÁ ESTUDADO PELO OUVINTE: {topic}

VOCÊ ESTÁ ESCREVENDO O BLOCO {block_index + 1} DO DRILL: {block['title']}

O QUE ESTE BLOCO PRECISA FAZER:
{block['brief']}

BASE LEGAL (a mesma da aula que ele já ouviu — use para formular as perguntas,
NÃO para reexplicar):
{material[:9000]}

Escreva no mínimo {DRILL_WORDS_PER_BLOCK} palavras. Lembre: pergunta, espera,
confirmação curta. Se você começar a ensinar, você errou o formato.

Responda em JSON:
{{"turns": [{{"speaker": "{HOST_A}", "text": "fala"}}, {{"speaker": "{HOST_B}", "text": "fala"}}]}}"""

    try:
        data = await llm_service.chat_json(
            [
                {"role": "system", "content": DRILL_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
            max_tokens=4000,
        )
    except Exception as e:
        logger.error(f"[DRILL] Bloco {block_index} de '{topic}' falhou: {e}")
        return []

    turns = []
    for t in data.get("turns") or []:
        if not isinstance(t, dict):
            continue
        text = (t.get("text") or "").strip()
        if not text:
            continue
        speaker = (t.get("speaker") or "").strip().upper()
        speaker = HOST_B if speaker.startswith(HOST_B[:3]) else HOST_A
        turns.append({"speaker": speaker, "text": text, "block": block_index})
    return turns


async def generate_drill(topic: str, subject: str, articles: list[dict]) -> dict:
    """Gera o drill de recuperação da volta, sobre o material da aula da ida."""
    material = _format_articles(articles, full_text=False)
    blocks = _drill_briefs(topic)

    results = await asyncio.gather(*[
        _generate_drill_block(topic, subject, i, b, material)
        for i, b in enumerate(blocks)
    ])

    turns: list[dict] = []
    for block_turns in results:
        turns.extend(block_turns)

    filled = sorted({t["block"] for t in turns})
    return {
        "topic": topic,
        "turns": turns,
        "blocks": filled,
        "segment_count": len(filled),
        "duration_secs": estimate_duration_secs(turns),
        "word_count": sum(len(t["text"].split()) for t in turns),
    }
