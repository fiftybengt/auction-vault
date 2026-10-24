-- C3: every kept scan has exactly row_count listings in silver.
select s.scan_id, s.row_count, coalesce(l.n, 0) as listings
from {{ ref('silver_scans') }} s
left join (select scan_id, count(*) as n from {{ ref('silver_listings') }} group by scan_id) l
  on l.scan_id = s.scan_id
where coalesce(l.n, 0) <> s.row_count
