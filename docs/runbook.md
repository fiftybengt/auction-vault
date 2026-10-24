# Runbook

How data gets from an in-game scan to the [live site](https://fiftybengt.github.io/auction-vault/),
how to keep the pipeline healthy, and what to do when something breaks.

---

## 1. From scan to site

```
 in game                    your PC                       Databricks               GitHub
┌───────────────┐ /reload ┌──────────────────┐ upload ┌──────────────────┐     ┌──────────────┐
│ Auctionator   │────────>│ SavedVariables   │───────>│ auction.raw      │     │ build-deploy │
│ Full Scan     │         │ AuctionVault.lua │        │ .landing volume  │     │ workflow     │
│ + AuctionVault│         │ → data/raw/ copy │        │ → bronze/silver/ │<────│ dbt build    │
│   harvest     │         └──────────────────┘        │   gold (dbt)     │────>│ export JSON  │
└───────────────┘          make publish ──────────────────────────────────────>│ deploy Pages │
                                                                               └──────────────┘
```

### Step 1: Scan in game
1. Log in on a character on the realm and faction you want prices for.
2. Open the auction house and click **Auctionator → Full Scan**. The server allows one full
   scan every 15 minutes.
3. Wait for chat to show:
   `AuctionVault scan Icecrown:Alliance:<time> -- 55000 listings, N sellers (no further list updates)`.
   If it says **`[INCOMPLETE]`** instead, see [Troubleshooting](#3-troubleshooting).
4. Check with `/av status`: the newest scan should have `rowCount == expectedTotal`.

### Step 2: Write it to disk
Type **`/reload`**, or log out. The game only writes SavedVariables at that moment. A scan that
is still in memory is lost if the game crashes.

The file is `~/Downloads/World of Warcraft 3.3.5a/WTF/Account/SICU/SavedVariables/AuctionVault.lua`.
To see what is in it without the game running:

```sh
make status
```

### Step 3: Publish
From the repo root:

```sh
make publish
```

What it does, in order:
1. **Archives** the file to `data/raw/<timestamp>_AuctionVault.lua`, checked with sha256 and
   recorded in `data/raw/manifest.json`. This copy is the only permanent record. The game file
   keeps just the newest 6 scans.
2. **Skips** the rest if this exact file was already uploaded (`already uploaded ...; nothing to do`).
3. **Parses and validates** it into Parquet. It checks the row counts, the fields and the seller indexes.
4. **Uploads** it to `/Volumes/auction/raw/landing/<timestamp>/`. `upload.parquet` goes last and
   marks the upload as complete.
5. **Starts** the GitHub workflow: `started build-deploy on fiftybengt/auction-vault`.

To preview without uploading: `make publish-dry`.

### Step 4: The site rebuilds (about 3 minutes)
The `build-deploy` workflow runs `dbt build` (bronze → silver → gold), exports gold to JSON,
checks its shape, builds the site and deploys it to Pages.

```sh
gh run watch -R fiftybengt/auction-vault        # follow it live
```

### Step 5: Check the site
- The freshness bar at the top shows the time of your scan.
- Raw check: [`data/icecrown-alliance/meta.json`](https://fiftybengt.github.io/auction-vault/data/icecrown-alliance/meta.json).
  `lastCompleteScan.at` should be your scan's unix time.

**Rule of thumb:** scan → `/reload` → `make publish`, at least once per play session. Trends need
many complete scans, and movers need complete scans at least 1 day (and 7 days) apart.

---

## 2. Maintaining the flow

### Routine
| When | What |
|---|---|
| Every session | Scan → `/reload` → `make publish`. |
| After changing code | `make test` (addon), `make ingest-test` (ingest). The site and dbt are checked in CI on every push. |
| Monthly | Back up `data/raw/` somewhere outside this PC. It holds every scan ever taken. |
| Before the token expires | Rotate it (below). |

### Rotate the Databricks token
1. Databricks → profile icon → **Settings → Developer → Access tokens** → generate a token with an
   expiry (e.g. 90 days).
2. In your own terminal: `python3 scripts/dbx_secret.py set-token` (hidden input).
3. `scripts/github-setup.sh` copies the token from the keyring into the GitHub secret.
   It is safe to re-run.
4. Revoke the old token in Databricks.

`python3 scripts/dbx_secret.py status` shows what is stored, without revealing the token.

### Another realm or faction
No changes needed. Scan with a character there and publish. Every table is keyed by
realm + faction, and the site's market switcher picks the new market up from `markets.json`.

### Rebuild the warehouse from scratch
Every upload stays in the landing volume, so the warehouse can always be rebuilt from it:

```sh
cp dbt/profiles.yml.example dbt/profiles.yml   # once; env vars only, gitignored
scripts/with-databricks dbt/.venv/bin/dbt build --project-dir dbt --profiles-dir dbt --full-refresh
gh workflow run build-deploy.yml -R fiftybengt/auction-vault
```

### Run the pipeline locally
```sh
scripts/with-databricks dbt/.venv/bin/dbt build --project-dir dbt --profiles-dir dbt
scripts/with-databricks dbt/.venv/bin/python export/export_gold.py --out /tmp/av-export
dbt/.venv/bin/python export/check_c4.py /tmp/av-export
make site-dev          # site with generated sample data at localhost
```

### Useful Databricks queries (SQL Editor)
```sql
-- what the warehouse has, newest first
select scan_id, from_unixtime(started_at) as at, row_count, expected_total, complete, coverage
from auction.silver.scans order by started_at desc;

-- what has landed
list '/Volumes/auction/raw/landing/';
```

### Limits to keep in mind
- **Free Edition** has daily compute limits. One build takes about 1–2 minutes of warehouse
  time, which is well inside them. If they are hit anyway, builds fail until the next day.
- **SavedVariables keeps 6 scans.** Publishing after every session means nothing rotates out
  before it is archived.
- **`index.json`** is about 118 KB gzipped. Split it at about 300 KB (see `docs/contracts.md`).

---

## 3. Troubleshooting

Find the symptom, then work down the checks.

### In game
| Symptom | Cause | Fix |
|---|---|---|
| Chat says `harvest aborted: list shrank to X of Y` / `[INCOMPLETE]` | The list disappeared before it was read: the AH closed, another addon searched, or a disconnect | Wait out the 15 min cooldown and scan again. Incomplete scans are kept but never plotted. |
| No AuctionVault message after the scan | The addon is not loaded | Character select → **AddOns**: enable AuctionVault. On the PC: `ls -l "$HOME/Downloads/World of Warcraft 3.3.5a/Interface/AddOns/AuctionVault"` must be a symlink into this repo (`make install` restores it). |
| `/av status` shows the scan but `make status` doesn't | Not written to disk yet | `/reload`. |
| `/av diag` shows the largest list ever seen as ≤ 50 | The scan was paged, not a getAll | Use Auctionator's **Full Scan**, not a normal search. |

### `make publish`
| Message | Cause | Fix |
|---|---|---|
| `already uploaded ...; nothing to do` | Same file as last time | Did you `/reload` after scanning? `make status` shows the newest scan in the file. |
| `no token stored` / `no host stored` / credentials missing | Keyring empty, or still locked after login | `python3 scripts/dbx_secret.py status`; set it again if needed. |
| `401` / `403` / `Invalid access token` | Token expired or revoked | [Rotate the token](#rotate-the-databricks-token). |
| `INVALID SavedVariables: ...` (scan id + row) | File truncated, usually a game crash mid-write | Log in and `/reload` again to rewrite it. Older uploads are unaffected, and the bad file is still archived in `data/raw/`. |
| `repo ... not reachable: skipping the site build` | `gh` not logged in | `gh auth login`, then `gh workflow run build-deploy.yml -R fiftybengt/auction-vault`. The upload itself already succeeded. |
| Failed halfway through the upload | Network | Run `make publish` again. A retry uses a fresh landing directory, and the incomplete one is ignored because it has no `upload.parquet`. |

### GitHub workflow
Start with `gh run view --log-failed -R fiftybengt/auction-vault`.

| Failing step | Cause | Fix |
|---|---|---|
| **Check secrets** | A repository secret is missing | `scripts/github-setup.sh` |
| **dbt build**: connection or auth error | Token expired, or the warehouse is unavailable | Rotate the token. Check the warehouse in Databricks → **SQL Warehouses**. |
| **dbt build**: a test failed | The data broke an assumption, e.g. row counts don't reconcile | Run dbt locally (above) and read the failing test in `dbt/tests/` or the model's `_*.yml`. Never skip the test to get a deploy out. |
| **dbt build**: quota or limit error | Free Edition daily compute limit | Wait until the next day and re-run. |
| **Check C4 shape** | The export no longer matches the contract | Run the export locally and compare it with `docs/contracts.md` C4. |
| **Build site** | Frontend compile error | `cd site && npm ci && npm run build` locally. |
| **deploy** | Pages is not set to Actions | Settings → Pages → Source = **GitHub Actions** (or re-run `scripts/github-setup.sh`). |

### The site
| Symptom | Cause | Fix |
|---|---|---|
| Old data after a green run | Browser or Pages cache | Hard refresh (Ctrl+Shift+R). Compare `meta.json` `generatedAt` with the run time. |
| "No complete scan yet" | No `complete=true` scan in the warehouse | Run the silver scans query above. If every scan is incomplete, rescan in game. |
| Movers empty | Needs complete scans ≥ 1 day apart, with ≥ 3 listings at both ends | Keep scanning daily. |
| An item has no history | Not listed in any complete scan, or only once | Expected. The item page shows "last seen". |
| Seller pages almost empty | Warmane omits seller names on full scans (about 98% unnamed) | Server limitation. Nothing to fix. |
