"""The generated sample (`make sample`) through the full parser, checked against the
reference reader's numbers."""

import time

import pytest

from ingest.parse_sv import parse
from conftest import LIVE, SAMPLE


def _check(reference, path):
    _, r_items, r_scans = reference.read(path)
    started = time.time()
    p = parse(path.read_text(encoding="utf-8"))
    assert time.time() - started < 30
    assert p.scans.num_rows == len(r_scans)
    assert p.items.num_rows == len(r_items)
    assert p.listings.num_rows == sum(len(s["rows"]) for s in r_scans)
    counts = dict(zip(*p.listings.group_by("scan_id").aggregate([("row_no", "count")])
                       .to_pydict().values()))
    for s in r_scans:
        assert counts[s["id"]] == len(s["rows"]) == s["rowCount"]
    for s, r in zip(p.summary, r_scans):
        assert s["nil_owners"] == sum(x["seller_idx"] == "0" for x in r["rows"])
    nulls = p.listings.column("seller").null_count
    assert nulls == sum(s["nil_owners"] for s in p.summary)
    return p


def test_sample_file(reference):
    if not SAMPLE.exists():
        pytest.skip("run `make sample` first")
    p = _check(reference, SAMPLE)
    assert p.listings.num_rows == 48000
    assert p.summary[0]["nil_owners"] == 36088


def test_live_file(reference):
    if not LIVE.exists():
        pytest.skip("no live SavedVariables on this machine")
    _check(reference, LIVE)
