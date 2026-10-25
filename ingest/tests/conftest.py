import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SAMPLE = REPO / "build" / "AuctionVault.lua"
LIVE = (Path.home() / "Downloads" / "World of Warcraft 3.3.5a" / "WTF" / "Account" / "SICU"
        / "SavedVariables" / "AuctionVault.lua")


@pytest.fixture(scope="session")
def reference():
    """addon/test/verify_format.py, the C1 reference reader."""
    spec = importlib.util.spec_from_file_location(
        "verify_format", REPO / "addon" / "test" / "verify_format.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _q(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def make_sv(scans, items=None, schema=1):
    """Render SavedVariables text in the exact layout WoW's SV writer produces."""
    out = ["", "AUCTIONVAULT_META = {", f'\t["schema"] = {schema},',
           '\t["addonVersion"] = "0.1.0",', "}", "AUCTIONVAULT_ITEMS = {"]
    for k, v in (items or {}).items():
        out.append(f"\t[{_q(k)}] = {_q(v)},")
    out += ["}", "AUCTIONVAULT_SCANS = {"]
    for n, sc in enumerate(scans, 1):
        out.append("\t{")
        for k, v in sc.items():
            if k in ("sellers", "rows"):
                vals = v if k == "sellers" else [
                    ";".join(v[i:i + 500]) for i in range(0, len(v), 500)]
                out.append(f'\t\t["{k}"] = {{')
                out += [f"\t\t\t{_q(x)}, -- [{i}]" for i, x in enumerate(vals, 1)]
                out.append("\t\t},")
            elif isinstance(v, bool):
                out.append(f'\t\t["{k}"] = {"true" if v else "false"},')
            elif isinstance(v, str):
                out.append(f'\t\t["{k}"] = {_q(v)},')
            else:
                out.append(f'\t\t["{k}"] = {v},')
        out.append(f"\t}}, -- [{n}]")
    out += ["}", "AUCTIONVAULT_DIAG = {", "}", ""]
    return "\n".join(out)


def scan(sid=1000, rows=None, sellers=("Alice", "Bob"), **over):
    rows = rows if rows is not None else [
        "13071:0,1,1400000,1505000,0,4,1", "2835:0,20,84,94,0,2,0",
        "36592:-36,1,5000,0,6000,3,2"]
    d = {"realm": "Icecrown", "faction": "Alliance", "id": f"Icecrown:Alliance:{sid}",
         "startedAt": sid, "endedAt": sid + 5, "player": "Tester", "mode": "getall",
         "source": "auctionator", "rowCount": len(rows), "expectedTotal": len(rows),
         "complete": True, "nilOwners": sum(r.endswith(",0") for r in rows),
         "unresolved": 0, "sellers": list(sellers), "rows": rows}
    d.update(over)
    return d


ITEMS = {
    "13071:0": "Plated Fist of Hakoo|3|63|58|Weapon|Fist Weapon|1|0|INVTYPE_WEAPONMAINHAND",
    "2835:0": "Rough Stone|1|5|0|Trade Goods|Parts|20|2|",
    "36592:-36": 'Deforester "Axe" of the Sorcerer|2|158|74|Weapon|Two-Handed Axes|1|121784|INVTYPE_2HWEAPON',
}

# Schema 2: the same items with a 10th `icon` field, except one still in the 9-field
# (icon unknown) shape and one with an explicitly empty icon.
ITEMS_V2 = {
    "13071:0": ITEMS["13071:0"] + "|inv_gauntlets_04",
    "2835:0": ITEMS["2835:0"],
    "36592:-36": ITEMS["36592:-36"] + "|",
    "33470:0": "Frostweave Cloth|1|80|0|Trade Goods|Cloth|20|100||inv_fabric_frostweave",
}
