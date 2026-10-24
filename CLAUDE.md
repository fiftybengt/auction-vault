# AuctionVault

WoW 3.3.5a (Warmane Icecrown) auction house prices:
addon → ingest → Databricks dbt → export → static site on GitHub Pages
(https://fiftybengt.github.io/auction-vault/).

## Working here
- The main session is the orchestrator. Delegate to the agents in `.claude/agents/`
  (addon, ingest, dbt, frontend, devops). Each one owns its directories; read its file
  before working in that area.
- `docs/contracts.md` defines every hand-off: SavedVariables (C1), landing Parquet (C2),
  warehouse (C3), site JSON (C4). Change it deliberately and bump the version; agents
  propose changes, they do not make them.
- Money is integer copper and times are unix seconds (UTC). Partial scans
  (`complete=false`) never feed price trends.

## Secrets
- Databricks credentials live in the GNOME keyring (`scripts/dbx_secret.py`). Run anything
  that needs them as `scripts/with-databricks <cmd>`. Never print, log or commit the token,
  and never create `~/.databrickscfg`, `.env` or `dbt/profiles.yml` with values in them.
- CI reads the GitHub Actions secrets `DATABRICKS_HOST`, `DATABRICKS_TOKEN` and
  `DATABRICKS_HTTP_PATH`.
- The Databricks workspace is for this project only: catalog `auction`.

## Never
- Write into the WoW client directory (`~/Downloads/World of Warcraft 3.3.5a`); it is read-only.
- Commit `resource_maybe_worth_checking/` (third-party reference code) or `data/raw/`.

## Commands
- `make test`: addon tests. `make ingest-test`: ingest tests. `make site-dev`: local site
  with fixture data.
- `make publish`: archive and upload the live SavedVariables, then trigger build-deploy.
- Outward-facing steps (repo settings, secrets, dropping catalogs) are often blocked in auto
  mode. Put them in a short script under `scripts/` for the user to run with `!`.
