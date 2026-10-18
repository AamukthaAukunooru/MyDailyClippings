"""Podcast RSS feeds (RSS 2.0 + iTunes tags), one per show."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

IST = timezone(timedelta(hours=5, minutes=30))
KIND_ORDER = {"news": 0, "explainer": 1, "question": 2, "article": 3}


def publish_time(day_iso: str, kind: str, index: int = 0) -> str:
    """06:00 IST on the page's date, nudged so a day's episodes sort news first."""
    base = datetime.fromisoformat(day_iso).replace(hour=6, tzinfo=IST)
    # newer pubDate sorts first in most apps, so earlier kinds get later times
    minutes = 30 - 10 * KIND_ORDER.get(kind, 3) - min(index, 9)
    return (base + timedelta(minutes=minutes)).isoformat()


def _duration(seconds: int) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _cdata(text: str) -> str:
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def render_feed(
    *,
    title: str,
    description: str,
    site_link: str,
    feed_url: str,
    art_url: str,
    author: str,
    episodes: list[dict],
) -> str:
    eps = sorted(episodes, key=lambda e: e["published"], reverse=True)
    now = format_datetime(datetime.now(timezone.utc))
    items = []
    for e in eps:
        pub = format_datetime(datetime.fromisoformat(e["published"]))
        desc = e.get("summary") or e["title"]
        if e.get("page"):
            desc += f'<p><a href="{escape(e["page"])}">Read it on the site</a></p>'
        items.append(
            "    <item>\n"
            f"      <title>{escape(e['title'])}</title>\n"
            f"      <guid isPermaLink=\"false\">{escape(e['guid'])}</guid>\n"
            f"      <pubDate>{pub}</pubDate>\n"
            + (f"      <link>{escape(e['page'])}</link>\n" if e.get("page") else "")
            + f"      <description>{_cdata(desc)}</description>\n"
            f"      <enclosure url=\"{escape(e['url'])}\" length=\"{int(e['bytes'])}\" type=\"audio/mpeg\"/>\n"
            f"      <itunes:duration>{_duration(e.get('duration', 0))}</itunes:duration>\n"
            "      <itunes:explicit>false</itunes:explicit>\n"
            "    </item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" '
        'xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        f"    <title>{escape(title)}</title>\n"
        f"    <link>{escape(site_link)}</link>\n"
        f"    <atom:link href=\"{escape(feed_url)}\" rel=\"self\" type=\"application/rss+xml\"/>\n"
        f"    <description>{escape(description)}</description>\n"
        "    <language>en</language>\n"
        f"    <lastBuildDate>{now}</lastBuildDate>\n"
        f"    <itunes:author>{escape(author)}</itunes:author>\n"
        f"    <itunes:summary>{escape(description)}</itunes:summary>\n"
        f"    <itunes:image href=\"{escape(art_url)}\"/>\n"
        f"    <image><url>{escape(art_url)}</url><title>{escape(title)}</title><link>{escape(site_link)}</link></image>\n"
        "    <itunes:explicit>false</itunes:explicit>\n"
        "    <itunes:type>episodic</itunes:type>\n"
        "    <itunes:category text=\"News\"/>\n"
        + ("\n".join(items) + "\n" if items else "")
        + "  </channel>\n"
        "</rss>\n"
    )


def write_if_changed(path: Path, content: str) -> bool:
    """Write the feed, ignoring lastBuildDate when comparing, to avoid noise commits."""
    def strip(s: str) -> str:
        return "\n".join(l for l in s.splitlines() if "<lastBuildDate>" not in l)

    if path.exists() and strip(path.read_text(encoding="utf-8")) == strip(content):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True
