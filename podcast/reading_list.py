"""Reading List: saved article links become episodes in their own podcast feed.

    python -m podcast.reading_list            # convert new links in reading-list.txt

Ported from Articast. Articles are other people's writing, so neither their text
nor their audio goes into this public repo or its Releases. Audio and the feed
live in a Cloudflare R2 bucket under a secret prefix; this file only keeps
non-identifying state (podcast/reading-list.json). Without the R2 secrets the
step is skipped.

Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
R2_PUBLIC_URL (bucket's public base URL), READING_LIST_PREFIX (random string).
"""

from __future__ import annotations

import hashlib
import html as html_module
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from .artwork import render
from .build import tag_mp3
from .config import PODCAST_DIR, ROOT, WORK_DIR, load_config
from .feeds import render_feed
from .storage import R2Bucket
from .tts import synthesize

LIST_FILE = ROOT / "reading-list.txt"
STATE_FILE = PODCAST_DIR / "reading-list.json"
MIN_TEXT_CHARS = 200
MAX_PER_RUN = int(os.environ.get("READING_LIST_MAX_PER_RUN", "10"))


def url_key(url: str) -> str:
    return hashlib.sha1(url.strip().encode("utf-8")).hexdigest()[:16]


def read_urls() -> list[str]:
    if not LIST_FILE.exists():
        return []
    seen, urls = set(), []
    for line in LIST_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and line not in seen:
            seen.add(line)
            urls.append(line)
    return urls


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"version": 1, "entries": {}}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def extract_article(url: str) -> tuple[str, str, str]:
    """(title, body text, hostname) - same approach as Articast."""
    import trafilatura

    downloaded = trafilatura.fetch_url(url)
    if downloaded is None:
        raise RuntimeError("could not download page (blocked, offline, or dead link)")
    raw = trafilatura.extract(downloaded, url=url, output_format="json", include_comments=False, include_tables=False)
    if not raw:
        raise RuntimeError("could not find article text on the page")
    doc = json.loads(raw)
    text = (doc.get("text") or "").strip()
    title = (doc.get("title") or "").strip()
    host = doc.get("hostname") or urlparse(url).netloc or "unknown site"
    if len(text) < MIN_TEXT_CHARS:
        raise RuntimeError(f"extracted only {len(text)} characters - possibly a paywall or JS-only page")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", downloaded, re.IGNORECASE | re.DOTALL)
        title = html_module.unescape(m.group(1)).strip() if m else f"Article from {host}"
    return title, text, host


def main() -> int:
    if not R2Bucket.configured() or not os.environ.get("READING_LIST_PREFIX"):
        print("Reading List: R2 secrets not set, skipping (see podcast/reading_list.py).")
        return 0

    cfg = load_config()
    store = R2Bucket(os.environ["READING_LIST_PREFIX"])
    state = load_state()
    entries = state["entries"]
    urls = read_urls()

    made = failed = 0
    for url in urls:
        key = url_key(url)
        entry = entries.get(key)
        if entry and entry["status"] == "done":
            continue
        if entry and entry["status"] == "failed" and entry.get("attempts", 0) >= 3:
            continue
        if made + failed >= MAX_PER_RUN:
            break
        entry = entry or {"added": datetime.now(timezone.utc).isoformat(timespec="seconds"), "attempts": 0}
        entries[key] = entry
        print(f"[reading-list] {url}")
        local = WORK_DIR / f"article-{key}.mp3"
        try:
            title, text, host = extract_article(url)
            speech = f"{title.rstrip('.')}. From {host}.\n\n{text}"
            synthesize("edge", speech, cfg.voice, cfg.rate, local)
            duration = tag_mp3(local, title, "Clippings · Reading List", host, entry["added"][:10])
            store.upload(local, f"article-{key}.mp3", "")
            entry.update(status="done", title=title, host=host, duration=duration,
                         bytes=local.stat().st_size, error=None)
            made += 1
            print(f"    done: {title} ({duration // 60} min)")
        except Exception as exc:
            entry.update(status="failed", error=str(exc)[:300], attempts=entry.get("attempts", 0) + 1)
            failed += 1
            print(f"    FAILED: {exc}", file=sys.stderr)
        finally:
            local.unlink(missing_ok=True)
        save_state(state)

    # Feed: only links still in reading-list.txt (removing a line drops the episode)
    listed = {url_key(u) for u in urls}
    base = f"{store.public}/{store.prefix}"
    episodes = [
        {
            "guid": f"reading-list/{k}",
            "title": e["title"],
            "published": e["added"],
            "summary": f"Saved article from {e.get('host', 'the web')}.",
            "url": f"{base}/audio/article-{k}.mp3",
            "bytes": e["bytes"],
            "duration": e["duration"],
        }
        for k, e in entries.items()
        if e.get("status") == "done" and k in listed
    ]
    xml = render_feed(
        title="Clippings · Reading List",
        description="My saved articles, read aloud word for word.",
        site_link=cfg.site_url,
        feed_url=f"{base}/reading-list.xml",
        art_url=f"{base}/reading-list.png",
        author=cfg.author,
        episodes=episodes,
    )
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    feed_file = WORK_DIR / "reading-list.xml"
    feed_file.write_text(xml, encoding="utf-8")
    store.put(feed_file, "reading-list.xml", "application/rss+xml")
    art_file = WORK_DIR / "reading-list.png"
    render("Reading List", "#475569").save(art_file)
    store.put(art_file, "reading-list.png", "image/png")
    print(f"Reading List: {made} new, {failed} failed. Feed: {base}/reading-list.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
