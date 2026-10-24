-- market x named seller in the newest COMPLETE scan.
select
    realm,
    faction,
    seller,
    max(scan_id)             as scan_id,
    count(*)                 as listings,
    count(distinct item_key) as items,
    coalesce(sum(buyout), 0) as est_value
from {{ ref('latest_listings') }}
where seller is not null
group by realm, faction, seller
