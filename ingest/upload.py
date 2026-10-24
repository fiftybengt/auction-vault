"""Upload a landing directory to the Unity Catalog volume (contract C2).

    scripts/with-databricks ingest/.venv/bin/python -m ingest.upload <landing_dir> <upload_ts>

Credentials come only from DATABRICKS_HOST / DATABRICKS_TOKEN in the environment. The
token is never printed, logged or written anywhere.

Landing directories are immutable: every file is uploaded with overwrite=False, and
upload.parquet goes last so its presence marks a complete directory.
"""

import os
import sys
from pathlib import Path

VOLUME_ROOT = "/Volumes/auction/raw/landing"

# Order matters: upload.parquet last = "this directory is complete".
LANDING_FILES = ["AuctionVault.lua", "items.parquet", "scans.parquet",
                 "listings.parquet", "upload.parquet"]


class CredentialsMissing(RuntimeError):
    pass


def client():
    host = os.environ.get("DATABRICKS_HOST")
    token = os.environ.get("DATABRICKS_TOKEN")
    if not host or not token:
        raise CredentialsMissing(
            "DATABRICKS_HOST / DATABRICKS_TOKEN not set; run via scripts/with-databricks")
    from databricks.sdk import WorkspaceClient
    # Explicit host/token so no ~/.databrickscfg profile is ever consulted.
    return WorkspaceClient(host=host, token=token, auth_type="pat")


def remote_dir(upload_ts):
    return f"{VOLUME_ROOT}/{upload_ts}"


def remote_dir_exists(w, path):
    from databricks.sdk.errors import NotFound
    try:
        w.files.get_directory_metadata(path)
        return True
    except NotFound:
        return False


def upload_dir(landing_dir, upload_ts, w=None, log=print):
    """Upload the C2 files in landing_dir to /Volumes/auction/raw/landing/<upload_ts>/."""
    landing_dir = Path(landing_dir)
    missing = [n for n in LANDING_FILES if not (landing_dir / n).is_file()]
    if missing:
        raise FileNotFoundError(f"{landing_dir} is missing {missing}")
    w = w or client()
    dest = remote_dir(upload_ts)
    if remote_dir_exists(w, dest):
        raise FileExistsError(f"{dest} already exists; landing directories are immutable")
    w.files.create_directory(dest)
    for name in LANDING_FILES:
        path = landing_dir / name
        with open(path, "rb") as f:
            w.files.upload(f"{dest}/{name}", f, overwrite=False)
        log(f"  uploaded {dest}/{name} ({path.stat().st_size:,} bytes)")
    return dest


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        sys.exit(__doc__)
    upload_dir(argv[0], argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
