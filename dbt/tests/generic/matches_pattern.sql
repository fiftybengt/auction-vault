{# Fails for every non-null value of `column_name` that does not fully match the regex `pattern`. #}
{% test matches_pattern(model, column_name, pattern) %}
select {{ column_name }}
from {{ model }}
where {{ column_name }} is not null
  and not regexp_like({{ column_name }}, '{{ pattern }}')
{% endtest %}
