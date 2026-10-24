-- Sanity: min <= p10 <= p25 <= median <= p75 wherever buyout stats exist.
select 'item_scan_stats' as model, scan_id, item_key, min_unit, p10_unit, p25_unit, median_unit, p75_unit
from {{ ref('item_scan_stats') }}
where median_unit is not null
  and not (min_unit <= p10_unit and p10_unit <= p25_unit and p25_unit <= median_unit and median_unit <= p75_unit)
union all
select 'item_daily', scan_id, item_key, min_unit, p10_unit, p25_unit, median_unit, p75_unit
from {{ ref('item_daily') }}
where median_unit is not null
  and not (min_unit <= median_unit and median_unit <= p75_unit)
