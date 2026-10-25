--[[ AuctionVault -- Core

Addon object, SavedVariables bootstrap, event wiring.

The design in one sentence: we never scan the auction house ourselves unless asked to.
The AH result list is global client state, so when Auctionator (or anything else) runs a
getAll full scan, we receive the same AUCTION_ITEM_LIST_UPDATE and read the same rows --
at full fidelity, including the fields Auctionator reads and throws away.
]]

local _, ns = ...

ns.ADDON_VERSION  = "0.1.0"
ns.SCHEMA_VERSION = 2

local AV = ns.AV -- created in Compat.lua; no external framework, see the note there

local format = string.format

-- Anything not listed here is not user-tunable.
local DEFAULTS = {
	maxScans         = 6,     -- scans retained in SavedVariables (oldest pruned first)
	rowsPerChunk     = 500,   -- listings per stored string; keeps SV writer overhead negligible
	harvestChunkRows = 5000,  -- hard cap on listings processed per frame
	chunkBudgetMs    = 15,    -- soft cap: stop the frame's chunk after this many ms
	minFullScanRows  = 51,    -- a list longer than one AH page means a full scan, not a search
	firstChunkBudgetMs = 60,  -- longer budget for the opening chunk, read inside the event
	finalizeSeconds  = 3,     -- close a fully-read scan if nothing more streams in
	diagTimelineMax  = 600,   -- list-size samples retained per auction house visit
	itemRetrySeconds = 0.5,   -- GetItemInfo retry cadence for uncached items
	itemMaxRetries   = 60,    -- give up resolving an item after this many retries
	debug            = false,
}
ns.DEFAULTS = DEFAULTS

function ns.Print(fmt, ...)
	local msg = select("#", ...) > 0 and format(fmt, ...) or fmt
	DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99AuctionVault|r " .. msg)
end

function ns.Debug(fmt, ...)
	if ns.cfg and ns.cfg.debug then
		local msg = select("#", ...) > 0 and format(fmt, ...) or fmt
		DEFAULT_CHAT_FRAME:AddMessage("|cff888888AuctionVault dbg|r " .. msg)
	end
end

function AV:OnInitialize()
	if type(AUCTIONVAULT_META) ~= "table" then AUCTIONVAULT_META = {} end
	AUCTIONVAULT_META.schema       = ns.SCHEMA_VERSION
	AUCTIONVAULT_META.addonVersion = ns.ADDON_VERSION

	if type(AUCTIONVAULT_CONFIG) ~= "table" then AUCTIONVAULT_CONFIG = {} end
	for k, v in pairs(DEFAULTS) do
		if AUCTIONVAULT_CONFIG[k] == nil then AUCTIONVAULT_CONFIG[k] = v end
	end
	ns.cfg = AUCTIONVAULT_CONFIG

	if type(AUCTIONVAULT_ITEMS) ~= "table" then AUCTIONVAULT_ITEMS = {} end
	if type(AUCTIONVAULT_SCANS) ~= "table" then AUCTIONVAULT_SCANS = {} end

	ns.Diag:Init()
	ns.ItemCache:Init()
	ns.Commands:Register()
end

function AV:OnEnable()
	self:RegisterEvent("AUCTION_ITEM_LIST_UPDATE")
	self:RegisterEvent("AUCTION_HOUSE_SHOW")
	self:RegisterEvent("AUCTION_HOUSE_CLOSED")
	self:RegisterEvent("PLAYER_LOGOUT")

	-- All addons have loaded by now, so Auctionator's globals exist if it is installed.
	ns.Harvest:InstallAuctionatorHook()
end

function AV:AUCTION_HOUSE_SHOW()
	ns.smallBatches = 0
	ns.Diag:Reset("auction house opened")
	ns.Debug("auction house opened")
end

function AV:AUCTION_ITEM_LIST_UPDATE()
	ns.Harvest:OnListUpdate()
end

function AV:AUCTION_HOUSE_CLOSED()
	-- A drained harvest read everything on offer, so closing the AH just confirms it.
	ns.Harvest:Finalize(ns.Harvest.drained, "auction house closed")
	ns.Session:CloseIfOpen(true, "auction house closed")
end

function AV:PLAYER_LOGOUT()
	-- Fires before SavedVariables are written, so a session in flight is still salvageable.
	ns.Harvest:Finalize(ns.Harvest.drained, "logout")
	ns.Session:CloseIfOpen(false, "logout")
end
