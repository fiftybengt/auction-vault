"""Reader for the AuctionVault SavedVariables Lua subset (contract C1, schema 1).

Lifted from addon/test/verify_format.py -- the reference reader -- and kept structurally
identical so the two agree (tests/test_svread.py checks that on every file it sees). The
one deliberate difference: string literals are matched and un-escaped the way WoW's SV
writer escapes them (backslash, quote, \\n, \\ddd), where the reference assumes names never
contain a quote.

Regexes only. Lua is never evaluated or executed.
"""

import re
from pathlib import Path

ITEM_FIELDS = ["name", "quality", "item_level", "req_level", "item_type",
               "sub_type", "stack_max", "vendor_sell", "equip_loc"]
ROW_FIELDS = ["item_key", "stack_count", "min_bid", "buyout", "bid_amount",
              "time_left", "seller_idx"]

# A Lua double-quoted string body, escape-aware.
_STR = r'"((?:[^"\\\n]|\\.)*)"'
_ESC = re.compile(r"\\(\d{1,3}|.)", re.S)
_ESC_MAP = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "\n": "\n",
            "a": "\a", "b": "\b", "f": "\f", "v": "\v"}


def unescape(body):
    if "\\" not in body:
        return body

    def sub(m):
        c = m.group(1)
        if c.isdigit():
            return chr(int(c))
        return _ESC_MAP.get(c, c)

    return _ESC.sub(sub, body)


def _block(text, name):
    """The body of a top-level `NAME = { ... }` assignment."""
    m = re.search(rf"^{name} = \{{$(.*?)^\}}$", text, re.S | re.M)
    return m.group(1) if m else ""


def _scalar(raw):
    if raw.startswith('"'):
        return unescape(raw[1:-1])
    if raw == "true":
        return True
    if raw == "false":
        return False
    return float(raw) if "." in raw else int(raw)


def _array(record, key):
    m = re.search(rf'\["{key}"\] = \{{$\n(.*?)^\t\t\}},$', record, re.S | re.M)
    if not m:
        return []
    return [unescape(s) for s in re.findall(_STR + r", -- \[\d+\]", m.group(1))]


def read_text(text):
    """Parse SavedVariables text into (meta, items, scans).

    meta:  {"schema": 1, "addonVersion": "0.1.0", ...}
    items: {item_key: raw "name|quality|..." string}
    scans: [{"id": ..., <scalars>, "sellers": [str], "rows": [str "k,s,mb,bo,ba,tl,si"]}]

    Rows and items stay as raw strings here; parse_sv splits and types them, so
    validation can name the scan and row that broke.
    """
    meta = {k: _scalar(v) for k, v in
            re.findall(r'\["(\w+)"\] = (.+),', _block(text, "AUCTIONVAULT_META"))}

    items = {unescape(key): unescape(val)
             for key, val in re.findall(rf"\[{_STR}\] = {_STR}",
                                        _block(text, "AUCTIONVAULT_ITEMS"))}

    # Scans are array elements, so each record closes with `}, -- [n]`.
    scans = []
    for record in re.findall(r"^\t\{$\n(.*?)^\t\}, -- \[\d+\]$",
                             _block(text, "AUCTIONVAULT_SCANS"), re.S | re.M):
        scan = {k: _scalar(v) for k, v in
                re.findall(r'^\t\t\["(\w+)"\] = ([^{].*),$', record, re.M)}
        scan["sellers"] = _array(record, "sellers")
        scan["rows"] = [row for chunk in _array(record, "rows")
                        for row in chunk.split(";") if row]
        scans.append(scan)

    return meta, items, scans


def decode(data):
    """SavedVariables bytes -> text, as Path.read_text would give it.

    Strict UTF-8 (a decoding error means a corrupt file, which must not be ingested), and
    universal newlines: the client (Windows build, run under Wine) writes CRLF.
    """
    return data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def read(path):
    return read_text(decode(Path(path).read_bytes()))
