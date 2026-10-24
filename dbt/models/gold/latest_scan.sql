-- The newest COMPLETE scan per market (zero rows until the first complete scan lands).
select realm, faction, scan_id, started_at as scan_at, row_count, expected_total
from (
    select *, row_number() over (
        partition by realm, faction order by started_at desc, scan_id desc) as _rank
    from {{ ref('silver_scans') }}
    where complete
)
where _rank = 1
