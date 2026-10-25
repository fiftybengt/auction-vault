-- C3 v3 / C4 v4 `overpriced`: items whose current market value (market_unit of the newest
-- complete scan) is at least over_pct % above the normal price. Needs ref_unit, current
-- listings >= 3, unit >= ref * (1 + over_pct/100) and gain = (unit - ref) * bundle >= min_gain_copper.
-- rank: pct descending, gain descending, item_key; top 50.
{% set over_pct = var('over_pct') %}
{% set min_gain = var('min_gain_copper') %}
with candidates as (
    select
        v.realm, v.faction, v.scan_id, v.item_key, r.bundle, r.ref_unit,
        v.market_unit as unit,
        v.listings
    from {{ ref('latest_scan') }} c
    join {{ ref('item_scan_value') }} v
      on v.realm = c.realm and v.faction = c.faction and v.scan_id = c.scan_id
    join {{ ref('item_reference') }} r
      on r.realm = v.realm and r.faction = v.faction and r.item_key = v.item_key
    where r.ref_unit is not null and r.ref_unit > 0
      and v.listings >= 3
),
listed as (
    select *,
        (unit - ref_unit) * bundle                                   as gain,
        cast(round((unit / cast(ref_unit as double) - 1) * 100, 1) as double) as pct
    from candidates
    where unit * 100 >= ref_unit * (100 + {{ over_pct }})
      and (unit - ref_unit) * bundle >= {{ min_gain }}
),
ranked as (
    select *,
        row_number() over (partition by realm, faction order by pct desc, gain desc, item_key) as rank
    from listed
)
select realm, faction, scan_id, rank, item_key, bundle, unit, ref_unit, pct, gain, listings
from ranked
where rank <= 50
