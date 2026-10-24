# AuctionVault

Auction house price history for a WoW 3.3.5a realm, from in-game scan to a static website.

```
addon ──> ingest ──> Databricks (dbt) ──> export ──> site
 scan     archive +   bronze -> silver     gold ->    Vite app on
 in game  upload to   -> gold              JSON       GitHub Pages
          the volume
```

| Step | Where | What it does |
|---|---|---|
| Addon | `addon/` | Records every auction listing to SavedVariables. See [addon/README.md](addon/README.md). |
| Ingest | `ingest/` | Archives the SavedVariables file to `data/raw/`, parses it to Parquet and uploads it to `/Volumes/auction/raw/landing/`. |
| Warehouse | `dbt/` | `dbt build` on the Databricks SQL warehouse: bronze, silver and gold tables in catalog `auction`. |
| Export | `export/` | `export_gold.py` turns the gold tables into the site's JSON, and `check_c4.py` checks its shape. |
| Site | `site/` | Static React/Vite site, published to GitHub Pages under `/auction-vault/`. |

The interfaces between the steps (file formats, tables, JSON) are defined in
[docs/contracts.md](docs/contracts.md).

The warehouse, export and site steps run in GitHub Actions
(`.github/workflows/build-deploy.yml`) on every push to `main` and whenever `make publish`
starts them.

## One-time setup

1. **Local Databricks credentials** go in the GNOME keyring, never in a file:

   ```sh
   scripts/dbx_secret.py set-host https://dbc-dbdf7f4d-bcc2.cloud.databricks.com
   scripts/dbx_secret.py set-token        # prompts, hidden input
   scripts/dbx_secret.py status
   ```

   Anything that needs them runs as `scripts/with-databricks <command>`.

2. **Addon**: `make install` symlinks it into the client (set `WOW_DIR=...` if the client is
   somewhere else). Ace3 must be installed.

3. **GitHub repo** `fiftybengt/auction-vault` (public), with these Actions secrets under
   *Settings > Secrets and variables > Actions*:

   | Secret | Value |
   |---|---|
   | `DATABRICKS_HOST` | `https://dbc-dbdf7f4d-bcc2.cloud.databricks.com` |
   | `DATABRICKS_HTTP_PATH` | `/sql/1.0/warehouses/7655e13e54222e5a` |
   | `DATABRICKS_TOKEN` | a Databricks personal access token |

   If a secret is missing, the workflow stops before it deploys anything.

4. **Pages**: *Settings > Pages > Build and deployment > Source = GitHub Actions*.

5. `gh auth login`, so `make publish` can start the workflow.

## Everyday flow

1. Scan the auction house in game.
2. `/reload` (or log out) so the client writes SavedVariables to disk.
3. `make publish`. This archives and uploads the file, then runs
   `gh workflow run build-deploy.yml`. The workflow rebuilds the warehouse, exports the JSON and
   deploys the site. Follow it with `gh run watch -R fiftybengt/auction-vault`.

The client keeps only the newest scans, so publish after every session.

## Other targets

| Command | What it does |
|---|---|
| `make test` | Lua syntax check and the headless addon tests |
| `make sample` | Writes a realistic SavedVariables file to `build/` and checks its format |
| `make status` | Shows what the live client has captured |
| `make publish-dry` | Archives and parses the file without uploading anything |
| `make ingest-test` | Runs the ingest pytest suite |
| `make site-dev` | Writes fixture data and starts the Vite dev server |

To run the warehouse and export locally:

```sh
cp dbt/profiles.yml.example dbt/profiles.yml      # env_var only, gitignored
scripts/with-databricks dbt/.venv/bin/dbt build --project-dir dbt --profiles-dir dbt
scripts/with-databricks dbt/.venv/bin/python export/export_gold.py --out site/public/data
```
