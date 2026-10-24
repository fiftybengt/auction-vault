-- market x scan, ALL scans. Partial scans are kept with their `coverage` so nothing is lost;
-- charts of market size over time should use complete = true only.
with agg as (
    select
        scan_id,
        count(*)                 as listings,
        sum(stack_count)         as quantity,
        count(distinct item_key) as items,
        count(distinct seller)   as sellers,
        count_if(buyout is null) as bid_only
    from {{ ref('silver_listings') }}
    group by scan_id
)
select
    s.realm,
    s.faction,
    s.scan_id,
    s.started_at                 as scan_at,
    s.ended_at,
    s.complete,
    s.row_count,
    s.expected_total,
    s.coverage,
    s.nil_owners,
    coalesce(a.listings, 0)      as listings,
    coalesce(a.quantity, 0)      as quantity,
    coalesce(a.items, 0)         as items,
    coalesce(a.sellers, 0)       as sellers,
    coalesce(a.bid_only, 0)      as bid_only
from {{ ref('silver_scans') }} s
left join agg a on a.scan_id = s.scan_id
