#!/bin/bash
# Screw Drivers dedicated server launcher (Windows build under Wine).
# Env-driven, crash-loop safe, SIGTERM aware. Same file is used by the Docker
# image (copied to /usr/local/bin) and by the Pterodactyl egg (installed into
# the server volume as ./start.sh), so keep it self-contained.
set -uo pipefail

APP_ID="${APP_ID:-1279510}"
EXE_NAME="Screw Drivers Server.exe"

log() { printf '[sd] %s\n' "$*"; }

# ---------------------------------------------------------------- environment
SERVER_DIR="${SERVER_DIR:-/home/container}"
if [[ ! -f "$SERVER_DIR/$EXE_NAME" && -f "$PWD/$EXE_NAME" ]]; then
	SERVER_DIR="$PWD"
fi
cd "$SERVER_DIR" || { log "cannot cd to $SERVER_DIR"; exit 1; }

SERVER_NAME="${SERVER_NAME:-Screw Drivers Server}"
SERVER_PASSWORD="${SERVER_PASSWORD:-}"
MAX_PLAYERS="${MAX_PLAYERS:-8}"
SERVER_PORT="${SERVER_PORT:-38000}"
HOST_STEAM_ID="${HOST_STEAM_ID:-0}"
ALLOW_FIRST_PLAYER_HOST="${ALLOW_FIRST_PLAYER_HOST:-0}"
NOBLE_CONNECT="${NOBLE_CONNECT:-0}"
EXTRA_ARGS="${EXTRA_ARGS:-}"
RESTART_ON_EXIT="${RESTART_ON_EXIT:-1}"

# Admin API (BepInEx mod). SD_ADMIN_* is what the plugin reads; ADMIN_* are aliases.
: "${SD_ADMIN_ENABLED:=${ADMIN_ENABLED:-1}}"
: "${SD_ADMIN_PORT:=${ADMIN_PORT:-38080}}"
: "${SD_ADMIN_BIND:=${ADMIN_BIND:-0.0.0.0}}"
: "${SD_ADMIN_TOKEN:=${ADMIN_TOKEN:-}}"
BEPINEX_SRC="${BEPINEX_SRC:-/opt/bepinex}"

export WINEPREFIX="${WINEPREFIX:-$SERVER_DIR/.wine}"
export WINEDEBUG="${WINEDEBUG:--all}"
export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-mscoree,mshtml=,winemenubuilder.exe=d}"
# Doorstop (BepInEx) hooks the game through its winhttp.dll proxy. Wine prefers its
# builtin winhttp, so the native copy next to the exe must be forced.
case "$WINEDLLOVERRIDES" in
	*winhttp=*) ;;
	*) export WINEDLLOVERRIDES="winhttp=n,b;${WINEDLLOVERRIDES}" ;;
esac

# The server splits arguments on whitespace, so spaces inside a value are
# encoded as [<SPACE>] (see ServerCommandLineParser in Assembly-CSharp).
encode_spaces() { printf '%s' "${1// /[<SPACE>]}"; }

build_args() {
	ARGS=(-batchmode -nographics -servername "$(encode_spaces "$SERVER_NAME")")
	[[ -n "$SERVER_PASSWORD" ]] && ARGS+=(-password "$(encode_spaces "$SERVER_PASSWORD")")
	ARGS+=(-port "$SERVER_PORT" -maxplayers "$MAX_PLAYERS" -logFile -)
	if [[ -n "$HOST_STEAM_ID" && "$HOST_STEAM_ID" != "0" ]]; then
		ARGS+=(-hostcsteamid "$HOST_STEAM_ID")
	elif [[ "$ALLOW_FIRST_PLAYER_HOST" == "1" ]]; then
		ARGS+=(-allowfirstplayerhost true)
	fi
	if [[ "$NOBLE_CONNECT" == "1" ]]; then
		ARGS+=(-nobleconnect true)
	else
		ARGS+=(-nobleconnect false)
	fi
	# shellcheck disable=SC2206 # deliberate word splitting for user supplied args
	[[ -n "$EXTRA_ARGS" ]] && ARGS+=($EXTRA_ARGS)
}

# ------------------------------------------------------------------ preflight
if [[ ! -f "$SERVER_DIR/$EXE_NAME" ]]; then
	log "fatal: '$EXE_NAME' not found in $SERVER_DIR"
	log "put the game's 'Dedicated Server' folder contents into $SERVER_DIR"
	# Docker's restart policy would otherwise spin on this, so back off a bit.
	sleep "${FAIL_SLEEP:-30}"
	exit 1
fi
command -v wine > /dev/null || { log "fatal: wine not found in PATH"; sleep "${FAIL_SLEEP:-30}"; exit 1; }

# Display: the server runs with -nographics, but Wine is happier with an X
# server present. Start Xvfb locally if nobody provides a display.
if command -v Xvfb > /dev/null; then
	display="${DISPLAY:-:0}"
	display_number="${display#:}"
	display_number="${display_number%%.*}"
	if [[ ! -S "/tmp/.X11-unix/X${display_number}" ]]; then
		Xvfb "$display" -screen 0 "${DISPLAY_WIDTH:-1024}x${DISPLAY_HEIGHT:-768}x${DISPLAY_DEPTH:-16}" > /dev/null 2>&1 &
		export DISPLAY="$display"
		for _ in $(seq 1 50); do
			[[ -S "/tmp/.X11-unix/X${display_number}" ]] && break
			sleep 0.1
		done
	fi
fi

# ------------------------------------------------------------- optional update
update_server() {
	local steamcmd="$SERVER_DIR/.steamcmd/steamcmd.sh"
	if [[ ! -x "$steamcmd" ]]; then
		log "AUTO_UPDATE=1 but $steamcmd is missing, skipping update"
		return 0
	fi
	local download="$SERVER_DIR/.download"
	mkdir -p "$download"
	local auth=("$STEAM_USERNAME" "$STEAM_PASSWORD")
	[[ -n "${STEAM_GUARD_CODE:-}" ]] && auth+=("$STEAM_GUARD_CODE")
	log "updating via steamcmd (downloads the full ~9.3 GB client depot, then keeps only Dedicated Server)"
	(
		cd "$SERVER_DIR/.steamcmd" || exit 1
		HOME="$SERVER_DIR" "$steamcmd" +force_install_dir "$download" \
			+@sSteamCmdForcePlatformType windows +login "${auth[@]}" \
			+app_update "$APP_ID" validate +quit
	)
	if [[ -d "$download/Screw Drivers/Dedicated Server" ]]; then
		cp -a "$download/Screw Drivers/Dedicated Server/." "$SERVER_DIR/" && rm -rf "$download"
		log "update applied"
	else
		log "update did not produce a Dedicated Server folder, keeping current files"
	fi
}

if [[ "${AUTO_UPDATE:-0}" == "1" ]]; then
	if [[ -n "${STEAM_USERNAME:-}" ]]; then
		update_server
	else
		log "AUTO_UPDATE=1 but STEAM_USERNAME is unset (this AppID needs a licensed account), skipping update"
	fi
fi

# --------------------------------------------------------------- wine prefix
if [[ ! -f "$WINEPREFIX/.sd-prefix-ready" ]]; then
	if [[ -d /opt/wineprefix && ! -d "$WINEPREFIX" ]]; then
		log "installing pre-baked wine prefix into $WINEPREFIX"
		cp -a /opt/wineprefix "$WINEPREFIX" || true
		wineserver -w > /dev/null 2>&1 || true
	else
		log "initialising wine prefix at $WINEPREFIX (first start only, this takes a minute)"
		mkdir -p "$WINEPREFIX"
		wineboot -u > /dev/null 2>&1 || true
		wineserver -w > /dev/null 2>&1 || true
	fi
	touch "$WINEPREFIX/.sd-prefix-ready"
fi

# ------------------------------------------------------- admin api (BepInEx)
install_mod() {
	[[ -d "$BEPINEX_SRC" ]] || return 0
	local wanted=""
	[[ -f "$BEPINEX_SRC/.version" ]] && wanted="$(cat "$BEPINEX_SRC/.version")"
	local installed=""
	[[ -f "$SERVER_DIR/BepInEx/.sd-version" ]] && installed="$(cat "$SERVER_DIR/BepInEx/.sd-version")"

	if [[ ! -f "$SERVER_DIR/winhttp.dll" || ! -f "$SERVER_DIR/BepInEx/core/BepInEx.dll" || "$wanted" != "$installed" ]]; then
		log "installing BepInEx ${wanted:-unknown} into the server folder"
		cp -a "$BEPINEX_SRC/." "$SERVER_DIR/" || log "warning: could not copy BepInEx"
		[[ -n "$wanted" ]] && echo "$wanted" > "$SERVER_DIR/BepInEx/.sd-version"
	fi

	mkdir -p "$SERVER_DIR/BepInEx/plugins"
	# The admin API used to ship as its own plugin; it lives in ModTheIsland now.
	rm -f "$SERVER_DIR/BepInEx/plugins/ScrewDriversAdmin.dll"
	local plugin dest
	for plugin in "$BEPINEX_SRC"/plugins/*.dll; do
		[[ -f "$plugin" ]] || continue
		dest="$SERVER_DIR/BepInEx/plugins/$(basename "$plugin")"
		if [[ ! -f "$dest" ]]; then
			cp -a "$plugin" "$dest" || log "warning: could not install $(basename "$plugin")"
		elif ! cmp -s "$plugin" "$dest"; then
			log "updating $(basename "$plugin") in the server folder"
			cp -a "$plugin" "$dest" || log "warning: could not update $(basename "$plugin")"
		fi
	done
}

if [[ "$SD_ADMIN_ENABLED" == "1" ]]; then
	install_mod
	if [[ -z "$SD_ADMIN_TOKEN" ]]; then
		SD_ADMIN_TOKEN="$(head -c 16 /dev/urandom 2> /dev/null | od -An -tx1 | tr -d ' \n')"
		[[ -n "$SD_ADMIN_TOKEN" ]] && log "no ADMIN_TOKEN set, generated one for this run"
	fi
else
	log "admin API disabled"
fi
export SD_ADMIN_ENABLED SD_ADMIN_PORT SD_ADMIN_BIND SD_ADMIN_TOKEN

# ------------------------------------------------------------------ run loop
build_args
log "server dir : $SERVER_DIR"
log "port/udp   : $SERVER_PORT"
log "name       : $SERVER_NAME"
log "max players: $MAX_PLAYERS"
log "password   : $([[ -n "$SERVER_PASSWORD" ]] && echo set || echo none)"
log "host       : $([[ -n "$HOST_STEAM_ID" && "$HOST_STEAM_ID" != 0 ]] && echo "steamid $HOST_STEAM_ID" || { [[ "$ALLOW_FIRST_PLAYER_HOST" == 1 ]] && echo "first player to join" || echo "claim with host_password.txt in-game"; })"
log "extra args : ${EXTRA_ARGS:-none}"
if [[ "$SD_ADMIN_ENABLED" == "1" ]]; then
	log "admin api  : http://$SD_ADMIN_BIND:$SD_ADMIN_PORT (bearer token $SD_ADMIN_TOKEN)"
	log "             curl -s -H 'Authorization: Bearer $SD_ADMIN_TOKEN' http://127.0.0.1:$SD_ADMIN_PORT/status"
else
	log "admin api  : disabled"
fi

STOPPING=0
WINE_PID=""

shutdown() {
	[[ "$STOPPING" == "1" ]] && return
	STOPPING=1
	log "shutdown requested"
	if [[ -n "$WINE_PID" ]] && kill -0 "$WINE_PID" 2> /dev/null; then
		kill -TERM "$WINE_PID" 2> /dev/null
		for _ in $(seq 1 40); do
			kill -0 "$WINE_PID" 2> /dev/null || break
			sleep 0.5
		done
		kill -KILL "$WINE_PID" 2> /dev/null
	fi
	wineserver -k > /dev/null 2>&1 || true
	log "stopped"
	exit 0
}

trap shutdown TERM INT

# Pterodactyl sends its stop command on stdin; accept the usual spellings.
# Background subshells get /dev/null as stdin, so hand the real stdin over as fd 3.
if [[ "${STDIN_COMMANDS:-1}" == "1" ]] && exec 3<&0 2> /dev/null; then
	(
		while IFS= read -r line <&3; do
			case "${line,,}" in
				stop | shutdown | quit | exit) log "stop command received"; kill -TERM $$ ;;
			esac
		done
		exec 3<&-
	) &
fi

delay=5
while :; do
	started=$SECONDS
	log "launching wine $EXE_NAME ${ARGS[*]}"
	wine "$EXE_NAME" "${ARGS[@]}" &
	WINE_PID=$!
	wait "$WINE_PID"
	rc=$?
	WINE_PID=""
	wineserver -w > /dev/null 2>&1 || true
	[[ "$STOPPING" == "1" ]] && exit 0

	if [[ -f "$SERVER_DIR/.sd-stop" ]]; then
		rm -f "$SERVER_DIR/.sd-stop"
		log "stop requested through the admin API, not restarting"
		exit 0
	fi

	uptime=$((SECONDS - started))
	if [[ "$RESTART_ON_EXIT" != "1" ]]; then
		log "server exited with code $rc after ${uptime}s (RESTART_ON_EXIT=0), exiting"
		exit "$rc"
	fi
	# Crash loops are throttled, long sessions start over with a short delay.
	[[ $uptime -ge 300 ]] && delay=5
	log "server exited with code $rc after ${uptime}s, restarting in ${delay}s"
	sleep "$delay" &
	wait $!
	delay=$((delay * 2))
	[[ $delay -gt 60 ]] && delay=60
done
