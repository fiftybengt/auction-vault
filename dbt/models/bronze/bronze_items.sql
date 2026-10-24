{{ config(alias='items') }}
with src as (
    select
        item_key, item_id, suffix_id, name, quality, item_level, req_level,
        item_type, item_subtype, stack_max, vendor_sell, equip_loc,
        {{ landing_dir() }} as _source_dir
    from read_files('{{ var("landing_path") }}/*/items.parquet', format => 'parquet')
)
select src.*, current_timestamp() as _ingested_at
from src
where _source_dir in (select _source_dir from {{ ref('bronze_upload') }})
{% if is_incremental() %}
  and _source_dir not in (select _source_dir from {{ this }})
{% endif %}
