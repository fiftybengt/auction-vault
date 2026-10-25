-- C4 v4 market value: a mean of buyout points, so it lies between the item's lowest and highest
-- unit buyout in that scan, and it is taken over 1..buyout_listings points.
select realm, faction, scan_id, item_key, market_unit, min_unit, max_unit, points, buyout_listings
from {{ ref('item_scan_value') }}
where market_unit is null
   or market_unit < min_unit
   or market_unit > max_unit
   or points < 1
   or points > buyout_listings
