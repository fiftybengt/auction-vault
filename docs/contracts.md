# Data contracts

Each stage of the pipeline promises the shapes below to the next. **Changing anything here
needs the orchestrator's sign-off** and a version bump on the affected contract, because the
stage downstream of you is built against it.

Conventions everywhere:

- Money is **integer copper** (`1g = 10000`). Never floats, never formatted strings.
- Times are **unix seconds, UTC** (`startedAt` comes from the client's `time()`).
- An item is identified by `item_key = "<itemId>:<suffixId>"` (suffix may be negative). Also
  carry `item_id` (int) separately so joins to DBC data need no string parsing.
- `realm` and `faction` are part of every market-level key, even though today all data is
  `Icecrown` / `Alliance`.

---

## Environment

- Databricks Free Edition workspace `https://dbc-dbdf7f4d-bcc2.cloud.databricks.com`.
- SQL warehouse `7655e13e54222e5a` (serverless 2X-Small), HTTP path `/sql/1.0/warehouses/7655e13e54222e5a`.
- Catalog `auction` with schemas `raw` (holds the volume `landing`), `bronze`, `silver` and `gold`.
  The workspace's `raw` and `analytics` catalogs belong to an unrelated dbt tutorial. Never touch them.
- **Credentials:** locally, the GNOME keyring via `scripts/dbx_secret.py`. Run any command that
  needs them as `scripts/with-databricks <cmd>`, which exports `DATABRICKS_HOST`, `DATABRICKS_TOKEN`
  and `DATABRICKS_HTTP_PATH`. In CI, the GitHub Actions secrets with the same names.
  Never write the token to a file, a log, a commit, or command output.

## C1. SavedVariables (addon → ingest) — schema 1

Owner: `wow-addon-engineer`. The full description is in `addon/README.md` ("What lands on disk");
`addon/test/verify_format.py` is the reference reader.

- `AUCTIONVAULT_SCANS[n]`: `id`, `startedAt`, `endedAt`, `realm`, `faction`, `player`,
  `mode`, `source`, `rowCount`, `expectedTotal`, `complete`, `nilOwners`, `unresolved`,
  `sellers` (array), `rows` (array of `;`-joined strings, 500 rows each).
- Row: `itemKey,stackCount,minBid,buyout,bidAmount,timeLeft,sellerIdx`.
  `sellerIdx` is 1-based into `sellers`, `0` = server sent no name. `timeLeft` is 1–4.
- `AUCTIONVAULT_ITEMS[itemKey] = "name|quality|itemLevel|reqLevel|itemType|subType|stackMax|vendorSell|equipLoc"`.
- The file keeps only the newest `maxScans` (6) scans, so **every file must be archived before
  the next session overwrites it**.

## C2. Landing files (ingest → Databricks volume) — v1

Owner: `data-ingest-engineer`.

Path: `/Volumes/auction/raw/landing/<upload_ts>/`, where `<upload_ts>` is `YYYYMMDDTHHMMSSZ`.
Each directory contains the raw `AuctionVault.lua` plus four Parquet files. Directories are
never modified after upload.

| File | Grain | Columns |
|---|---|---|
| `scans.parquet` | scan | `scan_id` str, `started_at` int64, `ended_at` int64, `realm` str, `faction` str, `player` str, `mode` str, `source` str, `row_count` int32, `expected_total` int32, `complete` bool, `nil_owners` int32, `unresolved` int32 |
| `listings.parquet` | listing | `scan_id` str, `row_no` int32 (1-based, file order), `item_key` str, `item_id` int32, `suffix_id` int32, `stack_count` int32, `min_bid` int64, `buyout` int64, `bid_amount` int64, `time_left` int8, `seller` str (null when `sellerIdx` was 0) |
| `items.parquet` | item_key | `item_key` str, `item_id` int32, `suffix_id` int32, `name` str, `quality` int8, `item_level` int16, `req_level` int16, `item_type` str, `item_subtype` str, `stack_max` int16, `vendor_sell` int64, `equip_loc` str |
| `upload.parquet` | 1 row | `upload_ts` str, `sv_sha256` str, `sv_bytes` int64, `schema` int32, `addon_version` str, `parser_version` str |

`buyout = 0` means bid-only. It stays as 0 in landing and becomes null in silver.

## C3. Warehouse (dbt) — v1

Owner: `dbt-analytics-engineer`. Catalog `auction`. Schemas `bronze`, `silver`, `gold`.

- **bronze**: one table per landing file, loaded with `read_files()`, append-only, plus
  `_source_dir` and `_ingested_at`.
- **silver**:
  - `scans`: deduplicated on `scan_id`, keeping the copy with the highest `row_count`.
  - `listings`: only rows from the kept copy. Adds `unit_buyout = buyout / stack_count` (null when bid-only) and `unit_min_bid`.
  - `items`: latest upload wins.
  - `item_classes`: from the DBC seeds.
  - `sellers`.
- **gold** (market key = `realm, faction`; trend tables use `complete` scans only):

| Table | Grain |
|---|---|
| `item_scan_stats` | market × scan × item_key: `listings`, `quantity`, `min_unit`, `p10/p25/median/p75_unit`, `sellers`, `bid_only` |
| `item_daily` | market × day × item_key: same measures over that day's latest complete scan |
| `market_overview` | market × scan: total listings, quantity, distinct items/sellers, coverage (`row_count/expected_total`) |
| `movers` | market × item_key: median now vs 1d / 7d ago, % change, min-listings filter |
| `latest_listings` | market × listing in the newest complete scan |
| `seller_summary` | market × seller: listings, distinct items, est. value at buyout |

## C4. Site JSON (export → site) — v1

Owner: `dbt-analytics-engineer` writes it, `frontend-engineer` reads it.
Location: `site/public/data/<realm>-<faction>/` (slugified, e.g. `icecrown-alliance`), plus
`site/public/data/markets.json` at the root.

| File | Shape |
|---|---|
| `markets.json` | `[{ slug, realm, faction, lastScanAt, scans }]` |
| `meta.json` | `{ generatedAt, lastScan: { id, at, rowCount, complete }, scanCount, itemCount }` |
| `index.json` | `{ cols: [...], rows: [[...]] }` columnar: `key, id, name, quality, class, subclass, median, listings` |
| `overview.json` | `{ series: [{ at, listings, quantity, items, sellers }] }` |
| `movers.json` | `{ up: [...], down: [...] }`, each `{ key, name, quality, median, prev, pct }` |
| `items/<item_key>.json` | `{ item: {...C2 items fields}, history: [{ at, min, p25, median, p75, listings, quantity }], listings: [{ stack, minBid, buyout, unit, bid, timeLeft, seller }] }` |
| `sellers/<seller>.json` | `{ seller, listings, items: [{ key, name, count, unit }] }` |

`<item_key>` in filenames uses `_` in place of `:` (e.g. `13071_0.json`).
