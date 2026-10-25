-- C4 v4: every row of the dashboard lists meets the rule that put it there.
{% set deal_pct = var('deal_pct') %}
{% set over_pct = var('over_pct') %}
{% set min_gain = var('min_gain_copper') %}
select 'deals' as list, item_key, cast(rank as bigint) as rank from {{ ref('dashboard_deals') }}
where ref_unit is null or ref_unit <= 0
   or buyout_quantity < bundle
   or unit * 100 > ref_unit * (100 - {{ deal_pct }})
   or gain != (ref_unit - unit) * bundle
   or gain < {{ min_gain }}
   or not (pct < 0)
   or rank > 50
union all
select 'overpriced', item_key, rank from {{ ref('dashboard_overpriced') }}
where ref_unit is null or ref_unit <= 0
   or listings < 3
   or unit * 100 < ref_unit * (100 + {{ over_pct }})
   or gain != (unit - ref_unit) * bundle
   or gain < {{ min_gain }}
   or not (pct > 0)
   or rank > 50
union all
select concat('extremes ', window_id, ' ', side), item_key, rank from {{ ref('dashboard_extremes') }}
where listings < 3
   or item_days < need_days
   or need_days != greatest(3, (days + 1) div 2)
   or (side = 'low' and not (unit < prev_unit))
   or (side = 'high' and not (unit > prev_unit))
   or rank > 25
union all
select 'valuable', item_key, rank from {{ ref('dashboard_valuable') }}
where unit is null or rank > 25
union all
-- the normal price exists only with enough history, and only from days before the current one
select 'item_reference', item_key, cast(null as bigint) from {{ ref('item_reference') }}
where (ref_unit is not null and (ref_days < {{ var('ref_min_days') }} or ref_listings < 3))
   or min_age_days < 1
   or max_age_days > {{ var('ref_window_days') }}
