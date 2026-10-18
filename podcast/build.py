"""Build podcast audio and feeds from the newsletters.

    python -m podcast.build                      # last 3 days, edge-tts, GitHub Releases
    python -m podcast.build --days 100 --dirs physics,ai --limit 50
    python -m podcast.build --tts stub --storage local   # dry run, no network
    python -m podcast.build --feeds-only         # just rewrite the feed XML

Each newsletter page becomes one MP3. The manifest (podcast/episodes.json)
records what exists, keyed by `<dir>/<slug>`, with a hash of the spoken text,
so re-runs only make new or changed episodes. Feeds are written to
public/feeds/<show>.xml and published with the site.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timedelta

from .config import NEWSLETTERS_DIR, WORK_DIR, load_config, load_manifest, save_manifest
from .feeds import IST, publish_time, render_feed, write_if_changed
from .speech import content_hash, episode_title, parse_page, speech_text
from .storage import make_store
from .tts import synthesize

EXIT_NOTHING_LEFT = 3


def asset_name(guid: str) -> str:
    name = re.sub(r"[^a-z0-9]+", "-", guid.lower()).strip("-")
    return name[:120] + ".mp3"


def tag_mp3(path, title: str, album: str, artist: str, day: str) -> int:
    from mutagen.easyid3 import EasyID3
    from mutagen.id3 import ID3NoHeaderError
    from mutagen.mp3 import MP3

    try:
        tags = EasyID3(str(path))
    except ID3NoHeaderError:
        tags = EasyID3()
    tags["title"] = title
    tags["album"] = album
    tags["artist"] = artist
    tags["date"] = day
    tags["genre"] = "Podcast"
    tags.save(str(path))
    return round(MP3(str(path)).info.length)


def collect_pages(cfg, days: int, only_dirs: set[str] | None):
    cutoff = (datetime.now(IST) - timedelta(days=days)).date()
    found = []
    for show in cfg.shows:
        for src in show.sources:
            if only_dirs and src.dir not in only_dirs:
                continue
            folder = NEWSLETTERS_DIR / src.dir
            if not folder.is_dir():
                continue
            for path in folder.glob("*.md"):
                page = parse_page(path)
                if page and page.date >= cutoff:
                    found.append((show, src, page))
    # newest first, and within a day news before explainers before questions
    order = {"news": 0, "explainer": 1, "question": 2}
    found.sort(key=lambda t: (-t[2].date.toordinal(), order.get(t[1].kind, 9), t[0].slug, t[2].slug))
    return found


def write_feeds(cfg, manifest) -> int:
    changed = 0
    episodes = manifest["episodes"].values()
    for show in cfg.shows:
        mine = [e for e in episodes if e.get("show") == show.slug]
        xml = render_feed(
            title=show.title,
            description=show.description,
            site_link=f"{cfg.site_url}/{show.sources[0].dir}/" if show.sources else cfg.site_url,
            feed_url=cfg.feed_url(show),
            art_url=cfg.art_url(show),
            author=cfg.author,
            episodes=mine,
        )
        if write_if_changed(show.feed_path, xml):
            changed += 1
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="podcast.build")
    ap.add_argument("--days", type=int, default=3, help="look back this many days (default 3)")
    ap.add_argument("--dirs", default="", help="comma-separated content dirs to limit to")
    ap.add_argument("--limit", type=int, default=0, help="max episodes to synthesize this run (0 = no limit)")
    ap.add_argument("--tts", default="edge", choices=["edge", "stub"])
    ap.add_argument("--storage", default="github", choices=["github", "local"])
    ap.add_argument("--feeds-only", action="store_true")
    ap.add_argument("--exit-code-when-done", action="store_true",
                    help=f"exit {EXIT_NOTHING_LEFT} when nothing is left to synthesize (for batch loops)")
    args = ap.parse_args(argv)

    cfg = load_config()
    manifest = load_manifest()

    if args.feeds_only:
        print(f"Feeds rewritten: {write_feeds(cfg, manifest)}")
        return 0

    only = {d.strip() for d in args.dirs.split(",") if d.strip()} or None
    pages = collect_pages(cfg, args.days, only)
    store = make_store(args.storage, cfg.repo)

    made = failed = pending = 0
    day_index: dict[tuple, int] = {}
    for show, src, page in pages:
        key = (show.slug, page.date, src.kind)
        idx = day_index.get(key, 0)
        day_index[key] = idx + 1

        text = speech_text(page, src)
        digest = content_hash(text, cfg.voice)
        existing = manifest["episodes"].get(page.guid)
        if existing and existing.get("hash") == digest:
            continue
        if args.limit and made >= args.limit:
            pending += 1
            continue

        title = episode_title(page, src)
        name = asset_name(page.guid)
        local = WORK_DIR / name
        print(f"[{page.guid}] {title} ({len(text.split())} words)")
        try:
            synthesize(args.tts, text, cfg.voice, cfg.rate, local)
            duration = tag_mp3(local, title, show.title, cfg.author, page.date.isoformat())
            url = store.upload(local, name, page.date.strftime("%Y-%m"))
        except Exception as exc:
            failed += 1
            print(f"    FAILED: {exc}", file=sys.stderr)
            local.unlink(missing_ok=True)
            continue

        manifest["episodes"][page.guid] = {
            "guid": page.guid,
            "show": show.slug,
            "kind": src.kind,
            "title": title,
            "date": page.date.isoformat(),
            "published": publish_time(page.date.isoformat(), src.kind, idx),
            "summary": page.summary,
            "page": f"{cfg.site_url}/{page.dir}/{page.slug}/",
            "url": url,
            "bytes": local.stat().st_size,
            "duration": duration,
            "hash": digest,
            "voice": cfg.voice,
        }
        save_manifest(manifest)
        local.unlink(missing_ok=True)
        made += 1
        print(f"    done: {duration // 60}m{duration % 60:02d}s")

    feeds_changed = write_feeds(cfg, manifest)
    print(f"\nAudio: {made} made, {failed} failed, {pending} left for a later run. Feeds changed: {feeds_changed}")

    if failed:
        return 1
    if args.exit_code_when_done and pending == 0:
        return EXIT_NOTHING_LEFT
    return 0


if __name__ == "__main__":
    sys.exit(main())
