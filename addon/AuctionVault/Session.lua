--[[ AuctionVault -- Session

One session == one full scan == one row in AUCTIONVAULT_SCANS.

The id is "realm:faction:startedAt", which makes ingestion downstream idempotent: re-reading
the same SavedVariables file, or overlapping retention windows, can never double-count.
]]

local ADDON, ns = ...

local Session = {}
ns.Session = Session

local current = nil

function Session:Current()
	return current
end

function Session:Open(source, mode)
	if current then return current end

	local realm   = GetRealmName()
	local faction = UnitFactionGroup("player") or "Neutral"
	local now     = time()

	current = {
		id            = realm .. ":" .. faction .. ":" .. now,
		startedAt     = now,
		mode          = mode or "getall",
		source        = source or "passive",
		realm         = realm,
		faction       = faction,
		player        = UnitName("player"),
		rows          = {},
		sellers       = {},
		sellerIdx     = {}, -- name -> index; not persisted, Store copies fields explicitly
		nilOwners     = 0,
		unresolved    = 0,
		expectedTotal = 0,
		complete      = false,
	}

	ns.ItemCache:Requeue()
	ns.Debug("session opened: %s (%s/%s)", current.id, current.source, current.mode)
	return current
end

--[[ Warmane commonly returns a nil owner on getAll results. We record index 0 for those
     rather than dropping the listing, and count them so the ingester can report how much
     seller-level analysis is actually possible for a given scan. ]]
function Session:SellerIndex(owner)
	if owner == nil or owner == "" then
		current.nilOwners = current.nilOwners + 1
		return 0
	end

	local idx = current.sellerIdx[owner]
	if idx then return idx end

	local sellers = current.sellers
	sellers[#sellers + 1]     = owner
	idx                       = #sellers
	current.sellerIdx[owner]  = idx
	return idx
end

-- Called when the list grew mid-harvest: what we read was a prefix of a larger list.
function Session:ResetRows()
	if not current then return end
	current.rows      = {}
	current.sellers   = {}
	current.sellerIdx = {}
	current.nilOwners = 0
end

function Session:Close(complete, reason)
	if not current then return end

	--[[ An empty session is noise, not data. It happens when a harvest aborts before its
	     first chunk, and storing it risks displacing a real scan that shares its id. ]]
	if #current.rows == 0 then
		ns.Debug("discarding empty session %s (%s)", current.id, reason or "")
		current = nil
		return
	end

	current.complete   = complete and true or false
	current.endedAt    = time()
	current.unresolved = ns.ItemCache:PendingCount() + ns.ItemCache:GiveUpCount()

	local rec = ns.Store:Commit(current)
	current = nil
	ns.lastScan = rec

	ns.Print("scan %s -- %d listings, %d sellers%s (%s)",
		rec.id, rec.rowCount, #rec.sellers,
		rec.complete and "" or " |cffff5555[INCOMPLETE]|r", reason or "done")
	ns.Print("|cff888888/reload or log out to write it to disk.|r")

	return rec
end

function Session:CloseIfOpen(complete, reason)
	if current then return self:Close(complete, reason) end
end
