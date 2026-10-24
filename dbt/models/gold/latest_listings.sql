-- market x listing in the newest COMPLETE scan.
select
    l.realm,
    l.faction,
    l.scan_id,
    l.scan_at,
    l.row_no,
    l.item_key,
    l.item_id,
    i.name,
    i.quality,
    l.stack_count,
    l.min_bid,
    l.buyout,
    l.bid_amount,
    l.unit_buyout,
    l.unit_min_bid,
    l.time_left,
    l.seller
from {{ ref('silver_listings') }} l
join {{ ref('latest_scan') }} ls on ls.scan_id = l.scan_id
left join {{ ref('silver_items') }} i on i.item_key = l.item_key
