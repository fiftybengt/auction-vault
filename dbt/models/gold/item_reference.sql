-- C3 v3: market x item_key at the current (newest complete) scan: the "normal" price.
-- ref_unit = weighted mean of the item's day values over the ref_window_days days BEFORE the
-- current scan's UTC day, weight 0.5^(age_days / ref_half_life_days), age_days = current day - day.
-- ref_unit is null unless there are >= ref_min_days such days and their mean listings >= 3.
-- bundle (from their mean quantity): < 10 -> 1, 10-49 -> 5, 50-199 -> 10, >= 200 -> 20.
-- One row per item with at least one day value in the window.
{% set window_days = var('ref_window_days') %}
{% set half_life = var('ref_half_life_days') %}
{% set min_days = var('ref_min_days') %}
with cur as (
    select realm, faction, scan_id, scan_at, cast(floor(scan_at / 86400) as int) as cur_day
    from {{ ref('latest_scan') }}
),
hist as (
    select
        c.realm, c.faction, c.scan_id, c.scan_at, c.cur_day,
        v.item_key, v.item_id, v.value, v.listings, v.quantity,
        c.cur_day - v.unix_day                                      as age_days,
        pow(0.5, (c.cur_day - v.unix_day) / cast({{ half_life }} as double)) as w
    from cur c
    join {{ ref('item_day_value') }} v
      on v.realm = c.realm and v.faction = c.faction
     and v.unix_day between c.cur_day - {{ window_days }} and c.cur_day - 1
),
agg as (
    select
        realm, faction, item_key,
        max(item_id)                    as item_id,
        max(scan_id)                    as scan_id,
        max(scan_at)                    as scan_at,
        max(cur_day)                    as cur_day,
        count(*)                        as ref_days,
        min(age_days)                   as min_age_days,
        max(age_days)                   as max_age_days,
        avg(listings)                   as ref_listings,
        avg(quantity)                   as ref_quantity,
        sum(w * value) / sum(w)         as ref_raw
    from hist
    group by realm, faction, item_key
)
select
    realm,
    faction,
    item_key,
    item_id,
    scan_id,
    scan_at,
    date_from_unix_date(cur_day)        as cur_day,
    ref_days,
    min_age_days,
    max_age_days,
    ref_listings,
    ref_quantity,
    case when ref_days >= {{ min_days }} and ref_listings >= 3
         then cast(round(ref_raw) as bigint) end as ref_unit,
    case when ref_quantity < 10 then 1
         when ref_quantity < 50 then 5
         when ref_quantity < 200 then 10
         else 20 end                    as bundle
from agg
