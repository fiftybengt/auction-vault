{{ config(alias='scans') }}
-- One row per scan_id. The addon keeps its newest 6 scans, so the same scan arrives in several
-- uploads; keep the copy with the most rows (newest upload on a tie).
with ranked as (
    select
        *,
        row_number() over (
            partition by scan_id
            order by row_count desc, _source_dir desc
        ) as _rank,
        count(*) over (partition by scan_id) as _copies
    from {{ ref('bronze_scans') }}
)
select
    scan_id,
    nullif(realm, '')   as realm,
    nullif(faction, '') as faction,
    started_at,
    ended_at,
    nullif(player, '')  as player,
    nullif(mode, '')    as mode,
    nullif(source, '')  as source,
    row_count,
    expected_total,
    complete,
    nil_owners,
    unresolved,
    cast(row_count as double) / nullif(expected_total, 0) as coverage,
    _copies as copies,
    _source_dir,
    _ingested_at
from ranked
where _rank = 1
