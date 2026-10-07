#!/usr/bin/env python3
"""
Gera os episódios de trajeto (~40 min) de todas as matérias da PMGO e o
manifesto que o app usa para tocar sem gerar nada no celular.

Cada matéria vira uma sequência de episódios de ~40 min — um para a ida, um
para a volta. Os tópicos entram inteiros (toda a lei do tópico e todas as
questões comentadas, ver prf/local/trajeto.py) e o corte entre episódios é
decidido pela duração real do áudio, nunca no meio de um artigo ou de uma
questão.

Uso:
    python scripts/gerar_audios.py <pasta_saida>

Retoma de onde parou: cada trecho sintetizado fica em <pasta>/.unidades com
o hash do texto e da voz, e não é sintetizado de novo. O nome de cada
episódio leva o hash do conteúdo, então mudança de conteúdo gera arquivo novo
e o celular não toca áudio velho do cache.

Dependências só da geração: edge-tts (vozes), lameenc (silêncio das pausas),
miniaudio (conferência: cada episódio é decodificado inteiro antes de entrar
no manifesto).

EDGE_TTS_CA_BUNDLE: CA extra para ambientes com proxy TLS (o edge-tts fixa o
bundle do certifi ao ser importado).
"""
from __future__ import annotations

import array
import asyncio
import hashlib
import json
import math
import os
import sys
import time
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if os.getenv("EDGE_TTS_CA_BUNDLE"):
    import certifi

    _bundle = os.environ["EDGE_TTS_CA_BUNDLE"]
    certifi.where = lambda: _bundle

from prf.local.content import get_store  # noqa: E402
from prf.local.podcast_local import _for_podcast  # noqa: E402
from prf.local.trajeto import (  # noqa: E402
    Unit,
    continuation_intro,
    episode_intro,
    episode_outro,
    topic_units,
)
from prf.services import podcast_service  # noqa: E402
from prf.services.podcast_service import HOST_A, HOST_B  # noqa: E402

# Thalita é a voz pt-BR mais nova e natural do serviço; conduz a aula. O
# Antônio é a única voz masculina pt-BR e fica com as deixas e as questões.
VOICES = {HOST_B: "pt-BR-ThalitaMultilingualNeural", HOST_A: "pt-BR-AntonioNeural"}
# Lei se lê mais devagar que conversa: é leitura literal, palavra por palavra.
RATES = {
    (HOST_B, "lei"): "-10%",
    (HOST_B, "fala"): "-4%",
    (HOST_A, "lei"): "-6%",
    (HOST_A, "fala"): "-2%",
}
TARGET_SECS = 40 * 60
# Um corte até 4 min mais longe do ponto ideal vale a pena se cair na troca
# de tópico: o episódio começa e termina em assunto inteiro.
TOPIC_CUT_BONUS_SECS = 4 * 60
CUT_WINDOW_SECS = 8 * 60
CONCURRENCY = int(os.getenv("TTS_CONCURRENCY", "8"))
# Para testar com uma matéria só: MATERIAS=direito-penal,lingua-portuguesa
ONLY = {s for s in os.getenv("MATERIAS", "").split(",") if s}
ATTEMPTS = 6
SAMPLE_RATE = 24000  # o edge-tts entrega MP3 24 kHz, 48 kbps, mono

_MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
_MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
_MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_duration(data: bytes) -> float:
    """Duração somando os quadros MPEG Layer III — estimar por palavra errava
    em ~30% e o "pular parte" do player caía no meio da fala errada."""
    i, secs, n = 0, 0.0, len(data)
    while i + 4 <= n:
        b1, b2 = data[i + 1], data[i + 2]
        if data[i] != 0xFF or (b1 & 0xE0) != 0xE0:
            i += 1
            continue
        version, layer = (b1 >> 3) & 3, (b1 >> 1) & 3
        bitrate_idx, rate_idx, padding = (b2 >> 4) & 0xF, (b2 >> 2) & 3, (b2 >> 1) & 1
        if version == 1 or layer != 1 or bitrate_idx in (0, 15) or rate_idx == 3:
            i += 1
            continue
        rate = _MP3_RATES[version][rate_idx]
        if version == 3:
            bitrate, samples, coef = _MP3_BITRATES_V1[bitrate_idx], 1152, 144
        else:
            bitrate, samples, coef = _MP3_BITRATES_V2[bitrate_idx], 576, 72
        secs += samples / rate
        i += coef * bitrate * 1000 // rate + padding
    return secs


@lru_cache(maxsize=None)
def silence(secs: float) -> bytes:
    """Silêncio real no mesmo formato do edge-tts. O serviço gratuito não
    aceita <break> no SSML, e sem pausa o gabarito vinha colado na pergunta —
    o ouvinte não tinha tempo de decidir."""
    import lameenc

    if secs <= 0:
        return b""
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = array.array("h", [0] * int(SAMPLE_RATE * secs)).tobytes()
    return enc.encode(pcm) + enc.flush()


async def synth(text: str, voice: str, rate: str, sem: asyncio.Semaphore) -> bytes:
    import edge_tts

    error: object = None
    for attempt in range(ATTEMPTS):
        async with sem:
            try:
                buf = bytearray()
                async for msg in edge_tts.Communicate(text, voice, rate=rate).stream():
                    if msg["type"] == "audio":
                        buf += msg["data"]
                if buf:
                    return bytes(buf)
                error = "áudio vazio"
            except Exception as e:  # rede, throttling do serviço
                error = e
        await asyncio.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"TTS falhou após {ATTEMPTS} tentativas: {error}")


def unit_key(unit: Unit) -> str:
    payload = json.dumps({"turns": unit.turns, "voices": VOICES, "rates": sorted(RATES.items())},
                         ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(payload.encode()).hexdigest()[:16]


async def render_unit(unit: Unit, cache: Path, sem: asyncio.Semaphore) -> bytes:
    path = cache / f"{unit_key(unit)}.mp3"
    if path.exists():
        return path.read_bytes()
    audios = await asyncio.gather(*[
        synth(text, VOICES[speaker], RATES[(speaker, style)], sem)
        for speaker, text, style, _pause in unit.turns
    ])
    audio = b"".join(a + silence(turn[3]) for a, turn in zip(audios, unit.turns))
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(audio)
    tmp.replace(path)
    return audio


def material(store, topic: dict) -> tuple[list[dict], list[dict]]:
    """Toda a lei do tópico que cabe nas partes do plano (as de maior
    incidência, até 4 partes de ~7 mil caracteres) e todas as questões."""
    tid = str(topic["id"])
    articles = store.get_articles(topic_id_=tid, limit=100000)
    chosen: set[str] = set()
    if articles:
        for part in podcast_service.plan_parts([_for_podcast(a) for a in articles]):
            chosen.update(a["id"] for a in part)
    return ([a for a in articles if str(a["id"]) in chosen],
            store.get_questions(topic_id_=tid, limit=1000))


def partition(items: list[dict]) -> list[list[dict]]:
    """Divide a matéria em episódios de duração parecida, em ordem.

    Cortar tópico grande primeiro e agrupar depois deixava sobras de 5 a 13
    min virando episódio sozinho, e juntava partes até passar de 49 min.
    Aqui o número de episódios sai da duração total (nenhum acima de ~45
    min) e cada corte cai perto do ponto ideal, de preferência na troca de
    tópico — nunca no meio de um artigo ou de uma questão.
    """
    total = sum(i["secs"] for i in items)
    count = max(1, math.ceil(total / (TARGET_SECS * 1.12)))
    if count == 1:
        return [items]
    elapsed_before = [0.0]
    for item in items:
        elapsed_before.append(elapsed_before[-1] + item["secs"])

    cuts: list[int] = []
    last = 0
    for k in range(1, count):
        ideal = total * k / count
        best = None
        for i in range(last + 1, len(items) - (count - k) + 1):
            distance = abs(elapsed_before[i] - ideal)
            if distance > CUT_WINDOW_SECS and best is not None:
                continue
            score = distance - (TOPIC_CUT_BONUS_SECS if items[i]["starts_topic"] else 0)
            if best is None or score < best[0]:
                best = (score, i)
        cuts.append(best[1])
        last = best[1]
    bounds = [0, *cuts, len(items)]
    return [items[a:b] for a, b in zip(bounds, bounds[1:])]


async def main(out_dir: Path) -> int:
    import miniaudio

    out_dir.mkdir(parents=True, exist_ok=True)
    cache = out_dir / ".unidades"
    cache.mkdir(exist_ok=True)
    store = get_store()
    sem = asyncio.Semaphore(CONCURRENCY)
    started = time.monotonic()

    subjects = []
    for subject in store.get_subjects():
        if not subject.get("weight_pm"):
            continue
        if ONLY and subject["slug"] not in ONLY:
            continue
        topics = []
        for topic in store.get_topics(subject["slug"]):
            articles, questions = material(store, topic)
            units = topic_units(topic, subject["name"], articles, questions)
            if units:
                topics.append((topic, units))
        if topics:
            subjects.append((subject, topics))

    all_units = [u for _, topics in subjects for _, units in topics for u in units]
    print(f"{len(subjects)} matérias, {sum(len(t) for _, t in subjects)} tópicos, "
          f"{len(all_units)} trechos, {sum(len(u.turns) for u in all_units)} falas", flush=True)

    done = 0

    async def timed(unit: Unit) -> float:
        nonlocal done
        audio = await render_unit(unit, cache, sem)
        done += 1
        if done % 200 == 0:
            print(f"  {done}/{len(all_units)} trechos | {(time.monotonic() - started) / 60:.1f} min", flush=True)
        return mp3_duration(audio)

    durations = await asyncio.gather(*[timed(u) for u in all_units])
    secs_of = {id(u): d for u, d in zip(all_units, durations)}

    episodes_out = []
    topic_index: dict[str, dict] = {}
    for subject, topics in subjects:
        items = [
            {"topic": topic, "unit": unit, "secs": secs_of[id(unit)], "starts_topic": i == 0}
            for topic, units in topics
            for i, unit in enumerate(units)
        ]
        grouped = partition(items)
        for number, group in enumerate(grouped, start=1):
            titles = []
            for item in group:
                if item["topic"]["name"] not in titles:
                    titles.append(item["topic"]["name"])
            following = None
            if number < len(grouped):
                nxt = grouped[number][0]
                following = nxt["topic"]["name"] + ("" if nxt["starts_topic"] else ", continuação")

            sequence: list[tuple[str, Unit, dict | None]] = [("intro", episode_intro(subject["name"], number, titles), None)]
            if not group[0]["starts_topic"]:
                sequence.append(("piece", continuation_intro(group[0]["topic"]["name"]),
                                 {"topic": group[0]["topic"], "cont": True}))
            for item in group:
                chapter = {"topic": item["topic"], "cont": False} if item["starts_topic"] else None
                sequence.append(("piece", item["unit"], chapter))
            sequence.append(("outro", episode_outro(subject["name"], number, following), None))

            chunks: list[bytes] = []
            chapters: list[dict] = []
            elapsed = 0.0
            for kind, unit, starts in sequence:
                audio = await render_unit(unit, cache, sem)
                if starts is not None:
                    title = starts["topic"]["name"] + (" (continuação)" if starts["cont"] else "")
                    chapters.append({"topic_id": str(starts["topic"]["id"]), "title": title,
                                     "start": round(elapsed if chapters else 0.0, 2)})
                chunks.append(audio)
                elapsed += mp3_duration(audio)

            data = b"".join(chunks)
            boundaries = [c["start"] for c in chapters[1:]] + [round(elapsed, 2)]
            digest = hashlib.sha1(json.dumps([unit_key(u) for _, u, _ in sequence]).encode()).hexdigest()[:10]
            episode_id = f"{subject['slug']}-{number:02d}"
            name = f"{episode_id}-{digest}.mp3"

            decoded = miniaudio.decode(data, nchannels=1, sample_rate=SAMPLE_RATE,
                                       output_format=miniaudio.SampleFormat.SIGNED16)
            decoded_secs = len(decoded.samples) / SAMPLE_RATE
            if abs(decoded_secs - elapsed) > 3:
                raise RuntimeError(f"{name}: decodifica {decoded_secs:.0f}s, esperado {elapsed:.0f}s")

            (out_dir / name).write_bytes(data)
            episodes_out.append({
                "id": episode_id,
                "subject_slug": subject["slug"],
                "subject_name": subject["name"],
                "number": number,
                "title": f"{subject['name']} · Episódio {number}",
                "file": name,
                "bytes": len(data),
                "duration_secs": round(elapsed),
                "chapters": chapters,
                "boundaries": boundaries,
                "segment_count": len(chapters),
            })
            for chapter in chapters:
                topic_index.setdefault(chapter["topic_id"], {"episode": episode_id, "start": chapter["start"]})
            print(f"[{len(episodes_out)}] {episode_id}: {elapsed / 60:.1f} min, {len(chapters)} tópicos, "
                  f"{len(data) / 1e6:.1f} MB | {', '.join(titles)}", flush=True)

    manifest = {
        "version": 2,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "voices": VOICES,
        "episodes": episodes_out,
        "topics": topic_index,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    total_h = sum(e["duration_secs"] for e in episodes_out) / 3600
    total_mb = sum(e["bytes"] for e in episodes_out) / 1e6
    print(f"\nmanifesto: {len(episodes_out)} episódios, {total_h:.1f} h, {total_mb:.0f} MB, "
          f"{len(topic_index)} tópicos | {(time.monotonic() - started) / 60:.1f} min")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(Path(sys.argv[1]))))
