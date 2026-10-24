"""Shape check for the site JSON, contract C4 v2 (docs/contracts.md).

    python export/check_c4.py <data_dir>

Checks every file's keys and value types, the columnar index, sort orders, file names, and
that money is integer copper or null (never a float, never a bool).
"""

import json
import sys
from pathlib import Path

INDEX_COLS = ["key", "id", "name", "quality", "class", "subclass", "median", "min", "listings", "lastSeenAt"]


class Check:
    def __init__(self):
        self.errors = []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def keys(self, where, obj, expected):
        if not isinstance(obj, dict):
            self.err(where, f"expected object, got {type(obj).__name__}")
            return False
        if set(obj) != set(expected):
            self.err(where, f"keys {sorted(obj)} != {sorted(expected)}")
            return False
        return True

    def int_(self, where, v, nullable=False):
        if v is None and nullable:
            return
        if not isinstance(v, int) or isinstance(v, bool):
            self.err(where, f"expected int{' or null' if nullable else ''}, got {v!r}")

    def num(self, where, v, nullable=False):
        if v is None and nullable:
            return
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            self.err(where, f"expected number, got {v!r}")

    def str_(self, where, v, nullable=False):
        if v is None and nullable:
            return
        if not isinstance(v, str):
            self.err(where, f"expected string, got {v!r}")

    def bool_(self, where, v):
        if not isinstance(v, bool):
            self.err(where, f"expected bool, got {v!r}")

    def list_(self, where, v):
        if not isinstance(v, list):
            self.err(where, f"expected array, got {type(v).__name__}")
            return []
        return v

    def sorted_at(self, where, series):
        ats = [p.get("at") for p in series if isinstance(p, dict)]
        if any(a is None for a in ats) or ats != sorted(ats):
            self.err(where, "series not sorted ascending by at")


def load(c, path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        c.err(path.name, f"unreadable JSON: {e}")
        return None


def check_market(c, d, m):
    w = d.name
    meta = load(c, d / "meta.json")
    if meta is not None and c.keys(f"{w}/meta.json", meta, [
            "generatedAt", "lastScan", "lastCompleteScan", "scanCount", "completeScanCount", "itemCount"]):
        c.int_(f"{w}/meta.generatedAt", meta["generatedAt"])
        ls = meta["lastScan"]
        if ls is None or c.keys(f"{w}/meta.lastScan", ls, ["id", "at", "rowCount", "expectedTotal", "complete"]):
            if ls is not None:
                c.str_(f"{w}/meta.lastScan.id", ls["id"])
                c.int_(f"{w}/meta.lastScan.at", ls["at"])
                c.int_(f"{w}/meta.lastScan.rowCount", ls["rowCount"])
                c.int_(f"{w}/meta.lastScan.expectedTotal", ls["expectedTotal"])
                c.bool_(f"{w}/meta.lastScan.complete", ls["complete"])
        lc = meta["lastCompleteScan"]
        if lc is not None and c.keys(f"{w}/meta.lastCompleteScan", lc, ["id", "at", "rowCount"]):
            c.str_(f"{w}/meta.lastCompleteScan.id", lc["id"])
            c.int_(f"{w}/meta.lastCompleteScan.at", lc["at"])
            c.int_(f"{w}/meta.lastCompleteScan.rowCount", lc["rowCount"])
        for k in ("scanCount", "completeScanCount", "itemCount"):
            c.int_(f"{w}/meta.{k}", meta[k])
        if m is not None:
            if meta["scanCount"] != m.get("scans"):
                c.err(f"{w}/meta.json", "scanCount != markets.json scans")
            if (lc["at"] if lc else None) != m.get("lastCompleteScanAt"):
                c.err(f"{w}/meta.json", "lastCompleteScan.at != markets.json lastCompleteScanAt")
        if lc is None and meta["completeScanCount"] != 0:
            c.err(f"{w}/meta.json", "lastCompleteScan is null but completeScanCount > 0")
    has_current = bool(meta and meta.get("lastCompleteScan"))

    idx = load(c, d / "index.json")
    keys = set()
    if idx is not None and c.keys(f"{w}/index.json", idx, ["cols", "rows"]):
        if idx["cols"] != INDEX_COLS:
            c.err(f"{w}/index.json", f"cols {idx['cols']} != {INDEX_COLS}")
        for i, r in enumerate(c.list_(f"{w}/index.rows", idx["rows"])):
            at = f"{w}/index.rows[{i}]"
            if not isinstance(r, list) or len(r) != len(INDEX_COLS):
                c.err(at, "row length != cols")
                continue
            key, iid, name, quality, cls, sub, median, mn, listings, last_seen = r
            c.str_(at + ".key", key)
            c.int_(at + ".id", iid)
            c.str_(at + ".name", name, nullable=True)
            c.int_(at + ".quality", quality, nullable=True)
            c.str_(at + ".class", cls, nullable=True)
            c.str_(at + ".subclass", sub, nullable=True)
            c.int_(at + ".median", median, nullable=True)
            c.int_(at + ".min", mn, nullable=True)
            c.int_(at + ".listings", listings)
            c.int_(at + ".lastSeenAt", last_seen)
            if not has_current and (median is not None or mn is not None or listings != 0):
                c.err(at, "current values present but there is no complete scan")
            if key in keys:
                c.err(at, f"duplicate key {key}")
            keys.add(key)
        if meta is not None and meta.get("itemCount") != len(idx["rows"]):
            c.err(f"{w}/meta.json", "itemCount != index rows")

    ov = load(c, d / "overview.json")
    if ov is not None and c.keys(f"{w}/overview.json", ov, ["series"]):
        series = c.list_(f"{w}/overview.series", ov["series"])
        for i, p in enumerate(series):
            at = f"{w}/overview.series[{i}]"
            if c.keys(at, p, ["at", "complete", "coverage", "listings", "quantity", "items", "sellers"]):
                c.int_(at + ".at", p["at"])
                c.bool_(at + ".complete", p["complete"])
                c.num(at + ".coverage", p["coverage"], nullable=True)
                for k in ("listings", "quantity", "items", "sellers"):
                    c.int_(f"{at}.{k}", p[k])
        c.sorted_at(f"{w}/overview.series", series)
        if meta is not None and len(series) != meta.get("scanCount"):
            c.err(f"{w}/overview.json", "series length != meta.scanCount")

    mv = load(c, d / "movers.json")
    if mv is not None and c.keys(f"{w}/movers.json", mv, ["minListings", "windows"]):
        c.int_(f"{w}/movers.minListings", mv["minListings"])
        wins = mv["windows"]
        if not isinstance(wins, dict) or not set(wins) <= {"1d", "7d"}:
            c.err(f"{w}/movers.windows", f"unexpected windows {wins!r}")
        else:
            for name, win in wins.items():
                at = f"{w}/movers.windows.{name}"
                if not c.keys(at, win, ["prevAt", "up", "down"]):
                    continue
                c.int_(at + ".prevAt", win["prevAt"])
                for side in ("up", "down"):
                    for i, r in enumerate(c.list_(f"{at}.{side}", win[side])):
                        ra = f"{at}.{side}[{i}]"
                        if c.keys(ra, r, ["key", "name", "quality", "median", "prev", "pct", "listings"]):
                            c.str_(ra + ".key", r["key"])
                            c.str_(ra + ".name", r["name"], nullable=True)
                            c.int_(ra + ".quality", r["quality"], nullable=True)
                            c.int_(ra + ".median", r["median"])
                            c.int_(ra + ".prev", r["prev"])
                            c.num(ra + ".pct", r["pct"])
                            c.int_(ra + ".listings", r["listings"])
                            if side == "up" and r["pct"] <= 0 or side == "down" and r["pct"] >= 0:
                                c.err(ra, f"pct {r['pct']} on the wrong side")

    items_dir = d / "items"
    files = {p.stem for p in items_dir.glob("*.json")} if items_dir.is_dir() else set()
    expected = {k.replace(":", "_") for k in keys}
    if files != expected:
        c.err(f"{w}/items", f"{len(expected - files)} index items without a file, "
                            f"{len(files - expected)} files not in the index")
    for p in sorted(items_dir.glob("*.json")) if items_dir.is_dir() else []:
        at = f"{w}/items/{p.name}"
        o = load(c, p)
        if o is None or not c.keys(at, o, ["item", "history", "listings"]):
            continue
        it = o["item"]
        if c.keys(at + ".item", it, ["key", "id", "suffixId", "name", "quality", "itemLevel", "reqLevel",
                                      "itemType", "itemSubtype", "stackMax", "vendorSell", "equipLoc"]):
            if it["key"].replace(":", "_") != p.stem:
                c.err(at, "file name does not match item.key")
            c.int_(at + ".item.id", it["id"])
            for k in ("suffixId", "quality", "itemLevel", "reqLevel", "stackMax", "vendorSell"):
                c.int_(f"{at}.item.{k}", it[k], nullable=True)
            for k in ("name", "itemType", "itemSubtype", "equipLoc"):
                c.str_(f"{at}.item.{k}", it[k], nullable=True)
        hist = c.list_(at + ".history", o["history"])
        for i, h in enumerate(hist):
            ha = f"{at}.history[{i}]"
            if c.keys(ha, h, ["at", "min", "p25", "median", "p75", "listings", "quantity"]):
                c.int_(ha + ".at", h["at"])
                for k in ("min", "p25", "median", "p75"):
                    c.int_(f"{ha}.{k}", h[k], nullable=True)
                c.int_(ha + ".listings", h["listings"])
                c.int_(ha + ".quantity", h["quantity"])
        c.sorted_at(at + ".history", hist)
        lst = c.list_(at + ".listings", o["listings"])
        if lst and not has_current:
            c.err(at, "listings present but there is no complete scan")
        units = []
        for i, r in enumerate(lst):
            la = f"{at}.listings[{i}]"
            if c.keys(la, r, ["stack", "minBid", "buyout", "unit", "bid", "timeLeft", "seller"]):
                c.int_(la + ".stack", r["stack"])
                c.int_(la + ".minBid", r["minBid"])
                for k in ("buyout", "unit", "bid"):
                    c.int_(f"{la}.{k}", r[k], nullable=True)
                    if r[k] == 0:
                        c.err(la, f"{k} is 0; 'none' must be null")
                if (r["buyout"] is None) != (r["unit"] is None):
                    c.err(la, "buyout and unit must be null together")
                if r["timeLeft"] not in (1, 2, 3, 4):
                    c.err(la, f"timeLeft {r['timeLeft']!r} not in 1..4")
                c.str_(la + ".seller", r["seller"], nullable=True)
                units.append(r["unit"])
        nn = [u for u in units if u is not None]
        if nn != sorted(nn) or units != nn + [None] * (len(units) - len(nn)):
            c.err(at + ".listings", "not sorted by unit ascending, nulls last")

    sellers_dir = d / "sellers"
    for p in sorted(sellers_dir.glob("*.json")) if sellers_dir.is_dir() else []:
        at = f"{w}/sellers/{p.name}"
        o = load(c, p)
        if o is None or not c.keys(at, o, ["seller", "listings", "items"]):
            continue
        if o["seller"] != p.stem:
            c.err(at, "file name is not the raw seller name")
        if not has_current:
            c.err(at, "seller file present but there is no complete scan")
        c.int_(at + ".listings", o["listings"])
        for i, e in enumerate(c.list_(at + ".items", o["items"])):
            ea = f"{at}.items[{i}]"
            if c.keys(ea, e, ["key", "name", "quality", "count", "unit"]):
                c.str_(ea + ".key", e["key"])
                c.str_(ea + ".name", e["name"], nullable=True)
                c.int_(ea + ".quality", e["quality"], nullable=True)
                c.int_(ea + ".count", e["count"])
                c.int_(ea + ".unit", e["unit"], nullable=True)


def check(out):
    """Return a list of C4 v2 violations under `out` (empty list = valid)."""
    out = Path(out)
    c = Check()
    mk = load(c, out / "markets.json") if (out / "markets.json").exists() else None
    if mk is None:
        c.err("markets.json", "missing")
        return c.errors
    by_slug = {}
    for i, m in enumerate(c.list_("markets.json", mk)):
        at = f"markets.json[{i}]"
        if c.keys(at, m, ["slug", "realm", "faction", "lastScanAt", "lastCompleteScanAt", "scans"]):
            for k in ("slug", "realm", "faction"):
                c.str_(f"{at}.{k}", m[k])
            c.int_(at + ".lastScanAt", m["lastScanAt"])
            c.int_(at + ".lastCompleteScanAt", m["lastCompleteScanAt"], nullable=True)
            c.int_(at + ".scans", m["scans"])
            by_slug[m["slug"]] = m
    for slug, m in sorted(by_slug.items()):
        d = out / slug
        if not d.is_dir():
            c.err(slug, "market directory missing")
            continue
        check_market(c, d, m)
    return c.errors


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    errs = check(sys.argv[1])
    for e in errs:
        print(e)
    print("OK" if not errs else f"{len(errs)} violation(s)")
    sys.exit(1 if errs else 0)
