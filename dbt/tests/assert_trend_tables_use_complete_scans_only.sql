-- C3: trend and "current price" tables never contain a partial scan.
with partial as (select scan_id from {{ ref('silver_scans') }} where not complete)
select 'item_daily' as model, scan_id from {{ ref('item_daily') }} where scan_id in (select scan_id from partial)
union all
select 'latest_listings', scan_id from {{ ref('latest_listings') }} where scan_id in (select scan_id from partial)
union all
select 'movers', scan_id from {{ ref('movers') }} where scan_id in (select scan_id from partial)
union all
select 'seller_summary', scan_id from {{ ref('seller_summary') }} where scan_id in (select scan_id from partial)
