-- Incremental state check for item_scan_value (merge on scan x item): after any number of runs,
-- every complete scan is loaded from its KEPT copy only (no rows left from a smaller, older copy)
-- and holds exactly one row per item with a buyout listing in silver, with matching listing counts.
with kept as (
    select scan_id, _source_dir from {{ ref('silver_scans') }} where complete
),
expected as (
    select l.scan_id, l.item_key, count(*) as listings
    from {{ ref('silver_listings') }} l
    join kept k on k.scan_id = l.scan_id and k._source_dir = l._source_dir
    group by l.scan_id, l.item_key
    having count(l.unit_buyout) > 0
),
actual as (
    select scan_id, item_key, listings, _source_dir from {{ ref('item_scan_value') }}
)
select 'row from a non-kept copy or a partial scan' as problem, a.scan_id, a.item_key
from actual a left anti join kept k on k.scan_id = a.scan_id and k._source_dir = a._source_dir
union all
select 'missing or extra item, or listings differ', coalesce(e.scan_id, a.scan_id), coalesce(e.item_key, a.item_key)
from expected e
full outer join actual a on a.scan_id = e.scan_id and a.item_key = e.item_key
where e.scan_id is null or a.scan_id is null or e.listings != a.listings
