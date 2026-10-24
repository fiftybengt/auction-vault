import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pyarrow.parquet as pq
import pytest

from ingest import archive as arc
from ingest import cli, upload
from conftest import ITEMS, make_sv, scan


@pytest.fixture
def sv(tmp_path):
    p = tmp_path / "wow" / "WTF" / "Account" / "X" / "SavedVariables" / "AuctionVault.lua"
    p.parent.mkdir(parents=True)
    p.write_text(make_sv([scan(1000), scan(2000)], ITEMS))
    p.chmod(0o444)  # we must only ever read it
    return p


def test_archive_copies_and_is_idempotent(sv, tmp_path):
    raw = tmp_path / "raw"
    before = sv.read_bytes()
    entry, data, new = arc.archive(sv, raw, upload_ts="20261024T120000Z")
    assert new and data == before
    copy = raw / "20261024T120000Z_AuctionVault.lua"
    assert copy.read_bytes() == before
    assert entry["sv_sha256"] == hashlib.sha256(before).hexdigest()
    man = json.loads((raw / "manifest.json").read_text())
    assert man["files"][0]["archived"] == copy.name and man["files"][0]["uploaded"] is False

    entry2, _, new2 = arc.archive(sv, raw, upload_ts="20261024T130000Z")
    assert not new2 and entry2["upload_ts"] == "20261024T120000Z"
    assert sorted(p.name for p in raw.iterdir()) == [copy.name, "manifest.json"]
    assert sv.read_bytes() == before


def test_archive_restores_missing_copy(sv, tmp_path):
    raw = tmp_path / "raw"
    entry, _, _ = arc.archive(sv, raw)
    (raw / entry["archived"]).unlink()
    _, _, new = arc.archive(sv, raw)
    assert new and (raw / entry["archived"]).exists()


def _args(sv, tmp_path, dry_run=True):
    return ["publish", "--sv", str(sv), "--raw-dir", str(tmp_path / "raw"),
            "--out", str(tmp_path / "landing")] + (["--dry-run"] if dry_run else [])


def test_dry_run_writes_landing_and_uploads_nothing(sv, tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(upload, "client", lambda: pytest.fail("dry run touched the network"))
    assert cli.main(_args(sv, tmp_path)) == 0
    (land,) = (tmp_path / "landing").iterdir()
    assert sorted(p.name for p in land.iterdir()) == sorted(upload.LANDING_FILES)
    assert (land / "AuctionVault.lua").read_bytes() == sv.read_bytes()
    up = pq.read_table(land / "upload.parquet").to_pylist()[0]
    assert up["upload_ts"] == land.name
    assert up["sv_sha256"] == hashlib.sha256(sv.read_bytes()).hexdigest()
    out = capsys.readouterr().out
    assert "Icecrown:Alliance:1000" in out and "dry run" in out


def test_invalid_file_is_archived_but_not_landed(sv, tmp_path, capsys):
    sv.chmod(0o644)
    sv.write_text(make_sv([scan(1000, rowCount=99)], ITEMS))
    assert cli.main(_args(sv, tmp_path)) == 2
    assert "Icecrown:Alliance:1000" in capsys.readouterr().err
    assert len(list((tmp_path / "raw").glob("*_AuctionVault.lua"))) == 1
    assert not (tmp_path / "landing").exists()


def test_publish_without_credentials_fails_before_parsing(sv, tmp_path, monkeypatch):
    monkeypatch.delenv("DATABRICKS_HOST", raising=False)
    monkeypatch.delenv("DATABRICKS_TOKEN", raising=False)
    assert cli.main(_args(sv, tmp_path, dry_run=False)) == 1
    assert not (tmp_path / "landing").exists()


def test_refuses_to_write_into_client_dir(sv, tmp_path):
    with pytest.raises(SystemExit, match="WoW client"):
        cli.main(["publish", "--sv", str(sv), "--dry-run",
                  "--raw-dir", str(sv.parents[3] / "raw")])


class FakeFiles:
    def __init__(self):
        self.uploaded, self.dirs = [], set()

    def get_directory_metadata(self, path):
        if path not in self.dirs:
            from databricks.sdk.errors import NotFound
            raise NotFound("nope")

    def create_directory(self, path):
        self.dirs.add(path)

    def upload(self, path, f, overwrite=None):
        assert overwrite is False
        self.uploaded.append((path, len(f.read())))


def test_publish_uploads_once(sv, tmp_path, monkeypatch, capsys):
    fake = SimpleNamespace(files=FakeFiles())
    monkeypatch.setattr(upload, "client", lambda: fake)
    assert cli.main(_args(sv, tmp_path, dry_run=False)) == 0
    names = [p.rsplit("/", 1)[1] for p, _ in fake.files.uploaded]
    assert names == upload.LANDING_FILES  # upload.parquet last
    (d,) = fake.files.dirs
    assert d.startswith("/Volumes/auction/raw/landing/")
    man = json.loads((tmp_path / "raw" / "manifest.json").read_text())
    assert man["files"][0]["uploaded"] is True
    assert man["files"][0]["uploads"][0]["remote_dir"] == d

    # Same file again: skipped, nothing new uploaded.
    assert cli.main(_args(sv, tmp_path, dry_run=False)) == 0
    assert len(fake.files.uploaded) == len(upload.LANDING_FILES)
    assert "nothing to do" in capsys.readouterr().out


def test_retry_after_partial_upload_uses_fresh_dir(sv, tmp_path, monkeypatch):
    fake = SimpleNamespace(files=FakeFiles())
    monkeypatch.setattr(upload, "client", lambda: fake)
    entry, _, _ = arc.archive(sv, tmp_path / "raw", upload_ts="20200101T000000Z")
    fake.files.dirs.add(upload.remote_dir(entry["upload_ts"]))  # left by a failed attempt
    assert cli.main(_args(sv, tmp_path, dry_run=False)) == 0
    assert all("20200101T000000Z" not in p for p, _ in fake.files.uploaded)


def test_dry_run_on_crlf_file(sv, tmp_path):
    sv.chmod(0o644)
    sv.write_bytes(sv.read_bytes().replace(b"\n", b"\r\n"))
    assert cli.main(_args(sv, tmp_path)) == 0
    (land,) = (tmp_path / "landing").iterdir()
    assert (land / "AuctionVault.lua").read_bytes() == sv.read_bytes()  # raw bytes kept
    assert pq.read_table(land / "listings.parquet").num_rows == 6
