{# The landing directory name (<upload_ts>) a row was read from, taken from read_files() metadata. #}
{% macro landing_dir() -%}
    regexp_extract(_metadata.file_path, '/landing/([^/]+)/', 1)
{%- endmacro %}
