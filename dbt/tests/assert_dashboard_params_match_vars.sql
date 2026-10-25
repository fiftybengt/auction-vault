-- C4 v4: dashboard.json params echo the dbt vars exactly; the export reads them from this one row.
with p as (select * from {{ ref('dashboard_params') }})
select 'row count' as problem, count(*) as n from p having count(*) != 1
union all
select 'value mismatch', count(*) from p
where deal_pct           != {{ var('deal_pct') }}
   or over_pct           != {{ var('over_pct') }}
   or min_gain_copper    != {{ var('min_gain_copper') }}
   or index_min_listings != {{ var('index_min_listings') }}
   or ref_min_days       != {{ var('ref_min_days') }}
   or ref_window_days    != {{ var('ref_window_days') }}
   or ref_half_life_days != {{ var('ref_half_life_days') }}
   or breadth_flat_pct   != {{ var('breadth_flat_pct') }}
having count(*) > 0
