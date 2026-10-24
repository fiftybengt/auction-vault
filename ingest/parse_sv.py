"""SavedVariables (C1) -> landing Parquet (C2 v1).

    python -m ingest.parse_sv <AuctionVault.lua> <out_dir>

Writes scans.parquet, listings.parquet, items.parquet and upload.parquet. The pyarrow
schemas below are the single in-code definition of contract C2.
"""

import hashlib
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from . import PARSER_VERSION
from .svread import decode, read_text

SUPPORTED_SCHEMA = 1

# ------------------------------------------------------------------ C2 v1, defined once

SCANS_SCHEMA = pa.schema([
    ("scan_id", pa.string()),
    ("started_at", pa.int64()),
    ("ended_at", pa.int64()),
    ("realm", pa.string()),
    ("faction", pa.string()),
    ("player", pa.string()),
    ("mode", pa.string()),
    ("source", pa.string()),
    ("row_count", pa.int32()),
    ("expected_total", pa.int32()),
    ("complete", pa.bool_()),
    ("nil_owners", pa.int32()),
    ("unresolved", pa.int32()),
])

LISTINGS_SCHEMA = pa.schema([
    ("scan_id", pa.string()),
    ("row_no", pa.int32()),
    ("item_key", pa.string()),
    ("item_id", pa.int32()),
    ("suffix_id", pa.int32()),
    ("stack_count", pa.int32()),
    ("min_bid", pa.int64()),
    ("buyout", pa.int64()),
    ("bid_amount", pa.int64()),
    ("time_left", pa.int8()),
    ("seller", pa.string()),
])

ITEMS_SCHEMA = pa.schema([
    ("item_key", pa.string()),
    ("item_id", pa.int32()),
    ("suffix_id", pa.int32()),
    ("name", pa.string()),
    ("quality", pa.int8()),
    ("item_level", pa.int16()),
    ("req_level", pa.int16()),
    ("item_type", pa.string()),
    ("item_subtype", pa.string()),
    ("stack_max", pa.int16()),
    ("vendor_sell", pa.int64()),
    ("equip_loc", pa.string()),
])

UPLOAD_SCHEMA = pa.schema([
    ("upload_ts", pa.string()),
    ("sv_sha256", pa.string()),
    ("sv_bytes", pa.int64()),
    ("schema", pa.int32()),
    ("addon_version", pa.string()),
    ("parser_version", pa.string()),
])

SCHEMAS = {
    "scans.parquet": SCANS_SCHEMA,
    "listings.parquet": LISTINGS_SCHEMA,
    "items.parquet": ITEMS_SCHEMA,
    "upload.parquet": UPLOAD_SCHEMA,
}

# SV key -> C2 column, for the scan-level scalars.
_SCAN_FIELDS = [
    ("id", "scan_id", str), ("startedAt", "started_at", int), ("endedAt", "ended_at", int),
    ("realm", "realm", str), ("faction", "faction", str), ("player", "player", str),
    ("mode", "mode", str), ("source", "source", str), ("rowCount", "row_count", int),
    ("expectedTotal", "expected_total", int), ("complete", "complete", bool),
    ("nilOwners", "nil_owners", int), ("unresolved", "unresolved", int),
]


class SVError(ValueError):
    """The file breaks contract C1. The message names the scan (or item) at fault."""


@dataclass
class Parsed:
    scans: pa.Table
    listings: pa.Table
    items: pa.Table
    meta: dict
    summary: list  # one dict per scan, for printing
    warnings: list


def _split_key(key, where):
    try:
        item_id, suffix_id = key.split(":")
        return int(item_id), int(suffix_id)
    except ValueError:
        raise SVError(f"{where}: bad item key {key!r}") from None


def _scan_row(scan, n):
    sid = scan.get("id", f"<scan #{n} without id>")
    out = {}
    for sv, col, typ in _SCAN_FIELDS:
        if sv not in scan:
            raise SVError(f"scan {sid}: missing field {sv!r}")
        v = scan[sv]
        if typ is bool:
            ok = isinstance(v, bool)
        elif typ is int:
            ok = isinstance(v, int) and not isinstance(v, bool)
        else:
            ok = isinstance(v, str)
        if not ok:
            raise SVError(f"scan {sid}: field {sv!r} is {v!r}, expected {typ.__name__}")
        out[col] = v
    return out


def _parse_listings(scan, cols):
    """Append one scan's rows to the column lists, validating as we go."""
    sid = scan["id"]
    sellers = scan["sellers"]
    nsellers = len(sellers)
    rows = scan["rows"]
    if len(rows) != scan["rowCount"]:
        raise SVError(f"scan {sid}: rowCount {scan['rowCount']} but {len(rows)} rows parsed")

    key_cache = {}
    nil_owner = 0
    (c_scan, c_row, c_key, c_id, c_suf, c_stack, c_minbid, c_buyout, c_bid, c_tl,
     c_seller) = cols
    for row_no, row in enumerate(rows, 1):
        f = row.split(",")
        if len(f) != 7:
            raise SVError(f"scan {sid} row {row_no}: {len(f)} fields, expected 7: {row!r}")
        key = f[0]
        ids = key_cache.get(key)
        if ids is None:
            ids = key_cache[key] = _split_key(key, f"scan {sid} row {row_no}")
        try:
            stack, min_bid, buyout, bid, tl, si = (int(x) for x in f[1:])
        except ValueError:
            raise SVError(f"scan {sid} row {row_no}: non-integer field: {row!r}") from None
        if not 1 <= tl <= 4:
            raise SVError(f"scan {sid} row {row_no}: timeLeft {tl} not in 1-4")
        if not 0 <= si <= nsellers:
            raise SVError(f"scan {sid} row {row_no}: sellerIdx {si} out of range "
                          f"0-{nsellers}")
        if si == 0:
            nil_owner += 1
        c_scan.append(sid)
        c_row.append(row_no)
        c_key.append(key)
        c_id.append(ids[0])
        c_suf.append(ids[1])
        c_stack.append(stack)
        c_minbid.append(min_bid)
        c_buyout.append(buyout)
        c_bid.append(bid)
        c_tl.append(tl)
        c_seller.append(sellers[si - 1] if si else None)
    return nil_owner, set(key_cache)


def _int_or_none(s):
    return int(s) if s != "" else None


def _parse_items(items):
    cols = {name: [] for name in ITEMS_SCHEMA.names}
    for key, raw in items.items():
        f = raw.split("|")
        if len(f) != 9:
            raise SVError(f"item {key}: {len(f)} fields, expected 9: {raw!r}")
        item_id, suffix_id = _split_key(key, f"item {key}")
        name, quality, ilvl, req, itype, isub, stack_max, vendor, equip = f
        try:
            vals = [_int_or_none(x) for x in (quality, ilvl, req, stack_max, vendor)]
        except ValueError:
            raise SVError(f"item {key}: non-integer numeric field: {raw!r}") from None
        for col, v in zip(("item_key", "item_id", "suffix_id", "name", "item_type",
                           "item_subtype", "equip_loc"),
                          (key, item_id, suffix_id, name, itype, isub, equip)):
            cols[col].append(v)
        for col, v in zip(("quality", "item_level", "req_level", "stack_max",
                           "vendor_sell"), vals):
            cols[col].append(v)
    return pa.Table.from_pydict(cols, schema=ITEMS_SCHEMA)


def parse(text):
    """Parse and validate SavedVariables text. Raises SVError on any contract breach."""
    meta, items, scans = read_text(text)
    warnings = []

    if meta.get("schema") != SUPPORTED_SCHEMA:
        raise SVError(f"AUCTIONVAULT_META.schema is {meta.get('schema')!r}, "
                      f"this parser reads schema {SUPPORTED_SCHEMA}")
    if not scans:
        raise SVError("no scans in the file")

    scan_rows = [_scan_row(s, n) for n, s in enumerate(scans, 1)]
    dupes = [k for k, c in Counter(r["scan_id"] for r in scan_rows).items() if c > 1]
    if dupes:
        raise SVError(f"duplicate scan ids in one file: {dupes}")

    cols = [[] for _ in LISTINGS_SCHEMA.names]
    summary = []
    for scan in scans:
        nil_owner, keys = _parse_listings(scan, cols)
        if nil_owner != scan["nilOwners"]:
            warnings.append(f"scan {scan['id']}: nilOwners {scan['nilOwners']} but "
                            f"{nil_owner} rows have sellerIdx 0")
        summary.append({
            "scan_id": scan["id"], "started_at": scan["startedAt"],
            "mode": scan["mode"], "source": scan["source"], "rows": len(scan["rows"]),
            "expected_total": scan["expectedTotal"], "complete": scan["complete"],
            "sellers": len(scan["sellers"]), "nil_owners": nil_owner,
            "unknown_items": len(keys - items.keys()),
        })

    scans_t = pa.Table.from_pylist(scan_rows, schema=SCANS_SCHEMA)
    listings_t = pa.Table.from_arrays(
        [pa.array(c, type=f.type) for c, f in zip(cols, LISTINGS_SCHEMA)],
        schema=LISTINGS_SCHEMA)
    return Parsed(scans_t, listings_t, _parse_items(items), meta, summary, warnings)


def upload_table(upload_ts, sv_sha256, sv_bytes, meta):
    return pa.Table.from_pylist([{
        "upload_ts": upload_ts, "sv_sha256": sv_sha256, "sv_bytes": sv_bytes,
        "schema": meta.get("schema"), "addon_version": str(meta.get("addonVersion")),
        "parser_version": PARSER_VERSION,
    }], schema=UPLOAD_SCHEMA)


def write_landing(parsed, upload, out_dir):
    """Write the four C2 Parquet files into out_dir. Returns {filename: path}."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tables = {"scans.parquet": parsed.scans, "listings.parquet": parsed.listings,
              "items.parquet": parsed.items, "upload.parquet": upload}
    paths = {}
    for name, table in tables.items():
        assert table.schema.equals(SCHEMAS[name]), name
        paths[name] = out_dir / name
        pq.write_table(table, paths[name], compression="snappy")
    return paths


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        sys.exit(__doc__)
    from datetime import datetime, timezone
    data = Path(argv[0]).read_bytes()
    parsed = parse(decode(data))
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    up = upload_table(ts, hashlib.sha256(data).hexdigest(), len(data), parsed.meta)
    for p in write_landing(parsed, up, argv[1]).values():
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
