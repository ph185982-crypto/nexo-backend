#!/usr/bin/env python3
"""
Gera o áudio pronto de todas as aulas e o manifesto que o app usa para tocar
sem gerar nada no celular.

Gerar no aparelho eram 7 a 12 chamadas em sequência por aula; no iPhone,
bloquear a tela no meio derrubava a geração e o player ficava em "Episódio
indisponível". Aqui o áudio sai uma vez, fica na branch `audios` do
repositório, e o app só baixa o arquivo pronto.

Uso:
    python scripts/gerar_audios.py <pasta_saida>

Retoma de onde parou: aula já gerada (mesmo roteiro, mesmas vozes) é pulada.
O nome do arquivo leva o hash do roteiro, então conteúdo alterado gera
arquivo novo e o cache do celular não serve áudio velho.

EDGE_TTS_CA_BUNDLE: CA extra para ambientes com proxy TLS (o edge-tts fixa o
bundle do certifi ao ser importado).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if os.getenv("EDGE_TTS_CA_BUNDLE"):
    import certifi

    _bundle = os.environ["EDGE_TTS_CA_BUNDLE"]
    certifi.where = lambda: _bundle

from prf.local.content import get_store  # noqa: E402
from prf.local.podcast_local import PodcastLocalError, build_offline_script  # noqa: E402
from prf.services.podcast_service import HOST_A, HOST_B  # noqa: E402

VOICES = {HOST_A: "pt-BR-AntonioNeural", HOST_B: "pt-BR-FranciscaNeural"}
CONCURRENCY = int(os.getenv("TTS_CONCURRENCY", "6"))
ATTEMPTS = 5

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


async def synth(text: str, voice: str, sem: asyncio.Semaphore) -> bytes:
    import edge_tts

    error: object = None
    for attempt in range(ATTEMPTS):
        async with sem:
            try:
                buf = bytearray()
                async for msg in edge_tts.Communicate(text, voice).stream():
                    if msg["type"] == "audio":
                        buf += msg["data"]
                if buf:
                    return bytes(buf)
                error = "áudio vazio"
            except Exception as e:  # rede, throttling do serviço
                error = e
        await asyncio.sleep(2 ** attempt)
    raise RuntimeError(f"TTS falhou após {ATTEMPTS} tentativas: {error}")


async def render(script: dict, sem: asyncio.Semaphore) -> tuple[bytes, list[float]]:
    parts: list[bytes] = []
    boundaries: list[float] = []
    elapsed = 0.0
    for block in sorted({t["block"] for t in script["turns"]}):
        turns = [t for t in script["turns"] if t["block"] == block]
        audios = await asyncio.gather(*[
            synth(t["text"], VOICES.get(t["speaker"], VOICES[HOST_A]), sem) for t in turns
        ])
        audio = b"".join(audios)
        parts.append(audio)
        elapsed += mp3_duration(audio)
        boundaries.append(round(elapsed, 2))
    return b"".join(parts), boundaries


def script_hash(script: dict) -> str:
    payload = json.dumps({"turns": script["turns"], "voices": VOICES}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(payload.encode()).hexdigest()[:10]


async def main(out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_dir = out_dir / ".meta"
    meta_dir.mkdir(exist_ok=True)

    store = get_store()
    scripts = []
    for subject in store.get_subjects():
        for topic in store.get_topics(subject["slug"]):
            try:
                scripts.append(build_offline_script(str(topic["id"])))
            except PodcastLocalError:
                continue  # tópico sem lei e sem questão: não há aula a gerar

    sem = asyncio.Semaphore(CONCURRENCY)
    started = time.monotonic()
    done = 0
    failed: list[str] = []

    async def one(script: dict) -> None:
        nonlocal done
        name = f"{script['topic_id']}-{script_hash(script)}.mp3"
        meta_path = meta_dir / f"{name}.json"
        if (out_dir / name).exists() and meta_path.exists():
            done += 1
            return
        try:
            audio, boundaries = await render(script, sem)
        except RuntimeError as e:
            failed.append(f"{script['title']}: {e}")
            return
        (out_dir / name).write_bytes(audio)
        meta_path.write_text(json.dumps({
            "topic_id": script["topic_id"],
            "file": name,
            "bytes": len(audio),
            "duration_secs": round(boundaries[-1]),
            "boundaries": boundaries,
            "segment_count": len(boundaries),
            "title": script["title"],
            "subject_name": script["subject_name"],
            "engine": script["engine"],
        }, ensure_ascii=False))
        done += 1
        mins = (time.monotonic() - started) / 60
        print(f"[{done}/{len(scripts)}] {mins:5.1f} min | {script['subject_name']} / {script['title']} "
              f"| {boundaries[-1] / 60:.1f} min de áudio, {len(audio) / 1e6:.1f} MB", flush=True)

    await asyncio.gather(*[one(s) for s in scripts])

    wanted = {f"{s['topic_id']}-{script_hash(s)}.mp3" for s in scripts}
    episodes = {}
    for meta_path in sorted(meta_dir.glob("*.json")):
        meta = json.loads(meta_path.read_text())
        if meta["file"] in wanted:
            episodes[meta["topic_id"]] = meta

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "voices": VOICES,
        "episodes": episodes,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

    total_h = sum(e["duration_secs"] for e in episodes.values()) / 3600
    total_mb = sum(e["bytes"] for e in episodes.values()) / 1e6
    print(f"\nmanifesto: {len(episodes)} aulas, {total_h:.1f} h, {total_mb:.0f} MB")
    if failed:
        print(f"{len(failed)} falharam (rode de novo para retomar):")
        for line in failed:
            print("  " + line)
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(Path(sys.argv[1]))))
