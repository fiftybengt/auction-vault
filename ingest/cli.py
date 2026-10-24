"""python -m ingest publish [--dry-run] [--sv PATH] [--out DIR]

publish:
  1. archive the SavedVariables file to data/raw/ (sha256-verified, manifest updated)
  2. skip if that sha256 was already uploaded
  3. parse + validate into the C2 landing files
  4. upload them to /Volumes/auction/raw/landing/<upload_ts>/   (not with --dry-run)

Real uploads need credentials: `scripts/with-databricks ingest/.venv/bin/python -m ingest publish`
(or `make publish`). A dry run needs none.
"""

import argparse
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from . import archive as arc
from .parse_sv import SVError, parse, upload_table, write_landing
from .svread import decode

DEFAULT_SV = (Path.home() / "Downloads" / "World of Warcraft 3.3.5a" / "WTF" / "Account"
              / "SICU" / "SavedVariables" / "AuctionVault.lua")


def _client_root(sv):
    """The WoW client directory containing sv (the parent of WTF/), if any."""
    for p in Path(sv).resolve().parents:
        if p.name == "WTF":
            return p.parent
    return None


def _guard_outside(path, root, what):
    if root and Path(path).resolve().is_relative_to(root):
        sys.exit(f"refusing to write {what} inside the WoW client directory {root}")


def _fmt_ts(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")


def print_summary(parsed):
    print(f"\n  {'scan_id':<30} {'started (UTC)':<20} {'mode/source':<24} "
          f"{'rows':>7} {'expected':>8} {'complete':>8} {'sellers':>7} {'no-name':>7}")
    for s in parsed.summary:
        print(f"  {s['scan_id']:<30} {_fmt_ts(s['started_at']):<20} "
              f"{s['mode'] + '/' + s['source']:<24} {s['rows']:>7,} "
              f"{s['expected_total']:>8,} {str(s['complete']):>8} {s['sellers']:>7} "
              f"{s['nil_owners']:>7,}")
    print(f"  {'total':<30} {'':<20} {'':<24} {parsed.listings.num_rows:>7,}")
    print(f"\n  {parsed.items.num_rows:,} items in the dimension; "
          f"schema {parsed.meta.get('schema')}, addon v{parsed.meta.get('addonVersion')}")
    unknown = sum(s["unknown_items"] for s in parsed.summary)
    if unknown:
        print(f"  note: {unknown} item keys referenced by scans are not yet in the dimension")
    for w in parsed.warnings:
        print(f"  WARNING {w}")


def publish(args):
    sv = Path(args.sv).expanduser()
    if not sv.is_file():
        print(f"no SavedVariables file at {sv}", file=sys.stderr)
        return 1
    root = _client_root(sv)
    _guard_outside(args.raw_dir, root, "the archive")
    if args.out:
        _guard_outside(args.out, root, "landing files")

    # 1. Archive first: the raw file is the only copy of these scans.
    entry, data, is_new = arc.archive(sv, args.raw_dir)
    print(f"{'archived' if is_new else 'already archived'}: "
          f"{Path(args.raw_dir) / entry['archived']}")
    print(f"  sha256 {entry['sv_sha256']}  {entry['sv_bytes']:,} bytes")

    # 2. Idempotency.
    if entry.get("uploaded"):
        last = entry["uploads"][-1]
        msg = f"already uploaded to {last['remote_dir']} at {last['uploaded_at']}"
        if not args.dry_run:
            print(f"{msg}; nothing to do")
            return 0
        print(f"note: {msg}; a real publish would skip it")

    w = None
    upload_ts = entry["upload_ts"]
    if not args.dry_run:
        from . import upload as up
        try:
            w = up.client()
        except up.CredentialsMissing as e:
            print(e, file=sys.stderr)
            return 1
        # A previous attempt may have left a partial directory; never touch it.
        if up.remote_dir_exists(w, up.remote_dir(upload_ts)):
            upload_ts = arc.utc_ts()

    # 3. Parse + validate.
    started = time.time()
    try:
        parsed = parse(decode(data))
    except (SVError, UnicodeDecodeError) as e:
        print(f"INVALID SavedVariables: {e}", file=sys.stderr)
        return 2
    print(f"parsed in {time.time() - started:.2f}s")
    print_summary(parsed)

    if args.out:
        out = Path(args.out) / upload_ts
        temp = False
    else:
        out = Path(tempfile.mkdtemp(prefix=f"auctionvault-{upload_ts}-"))
        temp = True
    upload = upload_table(upload_ts, entry["sv_sha256"], entry["sv_bytes"], parsed.meta)
    write_landing(parsed, upload, out)
    (out / "AuctionVault.lua").write_bytes(data)
    print(f"\nlanding files ({upload_ts}) in {out}:")
    for p in sorted(out.iterdir()):
        print(f"  {p.name:<18} {p.stat().st_size:>12,} bytes")

    if args.dry_run:
        print("\ndry run: nothing uploaded")
        return 0

    # 4. Upload.
    print()
    dest = up.upload_dir(out, upload_ts, w=w)
    arc.Manifest(args.raw_dir).mark_uploaded(entry["sv_sha256"], upload_ts, dest)
    print(f"published {dest}")
    if temp:
        shutil.rmtree(out)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m ingest", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("publish", help="archive, parse and upload a SavedVariables file")
    p.add_argument("--sv", default=str(DEFAULT_SV),
                   help=f"SavedVariables file to read (read-only). Default: {DEFAULT_SV}")
    p.add_argument("--dry-run", action="store_true",
                   help="archive and parse, write landing files locally, upload nothing")
    p.add_argument("--out", help="write landing dirs under this directory "
                                 "(default: a temp dir, kept for --dry-run)")
    p.add_argument("--raw-dir", default=str(arc.RAW_DIR),
                   help="archive directory (default: data/raw)")
    args = ap.parse_args(argv)
    return {"publish": publish}[args.cmd](args)
