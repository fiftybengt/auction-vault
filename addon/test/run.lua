--[[ AuctionVault test harness

    lua5.1 addon/test/run.lua

Replays synthetic auction houses through the real addon code against a stubbed WoW API.
Covers the things that are expensive to discover in game: row encoding, chunk boundaries,
the item-link cache, deferred GetItemInfo, truncated getAll lists, and retention pruning.
]]

package.path = (arg[0]:match("^(.*)/[^/]+$") or ".") .. "/?.lua;" .. package.path
local stub = require("wowstub")

local ADDON_DIR = (arg[0]:match("^(.*)/test/[^/]+$") or ".") .. "/AuctionVault"
local format, floor, ceil = string.format, math.floor, math.ceil

----------------------------------------------------------------------- assertions

local passed, failed = 0, 0

local function check(cond, fmt, ...)
	local msg = select("#", ...) > 0 and format(fmt, ...) or fmt
	if cond then
		passed = passed + 1
	else
		failed = failed + 1
		print("  FAIL  " .. msg)
	end
end

local function equal(actual, expected, label)
	check(actual == expected, "%s: expected %s, got %s", label, tostring(expected), tostring(actual))
end

local function section(name)
	print("\n== " .. name)
end

----------------------------------------------------------------------- fixtures

-- Every 7th item gets a negative random-suffix id, which is the case a naive link parser
-- silently drops.
local function itemFixture(i)
	local itemId = 1000 + i
	local suffix = (i % 7 == 0) and -(100 + i) or 0
	return {
		itemId  = itemId,
		suffix  = suffix,
		key     = itemId .. ":" .. suffix,
		name    = "Test Item " .. i,
		texture = "Interface\\Icons\\Icon_" .. (i % 40),
		link    = format("|cffffffff|Hitem:%d:0:0:0:0:0:%d:0:80|h[Test Item %d]|h|r",
		                 itemId, suffix, i),
	}
end

-- `cachedFraction` controls how many items GetItemInfo can answer for immediately; the rest
-- exercise the retry queue.
local function buildAuctionHouse(numListings, numItems, cachedFraction)
	local items = {}
	stub.itemCache = {}

	for i = 1, numItems do
		local item = itemFixture(i)
		items[i] = item
		if not cachedFraction or (i % 100) < (cachedFraction * 100) then
			stub.itemCache[item.link] = {
				name = item.name, quality = i % 6, ilvl = 10 + i % 200, reqLevel = i % 80,
				itemType = "Weapon", subType = "Sword", stackMax = (i % 2 == 0) and 20 or 1,
				equipLoc = "INVTYPE_WEAPON",
			}
		end
	end

	local listings = {}
	for i = 1, numListings do
		local item = items[(i % numItems) + 1]
		-- a quarter of listings have no seller, as Warmane's getAll often reports.
		-- (written long-hand: `cond and nil or x` always yields x in Lua)
		local owner
		if i % 4 ~= 0 then owner = "Seller" .. (i % 50) end
		listings[i] = {
			name      = item.name,
			texture   = item.texture,
			count     = (i % 20) + 1,
			quality   = 2,
			minBid    = i * 100,
			buyout    = i * 137,
			bidAmount = (i % 5 == 0) and (i * 110) or 0,
			owner     = owner,
			link      = item.link,
			timeLeft  = (i % 4) + 1,
		}
	end

	stub.listings = listings
	stub.visible  = nil
	stub.linkCalls = 0
	return items, listings
end

local function decodeRows(record)
	local rows = {}
	for _, chunk in ipairs(record.rows) do
		for line in chunk:gmatch("[^;]+") do rows[#rows + 1] = line end
	end
	return rows
end

local function parseRow(line)
	local key, a, b, c, d, e, f = line:match("^([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)$")
	if not key then return nil end
	return { key = key, count = tonumber(a), minBid = tonumber(b), buyout = tonumber(c),
	         bidAmount = tonumber(d), timeLeft = tonumber(e), sellerIdx = tonumber(f) }
end

-- Pumps one frame at a time until the harvest is underway, so tests do not depend on the
-- exact relationship between settleSeconds and the frame interval.
local function pumpUntilHarvesting(ns, maxFrames)
	for _ = 1, maxFrames or 80 do
		if ns.Harvest.running then return true end
		stub.pumpFrames(1)
	end
	return ns.Harvest.running
end

local function freshAddon()
	stub.reset()
	stub.now = 1786800000
	return stub.loadAddon(ADDON_DIR)
end

----------------------------------------------------------------------- tests

section("full getAll harvest, 50000 listings / 3000 items")
do
	local ns = freshAddon()
	local items, listings = buildAuctionHouse(50000, 3000, 1.0)

	stub.fire("AUCTION_HOUSE_SHOW")
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 1, "one scan recorded")
	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.rowCount, 50000, "rowCount")
	equal(rec.complete, true, "marked complete")
	equal(rec.mode, "getall", "mode")
	equal(rec.source, "auctionator", "source defaults to passive/auctionator")
	equal(rec.realm, "Icecrown", "realm")
	equal(rec.faction, "Alliance", "faction")
	equal(rec.id, "Icecrown:Alliance:1786800000", "scan id is realm:faction:startedAt")
	check(ns.Session:Current() == nil, "session closed after harvest")
	check(not ns.Harvest.running, "harvest no longer running")

	-- chunking
	equal(#rec.rows, ceil(50000 / 500), "chunk count")
	local decoded = decodeRows(rec)
	equal(#decoded, 50000, "rows survive chunk round-trip")
	local oversized = 0
	for _, chunk in ipairs(rec.rows) do
		local n = 0
		for _ in chunk:gmatch("[^;]+") do n = n + 1 end
		if n > 500 then oversized = oversized + 1 end
	end
	equal(oversized, 0, "no chunk exceeds rowsPerChunk")

	-- encoding fidelity against the source listings
	local mismatches = 0
	for i = 1, 50000 do
		local row, src = parseRow(decoded[i]), listings[i]
		if not row
			or row.count     ~= src.count
			or row.minBid    ~= src.minBid
			or row.buyout    ~= src.buyout
			or row.bidAmount ~= src.bidAmount
			or row.timeLeft  ~= src.timeLeft then
			mismatches = mismatches + 1
		end
	end
	equal(mismatches, 0, "every row round-trips its numeric fields")

	-- item keys, including negative random suffixes
	local expectedKey = {}
	for _, item in ipairs(items) do expectedKey[item.key] = true end
	local badKeys, negativeSuffixes = 0, 0
	for i = 1, 50000 do
		local row = parseRow(decoded[i])
		if not expectedKey[row.key] then badKeys = badKeys + 1 end
		if row.key:match(":%-%d+$") then negativeSuffixes = negativeSuffixes + 1 end
	end
	equal(badKeys, 0, "all item keys map to a fixture item")
	check(negativeSuffixes > 0, "negative random-suffix ids are preserved (saw %d)", negativeSuffixes)

	-- sellers
	local nilSellerRows = 0
	for i = 1, 50000 do
		if parseRow(decoded[i]).sellerIdx == 0 then nilSellerRows = nilSellerRows + 1 end
	end
	equal(nilSellerRows, rec.nilOwners, "nilOwners matches rows with sellerIdx 0")
	check(rec.nilOwners > 10000, "nil owners counted (%d)", rec.nilOwners)
	equal(#rec.sellers, 50, "distinct sellers indexed")

	-- the item-link cache is the whole reason this is fast
	check(stub.linkCalls <= 3000, "GetAuctionItemLink called once per item, not per listing (%d calls for 50000 listings)",
		stub.linkCalls)
end

section("item dimension")
do
	local ns = freshAddon()
	buildAuctionHouse(5000, 400, 1.0)
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	local n, badFields = 0, 0
	for _, encoded in pairs(AUCTIONVAULT_ITEMS) do
		n = n + 1
		local fields = 0
		for _ in (encoded .. "|"):gmatch("([^|]*)|") do fields = fields + 1 end
		if fields ~= 9 then badFields = badFields + 1 end
	end
	equal(n, 400, "one dimension row per distinct item")
	equal(badFields, 0, "every dimension row has 9 pipe-separated fields")
	equal(ns.ItemCache:PendingCount(), 0, "nothing left pending when the client has everything cached")
end

section("deferred GetItemInfo for uncached items")
do
	local ns = freshAddon()
	local items = buildAuctionHouse(2000, 200, 0.5) -- half the items uncached

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.rowCount, 2000, "listings are never dropped for a missing item row")
	check(rec.unresolved > 0, "unresolved items reported on the scan (%d)", rec.unresolved)

	local known = 0
	for _ in pairs(AUCTIONVAULT_ITEMS) do known = known + 1 end
	check(known >= 100 and known < 200, "only the cached half resolved (%d of 200)", known)

	-- the client caches them later; the next scan should fill them in
	for _, item in ipairs(items) do
		stub.itemCache[item.link] = stub.itemCache[item.link] or {
			name = item.name, quality = 3, ilvl = 100, reqLevel = 70,
			itemType = "Armor", subType = "Cloth", stackMax = 1, equipLoc = "INVTYPE_CHEST",
		}
	end
	stub.now = stub.now + 600
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	known = 0
	for _ in pairs(AUCTIONVAULT_ITEMS) do known = known + 1 end
	equal(known, 200, "all items resolved once the client caches them")
	equal(ns.ItemCache:PendingCount(), 0, "retry queue drained")
	equal(#AUCTIONVAULT_SCANS, 2, "second scan recorded separately")
end

section("search results are ignored")
do
	local ns = freshAddon()
	buildAuctionHouse(25, 10, 1.0)

	stub.fire("AUCTION_HOUSE_SHOW")
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 0, "a 25-row list does not create a scan")
	check(ns.Session:Current() == nil, "no session opened")
	equal(ns.smallBatches, 1, "short list counted for the /av status hint")
end

section("truncated getAll list")
do
	local ns = freshAddon()
	buildAuctionHouse(20000, 500, 1.0)
	ns.cfg.harvestChunkRows = 1000 -- force several frames so we can truncate mid-harvest

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	check(ns.Harvest.running, "harvest started")

	-- the client drops the result list right after the opening chunk
	stub.visible = 3000
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 1, "the partial scan is still recorded")
	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.complete, false, "partial scan is flagged incomplete")
	equal(rec.expectedTotal, 20000, "expectedTotal preserves what the server claimed")
	check(rec.rowCount < 20000, "fewer rows than expected (%d)", rec.rowCount)
	check(not ns.Harvest.running, "harvest stopped")
	check(ns.Session:Current() == nil, "session closed")
end

section("retention pruning")
do
	local ns = freshAddon()
	ns.cfg.maxScans = 3
	buildAuctionHouse(200, 20, 1.0)

	local ids = {}
	for i = 1, 6 do
		stub.now = 1786800000 + i * 60
		ids[i] = "Icecrown:Alliance:" .. stub.now
		stub.fire("AUCTION_ITEM_LIST_UPDATE")
		stub.pump()
	end

	equal(#AUCTIONVAULT_SCANS, 3, "capped at maxScans")
	equal(AUCTIONVAULT_SCANS[1].id, ids[4], "oldest scans pruned first")
	equal(AUCTIONVAULT_SCANS[3].id, ids[6], "newest scan retained")
end

section("re-committing the same scan id replaces rather than duplicates")
do
	local ns = freshAddon()
	buildAuctionHouse(100, 10, 1.0)

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()
	stub.fire("AUCTION_ITEM_LIST_UPDATE") -- same virtual second, so the same id
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 1, "no duplicate record for the same id")
end

section("auction house closing mid-harvest")
do
	local ns = freshAddon()
	buildAuctionHouse(20000, 500, 1.0)
	ns.cfg.harvestChunkRows = 1000

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	check(ns.Harvest.running, "harvest started")
	stub.fire("AUCTION_HOUSE_CLOSED")

	equal(#AUCTIONVAULT_SCANS, 1, "whatever was captured is kept")
	equal(AUCTIONVAULT_SCANS[1].complete, false, "flagged incomplete")
	check(not ns.Harvest.running, "harvest stopped")
	stub.pump() -- nothing should be left scheduled that errors
end

section("slash commands run without erroring")
do
	local ns = freshAddon()
	buildAuctionHouse(300, 30, 1.0)
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	local ok = pcall(function()
		stub.slash("av", "status")
		stub.slash("av", "config")
		stub.slash("av", "config maxScans 4")
		stub.slash("av", "debug")
		stub.slash("av", "debug")
		stub.slash("av", "nonsense")
	end)
	check(ok, "status/config/debug/help all run")
	equal(ns.cfg.maxScans, 4, "config change applied")

	stub.ahOpen = false
	ok = pcall(function() stub.slash("av", "scan") end)
	check(ok, "/av scan with the AH closed is handled")

	stub.ahOpen = true
	stub.canQueryAll = true
	pcall(function() stub.slash("av", "scan") end)
	check(stub.lastQuery, "/av scan issues a getAll query when allowed")

	stub.slash("av", "purge")
	equal(#AUCTIONVAULT_SCANS, 0, "/av purge empties stored scans")
end

--[[ Regression for the failure seen on Warmane 2026-08-17: the client streams a getAll
     result, firing AUCTION_ITEM_LIST_UPDATE thousands of times with a growing row count.
     The original code read "another event arrived" as "the list was replaced", aborted the
     harvest, opened a fresh session in the same second, aborted that one at zero rows, and
     let the empty record overwrite the good one via its identical id. Observed result:
     "1/6 scans, 0 listings, 237 items known". ]]
section("streaming getAll result (Warmane behaviour)")
do
	local ns = freshAddon()
	buildAuctionHouse(30000, 900, 1.0)

	-- The payload arrives in pieces, exactly as the real client delivers it. Reading starts
	-- on the first sizeable packet and each later packet extends the same read.
	for _, visible in ipairs({ 12, 40, 260, 3100, 11000, 24000, 30000 }) do
		stub.visible = visible
		stub.fire("AUCTION_ITEM_LIST_UPDATE")
		stub.pumpFrames(2)
	end
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 1, "exactly one scan recorded")
	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.rowCount, 30000, "the full list is captured, not a prefix")
	equal(rec.complete, true, "marked complete")
	check(ns.Harvest.extends > 0, "growth handled by extending, not restarting (%d extends)",
		ns.Harvest.extends)
end

--[[ The failure that lost the 01:42 scan: waiting for the list to settle meant reading only
     after the client had already torn it down. Reading must begin on the first sizeable
     packet, while the rows are still there. ]]
section("client tears the list down shortly after delivering it")
do
	local ns = freshAddon()
	buildAuctionHouse(20000, 500, 1.0)

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	check(ns.Harvest.running, "reading begins inside the event, with no delay")
	check(#ns.Session:Current().rows > 0, "the first chunk is read synchronously")

	-- the client drops the result before any later frame could have run
	stub.visible = 0
	stub.pump()

	local rec = AUCTIONVAULT_SCANS[1]
	check(rec ~= nil, "a scan was still recorded")
	check(rec.rowCount > 0, "with rows in it (%d)", rec and rec.rowCount or 0)
	equal(rec.complete, false, "flagged incomplete, since the read was cut short")
end

section("Auctionator scan hook")
do
	stub.reset()
	stub.now = 1786800000
	stub.installAuctionator()
	local ns = stub.loadAddon(ADDON_DIR)
	check(ns.Harvest.hooked, "hook installed when Auctionator is present")

	buildAuctionHouse(25000, 600, 1.0)

	-- Auctionator calls its analyze function once the result is present; we read there.
	Atr_FullScanAnalyze()
	check(ns.Harvest.running, "harvest began from the hook")
	equal(stub.auctionatorRan, 1, "Auctionator's own scan still ran")

	stub.pump()
	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.rowCount, 25000, "full list captured via the hook")
	equal(rec.source, "auctionator-hook", "source records how it was captured")
	equal(rec.complete, true, "marked complete")
end

--[[ The failure behind every Icecrown scan until 2026-10-24: 55000 rows on offer, ~5000 to
     13000 stored, because Auctionator clears the list as soon as its own pass finishes. ]]
section("Auctionator clears the list right after its pass")
do
	stub.reset()
	stub.now = 1786800000
	stub.installAuctionator(true)
	local ns = stub.loadAddon(ADDON_DIR)

	buildAuctionHouse(55000, 1500, 1.0)
	Atr_FullScanAnalyze()
	equal(#ns.Session:Current().rows, 55000, "every row read inside the hook")

	stub.pump()
	local rec = AUCTIONVAULT_SCANS[1]
	equal(rec.rowCount, 55000, "full list stored despite the clear")
	equal(rec.complete, true, "marked complete")
end

section("no Auctionator installed")
do
	local ns = freshAddon() -- freshAddon does not install the Auctionator global
	check(not ns.Harvest.hooked, "hook reports itself absent")

	buildAuctionHouse(3000, 100, 1.0)
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()
	equal(AUCTIONVAULT_SCANS[1].rowCount, 3000, "event fallback still captures the scan")
end

section("list grows after the harvest has already begun")
do
	local ns = freshAddon()
	buildAuctionHouse(20000, 400, 1.0)
	ns.cfg.harvestChunkRows = 800 -- many frames, so we can interrupt mid-read

	stub.visible = 9000
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pumpFrames(4)
	local partway = #ns.Session:Current().rows
	check(partway > 0 and partway < 9000, "partway through (%d rows)", partway)

	-- More rows stream in. A getAll list only ever grows on the end, so what we already read
	-- stays valid and must not be thrown away.
	stub.visible = 20000
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	check(#ns.Session:Current().rows >= partway, "rows read so far are kept, not discarded")
	stub.pump()

	local rec = AUCTIONVAULT_SCANS[#AUCTIONVAULT_SCANS]
	equal(rec.rowCount, 20000, "extended to the larger list")
	equal(rec.complete, true, "marked complete")
end

--[[ Now that the opening chunk is read synchronously, a session almost always has rows by
     the time anything can go wrong -- so drive the guard directly rather than trying to
     reproduce the timing that used to cause it. ]]
section("an empty session never displaces a real scan")
do
	local ns = freshAddon()
	buildAuctionHouse(5000, 200, 1.0)

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()
	equal(#AUCTIONVAULT_SCANS, 1, "good scan stored")
	equal(AUCTIONVAULT_SCANS[1].rowCount, 5000, "with all its rows")

	-- same virtual second, so an identical scan id, and not a row read
	ns.Session:Open("test", "getall")
	equal(#ns.Session:Current().rows, 0, "session has no rows")
	ns.Session:Close(false, "nothing was read")

	check(ns.Session:Current() == nil, "empty session closed without storing")
	equal(#AUCTIONVAULT_SCANS, 1, "still one scan")
	equal(AUCTIONVAULT_SCANS[1].rowCount, 5000, "the good record survived")
end

-- The second guard: a session that did read some rows, but fewer than the record already
-- stored under the same id. Session:Close lets it through; Store:Commit must not.
section("a thinner scan never displaces a fuller one with the same id")
do
	local ns = freshAddon()
	buildAuctionHouse(5000, 200, 1.0)

	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()
	equal(AUCTIONVAULT_SCANS[1].rowCount, 5000, "full scan stored")

	ns.cfg.harvestChunkRows = 200
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	check(pumpUntilHarvesting(ns), "second harvest started")
	stub.pumpFrames(3) -- read a few hundred rows, nowhere near all of them

	local partial = #ns.Session:Current().rows
	check(partial > 0 and partial < 5000, "partway through (%d rows)", partial)

	stub.visible = 10
	stub.fire("AUCTION_ITEM_LIST_UPDATE")
	stub.pump()

	equal(#AUCTIONVAULT_SCANS, 1, "still one scan")
	equal(AUCTIONVAULT_SCANS[1].rowCount, 5000, "the fuller record won")
end

section("timer layer")
do
	local ns = freshAddon()
	local AV = ns.AV

	-- The hazard Compat.lua's `due` list exists to avoid: a callback that schedules more
	-- work while OnUpdate is still walking the timer table. Inserting into a table during
	-- pairs() is undefined in Lua 5.1, and the harvester does exactly this on every chunk.
	local fired, chain = 0, nil
	chain = function()
		fired = fired + 1
		if fired < 25 then AV:ScheduleTimer(chain, 0.01) end
	end
	AV:ScheduleTimer(chain, 0.01)
	stub.pump()
	equal(fired, 25, "a timer may schedule its successor from inside its own callback")
	equal(AV:PendingTimerCount(), 0, "no timers left pending")

	local repeats = 0
	local handle
	handle = AV:ScheduleRepeatingTimer(function()
		repeats = repeats + 1
		if repeats == 5 then AV:CancelTimer(handle) end
	end, 0.02)
	stub.pump()
	equal(repeats, 5, "a repeating timer can cancel itself from its own callback")

	local cancelled = false
	local h = AV:ScheduleTimer(function() cancelled = true end, 0.05)
	AV:CancelTimer(h)
	stub.pump()
	equal(cancelled, false, "a cancelled timer never fires")
	check(pcall(function() AV:CancelTimer(nil); AV:CancelTimer("bogus") end),
		"cancelling a nil or unknown handle is harmless")
end

section("link parsing")
do
	local ns = freshAddon()
	local parse = ns.ItemCache.ParseLink
	equal(parse("|cffffffff|Hitem:13071:0:0:0:0:0:0:0:80|h[Plated Fist of Hakoo]|h|r"), "13071:0",
		"plain item")
	equal(parse("|cff1eff00|Hitem:15117:0:0:0:0:0:848:1234:70|h[Rigid Leggings of the Eagle]|h|r"),
		"15117:848", "positive random suffix")
	equal(parse("|cff1eff00|Hitem:15117:0:0:0:0:0:-42:1234:70|h[Rigid Leggings]|h|r"),
		"15117:-42", "negative random suffix")
	equal(parse("item:2835:0:0:0:0:0:0:0:0"), "2835:0", "bare item string")
	equal(parse(nil), nil, "nil link")
	equal(parse("not a link"), nil, "garbage link")
end

----------------------------------------------------------------------- summary

print(format("\n%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
