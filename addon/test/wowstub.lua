--[[ Minimal stand-in for the 3.3.5a WoW Lua environment.

Enough to load AuctionVault outside the game and drive a synthetic auction house through it.
Note that this stubs only what the *client* provides -- frames, events, the auction API.
AuctionVault's own timer and dispatch code in Compat.lua runs for real, driven by
stub.pump(), which advances a virtual clock and calls OnUpdate frame by frame.
]]

local stub = {}

----------------------------------------------------------------------- clocks

stub.now       = nil -- pins time(); keeps scan ids deterministic
stub.frameTime = 0   -- virtual GetTime(), advanced by stub.pump

_G.time             = function() return stub.now or os.time() end
_G.GetTime          = function() return stub.frameTime end
_G.debugprofilestop = function() return os.clock() * 1000 end

----------------------------------------------------------------------- chat / player

_G.DEFAULT_CHAT_FRAME = {
	lines = {},
	AddMessage = function(self, msg)
		self.lines[#self.lines + 1] = msg
		if stub.verbose then print(msg) end
	end,
}

_G.SlashCmdList = {}

stub.realm   = "Icecrown"
stub.faction = "Alliance"
stub.player  = "Testchar"
stub.verbose = false

_G.GetRealmName     = function() return stub.realm end
_G.UnitFactionGroup = function() return stub.faction end
_G.UnitName         = function() return stub.player end

----------------------------------------------------------------------- frames

local frames = {}

_G.CreateFrame = function(_, name)
	local f = { name = name, events = {}, scripts = {} }
	function f:RegisterEvent(event)   self.events[event] = true end
	function f:UnregisterEvent(event) self.events[event] = nil end
	function f:SetScript(which, fn)   self.scripts[which] = fn end
	function f:GetScript(which)       return self.scripts[which] end
	function f:IsShown()              return stub.ahOpen end
	frames[#frames + 1] = f
	return f
end

function stub.fire(event, ...)
	for _, f in ipairs(frames) do
		if f.events[event] and f.scripts.OnEvent then
			f.scripts.OnEvent(f, event, ...)
		end
	end
end

-- Advances virtual time one frame at a time until the addon has no timers left pending.
function stub.pump(maxFrames)
	maxFrames = maxFrames or 100000
	for _ = 1, maxFrames do
		if _G.AuctionVault:PendingTimerCount() == 0 then return end
		stub.frameTime = stub.frameTime + 0.016
		for _, f in ipairs(frames) do
			if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.016) end
		end
	end
	error("stub.pump: frame limit reached -- a timer is probably never cancelled")
end

-- Advances a fixed number of frames, for asserting on mid-harvest state.
function stub.pumpFrames(n)
	for _ = 1, n do
		stub.frameTime = stub.frameTime + 0.016
		for _, f in ipairs(frames) do
			if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.016) end
		end
	end
end

function stub.slash(cmd, input)
	SlashCmdList["AUCTIONVAULT_" .. cmd:upper()](input)
end

----------------------------------------------------------------------- auction house

--[[ stub.listings is an array of:
     { name, texture, count, quality, minBid, buyout, bidAmount, owner, link, timeLeft }
     stub.visible caps how many of them GetNumAuctionItems reports, which is how we simulate
     the client dropping a getAll result list partway through a harvest. ]]
stub.listings  = {}
stub.visible   = nil
stub.itemCache = {} -- itemLink -> item info, or absent to mean "client has not cached it"

local function visibleCount()
	local n = #stub.listings
	if stub.visible and stub.visible < n then return stub.visible end
	return n
end

_G.GetNumAuctionItems = function(which)
	if which ~= "list" then return 0, 0 end
	local n = visibleCount()
	return n, n
end

_G.GetAuctionItemInfo = function(which, index)
	local l = stub.listings[index]
	if which ~= "list" or not l or index > visibleCount() then return nil end
	-- name, texture, count, quality, canUse, level, minBid, minIncrement,
	-- buyoutPrice, bidAmount, highBidder, owner
	return l.name, l.texture, l.count, l.quality, true, 1, l.minBid, 0,
	       l.buyout, l.bidAmount, nil, l.owner
end

_G.GetAuctionItemLink = function(which, index)
	local l = stub.listings[index]
	if which ~= "list" or not l or index > visibleCount() then return nil end
	stub.linkCalls = (stub.linkCalls or 0) + 1
	return l.link
end

_G.GetAuctionItemTimeLeft = function(which, index)
	local l = stub.listings[index]
	if which ~= "list" or not l then return nil end
	return l.timeLeft
end

-- Returns nil for links absent from stub.itemCache, mirroring an uncached client item.
_G.GetItemInfo = function(link)
	local info = stub.itemCache[link]
	if not info then return nil end
	-- name, link, quality, itemLevel, reqLevel, type, subType, stackMax, equipLoc, texture
	-- (3.3.5a stops here -- no vendor sell price)
	return info.name, link, info.quality, info.ilvl, info.reqLevel,
	       info.itemType, info.subType, info.stackMax, info.equipLoc, "Interface\\Icons\\Foo"
end

_G.CanSendAuctionQuery  = function() return true, stub.canQueryAll ~= false end
_G.SortAuctionClearSort = function() end
_G.QueryAuctionItems    = function() stub.lastQuery = true end

----------------------------------------------------------------------- addon loading

local FILES = { "Compat", "Core", "Diag", "Store", "ItemCache", "Session", "Harvest", "Commands" }

function stub.loadAddon(dir)
	local ns = {}
	for _, file in ipairs(FILES) do
		local chunk = assert(loadfile(dir .. "/" .. file .. ".lua"))
		chunk("AuctionVault", ns)
	end
	-- Drive the real lifecycle rather than calling OnInitialize/OnEnable directly.
	stub.fire("ADDON_LOADED", "AuctionVault")
	stub.fire("PLAYER_LOGIN")
	_G.AuctionFrame = ns.frame -- any frame with IsShown will do for /av scan
	return ns
end

function stub.reset()
	frames = {}
	stub.frameTime = 0
	_G.AuctionVault      = nil
	_G.SlashCmdList      = {}
	_G.AUCTIONVAULT_META   = nil
	_G.AUCTIONVAULT_CONFIG = nil
	_G.AUCTIONVAULT_ITEMS  = nil
	_G.AUCTIONVAULT_SCANS  = nil
	_G.AUCTIONVAULT_DIAG   = nil
	_G.Atr_FullScanAnalyze = nil
end

-- Stands in for Auctionator: defines the global AuctionVault hooks, and records that the
-- original was still called so we can prove we do not break Auctionator's own scan.
-- `clearsList` mimics the real Auctionator, which ends its pass with Atr_ClearBrowseListings
-- and so empties the result list before the next frame.
function stub.installAuctionator(clearsList)
	stub.auctionatorRan = 0
	_G.Atr_FullScanAnalyze = function()
		stub.auctionatorRan = stub.auctionatorRan + 1
		if clearsList then stub.visible = 0 end
	end
end

return stub
