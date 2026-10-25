"""Shape check for the site JSON, contract C4 v4 (docs/contracts.md).

    python export/check_c4.py <data_dir>

Checks every file's keys and value types, the columnar index, sort orders, file names, and
that money is integer copper or null (never a float, never a bool). For dashboard.json (v4) it
also checks the invariants: sort orders, list thresholds against `params`, `params` against the
dbt vars in dbt/dbt_project.yml, `values.all` = 100 on the first index point, breadth against
the last two points, and both extremes windows.
"""

import json
import math
import re
import sys
from pathlib import Path

INDEX_COLS = ["key", "id", "name", "quality", "icon", "class", "subclass", "median", "min", "listings", "lastSeenAt"]

ICON_RE = re.compile(r"[a-z0-9_&-]+")  # C1 icon character set ^[a-z0-9_&-]+$ (fullmatch)

# dashboard.json params (C4 v4) -> dbt var (dbt/dbt_project.yml)
DASHBOARD_PARAMS = {"dealPct": "deal_pct", "overPct": "over_pct", "minGainCopper": "min_gain_copper",
                    "indexMinListings": "index_min_listings", "refMinDays": "ref_min_days",
                    "refWindowDays": "ref_window_days", "refHalfLifeDays": "ref_half_life_days",
                    "breadthFlatPct": "breadth_flat_pct"}
DBT_PROJECT = Path(__file__).resolve().parent.parent / "dbt" / "dbt_project.yml"
PRICED_KEYS = ["key", "name", "quality", "icon", "bundle", "unit", "ref", "pct", "gain", "listings"]
EXTREME_KEYS = ["key", "name", "quality", "icon", "unit", "prev", "pct", "listings"]
VALUABLE_KEYS = ["key", "name", "quality", "icon", "unit", "min", "listings"]


def dbt_vars():
    """Integer vars from dbt_project.yml's `vars:` block (no YAML dependency), or None if absent."""
    if not DBT_PROJECT.exists():
        return None
    out, in_vars = {}, False
    for line in DBT_PROJECT.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\S", line):
            in_vars = line.startswith("vars:")
            continue
        m = in_vars and re.match(r"^  (\w+):\s*(-?\d+)\s*(#.*)?$", line)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v):
    """A JSON number: int or finite float (NaN/Infinity are not valid JSON), never a bool."""
    return is_int(v) or (isinstance(v, float) and math.isfinite(v))


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
        if not is_num(v):
            self.err(where, f"expected finite number, got {v!r}")

    def str_(self, where, v, nullable=False):
        if v is None and nullable:
            return
        if not isinstance(v, str):
            self.err(where, f"expected string, got {v!r}")

    def icon(self, where, v):
        """C4 v3: the C1 texture basename (never a URL), or null when unknown."""
        if v is None:
            return
        if not isinstance(v, str) or not ICON_RE.fullmatch(v):
            self.err(where, f"expected icon basename matching {ICON_RE.pattern} or null, got {v!r}")

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
            key, iid, name, quality, icon, cls, sub, median, mn, listings, last_seen = r
            c.str_(at + ".key", key)
            c.int_(at + ".id", iid)
            c.str_(at + ".name", name, nullable=True)
            c.int_(at + ".quality", quality, nullable=True)
            c.icon(at + ".icon", icon)
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
                        if c.keys(ra, r, ["key", "name", "quality", "icon", "median", "prev", "pct", "listings"]):
                            c.str_(ra + ".key", r["key"])
                            c.str_(ra + ".name", r["name"], nullable=True)
                            c.int_(ra + ".quality", r["quality"], nullable=True)
                            c.icon(ra + ".icon", r["icon"])
                            c.int_(ra + ".median", r["median"])
                            c.int_(ra + ".prev", r["prev"])
                            c.num(ra + ".pct", r["pct"])
                            c.int_(ra + ".listings", r["listings"])
                            if side == "up" and r["pct"] <= 0 or side == "down" and r["pct"] >= 0:
                                c.err(ra, f"pct {r['pct']} on the wrong side")

    check_dashboard(c, d, meta)

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
                                      "itemType", "itemSubtype", "stackMax", "vendorSell", "equipLoc",
                                      "icon"]):
            if it["key"].replace(":", "_") != p.stem:
                c.err(at, "file name does not match item.key")
            c.int_(at + ".item.id", it["id"])
            for k in ("suffixId", "quality", "itemLevel", "reqLevel", "stackMax", "vendorSell"):
                c.int_(f"{at}.item.{k}", it[k], nullable=True)
            for k in ("name", "itemType", "itemSubtype", "equipLoc"):
                c.str_(f"{at}.item.{k}", it[k], nullable=True)
            c.icon(at + ".item.icon", it["icon"])
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
            if c.keys(ea, e, ["key", "name", "quality", "icon", "count", "unit"]):
                c.str_(ea + ".key", e["key"])
                c.str_(ea + ".name", e["name"], nullable=True)
                c.int_(ea + ".quality", e["quality"], nullable=True)
                c.icon(ea + ".icon", e["icon"])
                c.int_(ea + ".count", e["count"])
                c.int_(ea + ".unit", e["unit"], nullable=True)


def check_dashboard(c, d, meta):
    w = f"{d.name}/dashboard"
    db = load(c, d / "dashboard.json") if (d / "dashboard.json").exists() else None
    if db is None:
        c.err(w, "dashboard.json missing")
        return
    if not c.keys(w, db, ["asOf", "historyDays", "params", "groups", "index", "breadth", "deals",
                          "overpriced", "extremes", "valuable"]):
        return
    as_of = db["asOf"]
    c.int_(w + ".asOf", as_of, nullable=True)
    c.int_(w + ".historyDays", db["historyDays"])
    lc = meta.get("lastCompleteScan") if isinstance(meta, dict) else None
    if meta is not None and as_of != (lc["at"] if lc else None):
        c.err(w, "asOf != meta.lastCompleteScan.at")

    # params: exact keys, ints, and equal to the dbt vars
    # A wrong key or type is reported, and the lists are still checked: a threshold whose
    # param is missing or not an int is skipped (lim[k] is None), never a traceback.
    prm = db["params"]
    c.keys(w + ".params", prm, list(DASHBOARD_PARAMS))
    prm = prm if isinstance(prm, dict) else {}
    lim = {}
    for k in DASHBOARD_PARAMS:
        if k in prm:
            c.int_(f"{w}.params.{k}", prm[k])
        lim[k] = prm[k] if is_int(prm.get(k)) else None
    dv = dbt_vars()
    if dv is not None:
        for k, var in DASHBOARD_PARAMS.items():
            if k in prm and dv.get(var) != prm[k]:
                c.err(w + ".params", f"{k}={prm[k]!r} but dbt var {var}={dv.get(var)!r}")

    # groups
    gids = []
    for i, gr in enumerate(c.list_(w + ".groups", db["groups"])):
        at = f"{w}.groups[{i}]"
        if c.keys(at, gr, ["id", "label"]):
            c.str_(at + ".id", gr["id"])
            c.str_(at + ".label", gr["label"])
            gids.append(gr["id"])
    if len(set(gids)) != len(gids) or "all" in gids:
        c.err(w + ".groups", f"ids must be unique and not 'all': {gids}")

    # index
    series = []
    if c.keys(w + ".index", db["index"], ["series"]):
        series = c.list_(w + ".index.series", db["index"]["series"])
    for i, pt in enumerate(series):
        at = f"{w}.index.series[{i}]"
        if not c.keys(at, pt, ["at", "values", "items"]):
            continue
        c.int_(at + ".at", pt["at"])
        c.int_(at + ".items", pt["items"])
        vals = pt["values"]
        if c.keys(at + ".values", vals, ["all"] + gids):
            for k, v in vals.items():
                c.num(f"{at}.values.{k}", v, nullable=True)
            if i == 0:
                # every series starts at 100: `all` always, each group wherever it is non-null
                if vals.get("all") != 100:
                    c.err(at, f"values.all is {vals.get('all')!r} on the first point, expected 100")
                for k, v in vals.items():
                    if k != "all" and v is not None and v != 100:
                        c.err(at, f"values.{k} is {v!r} on the first point, expected 100 or null")
        if i == 0 and pt["items"] != 0:
            c.err(at, f"items is {pt['items']!r} on the first point, expected 0 (no previous day)")
    ats = [pt.get("at") for pt in series if isinstance(pt, dict)]
    if any(not isinstance(a, int) for a in ats) or any(b <= a for a, b in zip(ats, ats[1:])):
        c.err(w + ".index.series", "not strictly ascending by at")
    if as_of is not None and len(series) != db["historyDays"]:
        c.err(w + ".index.series", "length != historyDays (one point per day with data)")

    # breadth
    br = db["breadth"]
    if len(series) < 2:
        if br is not None:
            c.err(w + ".breadth", "must be null with fewer than 2 index days")
    elif c.keys(w + ".breadth", br, ["at", "prevAt", "up", "down", "flat"]):
        for k in ("at", "prevAt", "up", "down", "flat"):
            c.int_(f"{w}.breadth.{k}", br[k])
        if br["at"] != series[-1].get("at") or br["prevAt"] != series[-2].get("at"):
            c.err(w + ".breadth", "at/prevAt are not the last two index points")
        if all(isinstance(br[k], int) for k in ("up", "down", "flat")) and \
                br["up"] + br["down"] + br["flat"] != series[-1].get("items"):
            c.err(w + ".breadth", "up + down + flat != items of the last index point")

    def head(at, r):
        c.str_(at + ".key", r["key"])
        c.str_(at + ".name", r["name"], nullable=True)
        c.int_(at + ".quality", r["quality"], nullable=True)
        c.icon(at + ".icon", r["icon"])

    def pct_ok(at, r, base):
        if is_num(r["pct"]) and base:
            if abs(r["pct"] - (r["unit"] / base - 1) * 100) > 0.05 + 1e-9:
                c.err(at, f"pct {r['pct']} != (unit/{base} - 1) * 100 rounded to 0.1")

    def ints(at, r, keys):
        ok = True
        for k in keys:
            c.int_(f"{at}.{k}", r[k])
            ok = ok and isinstance(r[k], int) and not isinstance(r[k], bool)
        return ok

    def sorted_by(at, rows, key, limit):
        if len(rows) > limit:
            c.err(at, f"{len(rows)} rows > top {limit}")
        try:
            if [key(r) for r in rows] != sorted(key(r) for r in rows):
                c.err(at, "rows not in the contract's sort order")
        except (TypeError, KeyError):
            c.err(at, "rows not sortable (bad types)")
        keys = [r.get("key") for r in rows if isinstance(r, dict)]
        if len(set(keys)) != len(keys):
            c.err(at, "duplicate key")

    def priced(name, deal):
        rows = c.list_(f"{w}.{name}", db[name])
        good = []
        for i, r in enumerate(rows):
            at = f"{w}.{name}[{i}]"
            if not c.keys(at, r, PRICED_KEYS):
                continue
            head(at, r)
            c.num(at + ".pct", r["pct"])
            if not ints(at, r, ["bundle", "unit", "ref", "gain", "listings"]) or not is_num(r["pct"]):
                continue
            good.append(r)
            u, ref, b = r["unit"], r["ref"], r["bundle"]
            if b not in (1, 5, 10, 20):
                c.err(at, f"bundle {b} not in 1/5/10/20")
            if ref <= 0:
                c.err(at, "ref must be > 0")
                continue
            if deal:
                if lim["dealPct"] is not None and u * 100 > ref * (100 - lim["dealPct"]):
                    c.err(at, f"unit {u} > ref {ref} x (1 - dealPct/100)")
                if r["gain"] != (ref - u) * b:
                    c.err(at, "gain != (ref - unit) x bundle")
                if not r["pct"] < 0:
                    c.err(at, "deal pct must be negative")
            else:
                if lim["overPct"] is not None and u * 100 < ref * (100 + lim["overPct"]):
                    c.err(at, f"unit {u} < ref {ref} x (1 + overPct/100)")
                if r["gain"] != (u - ref) * b:
                    c.err(at, "gain != (unit - ref) x bundle")
                if r["listings"] < 3:
                    c.err(at, "overpriced needs listings >= 3")
            if lim["minGainCopper"] is not None and r["gain"] < lim["minGainCopper"]:
                c.err(at, f"gain {r['gain']} < minGainCopper")
            pct_ok(at, r, ref)
        sign = 1 if deal else -1
        if len(good) == len(rows):
            sorted_by(f"{w}.{name}", rows, lambda r: (sign * r["pct"], -r["gain"], r["key"]), 50)
        return rows

    deals = priced("deals", True)
    over = priced("overpriced", False)

    ex = db["extremes"]
    ext_rows = []
    if c.keys(w + ".extremes", ex, ["7d", "30d"]):
        for wid, n in (("7d", 7), ("30d", 30)):
            at = f"{w}.extremes.{wid}"
            e = ex[wid]
            if not c.keys(at, e, ["days", "haveDays", "needDays", "low", "high"]):
                continue
            if e["days"] != n:
                c.err(at, f"days {e['days']!r} != {n}")
            need = max(3, -(-n // 2))
            if e["needDays"] != need:
                c.err(at, f"needDays {e['needDays']!r} != max(3, ceil(days/2)) = {need}")
            c.int_(at + ".haveDays", e["haveDays"])
            hd = db["historyDays"] if is_int(db["historyDays"]) else n
            if is_int(e["haveDays"]) and not 0 <= e["haveDays"] <= min(n, hd):
                c.err(at, "haveDays outside 0..min(days, historyDays)")
            for side in ("low", "high"):
                rows = c.list_(f"{at}.{side}", e[side])
                ext_rows += rows
                if rows and is_int(e["haveDays"]) and e["haveDays"] < need:
                    c.err(f"{at}.{side}", "must be empty while haveDays < needDays")
                good = []
                for i, r in enumerate(rows):
                    ra = f"{at}.{side}[{i}]"
                    if not c.keys(ra, r, EXTREME_KEYS):
                        continue
                    head(ra, r)
                    c.num(ra + ".pct", r["pct"])
                    if not ints(ra, r, ["unit", "prev", "listings"]) or not is_num(r["pct"]):
                        continue
                    good.append(r)
                    if side == "low" and not r["unit"] < r["prev"] or side == "high" and not r["unit"] > r["prev"]:
                        c.err(ra, f"unit {r['unit']} is not strictly {'below' if side == 'low' else 'above'} prev")
                    if r["listings"] < 3:
                        c.err(ra, "extremes need listings >= 3")
                    pct_ok(ra, r, r["prev"])
                sign = 1 if side == "low" else -1
                if len(good) == len(rows):
                    sorted_by(f"{at}.{side}", rows, lambda r: (sign * r["pct"], r["key"]), 25)

    val = c.list_(w + ".valuable", db["valuable"])
    good = []
    for i, r in enumerate(val):
        at = f"{w}.valuable[{i}]"
        if c.keys(at, r, VALUABLE_KEYS):
            head(at, r)
            c.int_(at + ".min", r["min"], nullable=True)
            if ints(at, r, ["unit", "listings"]):
                good.append(r)
                if isinstance(r["min"], int) and r["min"] > r["unit"]:
                    c.err(at, "min > unit")
    if len(good) == len(val):
        sorted_by(w + ".valuable", val, lambda r: (-r["unit"], r["key"]), 25)

    if as_of is None and (series or br is not None or deals or over or ext_rows or val):
        c.err(w, "asOf is null, so every list must be empty, series [] and breadth null")


def check(out):
    """Return a list of C4 v4 violations under `out` (empty list = valid)."""
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
