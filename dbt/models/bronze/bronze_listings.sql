{{ config(alias='listings') }}
with src as (
    select
        scan_id, row_no, item_key, item_id, suffix_id, stack_count,
        min_bid, buyout, bid_amount, time_left, seller,
        {{ landing_dir() }} as _source_dir
    from read_files('{{ var("landing_path") }}/*/listings.parquet', format => 'parquet')
)
select src.*, current_timestamp() as _ingested_at
from src
where _source_dir in (select _source_dir from {{ ref('bronze_upload') }})
{% if is_incremental() %}
  and _source_dir not in (select _source_dir from {{ this }})
{% endif %}
