{# Fails for every combination of `columns` that occurs more than once. #}
{% test unique_key(model, columns) %}
select {{ columns | join(', ') }}, count(*) as n
from {{ model }}
group by {{ columns | join(', ') }}
having count(*) > 1
{% endtest %}
