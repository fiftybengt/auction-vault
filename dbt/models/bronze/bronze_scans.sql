{{ config(alias='scans') }}
with src as (
    select
        scan_id, started_at, ended_at, realm, faction, player, mode, source,
        row_count, expected_total, complete, nil_owners, unresolved,
        {{ landing_dir() }} as _source_dir
    from read_files('{{ var("landing_path") }}/*/scans.parquet', format => 'parquet')
)
select src.*, current_timestamp() as _ingested_at
from src
where _source_dir in (select _source_dir from {{ ref('bronze_upload') }})
{% if is_incremental() %}
  and _source_dir not in (select _source_dir from {{ this }})
{% endif %}
