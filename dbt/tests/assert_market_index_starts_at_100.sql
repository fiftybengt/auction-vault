-- C4 v4: every group's index is 100 on the market's first day with complete scans, every market
-- with a complete scan has that first 'all' point, and after day 1 the index is null exactly when
-- the group has fewer than 5 eligible items.
with first_all as (
    select realm, faction from {{ ref('market_index') }} where day_no = 1 and group_id = 'all'
),
markets as (
    select distinct realm, faction from {{ ref('silver_scans') }} where complete
)
select 'first day not 100' as problem, realm, faction, group_id, day
from {{ ref('market_index') }}
where day_no = 1 and (index_value is null or index_value != 100)
union all
select 'market without a first all point', m.realm, m.faction, 'all', cast(null as date)
from markets m left anti join first_all f on f.realm = m.realm and f.faction = m.faction
union all
select 'null rule broken', realm, faction, group_id, day
from {{ ref('market_index') }}
where day_no > 1 and ((items < 5) != (index_value is null))
