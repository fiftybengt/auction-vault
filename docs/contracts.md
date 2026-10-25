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
  - `icon` (added in schema 2) is derived from the auction row's texture, in this order:
    take the basename after the last `\` or `/`, strip a file extension, lowercase it, and
    turn every space into `-`. Examples:
    - `Interface\Icons\INV_Potion_108` → `inv_potion_108`
    - `INV_Helmet_100.tga` → `inv_helmet_100`
    - `INV_Misc_SpineLeaf _01` → `inv_misc_spineleaf-_01`
    - `INV_Misc_Fork&Knife` → `inv_misc_fork&knife`

    These match the names Wowhead's icon CDN serves.
  - **Icon character set (all stages):** `^[a-z0-9_&-]+$`. A derived name that doesn't
    match is *no icon*. Icons are cosmetic, so a bad one is dropped with a warning at every
    stage, and never fails a publish, a dbt build or an export.
  - A 9-field entry (schema 1, or an item not seen since the upgrade) means the icon is unknown.
    The addon backfills it the next time a scan lists the item.
  - **The newest valid icon wins.** When a scan lists an item and the icon derived from its row
    is valid and differs from the stored one, the addon replaces the stored icon. This lets
    icons stored under an older derivation rule correct themselves, e.g. `inv_misc_spineleaf_01`
    becomes `inv_misc_spineleaf-_01`. An invalid or missing derivation never blanks or replaces
    a stored icon. Downstream, silver keeps the icon from the latest upload that has a valid
    one, so a correction flows through on the next publish.
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
| `items.parquet` | item_key | `item_key` str, `item_id` int32, `suffix_id` int32, `name` str, `quality` int8, `item_level` int16, `req_level` int16, `item_type` str, `item_subtype` str, `stack_max` int16, `vendor_sell` int64, `equip_loc` str, `icon` str (nullable, v2; ingest nulls any value outside the C1 set) |
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

## C3. Warehouse (dbt) — v3

Owner: `dbt-analytics-engineer`. Catalog `auction`. Schemas `bronze`, `silver`, `gold`.

- **bronze**: one table per landing file, loaded with `read_files()`, append-only, plus
  `_source_dir` and `_ingested_at`.
- **silver**:
  - `scans`: deduplicated on `scan_id`, keeping the copy with the highest `row_count`.
  - `listings`: only rows from the kept copy. Adds `unit_buyout = buyout / stack_count` (null when bid-only) and `unit_min_bid`.
  - `items`: latest upload wins, except for `icon`, which is the latest **valid** icon across all uploads: one matching the C1 set `^[a-z0-9_&-]+$`. Invalid or null values are dropped before the pick, so they never shadow an older valid icon. Landing files from before v2 have no `icon` column.
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
| `item_scan_value` (v3) | market × scan × item_key: `market_unit`, the TSM-style market value below. Complete scans only |
| `item_day_value` (v3) | market × UTC day × item_key: `value` = mean `market_unit` of that day's complete scans, `listings`/`quantity` = their max |
| `item_reference` (v3) | market × item_key, at the current scan: the "normal" price `ref_unit` and its inputs |
| `market_index` (v3) | market × day × group (`all` + each group): chained Jevons index |
| `dashboard_deals`, `dashboard_overpriced`, `dashboard_extremes`, `dashboard_valuable` (v3) | the ranked lists in C4 `dashboard.json` |
| `dashboard_params` (v3) | one row: the dbt vars the build used, echoed as `params` |


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

## C4. Site JSON (export → site) — v4

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
- `icon` (v3) is the C1 icon name (character set `^[a-z0-9_&-]+$`), or `null` when unknown.
  The export nulls any value outside that set. The site builds the image URL from it, so it is never a URL itself.
- `index.json` and `itemCount` cover the items seen in that market in any scan, not the
  whole item dimension. About 292 KB gzipped on 2026-10-25 (no icons yet). Icons add about 30 KB,
  which takes it past the 300 KB limit, so **splitting it is the next planned C4 change**.
- "Current" means **the newest complete scan**. Where no complete scan exists yet, current
  values are `null` and `meta.lastCompleteScan` is `null`.

| File | Shape |
|---|---|
| `markets.json` | `[{ slug, realm, faction, lastScanAt, lastCompleteScanAt, scans }]` |
| `meta.json` | `{ generatedAt, lastScan: { id, at, rowCount, expectedTotal, complete }, lastCompleteScan: { id, at, rowCount } \| null, scanCount, completeScanCount, itemCount }` |
| `index.json` | `{ cols: [...], rows: [[...]] }`, columnar: `key, id, name, quality, icon, class, subclass, median, min, listings, lastSeenAt`. `median`/`min`/`listings` come from the current scan (`null`/`0` if the item isn't listed there). `lastSeenAt` is the newest scan of any kind that contains the item. `class`/`subclass` are the client's localized `itemType`/`itemSubtype` strings. |
| `overview.json` | `{ series: [{ at, complete, coverage, listings, quantity, items, sellers }] }`. Includes partial scans, flagged. `coverage = rowCount / expectedTotal`. The site plots `complete` points only. |
| `dashboard.json` (v4) | The Overview dashboard. See [dashboard.json](#dashboardjson-c4-v4) below. |
| `movers.json` | `{ minListings, windows: { "1d": { prevAt, up: [...], down: [...] }, "7d": {...} } }`. Each row is `{ key, name, quality, icon, median, prev, pct, listings }`. A window whose `prevAt` would be missing is omitted. |
| `items/<item_key>.json` | `{ item: { key, id, suffixId, name, quality, itemLevel, reqLevel, itemType, itemSubtype, stackMax, vendorSell, equipLoc, icon }, history: [{ at, min, p25, median, p75, listings, quantity }], listings: [{ stack, minBid, buyout, unit, bid, timeLeft, seller }] }`. `history` is complete scans only. `listings` comes from the current scan, sorted by `unit` ascending, with nulls last. `buyout`/`unit` are `null` for bid-only listings. `bid` is `null` when nobody has bid. `seller` is `null` when unknown. |
| `sellers/<seller>.json` | `{ seller, listings, items: [{ key, name, quality, icon, count, unit }] }`. `unit` is that seller's lowest unit buyout. Comes from the current scan. Unknown (null) sellers get no file. |

File names:
- `<item_key>` uses `_` in place of `:` (e.g. `13071_0.json`).
- `<seller>` is the raw UTF-8 name as the file name. The site percent-encodes it in URLs.

### dashboard.json (C4 v4)

Why it looks like this (2026-10-25 analysis of the raw scans): a full scan returns the **newest
55,000 auctions**, not the whole auction house. So listing counts are capped, and an item missing
from a scan may still be listed. Medians of thin items swing widely between scans, so
everything here is built on a robust **market value** and compared with a smoothed **normal price**.

**Market value** (`item_scan_value.market_unit`), per complete scan and item. It follows the TSM
AuctionDB method, over buyout listings, with one point per auction at its unit price:
1. Sort the prices ascending, and let n be the count. Keep at most the lowest `ceil(0.3·n)`, and at least 1.
2. Walking up from index j = 1 (0-based), once j ≥ 0.15·n, stop at the first price that is
   ≥ 1.2 × the previous one, dropping it and everything above.
3. If 2 or more remain, drop the points more than 1.5 population standard deviations from their mean.
4. `market_unit` is the mean of what remains, rounded to integer copper.

**Day value** (`item_day_value`): one value per UTC day, the mean `market_unit` across that
day's complete scans. `listings` and `quantity` are the day's maximum.

**Normal price** (`item_reference.ref_unit`): the weighted mean of the item's day values over the
14 days **before** the current scan's day, with weight `0.5^(ageDays/2)`. It is null unless
the item has at least `refMinDays` (2) such days and their mean `listings` is at least 3. The
**bundle size** `N` comes from their mean `quantity`: under 10 → 1, 10–49 → 5, 50–199 → 10, 200 and over → 20.

**Market index** (`market_index`) is a chained Jevons index, starting at 100 on the first
day that has complete scans. For each pair of consecutive days with data d₀ → d₁:
- **Eligible items** have a day value on both days, with `listings` ≥ `indexMinListings` (5) on both.
- **Relative** r = value₁ / value₀, clipped to [0.5, 2].
- **Index:** I(d₁) = I(d₀) × exp(mean ln r).
- **Too few items:** a group with fewer than 5 eligible items has a null index that day, and the next
  non-null day chains from its last non-null value.

**Groups** (`dashboard_groups` seed, keyed on the localized `class`/`subclass`):
- From Trade Goods: `cloth`, `herb`, `metal` (Metal & Stone), `elemental`, `enchanting`, `leather`, `meat`;
- `gem` (class Gem), `glyph` (Glyph), `consumable` (Consumable), `recipe` (Recipe), `gear` (Armor + Weapon).
- Anything else counts only toward `all`.

Shape (all money is integer copper; `pct` is a percentage rounded to 0.1):
```
{ asOf, historyDays,
  params: { dealPct: 30, overPct: 30, minGainCopper: 10000, indexMinListings: 5,
            refMinDays: 2, refWindowDays: 14, refHalfLifeDays: 2, breadthFlatPct: 5 },
  groups: [{ id, label }],
  index:  { series: [{ at, values: { all, <groupId>: number|null, ... }, items }] },
  breadth: { at, prevAt, up, down, flat } | null,
  deals:      [{ key, name, quality, icon, bundle, unit, ref, pct, gain, listings }],
  overpriced: [{ key, name, quality, icon, bundle, unit, ref, pct, gain, listings }],
  extremes: { "7d":  { days: 7,  haveDays, needDays, low: [...], high: [...] },
              "30d": { days: 30, haveDays, needDays, low: [...], high: [...] } },
  valuable:   [{ key, name, quality, icon, unit, min, listings }] }
```

Field notes:
- **`asOf`** is the current complete scan's `at`, or `null` when there is none. In that case every list is empty,
  `index.series` is `[]` and `breadth` is `null`. **`historyDays`** is the number of distinct UTC days with a complete scan.
- **`index.series`** has one point per day with data. `at` is the day's latest complete scan, and `items` is the number of eligible items in `all`.
  `values.all` is 100 on the first point.
- **`breadth`** covers the last two index days, using the eligible items in `all`:
  - `up` means r > 1 + breadthFlatPct/100;
  - `down` means r < 1 − breadthFlatPct/100;
  - `flat` is the rest.

  It is `null` with fewer than 2 index days. The site does not show it (decided 2026-10-25); it stays as data.
- **`deals`**: `unit` is the mean unit price of the cheapest `bundle` units in the current scan,
  over buyout listings, where buying part of a stack is allowed. To be listed:
  - the item needs `ref_unit`;
  - current quantity ≥ `bundle`;
  - `unit` ≤ ref × (1 − dealPct/100);
  - `gain` = (ref − unit) × bundle ≥ minGainCopper.

  `pct` = (unit/ref − 1)·100, which is negative. Sorted by `pct` ascending, then `gain` descending, then `key`. Top 50.
- **`overpriced`**: `unit` is the current `market_unit`. To be listed:
  - the item needs `ref_unit`;
  - current listings ≥ 3;
  - `unit` ≥ ref × (1 + overPct/100);
  - `gain` = (unit − ref) × bundle ≥ minGainCopper.

  Sorted by `pct` descending, then `gain` descending, then `key`. Top 50.
- **`extremes`**: over the last `days` UTC days, up to and including the current day. `haveDays` is the market's
  days with data in that window, and `needDays` = max(3, ceil(days/2)). An item qualifies when:
  - it has a day value on at least `needDays` of those days, including today;
  - today's `listings` ≥ 3;
  - today's value is strictly below the minimum (`low`) or strictly above the maximum (`high`) of its other days.

  Rows are `{ key, name, quality, icon, unit, prev, pct, listings }`, where `prev` is that other-day min or max and
  `pct` = (unit/prev − 1)·100. `low` is sorted by `pct` ascending and `high` by `pct` descending, then `key`. Top 25 each.
  Both windows are always present, and the lists are empty while `haveDays < needDays`.
- **`valuable`**: the top 25 items by current `market_unit` (`unit`), with `min` = the current `min_unit`. Sorted by
  `unit` descending, then `key`.
- **Tunable values** live in dbt vars, and `params` must echo them exactly. `check_c4.py` validates the shape.
- `movers.json` and `overview.json` stay unchanged in v4 and are still exported, but the Overview page no longer reads them (decided 2026-10-25). The dashboard replaces the 1d/7d movers, and the listings-per-scan chart always read 55,000 because of the cap. They are kept for a later page or for removal in v5.

As built (decided 2026-10-25):
- **`listings`** counts every listing, bid-only included, as in `item_scan_stats`. Deal bundles
  are built from buyout units only, so "current quantity ≥ bundle" uses buyout quantity.
  An item listed only as bid-only has no market value.
- **`ageDays`** is the whole number of UTC days between the current day and that day (1..14).
- **Index:**
  - every group, not just `all`, is 100 on the first day, and `items` is 0 there;
  - values are rounded to 0.01;
  - day values are integer copper, and items whose day value is 0 are not eligible;
  - `market_index` also carries the `up`/`down`/`flat` counts that `breadth` is built from.
- **`groups`** lists the seed groups only. `all` is implicit.
- **Sorting:** lists sort on the published, rounded `pct`.
- **Extremes:** `unit` is today's day value and `listings` is today's maximum.
- **Fixed constants** (in SQL, not tunable): at least 5 items per index group, mean reference listings ≥ 3,
  listings ≥ 3, relatives clipped to [0.5, 2], top 50/50/25/25/25, and the bundle steps.

