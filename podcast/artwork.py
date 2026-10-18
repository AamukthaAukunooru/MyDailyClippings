"""Generate square cover art for each show (podcast apps want 1400-3000 px).

    python -m podcast.artwork          # writes public/feeds/art/<show>.png

Run it again after adding a show to shows.json. The PNGs are committed.
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from .config import FEEDS_DIR, load_config

SIZE = 1400


def _font(size: int, bold: bool = False):
    candidates = (
        ["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold
        else ["DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _wrap(draw, text: str, font, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def render(label: str, color: str) -> Image.Image:
    img = Image.new("RGB", (SIZE, SIZE), color)
    draw = ImageDraw.Draw(img)
    pad = 120
    draw.rectangle([pad, pad, pad + 160, pad + 16], fill="white")
    draw.text((pad, pad + 60), "MY DAILY CLIPPINGS", font=_font(64, bold=True), fill="white")
    big = _font(170, bold=True)
    lines = _wrap(draw, label, big, SIZE - 2 * pad)
    y = SIZE - pad - len(lines) * 190
    for line in lines:
        draw.text((pad, y), line, font=big, fill="white")
        y += 190
    return img


def main() -> None:
    cfg = load_config()
    out = FEEDS_DIR / "art"
    out.mkdir(parents=True, exist_ok=True)
    for show in cfg.shows:
        label = show.title.split("·", 1)[-1].strip()
        render(label, show.color).save(out / f"{show.slug}.png", optimize=True)
        print(f"art: {show.slug}.png")


if __name__ == "__main__":
    main()
