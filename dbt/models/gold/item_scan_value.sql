{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['realm', 'faction', 'scan_id', 'item_key']
) }}
-- C3 v3: market x COMPLETE scan x item_key, with `market_unit`, the TSM AuctionDB-style market
-- value (C4 v4 "Market value"). One point per buyout auction at its unit price; bid-only
-- listings are counted in `listings`/`quantity` but are not points. Items whose listings are all
-- bid-only have no market value and no row. Incremental like item_scan_stats.
--   1. sort ascending, n points; keep the lowest max(1, ceil(0.3 n))          (0-based j < k1)
--   2. from j = 1, the first j with j >= 0.15 n and p_j >= 1.2 p_(j-1) cuts there (keep j < cut)
--   3. with 2+ points left, drop those more than 1.5 population std devs from their mean
--   4. market_unit = round(mean of the rest)
-- Steps 1 and 2 use integer arithmetic (ceil(0.3 n) = (3n + 9) div 10, j >= 0.15 n <=> 20 j >= 3 n,
-- p >= 1.2 prev <=> 5 p >= 6 prev), so no float rounding moves a boundary (0.3 * 10 > 3 in doubles).
with todo as (
    select s.scan_id, s._source_dir
    from {{ ref('silver_scans') }} s
    {% if is_incremental() %}
    left anti join (select distinct scan_id, _source_dir from {{ this }}) t
        on t.scan_id = s.scan_id and t._source_dir = s._source_dir
    {% endif %}
    where s.complete
),
listings as (
    select l.realm, l.faction, l.scan_id, l.scan_at, l.item_key, l.item_id, l.row_no,
           l.stack_count, l.unit_buyout, l._source_dir
    from {{ ref('silver_listings') }} l
    join todo t on t.scan_id = l.scan_id and t._source_dir = l._source_dir
),
counts as (
    select
        realm, faction, scan_id, item_key,
        max(item_id)                                         as item_id,
        max(scan_at)                                         as scan_at,
        max(_source_dir)                                     as _source_dir,
        count(*)                                             as listings,
        sum(stack_count)                                     as quantity,
        count(unit_buyout)                                   as buyout_listings,
        sum(case when unit_buyout is not null then stack_count end) as buyout_quantity,
        min(unit_buyout)                                     as min_unit,
        max(unit_buyout)                                     as max_unit
    from listings
    group by realm, faction, scan_id, item_key
),
ranked as (
    select
        realm, faction, scan_id, item_key,
        unit_buyout as p,
        row_number() over w - 1  as j,
        count(*) over (partition by realm, faction, scan_id, item_key) as n,
        lag(unit_buyout) over w  as prev_p
    from listings
    where unit_buyout is not null
    window w as (partition by realm, faction, scan_id, item_key order by unit_buyout, row_no)
),
step1 as (
    select * from ranked
    where j < greatest(1, (3 * n + 9) div 10)
),
step2_cut as (
    select *,
        min(case when j >= 1 and 20 * j >= 3 * n and 5 * p >= 6 * prev_p then j end)
            over (partition by realm, faction, scan_id, item_key) as cut_j
    from step1
),
step2 as (
    select realm, faction, scan_id, item_key, p
    from step2_cut
    where cut_j is null or j < cut_j
),
step3_stats as (
    select *,
        count(*)       over (partition by realm, faction, scan_id, item_key) as m,
        avg(p)         over (partition by realm, faction, scan_id, item_key) as mu,
        stddev_pop(p)  over (partition by realm, faction, scan_id, item_key) as sd
    from step2
),
step3 as (
    select * from step3_stats
    where m < 2 or abs(p - mu) <= 1.5 * sd
),
value as (
    select realm, faction, scan_id, item_key,
           cast(round(avg(p)) as bigint) as market_unit,
           count(*)                      as points
    from step3
    group by realm, faction, scan_id, item_key
)
select
    c.realm,
    c.faction,
    c.scan_id,
    c.scan_at,
    c.item_key,
    c.item_id,
    v.market_unit,
    v.points,
    c.listings,
    c.quantity,
    c.buyout_listings,
    c.buyout_quantity,
    c.min_unit,
    c.max_unit,
    c._source_dir
from counts c
join value v
  on v.realm = c.realm and v.faction = c.faction and v.scan_id = c.scan_id and v.item_key = c.item_key
