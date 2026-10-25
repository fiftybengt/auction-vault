-- C3 v3 / C4 v4 `deals`: items in the current (newest complete) scan whose cheapest `bundle`
-- units cost at least deal_pct % less than the normal price. `unit` = mean unit price of the
-- cheapest `bundle` units over buyout listings, taking part of a stack where needed
-- (rounded to copper). Needs ref_unit and current buyout quantity >= bundle;
-- unit <= ref * (1 - deal_pct/100) and gain = (ref - unit) * bundle >= min_gain_copper.
-- rank: pct ascending, gain descending, item_key; top 50.
{% set deal_pct = var('deal_pct') %}
{% set min_gain = var('min_gain_copper') %}
with cur as (
    select realm, faction, scan_id from {{ ref('latest_scan') }}
),
refs as (
    select r.realm, r.faction, r.item_key, r.ref_unit, r.bundle
    from {{ ref('item_reference') }} r
    where r.ref_unit is not null
),
lst as (
    select
        l.realm, l.faction, l.item_key, l.stack_count, l.unit_buyout,
        r.ref_unit, r.bundle,
        coalesce(sum(l.stack_count) over (
            partition by l.realm, l.faction, l.item_key
            order by l.unit_buyout, l.row_no
            rows between unbounded preceding and 1 preceding), 0) as qty_before
    from {{ ref('silver_listings') }} l
    join cur c on c.scan_id = l.scan_id and c.realm = l.realm and c.faction = l.faction
    join refs r on r.realm = l.realm and r.faction = l.faction and r.item_key = l.item_key
    where l.unit_buyout is not null
),
bundles as (
    select
        realm, faction, item_key,
        max(ref_unit)        as ref_unit,
        max(bundle)          as bundle,
        sum(stack_count)     as buyout_quantity,
        sum(least(stack_count, greatest(bundle - qty_before, 0)) * unit_buyout) as bundle_cost
    from lst
    group by realm, faction, item_key
),
candidates as (
    select
        b.realm, b.faction, b.item_key, b.bundle, b.ref_unit, b.buyout_quantity,
        cast(round(b.bundle_cost / b.bundle) as bigint) as unit,
        v.listings,
        v.scan_id
    from bundles b
    join cur c on c.realm = b.realm and c.faction = b.faction
    join {{ ref('item_scan_value') }} v
      on v.realm = b.realm and v.faction = b.faction and v.scan_id = c.scan_id and v.item_key = b.item_key
    where b.buyout_quantity >= b.bundle
),
listed as (
    select *,
        (ref_unit - unit) * bundle                                   as gain,
        cast(round((unit / cast(ref_unit as double) - 1) * 100, 1) as double) as pct
    from candidates
    where ref_unit > 0
      and unit * 100 <= ref_unit * (100 - {{ deal_pct }})
      and (ref_unit - unit) * bundle >= {{ min_gain }}
),
ranked as (
    select *,
        row_number() over (partition by realm, faction order by pct asc, gain desc, item_key) as rank
    from listed
)
select realm, faction, scan_id, rank, item_key, bundle, unit, ref_unit, pct, gain, listings, buyout_quantity
from ranked
where rank <= 50
