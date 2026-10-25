-- C3: the dashboard models (C3 v3) never contain a partial scan, and the "current" lists all
-- come from the newest complete scan.
with partial as (select scan_id from {{ ref('silver_scans') }} where not complete),
cur as (select scan_id from {{ ref('latest_scan') }})
select 'item_scan_value' as model, scan_id from {{ ref('item_scan_value') }} where scan_id in (select scan_id from partial)
union all
select 'item_reference', scan_id from {{ ref('item_reference') }} where scan_id not in (select scan_id from cur)
union all
select 'dashboard_deals', scan_id from {{ ref('dashboard_deals') }} where scan_id not in (select scan_id from cur)
union all
select 'dashboard_overpriced', scan_id from {{ ref('dashboard_overpriced') }} where scan_id not in (select scan_id from cur)
union all
select 'dashboard_extremes', scan_id from {{ ref('dashboard_extremes') }} where scan_id not in (select scan_id from cur)
union all
select 'dashboard_valuable', scan_id from {{ ref('dashboard_valuable') }} where scan_id not in (select scan_id from cur)
