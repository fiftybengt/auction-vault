import pytest

from ingest import svread
from conftest import ITEMS, LIVE, SAMPLE, make_sv, scan


def _agree(reference, path):
    r_meta, r_items, r_scans = reference.read(path)
    meta, items, scans = svread.read(path)
    assert meta == r_meta
    assert {k: v.split("|") for k, v in items.items()} == \
        {k: list(v.values()) for k, v in r_items.items()}
    assert len(scans) == len(r_scans)
    for s, r in zip(scans, r_scans):
        assert {k: v for k, v in s.items() if k != "rows"} == \
            {k: v for k, v in r.items() if k != "rows"}
        assert [row.split(",") for row in s["rows"]] == [list(x.values()) for x in r["rows"]]


def test_agrees_with_reference_on_sample(reference):
    if not SAMPLE.exists():
        pytest.skip("run `make sample` first")
    _agree(reference, SAMPLE)


def test_agrees_with_reference_on_live_file(reference):
    if not LIVE.exists():
        pytest.skip("no live SavedVariables on this machine")
    _agree(reference, LIVE)


def test_escaped_strings():
    text = make_sv([scan(sellers=['Ali"ce', "B\\ob"])], ITEMS)
    meta, items, scans = svread.read_text(text)
    assert items["36592:-36"].startswith('Deforester "Axe"')
    assert scans[0]["sellers"] == ['Ali"ce', "B\\ob"]


def test_unescape_decimal_and_newline():
    assert svread.unescape(r"a\nb\065\\") == "a\nbA\\"


def test_empty_sellers_and_chunking():
    rows = [f"2835:0,1,1,1,0,1,0" for _ in range(1201)]
    _, _, scans = svread.read_text(make_sv([scan(rows=rows, sellers=())], ITEMS))
    assert scans[0]["sellers"] == []
    assert len(scans[0]["rows"]) == 1201


def test_crlf_file_like_the_live_client_writes(tmp_path):
    text = make_sv([scan()], ITEMS)
    p = tmp_path / "AuctionVault.lua"
    p.write_bytes(text.replace("\n", "\r\n").encode())
    meta, items, scans = svread.read(p)
    assert meta["schema"] == 1 and len(items) == 3 and len(scans[0]["rows"]) == 3
