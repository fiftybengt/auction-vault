"""Local archive of raw SavedVariables files, plus the publish manifest.

The addon keeps only the newest 6 scans, so every file is copied to
data/raw/<upload_ts>_AuctionVault.lua before anything else happens, and the copy is
verified by sha256. data/raw/manifest.json records each distinct file (by sha256) and
whether it has been uploaded, which is what makes `publish` idempotent.

The source file is only ever opened for reading.
"""

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RAW_DIR = REPO / "data" / "raw"
MANIFEST_VERSION = 1


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def utc_ts(dt=None):
    """C2 `upload_ts`: YYYYMMDDTHHMMSSZ."""
    return (dt or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Manifest:
    def __init__(self, raw_dir=RAW_DIR):
        self.raw_dir = Path(raw_dir)
        self.path = self.raw_dir / "manifest.json"
        if self.path.exists():
            doc = json.loads(self.path.read_text())
        else:
            doc = {"version": MANIFEST_VERSION, "files": []}
        self.doc = doc

    @property
    def files(self):
        return self.doc["files"]

    def find(self, sv_sha256):
        return next((e for e in self.files if e["sv_sha256"] == sv_sha256), None)

    def save(self):
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.raw_dir, prefix=".manifest.", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(self.doc, f, indent=2)
            f.write("\n")
        os.replace(tmp, self.path)

    def mark_uploaded(self, sv_sha256, upload_ts, remote_dir):
        e = self.find(sv_sha256)
        e.setdefault("uploads", []).append(
            {"upload_ts": upload_ts, "remote_dir": remote_dir, "uploaded_at": _now_iso()})
        e["uploaded"] = True
        self.save()


def archive(sv_path, raw_dir=RAW_DIR, upload_ts=None):
    """Copy sv_path into raw_dir and record it. Returns (entry, data, is_new).

    `data` is the verified bytes of the archived copy, so callers parse exactly what was
    archived and the source file is read once. A file already in the manifest (same
    sha256) is not copied again; its existing entry is returned.
    """
    sv_path = Path(sv_path).expanduser()
    raw_dir = Path(raw_dir)
    with open(sv_path, "rb") as f:  # read-only, always
        data = f.read()
    digest = sha256_bytes(data)

    manifest = Manifest(raw_dir)
    entry = manifest.find(digest)
    if entry is not None:
        existing = raw_dir / entry["archived"]
        if existing.exists() and sha256_file(existing) == digest:
            return entry, data, False
        # Recorded but the copy is gone or damaged: archive it again under the old name.
        target = existing
    else:
        upload_ts = upload_ts or utc_ts()
        target = raw_dir / f"{upload_ts}_AuctionVault.lua"
        entry = {
            "sv_sha256": digest, "sv_bytes": len(data), "upload_ts": upload_ts,
            "archived": target.name, "archived_at": _now_iso(),
            "source": str(sv_path), "uploaded": False,
        }

    raw_dir.mkdir(parents=True, exist_ok=True)
    if target.exists() and sha256_file(target) != digest:
        raise RuntimeError(f"{target} exists with different content; refusing to overwrite")
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    if sha256_file(target) != digest:
        raise RuntimeError(f"archive copy {target} failed sha256 verification")

    if entry not in manifest.files:
        manifest.files.append(entry)
    manifest.save()
    return entry, data, True
