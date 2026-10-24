--[[ AuctionVault -- Diag

Persistent record of how the client actually delivers auction results.

This exists because the getAll delivery pattern on a 3.3.5a private server is not documented
anywhere and two designs have already failed against it. In-memory diagnostics are useless
here: SavedVariables are only written on /reload, and reloading destroys exactly the state
you wanted to inspect. So the timeline is written to disk.

`/av diag` prints it, and it survives into AUCTIONVAULT_DIAG for offline inspection.
]]

local ADDON, ns = ...

local Diag = {}
ns.Diag = Diag

local format, floor = string.format, math.floor

function Diag:Init()
	if type(AUCTIONVAULT_DIAG) ~= "table" then AUCTIONVAULT_DIAG = {} end
	local d = AUCTIONVAULT_DIAG
	if type(d.sizes) ~= "table" then d.sizes = {} end
	d.timeline = {}
	d.notes    = {}
	d.startedAt = nil
end

-- Timeline and notes cover one auction house visit; the size histogram accumulates.
function Diag:Reset(why)
	local d = AUCTIONVAULT_DIAG
	d.timeline  = {}
	d.notes     = {}
	d.startedAt = GetTime()
	d.reason    = why
end

function Diag:Elapsed()
	local d = AUCTIONVAULT_DIAG
	if not d.startedAt then d.startedAt = GetTime() end
	return floor((GetTime() - d.startedAt) * 1000)
end

--[[ Sizes are bucketed above 100. A streaming result climbs through thousands of distinct
     counts, and one histogram key per count would balloon the file. ]]
local function bucket(n)
	if n <= 100 then return tostring(n) end
	return tostring(floor(n / 500) * 500) .. "+"
end

function Diag:Observe(n)
	local d = AUCTIONVAULT_DIAG

	local key = bucket(n)
	if d.sizes[key] or self:SizeCount() < 200 then
		d.sizes[key] = (d.sizes[key] or 0) + 1
	end

	local max = ns.cfg and ns.cfg.diagTimelineMax or 600
	if #d.timeline < max then
		d.timeline[#d.timeline + 1] = format("%d:%d", self:Elapsed(), n)
	end
end

function Diag:SizeCount()
	local n = 0
	for _ in pairs(AUCTIONVAULT_DIAG.sizes) do n = n + 1 end
	return n
end

-- Significant state transitions, timestamped alongside the size timeline.
function Diag:Note(fmt, ...)
	local msg = select("#", ...) > 0 and format(fmt, ...) or fmt
	local d = AUCTIONVAULT_DIAG
	if #d.notes < 200 then
		d.notes[#d.notes + 1] = format("%d %s", self:Elapsed(), msg)
	end
	ns.Debug(msg)
end
