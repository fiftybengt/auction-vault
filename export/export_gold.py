"""Gold tables (C3) -> site JSON (C4 v3).

    scripts/with-databricks dbt/.venv/bin/python export/export_gold.py [--out site/public/data]
    dbt/.venv/bin/python export/export_gold.py --check-only <dir>     # shape check, no warehouse

Reads DATABRICKS_HOST / DATABRICKS_TOKEN / DATABRICKS_HTTP_PATH from the environment.
Output is deterministic: sorted keys, stable row order, and `generatedAt` is taken from the
data (newest bronze upload ingest time), so unchanged data gives byte-identical files.
Files whose content is unchanged are not rewritten. The whole market directory is rebuilt, so
stale item/seller files disappear.
"""

import argparse
import json
import os
import re
import shutil
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_c4 import check  # noqa: E402

CATALOG = "auction"
WARN_BYTES = 500 * 1024
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "site" / "public" / "data"
INDEX_COLS = ["key", "id", "name", "quality", "icon", "class", "subclass", "median", "min", "listings", "lastSeenAt"]
MOVERS_TOP = 10
WINDOWS = ("1d", "7d")
MIN_LISTINGS = 3  # must match the dbt var movers_min_listings (dbt/dbt_project.yml)


# ------------------------------------------------------------------ warehouse

def connect():
    from databricks import sql
    host = os.environ["DATABRICKS_HOST"].replace("https://", "").rstrip("/")
    return sql.connect(server_hostname=host, http_path=os.environ["DATABRICKS_HTTP_PATH"],
                       access_token=os.environ["DATABRICKS_TOKEN"])


def query(cur, sql, params=None):
    cur.execute(sql, params or {})
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def g(table):
    return f"{CATALOG}.gold.{table}"


def s(table):
    return f"{CATALOG}.silver.{table}"


# ------------------------------------------------------------------ helpers

def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def to_int(v):
    return None if v is None else int(v)


def money(v):
    """Integer copper, or None. Zero never stands in for 'none' here: callers pass None."""
    return None if v is None else int(v)


def file_key(item_key):
    return item_key.replace(":", "_")


def seller_filename_ok(name):
    return bool(name) and "/" not in name and "\0" not in name and name not in (".", "..")


def dumps(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


class Writer:
    def __init__(self):
        self.files = {}  # relative path -> text

    def put(self, rel, obj):
        self.files[rel] = dumps(obj)

    def flush(self, out, slugs):
        out.mkdir(parents=True, exist_ok=True)
        # rebuild every market dir we own, and drop market dirs that no longer exist
        for child in out.iterdir():
            if child.is_dir() and (child.name in slugs or (child / "meta.json").exists()):
                keep = {p for p in self.files if p.startswith(child.name + "/")}
                for f in sorted(child.rglob("*"), reverse=True):
                    rel = f.relative_to(out).as_posix()
                    if f.is_file() and rel not in keep:
                        f.unlink()
                    elif f.is_dir() and not any(f.iterdir()):
                        f.rmdir()
        written = 0
        for rel, text in sorted(self.files.items()):
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            data = text.encode()
            if p.exists() and p.read_bytes() == data:
                continue
            p.write_bytes(data)
            written += 1
        return written


# ------------------------------------------------------------------ build

def build(cur):
    w = Writer()
    generated = query(cur, f"select cast(max(unix_timestamp(_ingested_at)) as bigint) as t "
                           f"from {CATALOG}.bronze.upload")[0]["t"]
    scans = query(cur, f"""
        select realm, faction, scan_id, scan_at, complete, coverage, row_count, expected_total,
               listings, quantity, items, sellers
        from {g('market_overview')} order by realm, faction, scan_at, scan_id""")
    current = {(r["realm"], r["faction"]): r for r in query(cur, f"select * from {g('latest_scan')}")}

    by_market = defaultdict(list)
    for r in scans:
        by_market[(r["realm"], r["faction"])].append(r)

    markets = []
    for (realm, faction), mscans in sorted(by_market.items()):
        slug = slugify(f"{realm}-{faction}")
        cur_scan = current.get((realm, faction))
        markets.append({"slug": slug, "realm": realm, "faction": faction,
                        "lastScanAt": mscans[-1]["scan_at"],
                        "lastCompleteScanAt": cur_scan["scan_at"] if cur_scan else None,
                        "scans": len(mscans)})
        build_market(cur, w, slug, realm, faction, mscans, cur_scan, generated)
    w.put("markets.json", markets)
    return w, {m["slug"] for m in markets}


def build_market(cur, w, slug, realm, faction, mscans, cur_scan, generated):
    p = {"realm": realm, "faction": faction}
    cur_id = cur_scan["scan_id"] if cur_scan else None

    # overview: every scan, flagged
    w.put(f"{slug}/overview.json", {"series": [
        {"at": r["scan_at"], "complete": bool(r["complete"]),
         "coverage": None if r["coverage"] is None else round(float(r["coverage"]), 4),
         "listings": r["listings"], "quantity": to_int(r["quantity"]),
         "items": r["items"], "sellers": r["sellers"]} for r in mscans]})

    # items seen in this market in any scan, with current values from the newest complete scan
    items = query(cur, f"""
        with seen as (
            select item_key, max(scan_at) as last_seen_at
            from {g('item_scan_stats')} where realm = :realm and faction = :faction
            group by item_key),
        now as (
            select item_key, median_unit, min_unit, listings
            from {g('item_scan_stats')}
            where realm = :realm and faction = :faction and scan_id = :cur)
        select s.item_key, i.item_id, i.suffix_id, i.name, i.quality, i.item_level, i.req_level,
               i.item_type, i.item_subtype, i.stack_max, i.vendor_sell, i.equip_loc, i.icon,
               s.last_seen_at, n.median_unit, n.min_unit, coalesce(n.listings, 0) as listings
        from seen s
        left join {s('items')} i on i.item_key = s.item_key
        left join now n on n.item_key = s.item_key
        order by s.item_key""", {**p, "cur": cur_id})

    def item_id(r):
        return r["item_id"] if r["item_id"] is not None else int(r["item_key"].split(":")[0])

    rows = [[r["item_key"], item_id(r), r["name"], to_int(r["quality"]), r["icon"], r["item_type"],
             r["item_subtype"], money(r["median_unit"]), money(r["min_unit"]), r["listings"],
             r["last_seen_at"]] for r in items]
    li = INDEX_COLS.index("listings")
    rows.sort(key=lambda x: (-x[li], x[2] or "", x[0]))
    w.put(f"{slug}/index.json", {"cols": INDEX_COLS, "rows": rows})

    complete_n = sum(1 for r in mscans if r["complete"])
    last = mscans[-1]
    w.put(f"{slug}/meta.json", {
        "generatedAt": generated,
        "lastScan": {"id": last["scan_id"], "at": last["scan_at"], "rowCount": last["row_count"],
                     "expectedTotal": last["expected_total"], "complete": bool(last["complete"])},
        "lastCompleteScan": None if cur_scan is None else {
            "id": cur_scan["scan_id"], "at": cur_scan["scan_at"], "rowCount": cur_scan["row_count"]},
        "scanCount": len(mscans),
        "completeScanCount": complete_n,
        "itemCount": len(rows),
    })

    # movers
    mv = query(cur, f"""
        select m.*, i.name, i.quality, i.icon from {g('movers')} m
        left join {s('items')} i on i.item_key = m.item_key
        where m.realm = :realm and m.faction = :faction""", p)
    windows = {}
    for win in WINDOWS:
        prev_at = next((r[f"at_{win}"] for r in mv if r[f"at_{win}"] is not None), None)
        if prev_at is None:
            continue
        ranked = [{"key": r["item_key"], "name": r["name"], "quality": to_int(r["quality"]),
                   "icon": r["icon"], "median": money(r["median_now"]), "prev": money(r[f"median_{win}"]),
                   "pct": float(r[f"pct_{win}"]), "listings": r["listings_now"]}
                  for r in mv if r[f"pct_{win}"] is not None]
        up = sorted((x for x in ranked if x["pct"] > 0), key=lambda x: (-x["pct"], x["key"]))
        down = sorted((x for x in ranked if x["pct"] < 0), key=lambda x: (x["pct"], x["key"]))
        windows[win] = {"prevAt": prev_at, "up": up[:MOVERS_TOP], "down": down[:MOVERS_TOP]}
    w.put(f"{slug}/movers.json", {"minListings": MIN_LISTINGS, "windows": windows})

    # per-item history (complete scans only) and current listings
    history = defaultdict(list)
    for r in query(cur, f"""
            select item_key, scan_at, min_unit, p25_unit, median_unit, p75_unit, listings, quantity
            from {g('item_scan_stats')}
            where realm = :realm and faction = :faction and complete
            order by item_key, scan_at, scan_id""", p):
        history[r["item_key"]].append({
            "at": r["scan_at"], "min": money(r["min_unit"]), "p25": money(r["p25_unit"]),
            "median": money(r["median_unit"]), "p75": money(r["p75_unit"]),
            "listings": r["listings"], "quantity": to_int(r["quantity"])})

    listings = defaultdict(list)
    sellers = defaultdict(lambda: {"listings": 0, "items": {}})
    names = {r["item_key"]: r for r in items}
    for r in query(cur, f"""
            select item_key, row_no, stack_count, min_bid, buyout, bid_amount, unit_buyout,
                   time_left, seller, name, quality, icon
            from {g('latest_listings')}
            where realm = :realm and faction = :faction
            order by item_key, unit_buyout asc nulls last, stack_count, row_no""", p):
        listings[r["item_key"]].append({
            "stack": r["stack_count"], "minBid": money(r["min_bid"]), "buyout": money(r["buyout"]),
            "unit": money(r["unit_buyout"]),
            "bid": money(r["bid_amount"]) if r["bid_amount"] else None,
            "timeLeft": to_int(r["time_left"]), "seller": r["seller"]})
        if r["seller"] is not None:
            sd = sellers[r["seller"]]
            sd["listings"] += 1
            e = sd["items"].setdefault(r["item_key"], {
                "key": r["item_key"], "name": r["name"], "quality": to_int(r["quality"]),
                "icon": r["icon"], "count": 0, "unit": None})
            e["count"] += 1
            u = money(r["unit_buyout"])
            if u is not None and (e["unit"] is None or u < e["unit"]):
                e["unit"] = u

    for key, r in names.items():
        w.put(f"{slug}/items/{file_key(key)}.json", {
            "item": {"key": key, "id": item_id(r), "suffixId": r["suffix_id"], "name": r["name"],
                     "quality": to_int(r["quality"]), "itemLevel": to_int(r["item_level"]),
                     "reqLevel": to_int(r["req_level"]), "itemType": r["item_type"],
                     "itemSubtype": r["item_subtype"], "stackMax": to_int(r["stack_max"]),
                     "vendorSell": money(r["vendor_sell"]), "equipLoc": r["equip_loc"],
                     "icon": r["icon"]},
            "history": history.get(key, []),
            "listings": listings.get(key, []),
        })

    for name, sd in sellers.items():
        if not seller_filename_ok(name):
            print(f"warning: seller name {name!r} is not a safe file name; skipped", file=sys.stderr)
            continue
        w.put(f"{slug}/sellers/{name}.json", {
            "seller": name, "listings": sd["listings"],
            "items": sorted(sd["items"].values(), key=lambda e: (-e["count"], e["name"] or "", e["key"]))})


# ------------------------------------------------------------------ main

def report(out):
    total, n, big = 0, 0, []
    for f in sorted(out.rglob("*.json")):
        size = f.stat().st_size
        total += size
        n += 1
        if size > WARN_BYTES:
            big.append((f.relative_to(out).as_posix(), size))
    print(f"{n} JSON files, {total / 1024:.1f} KB total in {out}")
    for rel, size in big:
        print(f"warning: {rel} is {size / 1024:.1f} KB (> {WARN_BYTES // 1024} KB)", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory (default: site/public/data)")
    ap.add_argument("--check-only", type=Path, metavar="DIR", help="only run the C4 shape check on DIR")
    args = ap.parse_args(argv)

    if args.check_only:
        out = args.check_only
    else:
        out = args.out
        with connect() as conn:
            cur = conn.cursor()
            w, slugs = build(cur)
        changed = w.flush(out, slugs)
        print(f"{len(w.files)} files exported, {changed} changed")

    errors = check(out)
    report(out)
    if errors:
        for e in errors[:50]:
            print(f"C4 violation: {e}", file=sys.stderr)
        print(f"{len(errors)} C4 violation(s)", file=sys.stderr)
        return 1
    print("C4 v3 shape check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
