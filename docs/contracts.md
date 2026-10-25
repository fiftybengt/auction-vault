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

## C1. SavedVariables (addon → ingest) — schema 2

Owner: `wow-addon-engineer`. The full description is in `addon/README.md` ("What lands on disk");
`addon/test/verify_format.py` is the reference reader.

- `AUCTIONVAULT_SCANS[n]`: `id`, `startedAt`, `endedAt`, `realm`, `faction`, `player`,
  `mode`, `source`, `rowCount`, `expectedTotal`, `complete`, `nilOwners`, `unresolved`,
  `sellers` (array), `rows` (array of `;`-joined strings, 500 rows each).
- Row: `itemKey,stackCount,minBid,buyout,bidAmount,timeLeft,sellerIdx`.
  `sellerIdx` is 1-based into `sellers`, `0` = server sent no name. `timeLeft` is 1–4.
- `AUCTIONVAULT_ITEMS[itemKey] = "name|quality|itemLevel|reqLevel|itemType|subType|stackMax|vendorSell|equipLoc|icon"`.
  - `icon` (added in schema 2) is the lowercase basename of the item's texture
    (`Interface\Icons\INV_Potion_108` → `inv_potion_108`), taken from the auction row.
  - A 9-field entry (schema 1, or an item not seen since the upgrade) means the icon is unknown.
    The addon backfills it the next time a scan lists the item, and never replaces a known icon
    with an empty one.
  - Readers must accept both schema 1 and schema 2 files.
- The file keeps only the newest `maxScans` (6) scans, so **every file must be archived before
  the next session overwrites it**.
- The client writes **CRLF** line endings. Readers normalise them to LF. Archives and the landed
  `AuctionVault.lua` keep the raw bytes, and `sv_sha256` is taken over the raw bytes.
- Every scan before the 2026-10-24 harvest fix is `complete=false` (a prefix of about 6–13k of
  ~55k rows).

## C2. Landing files (ingest → Databricks volume) — v2

Owner: `data-ingest-engineer`.

Path: `/Volumes/auction/raw/landing/<upload_ts>/`, where `<upload_ts>` is `YYYYMMDDTHHMMSSZ`.
Each directory contains the raw `AuctionVault.lua` plus four Parquet files. Directories are
never modified after upload.

| File | Grain | Columns |
|---|---|---|
| `scans.parquet` | scan | `scan_id` str, `started_at` int64, `ended_at` int64, `realm` str, `faction` str, `player` str, `mode` str, `source` str, `row_count` int32, `expected_total` int32, `complete` bool, `nil_owners` int32, `unresolved` int32 |
| `listings.parquet` | listing | `scan_id` str, `row_no` int32 (1-based, file order), `item_key` str, `item_id` int32, `suffix_id` int32, `stack_count` int32, `min_bid` int64, `buyout` int64, `bid_amount` int64, `time_left` int8, `seller` str (null when `sellerIdx` was 0) |
| `items.parquet` | item_key | `item_key` str, `item_id` int32, `suffix_id` int32, `name` str, `quality` int8, `item_level` int16, `req_level` int16, `item_type` str, `item_subtype` str, `stack_max` int16, `vendor_sell` int64, `equip_loc` str, `icon` str (nullable, v2) |
| `upload.parquet` | 1 row | `upload_ts` str, `sv_sha256` str, `sv_bytes` int64, `schema` int32, `addon_version` str, `parser_version` str |

`buyout = 0` means bid-only. It stays as 0 in landing and becomes null in silver.

- `<upload_ts>` is when the file was first archived, so the archive name, landing directory
  and `upload.parquet` all agree. A retried upload gets a fresh directory.
- **`upload.parquet` is uploaded last and marks the directory as complete.** Bronze must ignore
  any landing directory that has no `upload.parquet`.
- The raw file lands as `AuctionVault.lua`.
- Empty string fields (for example `equip_loc`) stay as `""` in landing, and silver turns them
  into null with `nullif`. An empty numeric field is already null in landing.
- `items.parquet` carries the file's whole item dimension on every upload. Silver keeps the
  latest upload.

## C3. Warehouse (dbt) — v1

Owner: `dbt-analytics-engineer`. Catalog `auction`. Schemas `bronze`, `silver`, `gold`.

- **bronze**: one table per landing file, loaded with `read_files()`, append-only, plus
  `_source_dir` and `_ingested_at`.
- **silver**:
  - `scans`: deduplicated on `scan_id`, keeping the copy with the highest `row_count`.
  - `listings`: only rows from the kept copy. Adds `unit_buyout = buyout / stack_count` (null when bid-only) and `unit_min_bid`.
  - `items`: latest upload wins, except for `icon`, which is the latest **non-null** icon across all uploads. Landing files from before v2 have no `icon` column.
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


C3 notes, as built:
- `item_scan_stats` and `market_overview` include **all** scans and carry `complete` and
  `coverage`. Every other gold table uses complete scans only.
- `latest_scan` holds the newest complete scan per market. It is the anchor for "current".
- Unit prices are rounded to integer copper.
- Movers compare against the latest complete scan between N and N+1 days older (N = 1, 7).
  A `pct` is null unless both ends have at least `movers_min_listings` (dbt var, default 3).
  The export's `minListings` must equal that var.
- Incremental silver and gold assume that a larger copy of a scan is a superset of the
  smaller one, with the same `row_no`s. That is how the addon's prefix copies behave.

## C4. Site JSON (export → site) — v3

Owner: `dbt-analytics-engineer` writes it, `frontend-engineer` reads it.
Location: `site/public/data/<realm>-<faction>/` (slugified, e.g. `icecrown-alliance`), plus
`site/public/data/markets.json` at the root.

General rules:
- Field names are **camelCase**, everywhere.
- Every time series is sorted ascending by `at`, where `at` is the scan's `startedAt`.
- Money is integer copper, or `null` when it doesn't apply. Never `0` standing in for "none".
- `generatedAt` is the newest bronze `_ingested_at`, not the time the export ran, so an
  unchanged warehouse gives a byte-identical export.
- Empty strings are `null`.
- `icon` (v3) is the C1 texture basename, or `null` when unknown. The site builds the image URL from it, so it is never a URL itself.
- `index.json` and `itemCount` cover the items seen in that market in any scan, not the
  whole item dimension. 118 KB gzipped today. Revisit at about 300 KB gzipped (split it,
  or limit it to the last N days).
- "Current" means **the newest complete scan**. Where no complete scan exists yet, current
  values are `null` and `meta.lastCompleteScan` is `null`.

| File | Shape |
|---|---|
| `markets.json` | `[{ slug, realm, faction, lastScanAt, lastCompleteScanAt, scans }]` |
| `meta.json` | `{ generatedAt, lastScan: { id, at, rowCount, expectedTotal, complete }, lastCompleteScan: { id, at, rowCount } \| null, scanCount, completeScanCount, itemCount }` |
| `index.json` | `{ cols: [...], rows: [[...]] }`, columnar: `key, id, name, quality, icon, class, subclass, median, min, listings, lastSeenAt`. `median`/`min`/`listings` come from the current scan (`null`/`0` if the item isn't listed there). `lastSeenAt` is the newest scan of any kind that contains the item. `class`/`subclass` are the client's localized `itemType`/`itemSubtype` strings. |
| `overview.json` | `{ series: [{ at, complete, coverage, listings, quantity, items, sellers }] }`. Includes partial scans, flagged. `coverage = rowCount / expectedTotal`. The site plots `complete` points only. |
| `movers.json` | `{ minListings, windows: { "1d": { prevAt, up: [...], down: [...] }, "7d": {...} } }`. Each row is `{ key, name, quality, icon, median, prev, pct, listings }`. A window whose `prevAt` would be missing is omitted. |
| `items/<item_key>.json` | `{ item: { key, id, suffixId, name, quality, itemLevel, reqLevel, itemType, itemSubtype, stackMax, vendorSell, equipLoc, icon }, history: [{ at, min, p25, median, p75, listings, quantity }], listings: [{ stack, minBid, buyout, unit, bid, timeLeft, seller }] }`. `history` is complete scans only. `listings` comes from the current scan, sorted by `unit` ascending, with nulls last. `buyout`/`unit` are `null` for bid-only listings. `bid` is `null` when nobody has bid. `seller` is `null` when unknown. |
| `sellers/<seller>.json` | `{ seller, listings, items: [{ key, name, quality, icon, count, unit }] }`. `unit` is that seller's lowest unit buyout. Comes from the current scan. Unknown (null) sellers get no file. |

File names:
- `<item_key>` uses `_` in place of `:` (e.g. `13071_0.json`).
- `<seller>` is the raw UTF-8 name as the file name. The site percent-encodes it in URLs.
