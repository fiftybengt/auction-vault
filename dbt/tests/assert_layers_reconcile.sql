-- Row counts reconcile across layers: every silver scan is in market_overview with all its
-- listings, and item_scan_stats accounts for every silver listing.
with s as (select count(*) as n from {{ ref('silver_listings') }}),
     o as (select coalesce(sum(listings), 0) as n, count(*) as scans from {{ ref('market_overview') }}),
     i as (select coalesce(sum(listings), 0) as n from {{ ref('item_scan_stats') }}),
     sc as (select count(*) as scans from {{ ref('silver_scans') }})
select s.n as silver, o.n as overview, i.n as item_stats, o.scans, sc.scans as silver_scans
from s, o, i, sc
where s.n <> o.n or s.n <> i.n or o.scans <> sc.scans
