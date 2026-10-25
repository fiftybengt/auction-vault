-- C3 v3: market x UTC day x group ('all' + each dashboard_groups id): chained Jevons index.
-- Days = UTC days with a complete scan; day_at = that day's latest complete scan.
-- For consecutive days with data d0 -> d1 (gaps allowed), an item is eligible when it has a day
-- value on both days, listings >= index_min_listings on both, and both values > 0.
--   r = clip(value1 / value0, 0.5, 2),  step = mean ln r over the group's eligible items.
-- A group with fewer than 5 eligible items has no step that day (index null).
-- Chaining: I(d) = 100 * exp(sum of the non-null steps up to d), which is the same as
-- I(d1) = I(d0) * exp(step), with a null day chaining on from the last non-null value.
-- Every group is 100 on the market's first day. up/down/flat count the eligible items by
-- the unclipped relative against 1 +- breadth_flat_pct/100 (exact integer comparison).
{% set min_listings = var('index_min_listings') %}
{% set flat_pct = var('breadth_flat_pct') %}
with days as (
    select realm, faction,
           cast(floor(started_at / 86400) as int) as unix_day,
           max(started_at)                        as day_at
    from {{ ref('silver_scans') }}
    where complete
    group by realm, faction, cast(floor(started_at / 86400) as int)
),
ordered as (
    select *,
        lag(unix_day)  over (partition by realm, faction order by unix_day) as prev_day,
        row_number()   over (partition by realm, faction order by unix_day) as day_no
    from days
),
item_groups as (
    -- each item is in at most one group (a '*' subclass matches any subclass of that class)
    select i.item_key, g.group_id
    from {{ ref('silver_items') }} i
    join {{ ref('dashboard_groups') }} g
      on g.class_name = i.item_type
     and (g.subclass_name = i.item_subtype or g.subclass_name = '*')
),
relatives as (
    select
        d.realm, d.faction, d.unix_day, v1.item_key,
        v1.value as value1,
        v0.value as value0,
        least(greatest(v1.value / v0.value, 0.5), 2.0) as r
    from ordered d
    join {{ ref('item_day_value') }} v1
      on v1.realm = d.realm and v1.faction = d.faction and v1.unix_day = d.unix_day
    join {{ ref('item_day_value') }} v0
      on v0.realm = d.realm and v0.faction = d.faction and v0.unix_day = d.prev_day
     and v0.item_key = v1.item_key
    where v1.listings >= {{ min_listings }} and v0.listings >= {{ min_listings }}
      and v1.value > 0 and v0.value > 0
),
by_group as (
    select realm, faction, unix_day, 'all' as group_id, value1, value0, r from relatives
    union all
    select r.realm, r.faction, r.unix_day, g.group_id, r.value1, r.value0, r.r
    from relatives r
    join item_groups g on g.item_key = r.item_key
),
agg as (
    select
        realm, faction, unix_day, group_id,
        count(*)                                                  as items,
        avg(ln(r))                                                as mean_log_r,
        count_if(value1 * 100 > value0 * (100 + {{ flat_pct }}))  as up,
        count_if(value1 * 100 < value0 * (100 - {{ flat_pct }}))  as down
    from by_group
    group by realm, faction, unix_day, group_id
),
groups as (
    select 'all' as group_id
    union
    select distinct group_id from {{ ref('dashboard_groups') }}
),
grid as (
    select
        d.realm, d.faction, d.unix_day, d.day_at, d.prev_day, d.day_no, g.group_id,
        coalesce(a.items, 0)                                       as items,
        case when a.items >= 5 then a.mean_log_r end               as step_log_r,
        case when d.day_no > 1 then coalesce(a.up, 0) end          as up,
        case when d.day_no > 1 then coalesce(a.down, 0) end        as down,
        case when d.day_no > 1
             then coalesce(a.items, 0) - coalesce(a.up, 0) - coalesce(a.down, 0) end as flat
    from ordered d
    cross join groups g
    left join agg a
      on a.realm = d.realm and a.faction = d.faction and a.unix_day = d.unix_day
     and a.group_id = g.group_id
)
select
    realm,
    faction,
    date_from_unix_date(unix_day)                      as day,
    unix_day,
    day_at,
    case when prev_day is not null then date_from_unix_date(prev_day) end as prev_day,
    day_no,
    group_id,
    items,
    step_log_r,
    case
        when day_no = 1 then cast(100.0 as double)
        when step_log_r is null then cast(null as double)
        else round(100.0 * exp(sum(coalesce(step_log_r, 0.0)) over (
                 partition by realm, faction, group_id order by unix_day
                 rows between unbounded preceding and current row)), 2)
    end                                                as index_value,
    up,
    down,
    flat
from grid
