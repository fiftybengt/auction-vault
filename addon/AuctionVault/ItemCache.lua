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

Icons (schema 2): the texture also gives us the item's icon for free, so a new entry is
written with it as a 10th field. Entries written before schema 2 have only 9 fields, and are
backfilled the first time a scan shows the item again. `settled` remembers which name+texture
pairs have nothing left to learn, so the per-row fast path stays a couple of table lookups --
the Auctionator hook reads ~55k rows in one synchronous pass, so anything per-row that
rebuilt or scanned the entry string would show up as a hitch.
]]

local ADDON, ns = ...

local ItemCache = {}
ns.ItemCache = ItemCache

local concat, gmatch, tonumber, tostring = table.concat, string.gmatch, tonumber, tostring
local gsub, lower, match, type = string.gsub, string.lower, string.match, type
local SEP = "\031" -- unit separator; cannot appear in an item name or texture path

local lookup   = {} -- "name\031texture" -> itemKey            (memory only)
local linkOf   = {} -- itemKey -> itemLink, kept while pending (memory only)
local pending  = {} -- itemKey -> retry count
local giveUp   = {} -- itemKey -> true, client will not resolve it
local iconOf   = {} -- itemKey -> icon, kept while pending     (memory only)
local settled  = {} -- "name\031texture" -> true: entry exists, icon handled (memory only)

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

--[[ "Interface\Icons\INV_Potion_108" -> "inv_potion_108". The client hands back backslash
     paths, but accept "/" too and drop any extension, so the value is a bare icon name the
     site can map to an image without knowing how the client spells paths. Returns nil when
     there is nothing usable, which means "icon unknown", never "icon is empty". ]]
local function IconName(texture)
	if type(texture) ~= "string" then return nil end
	local base = match(texture, "([^/\\]+)$")
	if not base then return nil end
	base = gsub(base, "%.[^.]*$", "")
	base = lower(gsub(base, "[|\"\n\r%s]", ""))
	if base == "" then return nil end
	return base
end
ItemCache.IconName = IconName

-- A 9-field entry (8 pipes) has no icon yet. Called once per name+texture per session.
local function HasIcon(entry)
	local _, pipes = gsub(entry, "|", "|")
	return pipes >= 9
end

local function Backfill(key, entry, icon)
	if icon and not HasIcon(entry) then
		AUCTIONVAULT_ITEMS[key] = entry .. "|" .. icon
	end
end
ItemCache.Backfill = Backfill

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
function ItemCache:Fill(key, link, icon)
	if not link then return false end

	local name, _, quality, itemLevel, reqLevel, itemType, itemSubType,
	      stackMax, equipLoc, _, sellPrice = GetItemInfo(link)
	if not name then return false end

	local fields = {
		clean(name),
		tostring(quality or -1),
		tostring(itemLevel or 0),
		tostring(reqLevel or 0),
		clean(itemType),
		clean(itemSubType),
		tostring(stackMax or 1),
		tostring(sellPrice or 0),
		clean(equipLoc),
	}
	-- No icon means a 9-field entry, which the contract reads as "unknown" and backfills.
	if icon then fields[10] = icon end
	AUCTIONVAULT_ITEMS[key] = concat(fields, "|")
	return true
end

function ItemCache:Resolve(name, texture, index)
	local ck  = (name or "") .. SEP .. (texture or "")
	local key = lookup[ck]

	if key then
		local entry = AUCTIONVAULT_ITEMS[key]
		if entry ~= nil then
			if not settled[ck] then
				-- once per name+texture per session: a pre-schema-2 entry, or one the retry
				-- queue filled in since
				Backfill(key, entry, IconName(texture))
				settled[ck] = true
			end
			return key -- fast path: nothing left to learn about this item
		end
		if pending[key] or giveUp[key] then return key end
	end
	-- Either a cache miss, or a known item whose dimension row is still missing (a
	-- give-up that Requeue cleared). Both are worth one GetAuctionItemLink.

	local link   = GetAuctionItemLink("list", index)
	local parsed = ParseLink(link)
	if not parsed then return key end -- keep the cached key if we had one

	key        = parsed
	lookup[ck] = key

	local icon  = IconName(texture)
	local entry = AUCTIONVAULT_ITEMS[key]
	if entry ~= nil then
		Backfill(key, entry, icon)
		settled[ck] = true
	elseif self:Fill(key, link, icon) then
		settled[ck] = true
	else
		linkOf[key]  = link
		iconOf[key]  = iconOf[key] or icon
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
		if self:Fill(key, linkOf[key], iconOf[key]) then
			pending[key] = nil
			linkOf[key]  = nil
			iconOf[key]  = nil
		elseif tries >= maxRetries then
			pending[key] = nil
			linkOf[key]  = nil
			-- iconOf is kept: a Requeue'd retry still has the icon from this session
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
