"""Show configuration, paths and the episode manifest."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PODCAST_DIR = ROOT / "podcast"
NEWSLETTERS_DIR = ROOT / "newsletters"
FEEDS_DIR = ROOT / "public" / "feeds"
MANIFEST_FILE = PODCAST_DIR / "episodes.json"
SHOWS_FILE = PODCAST_DIR / "shows.json"
WORK_DIR = ROOT / ".audio-work"  # scratch MP3s, gitignored


@dataclass
class Source:
    dir: str
    kind: str  # news | explainer | question
    label: str


@dataclass
class Show:
    slug: str
    title: str
    description: str
    color: str
    sources: list[Source] = field(default_factory=list)

    @property
    def feed_path(self) -> Path:
        return FEEDS_DIR / f"{self.slug}.xml"


@dataclass
class Config:
    site_url: str
    repo: str
    author: str
    voice: str
    rate: str
    shows: list[Show]

    def show_for_dir(self, content_dir: str) -> tuple[Show, Source] | None:
        for show in self.shows:
            for src in show.sources:
                if src.dir == content_dir:
                    return show, src
        return None

    def feed_url(self, show: Show) -> str:
        return f"{self.site_url}/feeds/{show.slug}.xml"

    def art_url(self, show: Show) -> str:
        return f"{self.site_url}/feeds/art/{show.slug}.png"


def load_config() -> Config:
    raw = json.loads(SHOWS_FILE.read_text(encoding="utf-8"))
    shows = [
        Show(
            slug=s["slug"],
            title=s["title"],
            description=s["description"],
            color=s.get("color", "#334155"),
            sources=[Source(**src) for src in s.get("sources", [])],
        )
        for s in raw["shows"]
    ]
    return Config(
        site_url=raw["siteUrl"].rstrip("/"),
        repo=os.environ.get("GITHUB_REPOSITORY", raw["repo"]),
        author=raw.get("author", "My Daily Clippings"),
        voice=os.environ.get("TTS_VOICE", raw.get("voice", "en-US-AvaMultilingualNeural")),
        rate=raw.get("rate", "+0%"),
        shows=shows,
    )


def load_manifest() -> dict:
    if MANIFEST_FILE.exists():
        return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    return {"version": 1, "episodes": {}}


def save_manifest(manifest: dict) -> None:
    tmp = MANIFEST_FILE.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, MANIFEST_FILE)
