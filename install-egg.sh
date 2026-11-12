#!/bin/bash
# Pterodactyl install script for the Screw Drivers dedicated server.
# Runs in ghcr.io/parkervcp/installers:debian with /mnt/server mounted.
#
# Two ways to get the game files:
#   1. STEAM_USERNAME/STEAM_PASSWORD of an account that owns Screw Drivers
#      (AppID 1279510) -> steamcmd pulls Windows depot and only the
#      "Dedicated Server" folder is kept.
#   2. No credentials -> the files must already be uploaded into the volume
#      (copy the "Dedicated Server" folder from your own installation).
# The marker line below is replaced by tools/build-egg.py with a heredoc that
# writes start.sh into the volume, so the egg stays self-contained.
set -uo pipefail

SERVER_DIR="/mnt/server"
EXE="Screw Drivers Server.exe"
APP_ID="1279510"
BEPINEX_VERSION="5.4.23.6"
STEAMCMD_DIR="$SERVER_DIR/.steamcmd"

echo "-----------------------------------------"
echo "Screw Drivers dedicated server installer"
echo "-----------------------------------------"

mkdir -p "$SERVER_DIR"

have_files() { [[ -f "$SERVER_DIR/$EXE" ]]; }

fetch_steamcmd() {
	mkdir -p "$STEAMCMD_DIR"
	echo "downloading steamcmd"
	curl -fsSL -o /tmp/steamcmd.tar.gz "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" || return 1
	tar -xzf /tmp/steamcmd.tar.gz -C "$STEAMCMD_DIR" || return 1
	mkdir -p "$SERVER_DIR/steamapps"
	chmod +x "$STEAMCMD_DIR/steamcmd.sh"
}

fetch_game_files() {
	local download="$SERVER_DIR/.download"
	local auth=("$STEAM_USERNAME" "$STEAM_PASSWORD")
	[[ -n "${STEAM_GUARD_CODE:-}" ]] && auth+=("$STEAM_GUARD_CODE")

	rm -rf "$download"
	mkdir -p "$download"

	echo "downloading AppID $APP_ID (Windows depot, ~9.3 GB, only 'Dedicated Server' is kept)"
	(
		cd "$STEAMCMD_DIR" || exit 1
		HOME="$SERVER_DIR" ./steamcmd.sh +force_install_dir "$download" \
			+@sSteamCmdForcePlatformType windows +login "${auth[@]}" \
			+app_update "$APP_ID" validate +quit
	) 2>&1 | tee /tmp/steamcmd.log

	if [[ ! -d "$download/Screw Drivers/Dedicated Server" ]]; then
		echo
		echo "steamcmd did not produce 'Screw Drivers/Dedicated Server'."
		grep -qi "no subscription" /tmp/steamcmd.log && echo "The account does not own Screw Drivers (AppID $APP_ID)."
		grep -qi "steam guard" /tmp/steamcmd.log && echo "Steam Guard was requested - set STEAM_GUARD_CODE and reinstall."
		return 1
	fi

	echo "extracting dedicated server"
	cp -a "$download/Screw Drivers/Dedicated Server/." "$SERVER_DIR/" || return 1
	rm -rf "$download"
}

if [[ -n "${STEAM_USERNAME:-}" && -n "${STEAM_PASSWORD:-}" ]]; then
	echo "using steam account: $STEAM_USERNAME"
	fetch_steamcmd || { echo "fatal: could not install steamcmd"; exit 1; }
	fetch_game_files || { echo "fatal: could not download the dedicated server"; exit 1; }
elif have_files; then
	echo "no Steam credentials given, keeping the $EXE already in the volume"
else
	cat << 'MSG'

fatal: no game files and no Steam credentials.

Screw Drivers is a paid game and Valve ships the dedicated server inside the
normal game depot (AppID 1279510), so there is no anonymous download.

Pick one:

  A) Set STEAM_USERNAME / STEAM_PASSWORD (and STEAM_GUARD_CODE for the first
     login) in the startup variables, then run the installer again.
     The account must own Screw Drivers.

  B) Copy the folder "Dedicated Server" from your own installed game
     (Steam\steamapps\common\Screw Drivers\Dedicated Server) into this
     server's file manager / SFTP root, so that
     "Screw Drivers Server.exe" ends up directly in /home/container.
     Then run the installer again.

MSG
	exit 1
fi

__WRITE_START_SH__

# Server mod: BepInEx + ModTheIsland.dll (guards, bans, admin API) so the server can be controlled
# over HTTP without joining it.
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

# Build the wine prefix now instead of on the first server start: the install
# container is the same wine image, so this moves ~1.4 GB of one-time work off
# the boot path.
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
echo "start the server from the panel; it binds its UDP port in under a minute"
echo "-----------------------------------------"
