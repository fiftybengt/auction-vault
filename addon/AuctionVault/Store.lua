--[[ AuctionVault -- Store

Encodes a finished session into SavedVariables and enforces retention.

Row format (one listing, comma separated, all integers except itemKey):
    itemKey,stackCount,minBid,buyout,bidAmount,timeLeft,sellerIdx
where itemKey is "itemID:suffixID" and sellerIdx indexes scan.sellers (0 = server sent nil).

Rows are stored as chunks of `rowsPerChunk` semicolon-joined listings rather than one array
entry each. WoW's SavedVariables writer spends roughly 12 bytes of `\t\t\t"...", -- [n]\n`
scaffolding on every array element; at 500 rows a chunk that overhead becomes noise instead
of a third of the file.

The separator is ';' rather than a newline on purpose. WoW's SV writer escapes a newline
inside a string as a literal two-character `\n` and keeps the string on one physical line
(verified against !BugGrabber.lua), so a newline join would look identical in the file while
forcing the reader to un-escape. Rows are digits, commas and colons only, so ';' never needs
escaping and the reader can split on raw bytes.
]]

local ADDON, ns = ...

local Store = {}
ns.Store = Store

local concat, remove = table.concat, table.remove

function Store:Commit(session)
	local rows      = session.rows
	local n         = #rows
	local perChunk  = ns.cfg.rowsPerChunk or 500
	local chunks    = {}
	local buf       = {}

	for i = 1, n do
		buf[#buf + 1] = rows[i]
		if #buf >= perChunk then
			chunks[#chunks + 1] = concat(buf, ";")
			buf = {}
		end
	end
	if #buf > 0 then
		chunks[#chunks + 1] = concat(buf, ";")
	end

	local record = {
		id            = session.id,
		startedAt     = session.startedAt,
		endedAt       = session.endedAt or time(),
		mode          = session.mode,
		source        = session.source,
		realm         = session.realm,
		faction       = session.faction,
		player        = session.player,
		rowCount      = n,
		expectedTotal = session.expectedTotal or n,
		nilOwners     = session.nilOwners or 0,
		unresolved    = session.unresolved or 0,
		complete      = session.complete and true or false,
		sellers       = session.sellers,
		rows          = chunks,
	}

	--[[ Same id means the same scan, so replace rather than duplicate -- but never trade a
	     fuller record for a thinner one. Two sessions can share a second when a harvest
	     restarts, and the loser must not clobber the winner. ]]
	for i = 1, #AUCTIONVAULT_SCANS do
		local existing = AUCTIONVAULT_SCANS[i]
		if existing.id == record.id then
			if (existing.rowCount or 0) > n then
				ns.Debug("keeping existing %s (%d rows) over %d", record.id, existing.rowCount, n)
				return existing
			end
			AUCTIONVAULT_SCANS[i] = record
			self:Prune()
			return record
		end
	end

	AUCTIONVAULT_SCANS[#AUCTIONVAULT_SCANS + 1] = record
	self:Prune()
	return record
end

-- Scans are appended newest-last, so index 1 is always the oldest.
function Store:Prune()
	local maxScans = ns.cfg.maxScans or 6
	while #AUCTIONVAULT_SCANS > maxScans do
		remove(AUCTIONVAULT_SCANS, 1)
	end
end

function Store:Purge()
	local n = #AUCTIONVAULT_SCANS
	AUCTIONVAULT_SCANS = {}
	return n
end
