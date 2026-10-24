# AuctionVault -- WoW 3.3.5a auction house data platform
#
#   make test      syntax-check and run the headless addon test harness
#   make sample    generate a realistic SavedVariables file and verify the format contract
#   make install   symlink the addon into the WoW client
#   make status    show what the live client has captured so far
#   make publish   archive + parse the live SavedVariables and upload it to Databricks
#                  (make publish-dry: same, but upload nothing; make ingest-test: pytest)

LUA_VERSION := 5.1.5
TOOLS       := .tools
LUA         := $(TOOLS)/bin/lua
LUAC        := $(TOOLS)/bin/luac

# WoW 3.3.5a runs Lua 5.1, so the test harness runs the exact same interpreter.
WOW_DIR     ?= $(HOME)/Downloads/World of Warcraft 3.3.5a
WOW_ACCOUNT ?= SICU
ADDON_DIR   := $(WOW_DIR)/Interface/AddOns/AuctionVault
SAVED_VARS  := $(WOW_DIR)/WTF/Account/$(WOW_ACCOUNT)/SavedVariables/AuctionVault.lua

BUILD       := build

# Python ingest (ingest/): its own venv, created on first use.
INGEST_VENV := ingest/.venv
PY          := $(INGEST_VENV)/bin/python
INGEST_DEPS := $(INGEST_VENV)/.installed

.PHONY: all test check sample install uninstall status clean publish publish-dry ingest-test

all: test

# ---------------------------------------------------------------- toolchain

# Built from source rather than apt-installed: no sudo, and it pins the interpreter to the
# same 5.1 the game ships.
$(LUA):
	@mkdir -p $(TOOLS)/src $(TOOLS)/bin
	curl -sSL -o $(TOOLS)/src/lua.tar.gz https://www.lua.org/ftp/lua-$(LUA_VERSION).tar.gz
	tar xzf $(TOOLS)/src/lua.tar.gz -C $(TOOLS)/src
	$(MAKE) -C $(TOOLS)/src/lua-$(LUA_VERSION) posix
	cp $(TOOLS)/src/lua-$(LUA_VERSION)/src/lua $(TOOLS)/src/lua-$(LUA_VERSION)/src/luac $(TOOLS)/bin/
	@echo "built lua $(LUA_VERSION)"

# ---------------------------------------------------------------- test

check: $(LUA)
	@$(LUAC) -p addon/AuctionVault/*.lua addon/test/*.lua && echo "syntax ok"

test: check
	@$(LUA) addon/test/run.lua

sample: check
	@mkdir -p $(BUILD)
	@$(LUA) addon/test/dump.lua $(BUILD)/AuctionVault.lua 48000
	@python3 addon/test/verify_format.py $(BUILD)/AuctionVault.lua

# ---------------------------------------------------------------- client

install:
	@test -d "$(WOW_DIR)/Interface/AddOns" || \
		{ echo "no AddOns dir at $(WOW_DIR) -- set WOW_DIR=..."; exit 1; }
	@if [ -e "$(ADDON_DIR)" ] && [ ! -L "$(ADDON_DIR)" ]; then \
		echo "$(ADDON_DIR) exists and is not a symlink; refusing to touch it"; exit 1; fi
	@rm -f "$(ADDON_DIR)"
	@ln -s "$(CURDIR)/addon/AuctionVault" "$(ADDON_DIR)"
	@echo "linked $(ADDON_DIR) -> $(CURDIR)/addon/AuctionVault"
	@echo "Ace3 present: $$(test -d '$(WOW_DIR)/Interface/AddOns/Ace3' && echo yes || echo NO -- required)"

uninstall:
	@test -L "$(ADDON_DIR)" && rm -f "$(ADDON_DIR)" && echo "unlinked" || echo "not a symlink, nothing done"

# Reads whatever the live client has written, using the same reader as `make sample`.
status:
	@test -f "$(SAVED_VARS)" || { echo "no scans yet at $(SAVED_VARS)"; exit 1; }
	@ls -lh "$(SAVED_VARS)"
	@python3 addon/test/verify_format.py "$(SAVED_VARS)"

# ---------------------------------------------------------------- ingest

$(INGEST_DEPS): ingest/pyproject.toml
	python3 -m venv $(INGEST_VENV)
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q "pyarrow>=15" "databricks-sdk>=0.30" "pytest>=7"
	@touch $@

ingest-test: $(INGEST_DEPS)
	@cd ingest && .venv/bin/python -m pytest -q

# Archives first (data/raw/), skips files already uploaded, then uploads the C2 landing
# directory. Credentials come from the GNOME keyring via scripts/with-databricks.
publish: $(INGEST_DEPS)
	@scripts/with-databricks $(PY) -m ingest publish --sv "$(SAVED_VARS)"
	@# TODO(devops-engineer): trigger the warehouse build here, e.g.
	@#   gh workflow run build-deploy

publish-dry: $(INGEST_DEPS)
	@$(PY) -m ingest publish --dry-run --sv "$(SAVED_VARS)"

clean:
	rm -rf $(BUILD)
