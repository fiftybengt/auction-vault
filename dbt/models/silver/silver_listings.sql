{{ config(
    alias='listings',
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['scan_id', 'row_no']
) }}
-- Rows of the kept copy of each scan (see silver_scans). Incremental: only scans whose kept copy
-- is not loaded yet. A better copy of a scan is a superset prefix of the old one (same row_no),
-- so merging on (scan_id, row_no) replaces it completely.
with todo as (
    select s.scan_id, s._source_dir, s.realm, s.faction, s.started_at, s.complete
    from {{ ref('silver_scans') }} s
    {% if is_incremental() %}
    left anti join (select distinct scan_id, _source_dir from {{ this }}) t
        on t.scan_id = s.scan_id and t._source_dir = s._source_dir
    {% endif %}
)
select
    l.scan_id,
    l.row_no,
    s.realm,
    s.faction,
    s.started_at                                    as scan_at,
    s.complete,
    l.item_key,
    l.item_id,
    l.suffix_id,
    l.stack_count,
    l.min_bid,
    nullif(l.buyout, 0)                             as buyout,
    l.bid_amount,
    l.time_left,
    nullif(l.seller, '')                            as seller,
    -- integer copper per unit; null when bid-only
    case when l.buyout > 0
         then cast(round(l.buyout / nullif(l.stack_count, 0)) as bigint) end as unit_buyout,
    cast(round(l.min_bid / nullif(l.stack_count, 0)) as bigint)            as unit_min_bid,
    l._source_dir,
    l._ingested_at
from {{ ref('bronze_listings') }} l
join todo s
  on s.scan_id = l.scan_id
 and s._source_dir = l._source_dir
