--[[ AuctionVault -- Compat

The four things we would otherwise pull Ace3 in for: addon lifecycle, event dispatch,
timers, and slash commands.

Ace3 is installed on this client, but it does not appear in any character's AddOns.txt, so
there is no way to confirm it actually loads -- and `## Dependencies: Ace3` turns that
uncertainty into a silent no-load. Four primitives are not worth a dependency we cannot
verify, so AuctionVault has none.

Timers are driven from OnUpdate, which means a scheduled callback fires on the next frame at
the earliest. That is exactly the pacing the chunked harvester wants, and it is the same
mechanism Auctionator uses (Auctionator.lua:2241).
]]

local ADDON, ns = ...

local AV = {}
ns.AV = AV
_G.AuctionVault = AV

local frame = CreateFrame("Frame", "AuctionVaultFrame")
ns.frame = frame

------------------------------------------------------------------ events

local handlers = {}

function AV:RegisterEvent(event, method)
	handlers[event] = method or event
	frame:RegisterEvent(event)
end

function AV:UnregisterEvent(event)
	handlers[event] = nil
	frame:UnregisterEvent(event)
end

------------------------------------------------------------------ timers

local timers, nextHandle = {}, 0
local due = {} -- reused scratch list, so a busy frame allocates nothing

function AV:ScheduleTimer(callback, delay)
	nextHandle = nextHandle + 1
	timers[nextHandle] = { fn = callback, at = GetTime() + (delay or 0) }
	return nextHandle
end

function AV:ScheduleRepeatingTimer(callback, delay)
	nextHandle = nextHandle + 1
	timers[nextHandle] = { fn = callback, at = GetTime() + delay, interval = delay }
	return nextHandle
end

function AV:CancelTimer(handle)
	if handle then timers[handle] = nil end
end

-- Diagnostic seam, also used by the test harness to know when to stop pumping frames.
function AV:PendingTimerCount()
	local n = 0
	for _ in pairs(timers) do n = n + 1 end
	return n
end

--[[ Due timers are collected before any of them run. A callback is free to schedule more
     work -- the harvester schedules its own next chunk -- and inserting into a table while
     pairs() is walking it is undefined in Lua 5.1. ]]
local function OnUpdate()
	local now, n = GetTime(), 0

	for handle, timer in pairs(timers) do
		if now >= timer.at then
			n = n + 1
			due[n] = handle
		end
	end

	for i = 1, n do
		local handle = due[i]
		local timer  = timers[handle]
		due[i] = nil
		if timer then
			if timer.interval then
				timer.at = now + timer.interval
			else
				timers[handle] = nil
			end
			timer.fn()
		end
	end
end

------------------------------------------------------------------ slash commands

function AV:RegisterChatCommand(name, handler)
	local key = "AUCTIONVAULT_" .. name:upper()
	_G["SLASH_" .. key .. "1"] = "/" .. name
	SlashCmdList[key] = handler
end

------------------------------------------------------------------ lifecycle

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")

frame:SetScript("OnUpdate", OnUpdate)
frame:SetScript("OnEvent", function(_, event, ...)
	if event == "ADDON_LOADED" then
		local loaded = ...
		if loaded == ADDON then
			frame:UnregisterEvent("ADDON_LOADED")
			AV:OnInitialize()
		end
		return
	end

	if event == "PLAYER_LOGIN" then
		frame:UnregisterEvent("PLAYER_LOGIN")
		AV:OnEnable()
		return
	end

	local method = handlers[event]
	if method then AV[method](AV, ...) end
end)
