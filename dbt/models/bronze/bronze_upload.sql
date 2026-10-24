{{ config(alias='upload') }}
-- C2: upload.parquet is written last and marks its landing directory as complete.
-- Every other bronze table only loads directories that appear here.
with src as (
    select
        upload_ts,
        sv_sha256,
        sv_bytes,
        `schema`,
        addon_version,
        parser_version,
        {{ landing_dir() }} as _source_dir
    from read_files('{{ var("landing_path") }}/*/upload.parquet', format => 'parquet')
)
select src.*, current_timestamp() as _ingested_at
from src
{% if is_incremental() %}
where _source_dir not in (select _source_dir from {{ this }})
{% endif %}
