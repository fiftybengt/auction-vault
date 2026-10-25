{{ config(alias='items') }}
-- Every upload carries the whole item dimension; the latest upload wins, except for icon (C3):
-- that is the latest non-null icon across all uploads (pre-v2 uploads carry no icon).
with ranked as (
    select *, row_number() over (partition by item_key order by _source_dir desc) as _rank
    from {{ ref('bronze_items') }}
),
icons as (
    select item_key, max_by(icon, _source_dir) as icon
    from {{ ref('bronze_items') }}
    where nullif(icon, '') is not null
    group by item_key
),
class_lookup as (
    -- one (class_id, subclass_id) per (class name, subtype name); lowest id on a name clash
    select class_name, display_name, class_id, subclass_id
    from (
        select *, row_number() over (
            partition by class_name, display_name order by class_id, subclass_id) as _rank
        from {{ ref('item_classes') }}
    )
    where _rank = 1
)
select
    i.item_key,
    i.item_id,
    i.suffix_id,
    nullif(i.name, '')         as name,
    i.quality,
    i.item_level,
    i.req_level,
    nullif(i.item_type, '')    as item_type,
    nullif(i.item_subtype, '') as item_subtype,
    i.stack_max,
    i.vendor_sell,
    nullif(i.equip_loc, '')    as equip_loc,
    ic.icon,
    c.class_id,
    c.subclass_id,
    i._source_dir,
    i._ingested_at
from ranked i
left join icons ic
  on ic.item_key = i.item_key
left join class_lookup c
  on c.class_name = i.item_type
 and c.display_name = i.item_subtype
where i._rank = 1
