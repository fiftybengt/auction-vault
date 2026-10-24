-- market x item_key in the newest COMPLETE scan: median now vs ~1 day and ~7 days ago.
-- "Ago" = the latest complete scan at least N days older, but no more than N+1 days older.
-- at_1d/at_7d are the market-level comparison scans (null when no scan falls in the window).
-- pct_* is null unless both ends have at least var('movers_min_listings') listings.
{% set min_n = var('movers_min_listings') %}
with cs as (
    select realm, faction, scan_id, started_at from {{ ref('silver_scans') }} where complete
),
ref_scans as (
    select
        n.realm,
        n.faction,
        n.scan_id   as now_scan_id,
        n.scan_at   as now_at,
        max_by(case when c.started_at between n.scan_at - 2 * 86400 and n.scan_at - 86400
                    then c.scan_id end,
               case when c.started_at between n.scan_at - 2 * 86400 and n.scan_at - 86400
                    then c.started_at end) as scan_id_1d,
        max_by(case when c.started_at between n.scan_at - 8 * 86400 and n.scan_at - 7 * 86400
                    then c.scan_id end,
               case when c.started_at between n.scan_at - 8 * 86400 and n.scan_at - 7 * 86400
                    then c.started_at end) as scan_id_7d,
        max(case when c.started_at between n.scan_at - 2 * 86400 and n.scan_at - 86400
                 then c.started_at end) as prev_at_1d,
        max(case when c.started_at between n.scan_at - 8 * 86400 and n.scan_at - 7 * 86400
                 then c.started_at end) as prev_at_7d
    from {{ ref('latest_scan') }} n
    left join cs c on c.realm = n.realm and c.faction = n.faction
    group by n.realm, n.faction, n.scan_id, n.scan_at
)
select
    cur.realm,
    cur.faction,
    cur.item_key,
    cur.item_id,
    r.now_scan_id                    as scan_id,
    r.now_at                         as scan_at,
    cur.median_unit                  as median_now,
    cur.listings                     as listings_now,
    r.prev_at_1d                     as at_1d,
    d1.median_unit                   as median_1d,
    d1.listings                      as listings_1d,
    case when cur.listings >= {{ min_n }} and d1.listings >= {{ min_n }} and d1.median_unit > 0
         then cast(round((cur.median_unit - d1.median_unit) * 100.0 / d1.median_unit, 1) as double) end as pct_1d,
    r.prev_at_7d                     as at_7d,
    d7.median_unit                   as median_7d,
    d7.listings                      as listings_7d,
    case when cur.listings >= {{ min_n }} and d7.listings >= {{ min_n }} and d7.median_unit > 0
         then cast(round((cur.median_unit - d7.median_unit) * 100.0 / d7.median_unit, 1) as double) end as pct_7d
from ref_scans r
join {{ ref('item_scan_stats') }} cur
  on cur.scan_id = r.now_scan_id
left join {{ ref('item_scan_stats') }} d1
  on d1.scan_id = r.scan_id_1d and d1.item_key = cur.item_key
left join {{ ref('item_scan_stats') }} d7
  on d7.scan_id = r.scan_id_7d and d7.item_key = cur.item_key
where cur.median_unit is not null
