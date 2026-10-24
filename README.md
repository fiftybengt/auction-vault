# AuctionVault

**Live site: [fiftybengt.github.io/auction-vault](https://fiftybengt.github.io/auction-vault/)**

Current prices and price trends for the World of Warcraft 3.3.5a auction house on Warmane
Icecrown, built from full in-game scans of every listing.

```
addon ──> ingest ──> Databricks (dbt) ──> export ──> site
 scan     Parquet     bronze -> silver     gold ->    React on
 in game  upload      -> gold              JSON       GitHub Pages
```

| | |
|---|---|
| [`addon/`](addon/README.md) | WoW addon that records every auction listing during an Auctionator full scan |
| `ingest/` | Archives the SavedVariables file, converts it to Parquet, uploads it to Databricks |
| `dbt/` | Bronze / silver / gold models on Databricks |
| `export/` | Gold tables → static JSON for the site |
| `site/` | Vite + React + Tailwind + uPlot |

Data formats between stages: [docs/contracts.md](docs/contracts.md). Operating and troubleshooting: [docs/runbook.md](docs/runbook.md).

## Updating the data

Full Scan in game → `/reload` → `make publish`. The upload starts
[build-deploy](.github/workflows/build-deploy.yml), which rebuilds the warehouse and redeploys
the site.
