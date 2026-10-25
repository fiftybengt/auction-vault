# AuctionVault

A World of Warcraft **3.3.5a (build 12340)** addon that records every individual auction
house listing to SavedVariables, so the data can be analysed outside the game.

Step 1 of the auction data platform. Nothing here talks to a network, a database, or a
dashboard — its only job is to get complete, honest data onto disk.

## Why not just read Auctionator's data?

Auctionator scans the AH perfectly well, and this addon deliberately reuses that scan. But
what it *stores* cannot support price analysis:

| Auctionator stores | Consequence |
| --- | --- |
| Keys by localized item **name**, not itemID | Can't join to item metadata; same-name items collide |
| Only the **single cheapest** per-unit buyout | No median, no distribution, no depth |
| A 15-slot price array with **random eviction, no timestamps** | Not a usable time series |
| **No quantity at all** | No supply, market cap, or liquidity |
| Reads `minBid`/`bidAmount`/`owner`, then discards them | No undercut or seller analysis |
| Never calls `GetAuctionItemTimeLeft` | Can't tell a sold auction from an expired one |

None of that is recoverable after the fact. AuctionVault captures the raw listings instead.

## How it works

The AH result list is **global client state**. When Auctionator runs its Full Scan, every
addon receives the same `AUCTION_ITEM_LIST_UPDATE` and can read the same rows. So this addon
listens rather than scans:

```
you press Auctionator's Full Scan
        ↓  AUCTION_ITEM_LIST_UPDATE, fired repeatedly as the result streams in
AuctionVault waits for the row count to stop growing (settleSeconds)
AuctionVault then harvests every row, ~5000 per frame
        ↓  /reload or log out
WTF/Account/<acct>/SavedVariables/AuctionVault.lua
```

**The client streams a getAll result.** It does not arrive in one event — the row count
climbs across thousands of `AUCTION_ITEM_LIST_UPDATE` firings. So "another event arrived"
does not mean "the list was replaced", and reading it that way throws the scan away. We wait
for the count to settle, then read once; if it grows again mid-read we restart against the
larger list, and if it shrinks the client has dropped the result and the scan is recorded
incomplete.

No change to your workflow, no extra server queries, and no conflict — Auctionator's conflict
detection only patches addons named `recipeknown`, `lootlink` and `WOWEcon`
(`AuctionatorConflicts.lua:66`).

Three things it does that Auctionator does not:

1. **Keys by itemID**, resolved from `GetAuctionItemLink` and cached by name+texture, so the
   link call happens once per *item* rather than once per *listing* (~1600 calls for 48k rows).
2. **Chunks the read across frames** with a 15 ms per-frame budget, instead of one blocking
   pass over 100k rows.
3. **Captures `minBid`, `bidAmount`, `owner` and `timeLeft`** — the fields that make
   sold-vs-expired inference possible later.

## Install

```sh
make install     # symlinks addon/AuctionVault into the client
make uninstall
```

`WOW_DIR` defaults to `~/Downloads/World of Warcraft 3.3.5a`; override it if yours differs.

No dependencies. Ace3 is installed on this client but does not appear in any character's
`AddOns.txt`, so there is no way to confirm it loads — and `## Dependencies:` on an addon
that might be disabled means a silent no-load. The four primitives we would have used from
it (lifecycle, events, timers, slash commands) are ~70 lines in `Compat.lua`.

## Using it

Open the auction house and run **Auctionator → Full Scan**. That's it.

| Command | |
| --- | --- |
| `/av status` | what has been captured, how stale it is, whether sellers came through |
| `/av diag` | distribution of auction list sizes seen — tells getAll apart from paged |
| `/av scan` | run a getAll scan ourselves (fallback; has a 15 min cooldown) |
| `/av purge` | drop all stored scans |
| `/av config <key> <value>` | tune retention, chunk size, etc. |
| `/av debug` | verbose logging |

SavedVariables are only written on `/reload` or logout — until then a scan lives in memory.

## What lands on disk

```lua
AUCTIONVAULT_ITEMS = {
  ["13071:0"] = "Plated Fist of Hakoo|3|63|58|Weapon|Fist Weapon|1|0|INVTYPE_WEAPONMAINHAND|inv_gauntlets_04",
  --             name|quality|itemLevel|reqLevel|itemType|subType|stackMax|vendorSell|equipLoc|icon
}

AUCTIONVAULT_SCANS = {
  {
    ["id"] = "Icecrown:Alliance:1786811672",   -- realm:faction:startedAt, ingest-idempotent
    ["rowCount"] = 48000, ["expectedTotal"] = 48000, ["complete"] = true,
    ["nilOwners"] = 36088, ["unresolved"] = 31,
    ["sellers"] = { "Trader180", ... },        -- index; 0 means the server sent no name
    ["rows"] = {                                -- chunks of 500 rows
      "13071:0,1,1400000,1505000,0,4,17;2835:0,20,84,94,0,2,0;...",
      --  itemKey,stackCount,minBid,buyout,bidAmount,timeLeft,sellerIdx
    },
  },
}
```

Roughly **1.8 MB per scan** (38 bytes a listing), six scans retained by default.

**Schema 2** added `icon`, derived from the texture `GetAuctionItemInfo` returns by the C1
rule: basename after the last `\` or `/`, extension stripped, lowercased, every space turned
into `-` (not trimmed), and kept only if it matches `^[a-z0-9_&-]+$`
(`Interface\Icons\INV_Potion_108` -> `inv_potion_108`, `INV_Misc_SpineLeaf _01` ->
`inv_misc_spineleaf-_01`, `INV_Misc_Fork&Knife` -> `inv_misc_fork&knife`). A name outside
that set is dropped (with a `/av` debug-mode message) and treated as no icon. An entry with only 9 fields — written
under schema 1, or an item with no texture — means "icon unknown". The newest valid icon
wins: the first time a scan lists an item in a session, the addon appends the derived icon to
a 9-field entry, or replaces a stored icon that differs (so names stored under an older rule,
like `inv_misc_spineleaf_01`, correct themselves to `inv_misc_spineleaf-_01`). A missing,
empty or invalid derivation never blanks or replaces a stored icon. The check runs once per
item per session; settled rows cost three table lookups, so the 55k-row Auctionator hook
pass stays O(1) per row. Readers must accept both 9 and 10 fields, as `verify_format.py` does, and `verify_format.py`
checks every icon against the same set.

Two format choices worth knowing:

- Rows are chunked 500-to-a-string because WoW's SV writer spends ~12 bytes of
  `\t\t\t"...", -- [n]\n` scaffolding on *every* array element.
- The separator is `;`, not a newline. WoW escapes a newline inside a string as a literal
  `\n` and keeps the string on one physical line (verified against `!BugGrabber.lua`), so a
  newline join would look identical in the file while forcing the reader to un-escape. Rows
  are digits, commas and colons only, so `;` never needs escaping.

## Known limitations

- **Only getAll scans are harvested.** A paged scan is indistinguishable from an ordinary
  item search when observed passively — both arrive as 50-row batches with no page number.
  `/av diag` shows the largest list ever seen: above 50 means getAll reached us, and stuck
  at 50 means the scan was paged and a paged sweep would need building.
- **Warmane usually omits the seller** on getAll results. Listings are still recorded with
  seller index 0, and `nilOwners` reports how many, so downstream analysis can decide how
  much to trust seller-level work rather than silently assuming it's fine.
- ~~`vendorSell` is always 0~~ — **it works.** I expected `GetItemInfo` to stop at the
  texture on 3.3.5a, but the live client returns a sell price in slot 11
  (`Felsteel Longblade|4|105|70|Weapon|One-Handed Swords|1|107762|INVTYPE_WEAPON`). No
  TrinityCore `item_template` join is needed for vendor prices.
- Item metadata fills in over the first few scans, since `GetItemInfo` returns nil for items
  the client hasn't cached yet. Listings are never dropped for a missing item row.

## Development

```sh
make test      # syntax check + 145 assertions against a stubbed WoW API
make sample    # generate a realistic 48k-listing SavedVariables file and verify it parses
make status    # parse whatever the live client has actually written
```

`make test` builds Lua 5.1.5 from source into `.tools/` on first run — the same interpreter
version the game ships, no sudo required.

The harness in `test/wowstub.lua` stubs only what the *client* provides (frames, events, the
auction API). AuctionVault's own timer and dispatch code runs for real, driven frame by frame
by `stub.pump()`.
