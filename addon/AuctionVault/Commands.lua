--[[ AuctionVault -- Commands

/av status | scan | purge | config <key> <value> | debug
]]

local ADDON, ns = ...

local Commands = {}
ns.Commands = Commands

local format, floor = string.format, math.floor

function Commands:Register()
	ns.AV:RegisterChatCommand("av", function(input) Commands:Dispatch(input) end)
	ns.AV:RegisterChatCommand("auctionvault", function(input) Commands:Dispatch(input) end)
end

function Commands:Dispatch(input)
	local cmd, rest = (input or ""):match("^%s*(%S*)%s*(.-)%s*$")
	cmd = (cmd or ""):lower()

	if cmd == "" or cmd == "status" then
		self:Status()
	elseif cmd == "scan" then
		self:Scan()
	elseif cmd == "diag" then
		self:Diag()
	elseif cmd == "purge" then
		self:Purge()
	elseif cmd == "config" then
		self:Config(rest)
	elseif cmd == "debug" then
		ns.cfg.debug = not ns.cfg.debug
		ns.Print("debug %s", ns.cfg.debug and "on" or "off")
	else
		self:Help()
	end
end

function Commands:Help()
	ns.Print("commands:")
	ns.Print("  |cffffff00/av status|r         what has been captured so far")
	ns.Print("  |cffffff00/av diag|r           distribution of auction list sizes seen")
	ns.Print("  |cffffff00/av scan|r           run a getAll scan ourselves (AH must be open)")
	ns.Print("  |cffffff00/av purge|r          drop all stored scans")
	ns.Print("  |cffffff00/av config k v|r     set a config value")
	ns.Print("  |cffffff00/av debug|r          toggle verbose logging")
	ns.Print("Normally you do not need any of these -- just run Auctionator's Full Scan.")
end

local function countKeys(t)
	local n = 0
	for _ in pairs(t) do n = n + 1 end
	return n
end

function Commands:Status()
	ns.Print("v%s, schema %d -- %s / %s",
		ns.ADDON_VERSION, ns.SCHEMA_VERSION, GetRealmName(), UnitFactionGroup("player") or "?")

	if not ns.Harvest.hooked then
		ns.Print("|cffff5555Auctionator scan hook not installed|r -- capture will be less reliable.")
	end

	local session = ns.Session:Current()
	if session then
		local pct = session.expectedTotal > 0
			and floor(100 * (ns.Harvest.cursor or 0) / session.expectedTotal) or 0
		ns.Print("scan in progress: %d listings captured (%d%%)", #session.rows, pct)
	end

	local scans, listings = #AUCTIONVAULT_SCANS, 0
	for i = 1, scans do
		listings = listings + (AUCTIONVAULT_SCANS[i].rowCount or 0)
	end
	ns.Print("stored: %d/%d scans, %d listings (~%.1f MB), %d items known",
		scans, ns.cfg.maxScans, listings, listings * 35 / 1048576, countKeys(AUCTIONVAULT_ITEMS))

	local last = AUCTIONVAULT_SCANS[scans]
	if last then
		local age = time() - (last.endedAt or last.startedAt or 0)
		ns.Print("last scan: %d listings, %d sellers, %s, %d min ago%s",
			last.rowCount, #(last.sellers or {}),
			(last.nilOwners or 0) >= last.rowCount and "|cffff5555no seller names|r" or "seller names present",
			floor(age / 60),
			last.complete and "" or " |cffff5555[INCOMPLETE]|r")
	else
		ns.Print("no scans captured yet -- open the AH and run Auctionator's Full Scan.")
	end

	local unresolved = ns.ItemCache:PendingCount() + ns.ItemCache:GiveUpCount()
	if unresolved > 0 then
		ns.Print("%d items still unresolved (client has not cached them; retried next scan)", unresolved)
	end

	--[[ A getAll result streams in, so short lists during a scan are normal and expected.
	     They only mean something is wrong if a scan never landed. ]]
	if (ns.smallBatches or 0) > 200 and scans == 0 then
		ns.Print("|cffff5555%d short result lists and no scan captured.|r Run |cffffff00/av diag|r " ..
			"-- if the list never exceeded 50 rows, the scan was paged rather than getAll.",
			ns.smallBatches)
	end
end

function Commands:Diag()
	local d = AUCTIONVAULT_DIAG or {}

	ns.Print("Auctionator hook: %s", ns.Harvest.hooked
		and "|cff00ff00installed|r" or "|cffff5555NOT installed|r (Auctionator missing?)")
	ns.Print("harvest: running=%s drained=%s cursor=%s total=%s extends=%s",
		tostring(ns.Harvest.running), tostring(ns.Harvest.drained),
		tostring(ns.Harvest.cursor), tostring(ns.Harvest.total), tostring(ns.Harvest.extends))

	local sizes, total, largest = {}, 0, 0
	for key, seen in pairs(d.sizes or {}) do
		sizes[#sizes + 1] = { key = key, seen = seen }
		total = total + seen
		local n = tonumber(key:match("^(%d+)")) or 0
		if n > largest then largest = n end
	end

	if total == 0 then
		ns.Print("no auction list updates recorded yet.")
		return
	end

	table.sort(sizes, function(a, b) return a.seen > b.seen end)
	ns.Print("%d list updates seen, most frequent sizes:", total)
	for i = 1, math.min(#sizes, 6) do
		ns.Print("  %8s rows  x%d", sizes[i].key, sizes[i].seen)
	end
	ns.Print("largest list seen: %d rows -- %s", largest,
		largest > 50 and "getAll reached us" or
		"|cffff5555never above one page; scan was paged, not getAll|r")

	local notes = d.notes or {}
	if #notes > 0 then
		ns.Print("timeline (ms since AH opened):")
		for i = 1, math.min(#notes, 12) do
			ns.Print("  %s", notes[i])
		end
	end
	ns.Print("|cff888888full timeline persists in AUCTIONVAULT_DIAG after /reload.|r")
end

function Commands:Scan()
	if not (AuctionFrame and AuctionFrame:IsShown()) then
		ns.Print("open the auction house first.")
		return
	end
	if ns.Harvest.running then
		ns.Print("a harvest is already running.")
		return
	end

	local canQuery, canQueryAll = CanSendAuctionQuery()
	if not canQuery then
		ns.Print("the auction house is busy -- try again in a moment.")
		return
	end
	if not canQueryAll then
		ns.Print("getAll is on cooldown or unavailable (it has a 15 minute cooldown). " ..
			"Use Auctionator's Full Scan instead -- we harvest that passively.")
		return
	end

	ns.Harvest.pendingSource = "self"
	SortAuctionClearSort("list")
	QueryAuctionItems("", nil, nil, 0, 0, 0, 0, 0, 0, true)
	ns.Print("getAll query sent...")
end

function Commands:Purge()
	local n = ns.Store:Purge()
	ns.Print("dropped %d stored scan(s). /reload to write the change to disk.", n)
end

function Commands:Config(rest)
	local key, value = rest:match("^(%S+)%s+(%S+)$")
	if not key then
		ns.Print("current config:")
		for k in pairs(ns.DEFAULTS) do
			ns.Print("  %s = %s", k, tostring(ns.cfg[k]))
		end
		return
	end

	if ns.DEFAULTS[key] == nil then
		ns.Print("unknown key '%s'", key)
		return
	end

	local typed
	if type(ns.DEFAULTS[key]) == "boolean" then
		typed = (value == "true" or value == "1" or value == "on")
	else
		typed = tonumber(value)
		if not typed then
			ns.Print("'%s' expects a number", key)
			return
		end
	end

	ns.cfg[key] = typed
	ns.Print("%s = %s", key, tostring(typed))
end
