-- market x day (UTC) x item_key: the measures of that day's latest COMPLETE scan.
with day_scans as (
    select
        realm, faction, scan_id, started_at,
        cast(floor(started_at / 86400) as int) as unix_day,
        row_number() over (
            partition by realm, faction, cast(floor(started_at / 86400) as int)
            order by started_at desc, scan_id desc
        ) as _rank
    from {{ ref('silver_scans') }}
    where complete
)
select
    st.realm,
    st.faction,
    date_from_unix_date(d.unix_day)  as day,
    cast(d.unix_day as bigint) * 86400 as day_start,
    st.item_key,
    st.item_id,
    st.scan_id,
    st.scan_at,
    st.listings,
    st.quantity,
    st.min_unit,
    st.p10_unit,
    st.p25_unit,
    st.median_unit,
    st.p75_unit,
    st.sellers,
    st.bid_only
from {{ ref('item_scan_stats') }} st
join day_scans d
  on d.scan_id = st.scan_id
 and d._rank = 1
where st.complete
