#!/usr/bin/env python3
"""
Podcasts de estudo no formato "mergulho profundo": dois apresentadores
conversando, como o Audio Overview do NotebookLM, em episódios de ~40 min.

O roteiro por leitura de lei (gerar_audios.py) ensina a letra, mas soa como
leitura. O formato que o candidato pediu é outro: abre com um caso intrigante
sem resposta, explica com analogia do dia a dia, lê o trecho da lei que
importa, mostra a pegadinha da banca, faz o ouvinte pensar antes da resposta e
fecha resolvendo o caso. Isso exige escrita de verdade — aqui feita pelo
Gemini — e voz de diálogo, também do Gemini.

Cada episódio cobre os mesmos tópicos do episódio de trajeto de mesmo id (ver
prf/local/audio_manifest.json), então o índice tópico → episódio da missão
continua valendo.

Etapas por episódio, cada uma em cache para retomar:
1. roteiro-guia: caso de abertura, 8 blocos com o que cada um ensina;
2. cada bloco escrito como diálogo, com o fim do bloco anterior como contexto;
3. revisão de cada bloco contra o material: frase sem apoio no texto legal
   é corrigida ou cortada (material de estudo errado é pior que nenhum);
4. voz: um pedido por bloco, uma fala por parte com o nome de quem fala.

Uso:
    GEMINI_API_KEY=... python scripts/gerar_podcasts_ia.py <pasta> [episodio ...]

Publicar: copiar os .mp3 novos de <pasta> para a branch `audios` e
<pasta>/manifest.json para a branch `audios` (manifest.json) e para
prf/local/audio_manifest.json.

Cota: no plano gratuito da API cada modelo aceita só 20 pedidos de texto por
dia e a voz esgota em ~10 pedidos — dá ~1 episódio por dia. Um episódio usa
17 pedidos de texto e ~12 de voz; com faturamento ativo, os 52 saem numa tarde.

A chave só vem do ambiente; nunca vai para arquivo nem para o repositório.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import random
import re
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from prf.local.content import get_store  # noqa: E402
from prf.local.trajeto import _roman, article_order, document_name, speak as speak_law  # noqa: E402

API = "https://generativelanguage.googleapis.com/v1beta/models"
TEXT_MODEL = os.getenv("PODCAST_TEXT_MODEL", "gemini-3.8-flash")
# Sob alta demanda o modelo principal devolve 503 por minutos seguidos; os
# reservas escrevem quase igual e destravam o lote.
# Lote longo: sob pico de demanda vale esperar (até ~30 min por pedido) em
# vez de perder o episódio.
ATTEMPTS = int(os.getenv("PODCAST_ATTEMPTS", "30"))
THINKING_BUDGET = int(os.getenv("PODCAST_THINKING_BUDGET", "4096"))
TEXT_FALLBACKS = [m for m in os.getenv("PODCAST_TEXT_FALLBACKS", "gemini-3.6-flash,gemini-3.5-flash").split(",") if m]
TTS_MODEL = os.getenv("PODCAST_TTS_MODEL", "gemini-3.8-flash-tts")
# Mesmas vozes (Algieba/Sulafat) e mesmo formato de falas por locutor.
TTS_FALLBACKS = [m for m in os.getenv("PODCAST_TTS_FALLBACKS", "gemini-3.8-flash-lite-tts").split(",") if m]
HOSTS = {"Marcos": "Algieba", "Julia": "Sulafat"}
SEGMENTS = 8
WORDS_PER_SEGMENT = 720
SAMPLE_RATE = 24000
MP3_KBPS = 48
QUESTIONS_PER_TOPIC = 12
TEXT_CONCURRENCY = int(os.getenv("TEXT_CONCURRENCY", "6"))
TTS_CONCURRENCY = int(os.getenv("TTS_CONCURRENCY", "2"))
EPISODE_CONCURRENCY = int(os.getenv("EPISODE_CONCURRENCY", "4"))

STYLE = """Você escreve roteiros de um podcast de estudo para o concurso de Soldado da Polícia Militar de Goiás (PMGO, banca Instituto AOCP). Formato "mergulho profundo": dois apresentadores, Marcos e Julia, conversando de verdade — como amigos inteligentes que estudaram o assunto a fundo e explicam para quem ouve no carro, indo para o serviço.

Como a conversa soa:
- Natural e brasileira: frases faladas, curtas, com reações ("Nossa.", "Tá, manda.", "Exato.", "Peraí, deixa eu ver se entendi..."), interrupções, um completando o outro. Nada de texto lido, nada de lista falada, nada de "neste episódio vamos abordar".
- Os dois sabem do assunto; alternam quem explica e quem pergunta. Um faz a pergunta que o ouvinte faria, inclusive a dúvida errada típica, e o outro corrige.
- Analogias do dia a dia — de preferência da rotina de um policial militar em Goiás, de trânsito, de condomínio, de família — para tornar concreto o que é abstrato.
- Quando o ponto depende da letra da lei, um dos dois lê o trecho exato (curto) e o outro traduz.
- Mostram a pegadinha: a palavra que a banca troca para tornar a afirmação errada ("pode" por "deve", prazo trocado, "e" por "ou").
- De vez em quando, desafiam o ouvinte: "pausa aí e pensa: ..." — e só depois respondem.
- Em português do Brasil. Números e artigos escritos por extenso quando lidos ("artigo quinto", "dois anos").

Regra inegociável de conteúdo: tudo que for afirmado sobre a lei, prazos, penas, competências, requisitos e números vem do MATERIAL fornecido. Não invente número de súmula, julgado, artigo, prazo ou pena que não esteja no material. Se o material não diz, não afirme; fale do raciocínio, não do dado. Analogias e casos hipotéticos podem ser inventados — informação jurídica, não."""


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def tts_text(text: str) -> str:
    """Como se lê em voz alta: "§ 3º" vira "parágrafo terceiro" e o inciso
    no meio da frase ("; II - de") vira "inciso dois,". Além da pronúncia, a
    voz recusa (finishReason OTHER) listas de lei copiadas no formato original."""
    t = re.sub(r"(^|[;:.\"“]\s*)([IVXL]{1,6})\s*[-–—]\s*",
               lambda m: f"{m.group(1)}inciso {_roman(m.group(2))}, ", text)
    return speak_law(t)


class QuotaExhausted(RuntimeError):
    pass


class NoAudio(RuntimeError):
    pass


class Gemini:
    def __init__(self, key: str):
        verify = os.getenv("SSL_CERT_FILE") or True
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0), verify=verify)
        self.headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
        self.text_sem = asyncio.Semaphore(TEXT_CONCURRENCY)
        self.tts_sem = asyncio.Semaphore(TTS_CONCURRENCY)
        self.exhausted: set[str] = set()

    async def _post(self, model: str | list[str], body: dict, sem: asyncio.Semaphore) -> dict:
        error = None
        models = [model] if isinstance(model, str) else model
        for attempt in range(ATTEMPTS):
            live = [m for m in models if m not in self.exhausted]
            if not live:
                raise QuotaExhausted(f"cota diária esgotada em {', '.join(models)}")
            model = live[attempt % len(live)]
            async with sem:
                try:
                    r = await self.client.post(f"{API}/{model}:generateContent", headers=self.headers, json=body)
                    if r.status_code == 200:
                        return r.json()
                    error = f"HTTP {r.status_code}: {r.text[:300]}"
                    # Cota por dia acabou: esperar não adianta (só volta no dia
                    # seguinte). Tira o modelo da rotação.
                    if r.status_code == 429 and "PerDay" in r.text:
                        self.exhausted.add(model)
                        log(f"  {model}: cota diária esgotada")
                        continue
                    if r.status_code in (400, 401, 403, 404):
                        raise RuntimeError(error)
                except httpx.HTTPError as e:
                    error = f"{type(e).__name__}: {e}"
            log(f"  {model}: {error[:80]} (tentativa {attempt + 1})")
            await asyncio.sleep(min(90, 3 * 2 ** (attempt // len(models))) + random.random() * 5)
        raise RuntimeError(f"{model}: falhou após {ATTEMPTS} tentativas: {error}")

    async def json(self, prompt: str, schema: dict, temperature: float = 0.9) -> dict:
        body = {
            "systemInstruction": {"parts": [{"text": STYLE}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json",
                                 "responseSchema": schema, "maxOutputTokens": 16384,
                                 # Raciocínio sem teto deixa a resposta passar de 5 min e a
                                 # conexão cai antes de ela chegar.
                                 "thinkingConfig": {"thinkingBudget": THINKING_BUDGET}},
        }
        for attempt in range(5):
            data = await self._post([TEXT_MODEL, *TEXT_FALLBACKS], body, self.text_sem)
            cand = (data.get("candidates") or [{}])[0]
            try:
                text = "".join(p.get("text", "") for p in cand["content"]["parts"])
                return json.loads(text)
            except (KeyError, IndexError, json.JSONDecodeError) as e:
                reason = cand.get("finishReason", "?")
                log(f"  resposta inválida ({type(e).__name__}, {reason}), tentando de novo")
                # Raciocínio longo come o limite de saída e corta o JSON no
                # meio: na próxima tentativa, raciocínio curto.
                body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 1024}
        raise RuntimeError("modelo de texto não devolveu JSON válido")

    async def speak(self, turns: list[dict]) -> bytes:
        """PCM 16 bits mono 24 kHz de uma lista de falas."""
        body = {
            "contents": [{"parts": [{"text": tts_text(t["text"]), "speechMetadata": {"speaker": t["speaker"]}} for t in turns]}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"multiSpeakerVoiceConfig": {
                "speakerVoiceConfigs": [{"speaker": s, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": v}}}
                                        for s, v in HOSTS.items()]}}},
        }
        for attempt in range(2):
            data = await self._post([TTS_MODEL, *TTS_FALLBACKS], body, self.tts_sem)
            cand = (data.get("candidates") or [{}])[0]
            try:
                part = cand["content"]["parts"][0]["inlineData"]
                break
            except (KeyError, IndexError):
                # A voz às vezes volta sem áudio (finishReason OTHER): pede de novo.
                log(f"  voz sem áudio ({cand.get('finishReason', '?')}), tentando de novo")
        else:
            raise NoAudio("modelo de voz não devolveu áudio")
        raw = base64.b64decode(part["data"])
        if raw[:4] == b"RIFF":
            with wave.open(io.BytesIO(raw)) as w:
                if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
                    raise RuntimeError(f"formato inesperado: {w.getframerate()} Hz, {w.getnchannels()} canais")
                return w.readframes(w.getnframes())
        return raw


TURNS_SCHEMA = {
    "type": "OBJECT",
    "properties": {"turns": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "speaker": {"type": "STRING", "enum": ["Marcos", "Julia"]},
        "text": {"type": "STRING"}}, "required": ["speaker", "text"]}}},
    "required": ["turns"],
}

OUTLINE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "cold_open": {"type": "STRING"},
        "resolution": {"type": "STRING"},
        "segments": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "topic_id": {"type": "STRING"},
            "title": {"type": "STRING"},
            "teaches": {"type": "ARRAY", "items": {"type": "STRING"}},
            "law_quotes": {"type": "ARRAY", "items": {"type": "STRING"}},
            "analogy": {"type": "STRING"},
            "trap": {"type": "STRING"},
            "challenge": {"type": "STRING"},
        }, "required": ["topic_id", "title", "teaches", "law_quotes", "analogy", "trap", "challenge"]}},
    },
    "required": ["cold_open", "resolution", "segments"],
}

REVIEW_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "problems": {"type": "ARRAY", "items": {"type": "STRING"}},
        "turns": TURNS_SCHEMA["properties"]["turns"],
    },
    "required": ["problems", "turns"],
}


def material_text(store, topic: dict) -> str:
    """Toda a lei e as questões do tópico, em texto para o modelo."""
    tid = str(topic["id"])
    lines = [f"### TÓPICO {topic['name']} (topic_id={tid})"]
    articles = sorted(store.get_articles(topic_id_=tid, limit=100000), key=article_order)
    for a in articles:
        lines.append(f"[{a.get('article_number', '')} — {document_name(a.get('document_name'))}]")
        lines.append((a.get("official_text") or "").strip())
        if a.get("simple_text"):
            lines.append(f"Em resumo: {a['simple_text'].strip()}")
        if a.get("highlights"):
            lines.append("Palavras-chave cobradas: " + ", ".join(a["highlights"]))
    questions = store.get_questions(topic_id_=tid, limit=QUESTIONS_PER_TOPIC)
    if questions:
        lines.append("Questões de prova deste tópico (enunciado → gabarito, explicação):")
    for q in questions:
        alts = q.get("alternatives") or []
        correct = next((a for a in alts if a.get("is_correct")), None)
        answer = f"{correct.get('letter')}) {correct.get('text')}" if correct else "?"
        lines.append(f"- {(q.get('text') or '').strip()} → {answer}. {(q.get('explanation') or '').strip()}")
    return "\n".join(lines)


def words(turns: list[dict]) -> int:
    return sum(len(t["text"].split()) for t in turns)


def clean_turns(turns: list[dict]) -> list[dict]:
    out = []
    for t in turns:
        text = re.sub(r"\s+", " ", (t.get("text") or "")).strip()
        text = re.sub(r"[*_#`]+", "", text)
        if text and t.get("speaker") in HOSTS:
            out.append({"speaker": t["speaker"], "text": text})
    return out


TTS_MAX_WORDS = int(os.getenv("PODCAST_TTS_MAX_WORDS", "1200"))


def chunks_for_tts(turns: list[dict], max_words: int = TTS_MAX_WORDS) -> list[list[dict]]:
    """Pedidos de voz de até ~7,5 min: o modelo devolve no máximo ~10 min e
    perde fôlego no fim de pedidos longos. Na cota gratuita a voz é o
    gargalo, então um bloco inteiro cabe num pedido só (~8 por episódio)."""
    out, cur, n = [], [], 0
    for t in turns:
        w = len(t["text"].split())
        if cur and n + w > max_words:
            out.append(cur)
            cur, n = [], 0
        cur.append(t)
        n += w
    if cur:
        out.append(cur)
    return out


def pcm_secs(pcm: bytes) -> float:
    return len(pcm) / 2 / SAMPLE_RATE


def silence(secs: float) -> bytes:
    return b"\x00\x00" * int(SAMPLE_RATE * secs)


CACHE_KBPS = 96


def from_mp3(data: bytes) -> bytes:
    import miniaudio

    out = miniaudio.decode(bytes(data), output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=SAMPLE_RATE)
    return out.samples.tobytes()


def to_mp3(pcm: bytes, kbps: int = MP3_KBPS) -> bytes:
    import lameenc

    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm) + enc.flush()


async def write_episode(g: Gemini, store, ep: dict, work: Path) -> dict:
    work.mkdir(parents=True, exist_ok=True)
    topics = []
    for c in ep["chapters"]:
        t = store.get_topic(c["topic_id"])
        if t and all(str(x["id"]) != str(t["id"]) for x in topics):
            topics.append(t)
    material = "\n\n".join(material_text(store, t) for t in topics)
    topic_list = "\n".join(f"- {t['name']} (topic_id={t['id']})" for t in topics)
    continuation = " (este episódio continua tópicos começados no episódio anterior)" if any(
        "continuação" in c["title"] for c in ep["chapters"]) else ""

    outline_path = work / "outline.json"
    if outline_path.exists():
        outline = json.loads(outline_path.read_text())
    else:
        outline = await g.json(f"""Planeje um episódio de ~40 minutos: {ep['subject_name']}, episódio {ep['number']}{continuation}.
Tópicos do episódio, nesta ordem:
{topic_list}

Monte o roteiro-guia em exatamente {SEGMENTS} blocos de ~5 minutos, cobrindo os tópicos na ordem, distribuídos pelo peso do material (tópico com mais lei e mais questões ganha mais blocos). Para cada bloco: o topic_id do tópico que ele ensina; o que ele ensina (3 a 5 pontos concretos, tirados do material); 1 a 3 trechos curtos da lei para ler literalmente (copiados do material, sem alterar); uma analogia do dia a dia; a pegadinha de prova (a palavra que a banca troca); um desafio "pausa e pensa" com a resposta.
cold_open: um caso hipotético curto e intrigante, de rua, que só se resolve com o conteúdo do episódio — conte o caso, não a resposta. resolution: a resposta a cada pergunta do caso, uma por uma (sim/não e por quê), com o artigo do material que a fundamenta. O caso só pode perguntar o que o material responde.

MATERIAL:
{material}""", OUTLINE_SCHEMA, temperature=0.8)
        outline["segments"] = outline["segments"][:SEGMENTS]
        outline_path.write_text(json.dumps(outline, ensure_ascii=False, indent=1))

    segs = outline["segments"]
    previous_tail: list[dict] = []
    all_turns: list[list[dict]] = []
    for i, seg in enumerate(segs):
        seg_path = work / f"seg_{i}.json"
        if seg_path.exists():
            turns = json.loads(seg_path.read_text())["turns"]
        else:
            first, last = i == 0, i == len(segs) - 1
            topic = next((t for t in topics if str(t["id"]) == seg["topic_id"]), topics[min(i, len(topics) - 1)])
            role = []
            if first:
                role.append(f"É o COMEÇO do episódio: abra direto com o caso, sem saudação longa — um dos dois conta: {outline['cold_open']}. Deixe a resposta em aberto, avise que ela vem no fim, e diga em uma frase o que o ouvinte vai dominar hoje ({ep['subject_name']}).")
            else:
                role.append("Continue a conversa de onde parou, sem nova saudação e sem resumir o que já foi dito.")
            if last:
                role.append(f"É o FIM do episódio: depois do conteúdo do bloco, voltem ao caso do começo ({outline['cold_open']}) e respondam com todas as letras cada pergunta dele, uma por uma, NA MESMA ORDEM do caso. As respostas são exatamente estas — não troque, não acrescente e não invente outra pergunta: {outline['resolution']}. Façam uma revisão relâmpago com 3 perguntas rápidas ao ouvinte (pergunta, pausa curta, resposta) e se despeçam de forma natural, curta.")
            tail = "\n".join(f"{t['speaker']}: {t['text']}" for t in previous_tail[-8:])
            draft = await g.json(f"""Escreva o bloco {i + 1} de {len(segs)} do episódio "{ep['subject_name']}, episódio {ep['number']}" como diálogo entre Marcos e Julia, com cerca de {WORDS_PER_SEGMENT} palavras (entre {WORDS_PER_SEGMENT - 80} e {WORDS_PER_SEGMENT + 120}).
{' '.join(role)}

O bloco ensina — tópico "{topic['name']}":
- Pontos: {json.dumps(seg['teaches'], ensure_ascii=False)}
- Trechos da lei para ler literalmente: {json.dumps(seg['law_quotes'], ensure_ascii=False)}
- Analogia: {seg['analogy']}
- Pegadinha da banca: {seg['trap']}
- Desafio "pausa e pensa": {seg['challenge']}

Final da conversa até aqui (continue a partir daqui, sem repetir):
{tail or '(início do episódio)'}

MATERIAL do tópico (fonte única para informação jurídica):
{material_text(store, topic)}""", TURNS_SCHEMA, temperature=0.95)
            draft_turns = clean_turns(draft.get("turns", []))
            closing_check = "" if not last else f"""

FECHAMENTO: este é o fim do episódio. O caso do começo foi: {outline['cold_open']}
As respostas certas, na ordem: {outline['resolution']}
Se o trecho responder alguma pergunta diferente da do caso, fora de ordem ou com outra resposta, liste em "problems" e corrija as falas."""
            review = await g.json(f"""Revise este trecho de podcast de estudo contra o MATERIAL. Liste em "problems" cada afirmação jurídica que não tem apoio no material ou o contradiz (artigo, prazo, pena, número, requisito, competência, súmula ou julgado inventado), e devolva em "turns" o diálogo corrigido: conserte ou corte só o que estiver errado, mantenha todo o resto (estilo, tamanho, falas e ordem). Se nada estiver errado, "problems" vazio e o diálogo igual.

TRECHO:
{json.dumps(draft_turns, ensure_ascii=False)}

MATERIAL:
{material_text(store, topic)}{closing_check}""", REVIEW_SCHEMA, temperature=0.2)
            turns = clean_turns(review.get("turns", [])) or draft_turns
            if words(turns) < words(draft_turns) * 0.7:
                turns = draft_turns
            seg_path.write_text(json.dumps({"topic_id": seg["topic_id"], "turns": turns,
                                            "problems": review.get("problems", [])}, ensure_ascii=False, indent=1))
        previous_tail = turns
        all_turns.append(turns)
    return {"outline": outline, "segments": all_turns}


async def voice_episode(g: Gemini, ep: dict, script: dict, work: Path) -> tuple[bytes, list[float], list[str]]:
    """A escrita é em sequência (cada bloco continua o anterior); a voz não
    precisa ser: todos os pedidos saem em paralelo, limitados pelo semáforo, e
    o áudio é montado na ordem. Em sequência era ~1 h por episódio."""

    async def speak_checked(chunk: list[dict], label: str) -> bytes:
        expected = words(chunk) / 160 * 60
        try:
            piece = b""
            for attempt in range(3):
                piece = await g.speak(chunk)
                # Voz que corta o fim do texto devolve áudio curto demais.
                if pcm_secs(piece) >= expected * 0.6:
                    break
                log(f"  {ep['id']} bloco {label}: áudio curto ({pcm_secs(piece):.0f}s de ~{expected:.0f}s), refazendo")
            return piece
        except NoAudio:
            # Alguns trechos voltam sempre sem áudio inteiros e passam em
            # partes menores.
            if len(chunk) < 2:
                raise
            half = len(chunk) // 2
            log(f"  {ep['id']} bloco {label}: sem áudio, dividindo em duas partes")
            return (await speak_checked(chunk[:half], label + "a")) + silence(0.35) + \
                (await speak_checked(chunk[half:], label + "b"))

    async def voice_chunk(i: int, j: int, chunk: list[dict]) -> bytes:
        # Guardado em MP3 (96 kbps): cabe na branch `audios`, então um
        # reinício do ambiente não joga fora a cota de voz já gasta.
        legacy, path = work / f"seg_{i}_{j}.pcm", work / f"seg_{i}_{j}.mp3"
        if legacy.exists():
            path.write_bytes(to_mp3(legacy.read_bytes(), CACHE_KBPS))
            legacy.unlink()
        if path.exists():
            return from_mp3(path.read_bytes())
        piece = await speak_checked(chunk, f"{i}.{j}")
        path.write_bytes(to_mp3(piece, CACHE_KBPS))
        return from_mp3(path.read_bytes())

    plan = [(i, j, chunk) for i, turns in enumerate(script["segments"])
            for j, chunk in enumerate(chunks_for_tts(turns))]
    pieces = await asyncio.gather(*[voice_chunk(i, j, c) for i, j, c in plan])

    pcm_parts: list[bytes] = []
    seg_bounds: list[float] = []
    seg_topics: list[str] = []
    elapsed = 0.0
    for i in range(len(script["segments"])):
        seg_pcm = b"".join(p + silence(0.35) for (si, _, _), p in zip(plan, pieces) if si == i)
        pcm_parts.append(seg_pcm + silence(0.6))
        elapsed += pcm_secs(seg_pcm) + 0.6
        seg_bounds.append(round(elapsed, 2))
        seg_topics.append(json.loads((work / f"seg_{i}.json").read_text())["topic_id"])
    return b"".join(pcm_parts), seg_bounds, seg_topics


def chapters_from(ep: dict, store, seg_bounds: list[float], seg_topics: list[str]) -> list[dict]:
    """Capítulo = tópico. Começa no primeiro bloco que ensina o tópico."""
    titles = {c["topic_id"]: c["title"] for c in ep["chapters"]}
    chapters: list[dict] = []
    start = 0.0
    for end, tid in zip(seg_bounds, seg_topics):
        if not chapters or chapters[-1]["topic_id"] != tid:
            topic = store.get_topic(tid)
            title = titles.get(tid) or (topic["name"] if topic else "Tópico")
            chapters.append({"topic_id": tid, "title": title, "start": round(start, 2)})
        start = end
    if chapters:
        chapters[0]["start"] = 0.0
    return chapters


async def produce(g: Gemini, store, ep: dict, out: Path) -> dict | None:
    work = out / ".trabalho" / ep["id"]
    done_path = work / "done.json"
    if done_path.exists():
        return json.loads(done_path.read_text())
    t0 = time.monotonic()
    try:
        script = await write_episode(g, store, ep, work)
        log(f"{ep['id']}: roteiro pronto, {sum(words(s) for s in script['segments'])} palavras")
        pcm, seg_bounds, seg_topics = await voice_episode(g, ep, script, work)
    except Exception as e:
        log(f"{ep['id']}: FALHOU — {e}")
        return None
    mp3 = to_mp3(pcm)
    digest = hashlib.sha1(mp3).hexdigest()[:10]
    name = f"{ep['id']}-ia-{digest}.mp3"
    (out / name).write_bytes(mp3)
    chapters = chapters_from(ep, store, seg_bounds, seg_topics)
    boundaries = [c["start"] for c in chapters[1:]] + [round(pcm_secs(pcm), 2)]
    result = {
        "id": ep["id"], "subject_slug": ep["subject_slug"], "subject_name": ep["subject_name"],
        "number": ep["number"], "title": ep["title"], "file": name, "bytes": len(mp3),
        "duration_secs": round(pcm_secs(pcm)), "chapters": chapters, "boundaries": boundaries,
        "segment_count": len(chapters), "format": "conversa",
        "problems_fixed": sum(len(json.loads((work / f"seg_{i}.json").read_text()).get("problems", []))
                              for i in range(len(script["segments"]))),
    }
    done_path.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    # As vozes por bloco (MP3) ficam: corrigir um bloco depois de pronto
    # regrava só ele. Quem publica apaga a pasta.
    for piece in work.glob("seg_*.pcm"):
        piece.unlink()
    log(f"{ep['id']}: PRONTO {result['duration_secs'] / 60:.1f} min, {len(mp3) / 1e6:.1f} MB, "
        f"{result['problems_fixed']} correções da revisão, {(time.monotonic() - t0) / 60:.1f} min")
    return result


async def main(out: Path, only: list[str]) -> int:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY ausente")
    out.mkdir(parents=True, exist_ok=True)
    store = get_store()
    base = json.loads((Path(__file__).resolve().parent.parent / "prf/local/audio_manifest.json").read_text())
    # Na ordem pedida: quem já tem roteiro (só falta voz) vai primeiro.
    by_id = {e["id"]: e for e in base["episodes"]}
    episodes = [by_id[i] for i in only if i in by_id] if only else base["episodes"]
    g = Gemini(key)
    sem = asyncio.Semaphore(EPISODE_CONCURRENCY)

    async def one(ep):
        async with sem:
            return await produce(g, store, ep, out)

    results = await asyncio.gather(*[one(e) for e in episodes])
    ok = [r for r in results if r]
    log(f"concluídos {len(ok)}/{len(episodes)}")
    # Manifesto completo: episódio em conversa onde já existe, o de trajeto
    # (leitura) onde ainda não. Pode ser publicado aos poucos, conforme a
    # cota da API permite gerar.
    ready = {e["id"]: e for e in (json.loads(p.read_text()) for p in (out / ".trabalho").glob("*/done.json"))}
    merged = [ready.get(e["id"], e) for e in base["episodes"]]
    topics: dict[str, dict] = {}
    for e in merged:
        for c in e["chapters"]:
            topics.setdefault(c["topic_id"], {"episode": e["id"], "start": c["start"]})
    manifest = {**base, "version": 2, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "episodes": merged, "topics": topics}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    log(f"manifesto: {len(ready)} de {len(merged)} episódios em conversa")
    return 0 if len(ok) == len(episodes) else 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(Path(sys.argv[1]), sys.argv[2:])))
