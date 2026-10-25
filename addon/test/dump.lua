--[[ Produces a realistic AuctionVault.lua SavedVariables file outside the game.

    lua5.1 addon/test/dump.lua [outfile] [numListings]

Drives a synthetic auction house through the real addon, then serialises the globals using
WoW's own SavedVariables conventions (tab indent, ["key"] = value, `-- [n]` array comments,
escaped strings). Use it to sanity-check the on-disk size budget and to give the Python
reader something to parse before a real scan exists.
]]

package.path = (arg[0]:match("^(.*)/[^/]+$") or ".") .. "/?.lua;" .. package.path
local stub = require("wowstub")

local ADDON_DIR    = (arg[0]:match("^(.*)/test/[^/]+$") or ".") .. "/AuctionVault"
local OUT          = arg[1] or "AuctionVault.lua"
local NUM_LISTINGS = tonumber(arg[2]) or 48000

local format, floor, random = string.format, math.floor, math.random
math.randomseed(20260816)

----------------------------------------------------------------------- fixture

--[[ A real auction house is heavily skewed: a handful of commodities carry hundreds of
     listings while most items have one or two. Sampling item index from a squared uniform
     gives that shape, which matters because it is what drives the item-link cache hit rate
     and the compressibility of the row chunks. ]]
local ADJECTIVES = { "Runic", "Frostweave", "Saronite", "Titanium", "Eternal", "Crystallized",
                     "Icy", "Arctic", "Wyrmrest", "Borean", "Nerubian", "Vrykul" }
local NOUNS      = { "Bar", "Cloth", "Dust", "Essence", "Shard", "Ore", "Leather", "Scale",
                     "Potion", "Elixir", "Flask", "Gem", "Glyph", "Belt", "Bracers", "Cloak" }
local SUFFIXES   = { "", " of the Bear", " of the Eagle", " of Intellect", " of Power",
                     " of Frost Protection", " of the Whale" }

local NUM_ITEMS = 5000

local items = {}
stub.itemCache = {}
for i = 1, NUM_ITEMS do
	local suffixText = SUFFIXES[(i % #SUFFIXES) + 1]
	local suffixId   = suffixText == "" and 0 or (800 + (i % 60))
	local itemId     = 2000 + i * 7
	local name       = format("%s %s%s", ADJECTIVES[(i % #ADJECTIVES) + 1],
	                          NOUNS[(i % #NOUNS) + 1], suffixText)
	local link = format("|cff1eff00|Hitem:%d:0:0:0:0:0:%d:%d:80|h[%s]|h|r",
	                    itemId, suffixId, random(0, 99999), name)

	-- GetAuctionItemInfo returns the full texture path; the addon stores "inv_misc_<n>"
	items[i] = { link = link, name = name, texture = "Interface\\Icons\\INV_Misc_" .. (i % 60) }

	-- ~2% of items are not in the client's item cache, as happens after a fresh login
	if i % 50 ~= 0 then
		stub.itemCache[link] = {
			name = name, quality = random(0, 5), ilvl = random(1, 284), reqLevel = random(0, 80),
			itemType = "Trade Goods", subType = "Metal & Stone",
			stackMax = (i % 3 == 0) and 20 or 1, equipLoc = "",
		}
	end
end

local sellerNames = {}
for i = 1, 900 do sellerNames[i] = "Trader" .. i end

local listings = {}
for i = 1, NUM_LISTINGS do
	local item     = items[floor(random() ^ 2 * (NUM_ITEMS - 1)) + 1]
	local stack    = (random(1, 3) == 1) and 20 or random(1, 5)
	local unit     = random(50, 4000000)
	local buyout   = unit * stack
	local hasBuyout = random(1, 20) > 1

	local owner
	-- Warmane's getAll typically omits the seller; keep a slice populated so the
	-- downstream lifecycle model can be exercised either way
	if random(1, 4) == 1 then owner = sellerNames[random(1, #sellerNames)] end

	listings[i] = {
		name      = item.name,
		texture   = item.texture,
		count     = stack,
		quality   = 2,
		minBid    = floor(buyout * 0.85),
		buyout    = hasBuyout and buyout or 0,
		bidAmount = (random(1, 8) == 1) and floor(buyout * 0.9) or 0,
		owner     = owner,
		link      = item.link,
		timeLeft  = random(1, 4),
	}
end

stub.listings = listings

----------------------------------------------------------------------- run

stub.now = os.time()
stub.reset()
-- An upgraded install: some schema 1 (9-field, no icon) entries are already on disk. Items the
-- scan lists get their icon backfilled; the rest stay 9-field, so the sample exercises a
-- reader against both shapes in one file.
AUCTIONVAULT_ITEMS = {}
for i = 1, 200 do
	local itemId = 2000 + i * 7
	AUCTIONVAULT_ITEMS[itemId .. ":0"] = "Legacy Item " .. i .. "|1|10|1|Trade Goods|Metal & Stone|20|0|"
end
stub.loadAddon(ADDON_DIR)
stub.verbose = true

stub.fire("AUCTION_HOUSE_SHOW")
stub.fire("AUCTION_ITEM_LIST_UPDATE")
stub.pump()

----------------------------------------------------------------------- serialise

-- Mirrors WoW's SavedVariables writer: escapes backslash, quote and newline, one line each.
local function quote(s)
	s = s:gsub("\\", "\\\\"):gsub("\"", "\\\""):gsub("\n", "\\n"):gsub("\r", "\\r")
	return "\"" .. s .. "\""
end

local function isArray(t)
	local n = 0
	for k in pairs(t) do
		if type(k) ~= "number" then return false end
		n = n + 1
	end
	return n == #t
end

local write

local function value(out, v, depth)
	local t = type(v)
	if t == "table" then
		write(out, v, depth)
	elseif t == "string" then
		out[#out + 1] = quote(v)
	elseif t == "boolean" then
		out[#out + 1] = tostring(v)
	else
		out[#out + 1] = tostring(v)
	end
end

write = function(out, tbl, depth)
	local pad, inner = ("\t"):rep(depth), ("\t"):rep(depth + 1)
	out[#out + 1] = "{\n"

	if isArray(tbl) then
		for i = 1, #tbl do
			out[#out + 1] = inner
			value(out, tbl[i], depth + 1)
			out[#out + 1] = format(", -- [%d]\n", i)
		end
	else
		for k, v in pairs(tbl) do
			out[#out + 1] = inner
			out[#out + 1] = type(k) == "string" and ("[" .. quote(k) .. "] = ")
			                                    or  ("[" .. tostring(k) .. "] = ")
			value(out, v, depth + 1)
			out[#out + 1] = ",\n"
		end
	end

	out[#out + 1] = pad .. "}"
end

local out = {}
for _, name in ipairs({ "AUCTIONVAULT_META", "AUCTIONVAULT_CONFIG",
                        "AUCTIONVAULT_ITEMS", "AUCTIONVAULT_SCANS" }) do
	out[#out + 1] = name .. " = "
	write(out, _G[name], 0)
	out[#out + 1] = "\n"
end

local f = assert(io.open(OUT, "w"))
f:write(table.concat(out))
f:close()

local size = assert(io.open(OUT, "rb")):seek("end")
local rec  = AUCTIONVAULT_SCANS[1]
print(format("\nwrote %s -- %.2f MB for %d listings (%.1f bytes/listing), %d chunks, %d items",
	OUT, size / 1048576, rec.rowCount, size / rec.rowCount, #rec.rows,
	(function() local n = 0; for _ in pairs(AUCTIONVAULT_ITEMS) do n = n + 1 end; return n end)()))
