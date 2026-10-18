"""Text-to-speech engines. All engines write an MP3 to `out_path`.

- edge: Microsoft Edge neural voices via edge-tts (free, unofficial endpoint).
- stub: a short silent MP3 made with ffmpeg; for dry runs without network.

Swapping in a paid engine later means adding one function here.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

ATTEMPTS = 4


async def _edge(text: str, voice: str, rate: str, out_path: Path) -> None:
    import edge_tts  # imported lazily so dry runs don't need it

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(out_path))


def _stub(text: str, out_path: Path) -> None:
    seconds = max(2, min(20, len(text.split()) // 150))
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
            "-t", str(seconds), "-b:a", "48k", str(out_path),
        ],
        check=True,
    )


def synthesize(engine: str, text: str, voice: str, rate: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if engine == "stub":
        _stub(text, out_path)
        return
    if engine != "edge":
        raise ValueError(f"unknown TTS engine: {engine}")

    last_error: Exception | None = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            asyncio.run(_edge(text, voice, rate, out_path))
            if out_path.stat().st_size < 4096:
                raise RuntimeError("no audio data received")
            return
        except Exception as exc:  # network hiccups, throttling
            last_error = exc
            out_path.unlink(missing_ok=True)
            if attempt < ATTEMPTS:
                wait = 5 * 2 ** (attempt - 1)
                print(f"    TTS attempt {attempt} failed ({exc}); retrying in {wait}s")
                import time

                time.sleep(wait)
    raise RuntimeError(f"TTS failed after {ATTEMPTS} attempts: {last_error}")
