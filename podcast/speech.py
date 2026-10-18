"""Turn a newsletter Markdown page into text that reads well aloud.

There is one text per page: the same Markdown the website shows. This module
only strips what makes no sense spoken (frontmatter, markdown symbols, URLs,
the masthead line) and adds a short spoken intro built from metadata.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date as Date
from pathlib import Path

import yaml

from .config import Source


@dataclass
class Page:
    path: Path
    dir: str
    slug: str
    date: Date
    title: str
    summary: str
    topic: str | None
    body: str

    @property
    def guid(self) -> str:
        return f"{self.dir}/{self.slug}"


def parse_page(path: Path) -> Page | None:
    raw = path.read_text(encoding="utf-8")
    meta: dict = {}
    body = raw
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, re.DOTALL)
    if m:
        meta = yaml.safe_load(m.group(1)) or {}
        body = m.group(2)
    date_value = meta.get("date") or path.stem[:10]
    try:
        page_date = date_value if isinstance(date_value, Date) else Date.fromisoformat(str(date_value)[:10])
    except ValueError:
        return None
    return Page(
        path=path,
        dir=path.parent.name,
        slug=path.stem,
        date=page_date,
        title=str(meta.get("title") or path.stem),
        summary=str(meta.get("summary") or "").strip(),
        topic=(str(meta.get("topic") or meta.get("question") or "").strip() or None),
        body=body,
    )


MASTHEAD = re.compile(r"^\s*(#+\s*)?[\"“]?my daily clippings[\"”]?\s*[:.!]?\s*$", re.IGNORECASE)


def clean_markdown(body: str) -> str:
    """Strip markdown down to plain spoken paragraphs."""
    out: list[str] = []
    in_code = False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if not stripped:
            out.append("")
            continue
        if MASTHEAD.match(stripped):
            continue
        if re.match(r"^(USED|SOURCES?)\s*:", stripped, re.IGNORECASE):
            continue
        if re.match(r"^([-*_]\s*){3,}$", stripped):  # horizontal rule
            out.append("")
            continue
        if stripped.startswith("|"):  # tables don't read well aloud
            continue
        heading = re.match(r"^#{1,6}\s+(.*)$", stripped)
        if heading:
            text = inline(heading.group(1)).rstrip(" .:")
            if text:
                # blank lines around a heading give the voice a natural pause
                out.extend(["", text + ".", ""])
            continue
        stripped = re.sub(r"^\s*([-*+]|\d+[.)])\s+", "", stripped)  # list markers
        stripped = re.sub(r"^>\s?", "", stripped)  # blockquotes
        text = inline(stripped)
        if text:
            out.append(text)
    joined = "\n".join(out)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def inline(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)  # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # links -> link text
    text = re.sub(r"https?://\S+", "", text)  # bare URLs
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])", r"\1", text)
    text = text.replace("**", "").replace("~~", "")
    text = re.sub(r"\[\d+(,\s*\d+)*\]", "", text)  # [3] style citations
    text = text.replace("—", ", ").replace("–", " to ")
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def spoken_date(d: Date) -> str:
    return f"{d.strftime('%A')}, {d.strftime('%B')} {d.day}"


def intro_for(page: Page, source: Source) -> str:
    if source.kind == "news":
        return f"{source.label} news for {spoken_date(page.date)}."
    if source.kind == "explainer":
        topic = page.topic or page.title
        return f"{source.label} explainer. {topic.rstrip('.')}."
    if source.kind == "question":
        q = page.topic or page.title
        return f"A curious question. {q}"
    return page.title.rstrip(".") + "."


def speech_text(page: Page, source: Source) -> str:
    return intro_for(page, source) + "\n\n" + clean_markdown(page.body)


def content_hash(text: str, voice: str) -> str:
    return hashlib.sha1(f"{voice}\n{text}".encode("utf-8")).hexdigest()[:16]


def short_date(d: Date) -> str:
    return f"{d.strftime('%b')} {d.day}"


def episode_title(page: Page, source: Source) -> str:
    if source.kind == "news":
        return f"{short_date(page.date)} · {source.label} news"
    if source.kind == "explainer":
        return f"{short_date(page.date)} · Explainer: {page.topic or page.title}"
    if source.kind == "question":
        return f"{short_date(page.date)} · {page.topic or page.title}"
    return page.title
