{{ config(alias='items', on_schema_change='append_new_columns') }}
-- C2 v2 added a nullable `icon` column; pre-v2 landing dirs have no such column. An explicit
-- schema makes read_files() read old and new files alike (icon is null for the old ones), and
-- append_new_columns adds `icon` to the existing incremental table without a full refresh.
with src as (
    select
        item_key, item_id, suffix_id, name, quality, item_level, req_level,
        item_type, item_subtype, stack_max, vendor_sell, equip_loc, icon,
        {{ landing_dir() }} as _source_dir
    from read_files(
        '{{ var("landing_path") }}/*/items.parquet',
        format => 'parquet',
        schema => 'item_key string, item_id int, suffix_id int, name string, quality tinyint,
                   item_level smallint, req_level smallint, item_type string, item_subtype string,
                   stack_max smallint, vendor_sell bigint, equip_loc string, icon string'
    )
)
-- icon goes last so a fresh build has the same column order as the migrated table
select
    item_key, item_id, suffix_id, name, quality, item_level, req_level,
    item_type, item_subtype, stack_max, vendor_sell, equip_loc,
    _source_dir, current_timestamp() as _ingested_at, icon
from src
where _source_dir in (select _source_dir from {{ ref('bronze_upload') }})
{% if is_incremental() %}
  and _source_dir not in (select _source_dir from {{ this }})
{% endif %}
