#!/usr/bin/env bash
# One-time GitHub setup: repo secrets from the GNOME keyring, Pages via Actions, first push.
# Safe to re-run: secrets are overwritten, and Pages is only created if it is missing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO="${GH_REPO:-fiftybengt/auction-vault}"
here=scripts

echo "setting secrets on $REPO"
/usr/bin/python3 "$here/dbx_secret.py" get token | gh secret set DATABRICKS_TOKEN -R "$REPO"
/usr/bin/python3 "$here/dbx_secret.py" get host  | gh secret set DATABRICKS_HOST  -R "$REPO"
printf '%s' '/sql/1.0/warehouses/7655e13e54222e5a' | gh secret set DATABRICKS_HTTP_PATH -R "$REPO"

if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
	echo "pages already enabled"
else
	gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null
	echo "pages enabled (source: GitHub Actions)"
fi

git push -u origin main
gh secret list -R "$REPO"
echo "first build started: gh run watch -R $REPO"
