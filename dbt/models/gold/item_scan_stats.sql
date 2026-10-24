{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['realm', 'faction', 'scan_id', 'item_key']
) }}
-- market x scan x item_key, over ALL scans (partial ones too, flagged by `complete`/`coverage`).
-- Price trends must filter on complete = true. Buyout statistics ignore bid-only listings
-- (unit_buyout is null), which are still counted in `listings` and `bid_only`.
with todo as (
    select s.scan_id, s._source_dir, s.complete, s.coverage
    from {{ ref('silver_scans') }} s
    {% if is_incremental() %}
    left anti join (select distinct scan_id, _source_dir from {{ this }}) t
        on t.scan_id = s.scan_id and t._source_dir = s._source_dir
    {% endif %}
),
agg as (
    select
        l.realm,
        l.faction,
        l.scan_id,
        l.item_key,
        max(l.item_id)               as item_id,
        max(l.scan_at)               as scan_at,
        count(*)                     as listings,
        sum(l.stack_count)           as quantity,
        min(l.unit_buyout)           as min_unit,
        percentile(l.unit_buyout, array(0.10, 0.25, 0.50, 0.75)) as pct,
        count(distinct l.seller)     as sellers,
        count_if(l.buyout is null)   as bid_only
    from {{ ref('silver_listings') }} l
    join todo t on t.scan_id = l.scan_id and t._source_dir = l._source_dir
    group by l.realm, l.faction, l.scan_id, l.item_key
)
select
    a.realm,
    a.faction,
    a.scan_id,
    a.scan_at,
    t.complete,
    t.coverage,
    a.item_key,
    a.item_id,
    a.listings,
    a.quantity,
    a.min_unit,
    cast(round(a.pct[0]) as bigint) as p10_unit,
    cast(round(a.pct[1]) as bigint) as p25_unit,
    cast(round(a.pct[2]) as bigint) as median_unit,
    cast(round(a.pct[3]) as bigint) as p75_unit,
    a.sellers,
    a.bid_only,
    t._source_dir
from agg a
join todo t on t.scan_id = a.scan_id
