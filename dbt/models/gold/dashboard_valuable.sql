-- C3 v3 / C4 v4 `valuable`: the top 25 items by current market value (market_unit of the newest
-- complete scan), with min_unit the current lowest unit buyout. rank: unit descending, item_key.
with ranked as (
    select
        v.realm, v.faction, v.scan_id, v.item_key,
        v.market_unit as unit,
        v.min_unit,
        v.listings,
        row_number() over (partition by v.realm, v.faction order by v.market_unit desc, v.item_key) as rank
    from {{ ref('latest_scan') }} c
    join {{ ref('item_scan_value') }} v
      on v.realm = c.realm and v.faction = c.faction and v.scan_id = c.scan_id
)
select realm, faction, scan_id, rank, item_key, unit, min_unit, listings
from ranked
where rank <= 25
