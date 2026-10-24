#!/usr/bin/env python3
"""Databricks credentials, kept in the GNOME login keyring (Secret Service over D-Bus).

The token never touches a file in this repo, a dotfile, or shell history: it lives
encrypted in the keyring, which unlocks with your desktop login.

    scripts/dbx_secret.py set-token          # prompts (hidden input), or reads stdin
    scripts/dbx_secret.py set-host <url>     # workspace URL, e.g. https://dbc-....cloud.databricks.com
    scripts/dbx_secret.py status             # what is stored, without revealing the token
    scripts/dbx_secret.py delete             # remove both

Use `scripts/with-databricks <command>` to run something with DATABRICKS_HOST and
DATABRICKS_TOKEN set for that process only.
"""
import getpass
import sys

import secretstorage

SERVICE = "auction-vault-databricks"


def _collection():
    conn = secretstorage.dbus_init()
    col = secretstorage.get_default_collection(conn)
    if col.is_locked():
        col.unlock()
    return col


def _find(col, kind):
    items = list(col.search_items({"service": SERVICE, "kind": kind}))
    return items[0] if items else None


def _store(kind, value, label):
    col = _collection()
    col.create_item(label, {"service": SERVICE, "kind": kind}, value.encode(), replace=True)


def get(kind):
    item = _find(_collection(), kind)
    return item.get_secret().decode() if item else None


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "status"

    if cmd == "set-token":
        token = getpass.getpass("Databricks token: ") if sys.stdin.isatty() else sys.stdin.read()
        token = token.strip()
        if not token.startswith("dapi"):
            sys.exit("that does not look like a Databricks personal access token (dapi...)")
        _store("token", token, "AuctionVault Databricks token")
        print("token stored in the GNOME keyring")
    elif cmd == "set-host":
        if len(argv) < 3:
            sys.exit("usage: dbx_secret.py set-host https://<workspace>.cloud.databricks.com")
        host = argv[2].strip().rstrip("/")
        if not host.startswith("https://"):
            host = "https://" + host
        _store("host", host, "AuctionVault Databricks host")
        print("host stored:", host)
    elif cmd == "status":
        token, host = get("token"), get("host")
        print("host: ", host or "(not set)")
        print("token:", f"set ({len(token)} chars, ...{token[-4:]})" if token else "(not set)")
    elif cmd == "get":  # for with-databricks only; prints the secret
        value = get(argv[2])
        if value is None:
            sys.exit(f"no {argv[2]} stored -- run scripts/dbx_secret.py set-{argv[2]}")
        sys.stdout.write(value)
    elif cmd == "delete":
        col = _collection()
        for kind in ("token", "host"):
            item = _find(col, kind)
            if item:
                item.delete()
        print("removed")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
