-- C4 v4 groups: a class is mapped either as a whole ('*') or by subclass, never both, and one
-- group_id has one label and order. So every item lands in at most one group.
select 'class mapped both ways' as problem, class_name as k
from {{ ref('dashboard_groups') }}
group by class_name
having count_if(subclass_name = '*') > 0 and count(*) > 1
union all
select 'group with several labels', group_id
from {{ ref('dashboard_groups') }}
group by group_id
having count(distinct group_label) > 1 or count(distinct group_order) > 1
union all
select 'reserved id', group_id from {{ ref('dashboard_groups') }} where group_id = 'all'
