import pyarrow.parquet as pq
import pytest

from ingest import PARSER_VERSION
from ingest.parse_sv import SCHEMAS, SVError, parse, upload_table, write_landing
from conftest import ITEMS, ITEMS_V2, make_sv, scan


def test_tables_match_c2(tmp_path):
    p = parse(make_sv([scan(1000), scan(2000, complete=False)], ITEMS))
    up = upload_table("20261024T120000Z", "ab" * 32, 123, p.meta)
    paths = write_landing(p, up, tmp_path)
    for name, schema in SCHEMAS.items():
        assert pq.read_schema(paths[name]).remove_metadata().equals(schema), name

    scans = pq.read_table(paths["scans.parquet"]).to_pylist()
    assert [s["scan_id"] for s in scans] == ["Icecrown:Alliance:1000", "Icecrown:Alliance:2000"]
    assert scans[1]["complete"] is False and scans[0]["row_count"] == 3

    rows = pq.read_table(paths["listings.parquet"]).to_pylist()
    assert len(rows) == 6
    first, nil, bid_only = rows[:3]
    assert first == {"scan_id": "Icecrown:Alliance:1000", "row_no": 1, "item_key": "13071:0",
                     "item_id": 13071, "suffix_id": 0, "stack_count": 1, "min_bid": 1400000,
                     "buyout": 1505000, "bid_amount": 0, "time_left": 4, "seller": "Alice"}
    assert nil["seller"] is None and nil["row_no"] == 2
    assert bid_only["suffix_id"] == -36 and bid_only["buyout"] == 0
    assert bid_only["seller"] == "Bob"
    assert rows[3]["row_no"] == 1  # row_no restarts per scan

    items = {i["item_key"]: i for i in pq.read_table(paths["items.parquet"]).to_pylist()}
    assert items["13071:0"] == {
        "item_key": "13071:0", "item_id": 13071, "suffix_id": 0,
        "name": "Plated Fist of Hakoo", "quality": 3, "item_level": 63, "req_level": 58,
        "item_type": "Weapon", "item_subtype": "Fist Weapon", "stack_max": 1,
        "vendor_sell": 0, "equip_loc": "INVTYPE_WEAPONMAINHAND", "icon": None}
    assert items["2835:0"]["equip_loc"] == ""
    assert items["36592:-36"]["name"] == 'Deforester "Axe" of the Sorcerer'

    u = pq.read_table(paths["upload.parquet"]).to_pylist()
    assert u == [{"upload_ts": "20261024T120000Z", "sv_sha256": "ab" * 32, "sv_bytes": 123,
                  "schema": 1, "addon_version": "0.1.0", "parser_version": PARSER_VERSION}]


def test_money_survives_int32_overflow():
    big = 9_999_999_999  # ~1M gold, past int32
    p = parse(make_sv([scan(rows=[f"13071:0,1,{big},{big},{big},4,1"])], ITEMS))
    assert p.listings.column("buyout").to_pylist() == [big]


@pytest.mark.parametrize("change, msg", [
    (dict(rowCount=4), "rowCount 4 but 3 rows"),
    (dict(rows=["13071:0,1,1,1,0,4"]), "row 1: 6 fields"),
    (dict(rows=["13071:0,1,1,1,0,5,1"]), "timeLeft 5 not in 1-4"),
    (dict(rows=["13071:0,1,1,1,0,0,1"]), "timeLeft 0 not in 1-4"),
    (dict(rows=["13071:0,1,1,1,0,4,3"]), "sellerIdx 3 out of range"),
    (dict(rows=["13071,1,1,1,0,4,1"]), "bad item key"),
    (dict(rows=["13071:0,1,x,1,0,4,1"]), "non-integer"),
    (dict(complete="yes"), "'complete'"),
])
def test_validation_fails_loudly_with_scan_id(change, msg):
    sc = scan(4242, **change)
    if "rows" in change and "rowCount" not in change:
        sc["rowCount"] = len(change["rows"])
    with pytest.raises(SVError) as e:
        parse(make_sv([scan(1), sc], ITEMS))
    assert "Icecrown:Alliance:4242" in str(e.value)
    assert msg in str(e.value)


def test_missing_scan_field():
    sc = scan(7)
    del sc["player"]
    with pytest.raises(SVError, match=r"Icecrown:Alliance:7: missing field 'player'"):
        parse(make_sv([sc], ITEMS))


def test_rejects_other_schema_and_empty_and_dupes():
    with pytest.raises(SVError, match="schema"):
        parse(make_sv([scan()], ITEMS, schema=3))
    with pytest.raises(SVError, match="schema"):
        parse(make_sv([scan()], ITEMS, schema=0))
    with pytest.raises(SVError, match="no scans"):
        parse(make_sv([], ITEMS))
    with pytest.raises(SVError, match="duplicate"):
        parse(make_sv([scan(5), scan(5)], ITEMS))


def test_bad_item_fails():
    with pytest.raises(SVError, match="item 1:0"):
        parse(make_sv([scan()], {"1:0": "Thing|1|2"}))


def test_schema1_icon_is_all_null(tmp_path):
    p = parse(make_sv([scan()], ITEMS, schema=1))
    assert p.items.schema.names[-1] == "icon"
    assert p.items.column("icon").null_count == p.items.num_rows == 3
    up = upload_table("20261024T120000Z", "ab" * 32, 1, p.meta)
    paths = write_landing(p, up, tmp_path)
    assert pq.read_schema(paths["items.parquet"]).remove_metadata().equals(
        SCHEMAS["items.parquet"])


def test_schema2_mixed_9_and_10_field_items(tmp_path):
    p = parse(make_sv([scan()], ITEMS_V2, schema=2))
    up = upload_table("20261025T120000Z", "cd" * 32, 1, p.meta)
    paths = write_landing(p, up, tmp_path)
    items = {i["item_key"]: i for i in pq.read_table(paths["items.parquet"]).to_pylist()}
    assert items["13071:0"]["icon"] == "inv_gauntlets_04"
    assert items["2835:0"]["icon"] is None          # 9 fields: unknown
    assert items["36592:-36"]["icon"] is None       # empty 10th field -> null
    assert items["33470:0"]["icon"] == "inv_fabric_frostweave"
    assert items["33470:0"]["equip_loc"] == ""      # other empty strings stay ""
    # The first nine fields read the same whether or not the icon is there.
    v1 = {i["item_key"]: i for i in parse(make_sv([scan()], ITEMS)).items.to_pylist()}
    for k, row in v1.items():
        assert {c: v for c, v in items[k].items() if c != "icon"} == \
            {c: v for c, v in row.items() if c != "icon"}
    u = pq.read_table(paths["upload.parquet"]).to_pylist()[0]
    assert u["schema"] == 2 and u["parser_version"] == PARSER_VERSION


@pytest.mark.parametrize("schema, raw, msg", [
    (1, "A|1|2|3|T|S|1|0|", None),                     # 9 fields: ok in schema 1
    (2, "A|1|2|3|T|S|1|0|", None),                     # and in schema 2
    (2, "A|1|2|3|T|S|1|0||inv_misc_qm", None),         # 10 fields: schema 2 only
    (1, "A|1|2|3|T|S|1|0||inv_misc_qm", "10 fields, expected 9 (schema 1)"),
    (1, "A|1|2|3|T|S|1|0", "8 fields, expected 9 (schema 1)"),
    (2, "A|1|2|3|T|S|1|0", "8 fields, expected 9 or 10 (schema 2)"),
    (2, "A|1|2|3|T|S|1|0||icon|extra", "11 fields, expected 9 or 10 (schema 2)"),
    (2, "A|x|2|3|T|S|1|0||icon", "non-integer"),
])
def test_item_field_counts(schema, raw, msg):
    text = make_sv([scan()], {**ITEMS, "1:0": raw}, schema=schema)
    if msg is None:
        assert parse(text).items.num_rows == 4
    else:
        with pytest.raises(SVError, match="item 1:0") as e:
            parse(text)
        assert msg in str(e.value)


def test_nil_owner_mismatch_is_a_warning():
    p = parse(make_sv([scan(nilOwners=9)], ITEMS))
    assert p.warnings and "nilOwners 9" in p.warnings[0]
