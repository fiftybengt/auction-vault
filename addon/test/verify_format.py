#!/usr/bin/env python3
"""Proves the AuctionVault SavedVariables format contract before any pipeline exists.

    python3 addon/test/verify_format.py <path/to/AuctionVault.lua>

Parses the file with no third-party dependencies, checks the invariants that the ingester
will rely on, and prints a scan summary. This is deliberately the seed of what becomes
pipeline/auctionvault/svread.py -- if this stays simple, the format is right.
"""

import re
import sys
import time
from pathlib import Path

# Schema 2 appended `icon`. A 9-field entry (schema 1, or an item not seen since the upgrade)
# means the icon is unknown, so both lengths are valid in the same file.
ITEM_FIELDS = ["name", "quality", "item_level", "req_level", "item_type",
               "sub_type", "stack_max", "vendor_sell", "equip_loc", "icon"]
ITEM_FIELD_COUNTS = (len(ITEM_FIELDS) - 1, len(ITEM_FIELDS))
SCHEMAS = (1, 2)
ROW_FIELDS = ["item_key", "stack_count", "min_bid", "buyout", "bid_amount",
              "time_left", "seller_idx"]


def _block(text, name):
    """The body of a top-level `NAME = { ... }` assignment."""
    m = re.search(rf"^{name} = \{{$(.*?)^\}}$", text, re.S | re.M)
    return m.group(1) if m else ""


def _scalar(raw):
    if raw.startswith('"'):
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if raw == "true":
        return True
    if raw == "false":
        return False
    return float(raw) if "." in raw else int(raw)


def _array(record, key):
    m = re.search(rf'\["{key}"\] = \{{$\n(.*?)^\t\t\}},$', record, re.S | re.M)
    if not m:
        return []
    return re.findall(r'"(.*?)", -- \[\d+\]', m.group(1))


# itemKey -> number of `|`-separated fields, as last seen by read().
FIELD_COUNTS = {}

# C1 icon character set, enforced at every stage.
ICON_RE = re.compile(r"[a-z0-9_&-]+")


def read(path):
    FIELD_COUNTS.clear()
    text = Path(path).read_text(encoding="utf-8", errors="replace")

    meta = {k: _scalar(v) for k, v in
            re.findall(r'\["(\w+)"\] = (.+),', _block(text, "AUCTIONVAULT_META"))}

    items = {}
    for key, val in re.findall(r'\["([^"]+)"\] = "([^"]*)"',
                               _block(text, "AUCTIONVAULT_ITEMS")):
        parts = val.split("|")
        # Field counts are kept out of the item dict: ingest/tests/test_svread.py compares
        # item values against svread's, so a synthetic key here breaks that agreement test.
        FIELD_COUNTS[key] = len(parts)
        items[key] = dict(zip(ITEM_FIELDS, parts))

    # Scans are array elements, so each record closes with `}, -- [n]`.
    scans = []
    for record in re.findall(r"^\t\{$\n(.*?)^\t\}, -- \[\d+\]$",
                             _block(text, "AUCTIONVAULT_SCANS"), re.S | re.M):
        scan = {k: _scalar(v) for k, v in
                re.findall(r'^\t\t\["(\w+)"\] = ([^{].*),$', record, re.M)}
        scan["sellers"] = _array(record, "sellers")
        scan["rows"] = [dict(zip(ROW_FIELDS, row.split(",")))
                        for chunk in _array(record, "rows")
                        for row in chunk.split(";") if row]
        scans.append(scan)

    return meta, items, scans


def money(copper):
    copper = int(copper)
    return f"{copper // 10000}g {copper % 10000 // 100}s {copper % 100}c"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    started = time.time()
    meta, items, scans = read(sys.argv[1])
    elapsed = time.time() - started

    print(f"parsed in {elapsed:.2f}s -- schema {meta.get('schema')}, "
          f"addon v{meta.get('addonVersion')}, {len(items)} items, {len(scans)} scans\n")

    failures = []
    if not scans:
        print("  FAIL  no scans in the file -- nothing was captured")
        return 1


    def check(cond, msg):
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            failures.append(msg)

    print("items")
    check(meta.get("schema") in SCHEMAS, f"schema {meta.get('schema')} is one of {SCHEMAS}")
    check(all(n in ITEM_FIELD_COUNTS for n in FIELD_COUNTS.values()),
          f"every item entry has {ITEM_FIELD_COUNTS[0]} or {ITEM_FIELD_COUNTS[1]} fields")
    icons = [i["icon"] for i in items.values() if "icon" in i]
    check(all(ICON_RE.fullmatch(ic) for ic in icons),
          "every icon matches the C1 character set ^[a-z0-9_&-]+$")
    print(f"  note   {len(icons)} of {len(items)} items have an icon\n")

    for scan in scans:
        print(f"{scan['id']}  [{scan['mode']}/{scan['source']}]")
        rows = scan["rows"]
        check(len(rows) == scan["rowCount"],
              f"rowCount {scan['rowCount']} matches {len(rows)} parsed rows")
        check(all(len(r) == len(ROW_FIELDS) for r in rows), "every row has 7 fields")

        # Not a failure: the client fills its item cache lazily, so early scans legitimately
        # reference items the dimension has not learned yet.
        unknown = sum(1 for r in rows if r["item_key"] not in items)
        print(f"  note   {unknown} rows ({unknown / len(rows):.1%}) reference an item not "
              f"yet in the dimension")

        nil_owner = sum(1 for r in rows if r["seller_idx"] == "0")
        check(nil_owner == scan["nilOwners"],
              f"nilOwners {scan['nilOwners']} matches {nil_owner} rows with seller_idx 0")
        check(all(0 <= int(r["seller_idx"]) <= len(scan["sellers"]) for r in rows),
              "every seller index is in range")
        check(all(1 <= int(r["time_left"]) <= 4 for r in rows),
              "every timeLeft is a valid 1-4 bucket")
        check(scan["complete"] is True, "scan is marked complete")

        print(f"  {len(rows):,} listings, {len(scan['sellers'])} sellers, "
              f"{nil_owner / len(rows):.0%} without a seller name, "
              f"{scan['endedAt'] - scan['startedAt']}s to harvest")

        # The whole point of capturing full listings: real per-unit prices with depth.
        depth = {}
        for r in rows:
            buyout, stack = int(r["buyout"]), int(r["stack_count"])
            if buyout > 0:
                depth.setdefault(r["item_key"], []).append(buyout / stack)

        liquid = [(min(p), len(p), k) for k, p in depth.items() if len(p) >= 5]
        liquid.sort()
        print("\n  cheapest per-unit items with 5+ listings:")
        for unit, n, key in liquid[:10]:
            name = items.get(key, {}).get("name", f"<unknown {key}>")
            print(f"    {money(unit):>22}  x{n:<4} {name}")
        print()

    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("format contract holds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
