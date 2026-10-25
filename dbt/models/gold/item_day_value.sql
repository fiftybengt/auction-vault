-- C3 v3: market x UTC day x item_key. `value` = mean market_unit over that day's complete scans
-- (rounded to copper); `listings`/`quantity` = their maximum. Small, so rebuilt as a table.
with v as (
    select *, cast(floor(scan_at / 86400) as int) as unix_day
    from {{ ref('item_scan_value') }}
)
select
    realm,
    faction,
    date_from_unix_date(unix_day)       as day,
    unix_day,
    item_key,
    max(item_id)                        as item_id,
    cast(round(avg(market_unit)) as bigint) as value,
    max(listings)                       as listings,
    max(quantity)                       as quantity,
    count(*)                            as scans,
    max(scan_at)                        as last_scan_at
from v
group by realm, faction, unix_day, item_key
