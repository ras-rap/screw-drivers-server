#!/bin/bash
# Pterodactyl install script for the Screw Drivers dedicated server.
# Runs in the egg's install image (ghcr.io/parkervcp/yolks:wine_10) with /mnt/server mounted.
#
# Two ways to get the game files:
#   1. STEAM_USERNAME/STEAM_PASSWORD of an account that owns Screw Drivers
#      (AppID 1279510) -> steamcmd pulls the Windows depot and only the
#      "Dedicated Server" folder is kept.
#   2. No credentials -> the files must already be in the volume (copy the
#      "Dedicated Server" folder from your own installation).
#
# start.sh and the mod are written FIRST, so a failed download still leaves a server
# that boots and tells you what is wrong instead of failing with "No such file".
#
# The __WRITE_*__ markers are replaced by tools/build_egg.py with heredocs that embed
# start.sh and ModTheIsland.dll, so the egg stays self-contained.
set -uo pipefail

SERVER_DIR="${SERVER_DIR:-/mnt/server}"
EXE="Screw Drivers Server.exe"
APP_ID="1279510"
BEPINEX_VERSION="5.4.23.6"
STEAMCMD_DIR="$SERVER_DIR/.steamcmd"
DOWNLOAD="$SERVER_DIR/.download"

echo "-----------------------------------------"
echo "Screw Drivers dedicated server installer"
echo "-----------------------------------------"

mkdir -p "$SERVER_DIR"

have_files() { [[ -f "$SERVER_DIR/$EXE" ]]; }

# ---------------------------------------------------------------- start script
__WRITE_START_SH__

# --------------------------------------------------------------- server mod
echo "installing BepInEx $BEPINEX_VERSION"
if curl -fsSL -o /tmp/bepinex.zip \
	"https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x64_${BEPINEX_VERSION}.zip"; then
	rm -rf /tmp/bepinex-extract
	if unzip -q /tmp/bepinex.zip -d /tmp/bepinex-extract; then
		cp -a /tmp/bepinex-extract/. "$SERVER_DIR/" || echo "warning: could not copy BepInEx into place"
	else
		echo "warning: could not unpack BepInEx"
	fi
	rm -rf /tmp/bepinex.zip /tmp/bepinex-extract
else
	echo "warning: BepInEx download failed, the admin API will be unavailable"
fi

mkdir -p "$SERVER_DIR/BepInEx/plugins"
rm -f "$SERVER_DIR/BepInEx/plugins/ScrewDriversAdmin.dll"   # superseded by ModTheIsland
__WRITE_PLUGIN_DLL__

# ------------------------------------------------------------------- game files
# steamcmd installs into whichever library it decides on (force_install_dir is not
# always honoured, and HOME=$SERVER_DIR makes it use $SERVER_DIR/Steam), so look for
# the "Dedicated Server" folder in every place it can land - including a tree that a
# previous attempt already left behind.
find_game_files() {
	local candidate
	for candidate in \
		"$SERVER_DIR/Screw Drivers/Dedicated Server" \
		"$DOWNLOAD/Screw Drivers/Dedicated Server" \
		"$DOWNLOAD/steamapps/common/Screw Drivers/Dedicated Server" \
		"$SERVER_DIR/Steam/steamapps/common/Screw Drivers/Dedicated Server"; do
		if [[ -d "$candidate" ]]; then
			printf '%s' "$candidate"
			return 0
		fi
	done
	find "$SERVER_DIR" -maxdepth 6 -type d -name "Dedicated Server" -print -quit 2>/dev/null
}

adopt_game_files() {
	local source="$1"
	echo "found the server files in ${source#"$SERVER_DIR"/}"
	cp -a "$source/." "$SERVER_DIR/" || return 1
	# Drop steamcmd's library (the full 9.3 GB client depot) and the scratch download.
	rm -rf "$DOWNLOAD"
	case "$source" in
	"$SERVER_DIR"/Steam/*) rm -rf "$SERVER_DIR/Steam" ;;
	esac
	return 0
}

fetch_steamcmd() {
	mkdir -p "$STEAMCMD_DIR"
	echo "downloading steamcmd"
	curl -fsSL -o /tmp/steamcmd.tar.gz "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" || return 1
	tar -xzf /tmp/steamcmd.tar.gz -C "$STEAMCMD_DIR" || return 1
	mkdir -p "$SERVER_DIR/steamapps"
	chmod +x "$STEAMCMD_DIR/steamcmd.sh"
}

fetch_game_files() {
	local auth=("$STEAM_USERNAME" "$STEAM_PASSWORD")
	[[ -n "${STEAM_GUARD_CODE:-}" ]] && auth+=("$STEAM_GUARD_CODE")

	rm -rf "$DOWNLOAD"
	mkdir -p "$DOWNLOAD"

	echo "downloading AppID $APP_ID (Windows depot, ~9.3 GB, only 'Dedicated Server' is kept)"
	(
		cd "$STEAMCMD_DIR" || exit 1
		HOME="$SERVER_DIR" ./steamcmd.sh +force_install_dir "$DOWNLOAD" \
			+login "${auth[@]}" +@sSteamCmdForcePlatformType windows \
			+app_update "$APP_ID" validate +quit
	) 2>&1 | tee /tmp/steamcmd.log

	local found
	found="$(find_game_files)"
	if [[ -z "$found" ]]; then
		echo
		echo "steamcmd finished but no 'Dedicated Server' folder turned up. Looked in:"
		echo "  $SERVER_DIR/Screw Drivers/Dedicated Server"
		echo "  $DOWNLOAD/... and $SERVER_DIR/Steam/steamapps/common/Screw Drivers/Dedicated Server"
		grep -qi "no subscription" /tmp/steamcmd.log && echo "The account does not own Screw Drivers (AppID $APP_ID)."
		grep -qi "steam guard" /tmp/steamcmd.log && echo "Steam Guard was requested - set STEAM_GUARD_CODE and reinstall."
		return 1
	fi
	adopt_game_files "$found"
}

if [[ -n "${STEAM_USERNAME:-}" && -n "${STEAM_PASSWORD:-}" ]]; then
	echo "using steam account: $STEAM_USERNAME"
	fetch_steamcmd || { echo "fatal: could not install steamcmd"; exit 1; }
	fetch_game_files || { echo "fatal: could not download the dedicated server (see above)"; exit 1; }
else
	existing="$(find_game_files)"
	if [[ -n "$existing" ]]; then
		echo "no Steam credentials given, adopting the files already in the volume"
		adopt_game_files "$existing" || echo "warning: could not copy the existing files into place"
	fi
fi

if ! have_files; then
	cat << 'MSG'

fatal: no game files yet.

Screw Drivers is a paid game and Valve ships the dedicated server inside the
normal game depot (AppID 1279510), so there is no anonymous download. Either:

  A) set STEAM_USERNAME / STEAM_PASSWORD (and STEAM_GUARD_CODE the first time) in the
     startup variables and run the installer again - the account must own the game; or

  B) copy the folder "Dedicated Server" from your own installation
     (Steam\steamapps\common\Screw Drivers\Dedicated Server) into this server's file
     manager / SFTP root, so that "Screw Drivers Server.exe" ends up directly in
     /home/container, then run the installer again.

start.sh and the mod are already installed, so after uploading you can start the
server right away.

MSG
	exit 1
fi

# ------------------------------------------------------------------- wine prefix
# Build the prefix now instead of on the first start: the install image is the same
# wine image, so this moves ~1.4 GB of one-time work off the boot path.
export WINEPREFIX="$SERVER_DIR/.wine"
if [[ ! -f "$WINEPREFIX/.sd-prefix-ready" ]]; then
	echo "initialising wine prefix in $WINEPREFIX (one-time step, a few minutes)"
	mkdir -p "$WINEPREFIX"
	WINEDEBUG=-all wineboot -u > /dev/null 2>&1 || true
	WINEDEBUG=-all wineserver -w > /dev/null 2>&1 || true
	touch "$WINEPREFIX/.sd-prefix-ready"
else
	echo "wine prefix already initialised"
fi

echo "setting permissions"
chown -R container:container "$SERVER_DIR" 2> /dev/null || chown -R 1000:1000 "$SERVER_DIR" 2> /dev/null || true

echo "-----------------------------------------"
echo "installed: $(du -sh "$SERVER_DIR" 2> /dev/null | cut -f1) in $SERVER_DIR"
ls -1 "$SERVER_DIR" | head -12
echo "start the server from the panel; it binds its UDP port in under a minute"
echo "-----------------------------------------"
