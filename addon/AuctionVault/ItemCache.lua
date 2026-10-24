--[[ AuctionVault -- ItemCache

Resolves auction rows to a stable "itemID:suffixID" key and builds the item dimension.

GetAuctionItemLink is the only source of an itemID, and it is far too slow to call once per
listing on a 48k-row getAll result. So we cache by name+texture -- both of which come free
from GetAuctionItemInfo -- and only call GetAuctionItemLink on a cache miss. That collapses
tens of thousands of calls into a few thousand distinct items.

Why name+texture is a sound key: random-suffix greens already carry their suffix in the name
("Rigid Leggings of the Eagle"), so name alone is nearly unique, and texture disambiguates
the residual same-name/different-item cases. Auctionator falls back on the same signal
(AuctionatorScan.lua:337) -- it just uses it to mangle the name instead of to find an ID.
]]

local ADDON, ns = ...

local ItemCache = {}
ns.ItemCache = ItemCache

local concat, gmatch, tonumber, tostring = table.concat, string.gmatch, tonumber, tostring
local SEP = "\031" -- unit separator; cannot appear in an item name or texture path

local lookup   = {} -- "name\031texture" -> itemKey            (memory only)
local linkOf   = {} -- itemKey -> itemLink, kept while pending (memory only)
local pending  = {} -- itemKey -> retry count
local giveUp   = {} -- itemKey -> true, client will not resolve it

function ItemCache:Init()
	self.retryTimer = nil
end

--[[ Item link payload in 3.3.5a:
     itemId:enchantId:jewel1:jewel2:jewel3:jewel4:suffixId:uniqueId:level
     suffixId is negative for random-suffix items, so it must be captured, not assumed 0. ]]
local function ParseLink(link)
	if not link then return nil end
	local payload = link:match("|Hitem:([%-%d:]+)") or link:match("item:([%-%d:]+)")
	if not payload then return nil end

	local parts = {}
	for v in gmatch(payload .. ":", "([^:]*):") do
		parts[#parts + 1] = v
	end

	local itemId = tonumber(parts[1])
	if not itemId then return nil end
	return itemId .. ":" .. (tonumber(parts[7]) or 0)
end
ItemCache.ParseLink = ParseLink

--[[ The item dimension is a pipe-joined string. Strip the field separator and anything the
     SavedVariables writer would escape, so the reader never has to un-escape either. In
     practice no 3.3.5a item name or type contains these; this just keeps that a fact rather
     than an assumption. ]]
local function clean(s)
	if s == nil then return "" end
	return (tostring(s):gsub("[|\"\\\n\r]", " "))
end

--[[ Writes one AUCTIONVAULT_ITEMS entry. Returns false when the client has not cached the
     item yet, in which case the key goes on the retry queue.

     Note on 3.3.5a: GetItemInfo returns 10 values here, ending at itemTexture -- there is no
     vendor sell price (that return arrived in a later expansion). We read the 11th slot
     anyway so the format is forward-compatible, and store 0 when it is absent. Vendor prices
     can be joined from a TrinityCore item_template dump downstream if we ever want them. ]]
function ItemCache:Fill(key, link)
	if not link then return false end

	local name, _, quality, itemLevel, reqLevel, itemType, itemSubType,
	      stackMax, equipLoc, _, sellPrice = GetItemInfo(link)
	if not name then return false end

	AUCTIONVAULT_ITEMS[key] = concat({
		clean(name),
		tostring(quality or -1),
		tostring(itemLevel or 0),
		tostring(reqLevel or 0),
		clean(itemType),
		clean(itemSubType),
		tostring(stackMax or 1),
		tostring(sellPrice or 0),
		clean(equipLoc),
	}, "|")
	return true
end

function ItemCache:Resolve(name, texture, index)
	local ck  = (name or "") .. SEP .. (texture or "")
	local key = lookup[ck]

	if key and (AUCTIONVAULT_ITEMS[key] ~= nil or pending[key] or giveUp[key]) then
		return key -- fast path: nothing left to learn about this item
	end
	-- Either a cache miss, or a known item whose dimension row is still missing (a
	-- give-up that Requeue cleared). Both are worth one GetAuctionItemLink.

	local link   = GetAuctionItemLink("list", index)
	local parsed = ParseLink(link)
	if not parsed then return key end -- keep the cached key if we had one

	key        = parsed
	lookup[ck] = key

	if AUCTIONVAULT_ITEMS[key] == nil and not self:Fill(key, link) then
		linkOf[key]  = link
		pending[key] = 0
		self:ScheduleRetry()
	end
	return key
end

function ItemCache:ScheduleRetry()
	if self.retryTimer then return end
	self.retryTimer = ns.AV:ScheduleRepeatingTimer(function() ItemCache:Drain() end,
		ns.cfg.itemRetrySeconds or 0.5)
end

-- Deleting the current key inside pairs() is well defined in Lua 5.1.
function ItemCache:Drain()
	local maxRetries = ns.cfg.itemMaxRetries or 60
	local remaining  = 0

	for key, tries in pairs(pending) do
		if self:Fill(key, linkOf[key]) then
			pending[key] = nil
			linkOf[key]  = nil
		elseif tries >= maxRetries then
			pending[key] = nil
			linkOf[key]  = nil
			giveUp[key]  = true
		else
			pending[key] = tries + 1
			remaining    = remaining + 1
		end
	end

	if remaining == 0 and self.retryTimer then
		ns.AV:CancelTimer(self.retryTimer)
		self.retryTimer = nil
	end
end

function ItemCache:PendingCount()
	local n = 0
	for _ in pairs(pending) do n = n + 1 end
	return n
end

function ItemCache:GiveUpCount()
	local n = 0
	for _ in pairs(giveUp) do n = n + 1 end
	return n
end

-- Unresolved keys are retried at the start of each scan; the client may have cached them since.
function ItemCache:Requeue()
	local n = 0
	for key in pairs(giveUp) do
		giveUp[key] = nil
		n = n + 1
	end
	return n
end
