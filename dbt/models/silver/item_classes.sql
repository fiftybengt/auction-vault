-- ItemClass x ItemSubClass from the 3.3.5a DBC seeds. `display_name` is what GetItemInfo()
-- returns as the item subtype (the plural form where the DBC has one, e.g. "One-Handed Axes").
select
    s.class_id,
    s.subclass_id,
    c.class_name,
    s.subclass_name,
    nullif(s.subclass_plural, '')                         as subclass_plural,
    coalesce(nullif(s.subclass_plural, ''), s.subclass_name) as display_name
from {{ ref('dbc_item_subclass') }} s
join {{ ref('dbc_item_class') }} c on c.class_id = s.class_id
