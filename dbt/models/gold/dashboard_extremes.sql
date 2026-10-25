-- C3 v3 / C4 v4 `extremes`: per window (7 and 30 UTC days up to and including the current
-- scan's day), items whose value today is strictly below the min (`low`) or above the max
-- (`high`) of their other days in the window. An item needs a day value on >= need_days of the
-- window's days (need_days = max(3, ceil(days / 2))), including today, and today's listings >= 3.
-- rank: low by pct ascending, high by pct descending, then item_key; top 25 each.
-- The window header (haveDays/needDays) is in the export; it holds for empty windows too.
with cur as (
    select realm, faction, scan_id, cast(floor(scan_at / 86400) as int) as cur_day
    from {{ ref('latest_scan') }}
),
windows as (
    select '7d' as window_id, 7 as days
    union all
    select '30d', 30
),
win as (
    select c.*, w.window_id, w.days, greatest(3, (w.days + 1) div 2) as need_days
    from cur c cross join windows w
),
vals as (
    select w.realm, w.faction, w.scan_id, w.window_id, w.days, w.need_days, w.cur_day,
           v.item_key, v.unix_day, v.value, v.listings
    from win w
    join {{ ref('item_day_value') }} v
      on v.realm = w.realm and v.faction = w.faction
     and v.unix_day between w.cur_day - w.days + 1 and w.cur_day
),
per_item as (
    select
        realm, faction, scan_id, window_id, days, need_days, item_key,
        count(*)                                                  as item_days,
        max(case when unix_day = cur_day then value end)          as unit,
        max(case when unix_day = cur_day then listings end)       as listings,
        min(case when unix_day < cur_day then value end)          as other_min,
        max(case when unix_day < cur_day then value end)          as other_max
    from vals
    group by realm, faction, scan_id, window_id, days, need_days, item_key
),
qualified as (
    select * from per_item
    where unit is not null and item_days >= need_days and listings >= 3
),
sides as (
    select realm, faction, scan_id, window_id, days, need_days, 'low' as side, item_key,
           unit, other_min as prev_unit, listings, item_days
    from qualified
    where unit < other_min
    union all
    select realm, faction, scan_id, window_id, days, need_days, 'high', item_key,
           unit, other_max, listings, item_days
    from qualified
    where unit > other_max and other_max > 0
),
ranked as (
    select *,
        cast(round((unit / cast(prev_unit as double) - 1) * 100, 1) as double) as pct
    from sides
),
numbered as (
    select *,
        row_number() over (
            partition by realm, faction, window_id, side
            order by case when side = 'low' then pct else -pct end, item_key) as rank
    from ranked
)
select realm, faction, scan_id, window_id, days, need_days, side, rank, item_key,
       unit, prev_unit, pct, listings, item_days
from numbered
where rank <= 25
