{{ config(alias='sellers') }}
-- Named sellers per market, over every scan (partial ones included). Null seller = server sent
-- no name; those are not a seller.
select
    realm,
    faction,
    seller,
    min(scan_at)            as first_seen_at,
    max(scan_at)            as last_seen_at,
    count(distinct scan_id) as scans,
    count(*)                as listings
from {{ ref('silver_listings') }}
where seller is not null
group by realm, faction, seller
