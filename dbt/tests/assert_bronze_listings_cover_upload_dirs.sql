-- Every completed landing directory produced scans and listings in bronze.
select u._source_dir
from {{ ref('bronze_upload') }} u
where u._source_dir not in (select _source_dir from {{ ref('bronze_scans') }})
   or u._source_dir not in (select _source_dir from {{ ref('bronze_listings') }})
