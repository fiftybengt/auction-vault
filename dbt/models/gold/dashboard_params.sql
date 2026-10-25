-- C4 v4 `params`: the dashboard's tunable dbt vars, one row, so the export echoes exactly the
-- values this build used (dashboard.json params must equal the vars).
select
    cast({{ var('deal_pct') }} as int)            as deal_pct,
    cast({{ var('over_pct') }} as int)            as over_pct,
    cast({{ var('min_gain_copper') }} as bigint)  as min_gain_copper,
    cast({{ var('index_min_listings') }} as int)  as index_min_listings,
    cast({{ var('ref_min_days') }} as int)        as ref_min_days,
    cast({{ var('ref_window_days') }} as int)     as ref_window_days,
    cast({{ var('ref_half_life_days') }} as int)  as ref_half_life_days,
    cast({{ var('breadth_flat_pct') }} as int)    as breadth_flat_pct
