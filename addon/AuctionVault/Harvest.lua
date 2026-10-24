--[[ AuctionVault -- Harvest

Reads the AH result list into the current session.

## Read immediately, extend as it grows

A 3.3.5a client streams a getAll result: it fires AUCTION_ITEM_LIST_UPDATE repeatedly while
the row count climbs, then tears the list down again some time after delivery. Two properties
follow, and both were learned the hard way against Warmane:

1. **Do not wait for the list to settle.** Waiting for streaming to stop and then reading
   misses the scan entirely, because the client has already dropped the result by then.
   Auctionator reads inside the first event for exactly this reason
   (AuctionatorScan.lua:1161). So the first chunk is read synchronously, in the event handler.

2. **A growing list is append-only, so growth is not a restart.** Rows already read stay
   valid; a larger count just means there is more on the end. We raise `total` and keep going
   from the cursor rather than discarding what we have.

Everything after the first chunk is spread across frames with a row cap and a millisecond
budget, so a 48k-row read does not freeze the client the way Auctionator's single blocking
pass does.

## Finishing

Reading to the end does not close the scan -- more rows may still stream in. The session goes
"drained" and closes `finalizeSeconds` later if nothing more arrives. A count that *drops*
means teardown: complete if we had already read everything, incomplete otherwise.
]]

local ADDON, ns = ...

local Harvest = {}
ns.Harvest = Harvest

local format, min = string.format, math.min
local clock = debugprofilestop or function() return 0 end

Harvest.running = false
Harvest.drained = false
Harvest.total   = 0
Harvest.cursor  = 1
Harvest.extends = 0

--[[ Preferred entry point: hook Auctionator instead of guessing.

Auctionator calls the global Atr_FullScanAnalyze (AuctionatorScan.lua:1143) from inside the
event where it has decided the getAll result is present and worth reading. That is strictly
better information than we can infer from row counts, so when Auctionator is installed we
read at its signal and skip the heuristics entirely.

We read before handing control on, because Auctionator's own pass is a blocking walk over
every row and we would rather not find out what the client does to the list in the meantime. ]]
function Harvest:InstallAuctionatorHook()
	if type(Atr_FullScanAnalyze) ~= "function" then
		ns.Debug("Auctionator not found; falling back to AUCTION_ITEM_LIST_UPDATE heuristics")
		return false
	end

	local original = Atr_FullScanAnalyze
	Atr_FullScanAnalyze = function(...)
		Harvest:OnAuctionatorScan()
		return original(...)
	end

	self.hooked = true
	ns.Debug("hooked Auctionator's full scan")
	return true
end

function Harvest:OnAuctionatorScan()
	local numBatch = GetNumAuctionItems("list") or 0
	ns.Diag:Note("Auctionator scan hook fired, %d rows", numBatch)

	if self.running then return end
	if numBatch < (ns.cfg.minFullScanRows or 51) then return end

	self.pendingSource = "auctionator-hook"
	self.inHook        = true
	self:Begin(numBatch)
	self.inHook        = nil
end

function Harvest:OnListUpdate()
	local numBatch = GetNumAuctionItems("list") or 0
	ns.Diag:Observe(numBatch)

	if self.running then
		if numBatch > self.total then
			self.total   = numBatch
			self.extends = self.extends + 1
			ns.Diag:Note("extend -> %d rows", numBatch)
			if self.drained then
				self.drained = false
				self:CancelFinalize()
				self:ScheduleStep()
			end
		elseif numBatch < self.total then
			if self.cursor > self.total then
				self:Finalize(true, "list cleared after a complete read")
			else
				self:Abort(format("list shrank to %d of %d rows", numBatch, self.total))
			end
		end
		return
	end

	if numBatch >= (ns.cfg.minFullScanRows or 51) then
		self:Begin(numBatch)
	else
		ns.smallBatches = (ns.smallBatches or 0) + 1
	end
end

function Harvest:Begin(total)
	local session = ns.Session:Open(self.pendingSource or "auctionator", "getall")
	self.pendingSource    = nil
	session.expectedTotal = total

	self.running = true
	self.drained = false
	self.cursor  = 1
	self.total   = total
	self.extends = 0

	ns.Diag:Note("begin harvest, %d rows", total)
	ns.Print("harvesting %d listings...", total)
	self:Step() -- read the first chunk now, while the list is certainly still there
end

function Harvest:ScheduleStep()
	if self.timer then return end
	self.timer = ns.AV:ScheduleTimer(function() Harvest:Step() end, 0.01)
end

function Harvest:Step()
	self.timer = nil
	if not self.running then return end

	local session = ns.Session:Current()
	if not session then
		self:Abort("session vanished")
		return
	end

	local available = GetNumAuctionItems("list") or 0
	if available < self.total then
		if self.cursor > self.total then
			self:Finalize(true, "list cleared after a complete read")
		else
			self:Abort(format("list shrank to %d of %d rows", available, self.total))
		end
		return
	end

	local rows      = session.rows
	local resolve   = ns.ItemCache.Resolve
	local itemCache = ns.ItemCache
	local sellerIdx = ns.Session.SellerIndex
	-- A one-off hitch is cheaper than missing the window in which the list exists at all, so
	-- the opening chunk gets a longer budget. Auctionator's hook reads the whole list in one
	-- go: Auctionator ends its pass with Atr_ClearBrowseListings (AuctionatorScan.lua:1274),
	-- which empties the list before any later frame runs, so a chunked read there only ever
	-- kept the first 5000 rows.
	local budget    = self.cursor == 1 and (ns.cfg.firstChunkBudgetMs or 60)
	                                    or (ns.cfg.chunkBudgetMs or 15)
	local last      = self.inHook and self.total
	               or min(self.total, self.cursor + (ns.cfg.harvestChunkRows or 5000) - 1)
	local started   = clock()
	local i         = self.cursor

	while i <= last do
		local name, texture, count, _, _, _, minBid, _, buyout, bidAmount, _, owner =
			GetAuctionItemInfo("list", i)

		if name then
			local key = resolve(itemCache, name, texture, i)
			if key then
				rows[#rows + 1] = format("%s,%d,%d,%d,%d,%d,%d",
					key,
					count or 1,
					minBid or 0,
					buyout or 0,
					bidAmount or 0,
					GetAuctionItemTimeLeft("list", i) or 0,
					sellerIdx(ns.Session, owner))
			end
		end

		i = i + 1
		if not self.inHook and i % 250 == 0 and clock() - started > budget then break end
	end

	self.cursor = i

	if i > self.total then
		self:Drain()
	else
		self:ScheduleStep()
	end
end

-- Read everything currently on offer. Wait a little in case more streams in.
function Harvest:Drain()
	self.drained = true
	ns.Diag:Note("drained at %d rows", self.cursor - 1)
	self:CancelFinalize()
	self.finalizeTimer = ns.AV:ScheduleTimer(function()
		Harvest:Finalize(true, "no further list updates")
	end, ns.cfg.finalizeSeconds or 3)
end

function Harvest:CancelFinalize()
	if self.finalizeTimer then
		ns.AV:CancelTimer(self.finalizeTimer)
		self.finalizeTimer = nil
	end
end

function Harvest:Finalize(complete, reason)
	if not self.running then return end
	self.running = false
	self.drained = false

	self:CancelFinalize()
	if self.timer then
		ns.AV:CancelTimer(self.timer)
		self.timer = nil
	end

	ns.Diag:Note("finalize complete=%s (%s)", tostring(complete), reason)
	ns.Session:CloseIfOpen(complete, reason)
end

function Harvest:Abort(reason)
	if not self.running then return end
	ns.Print("|cffff5555harvest aborted:|r %s", reason)
	self:Finalize(false, "aborted -- " .. reason)
end
