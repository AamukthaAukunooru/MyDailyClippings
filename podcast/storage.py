"""Where MP3s live. Never in git.

- github: assets on GitHub Releases, one release per month (tag audio-YYYY-MM).
- r2: a Cloudflare R2 bucket (S3 API); used for the Reading List so saved
  articles are not republished from the public repo.
- local: copies into .audio-work/published for dry runs.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
from pathlib import Path

from .config import WORK_DIR


class GitHubReleases:
    name = "github"

    def __init__(self, repo: str):
        self.repo = repo
        self._known_tags: set[str] = set()
        self._lock = threading.Lock()  # uploads run in parallel threads

    def _ensure_release(self, tag: str) -> None:
        with self._lock:
            self._ensure_release_locked(tag)

    def _ensure_release_locked(self, tag: str) -> None:
        if tag in self._known_tags:
            return
        view = subprocess.run(
            ["gh", "release", "view", tag, "--repo", self.repo],
            capture_output=True, text=True,
        )
        if view.returncode != 0:
            subprocess.run(
                [
                    "gh", "release", "create", tag, "--repo", self.repo,
                    "--title", f"Audio {tag.removeprefix('audio-')}",
                    "--notes", "Podcast audio for My Daily Clippings. Generated automatically.",
                    "--latest=false",
                ],
                check=True,
            )
        self._known_tags.add(tag)

    def upload(self, local: Path, asset_name: str, month: str) -> str:
        tag = f"audio-{month}"
        self._ensure_release(tag)
        staged = local.with_name(asset_name)
        if staged != local:
            shutil.copyfile(local, staged)
        subprocess.run(
            ["gh", "release", "upload", tag, str(staged), "--clobber", "--repo", self.repo],
            check=True,
        )
        return f"https://github.com/{self.repo}/releases/download/{tag}/{asset_name}"


class R2Bucket:
    """Cloudflare R2 via the S3 API. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL (the bucket's public base URL)."""

    name = "r2"

    def __init__(self, prefix: str):
        import boto3

        self.bucket = os.environ["R2_BUCKET"]
        self.public = os.environ["R2_PUBLIC_URL"].rstrip("/")
        self.prefix = prefix.strip("/")
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    @staticmethod
    def configured() -> bool:
        keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"]
        return all(os.environ.get(k) for k in keys)

    def put(self, local: Path, key: str, content_type: str) -> str:
        full = f"{self.prefix}/{key}"
        self.client.upload_file(str(local), self.bucket, full, ExtraArgs={"ContentType": content_type})
        return f"{self.public}/{full}"

    def upload(self, local: Path, asset_name: str, month: str) -> str:
        return self.put(local, f"audio/{asset_name}", "audio/mpeg")


class LocalStore:
    name = "local"

    def __init__(self):
        self.root = WORK_DIR / "published"

    def upload(self, local: Path, asset_name: str, month: str) -> str:
        dest = self.root / f"audio-{month}" / asset_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local, dest)
        return dest.resolve().as_uri()


def make_store(kind: str, repo: str):
    if kind == "github":
        return GitHubReleases(repo)
    if kind == "local":
        return LocalStore()
    raise ValueError(f"unknown storage: {kind}")
