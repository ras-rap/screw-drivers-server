#!/usr/bin/env python3
"""Generate the Pterodactyl egg for the Screw Drivers dedicated server.

start.sh and install-egg.sh are the single source of truth; this script embeds
them into pterodactyl/egg-screw-drivers-server.json so the two cannot drift.

    python3 tools/build_egg.py
"""
from __future__ import annotations

import base64
import json
import pathlib
import re
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "pterodactyl" / "egg-screw-drivers-server.json"
PLUGIN = ROOT / "dist" / "ModTheIsland.dll"

MARKER = "__WRITE_START_SH__"

# Pterodactyl\Models\EggVariable::$validationRules — an egg with any of these fails to
# import with "The selected env variable is invalid." These names are injected by
# wings/the daemon, so they are not egg variables.
RESERVED_ENV_NAMES = {
    "SERVER_MEMORY",
    "SERVER_IP",
    "SERVER_PORT",
    "ENV",
    "HOME",
    "USER",
    "STARTUP",
    "SERVER_UUID",
    "UUID",
}
PLUGIN_MARKER = "__WRITE_PLUGIN_DLL__"
HEREDOC = "SD_START_EOF"


def read_script(name: str) -> str:
    text = (ROOT / name).read_text(encoding="utf-8")
    if "\r" in text:
        raise SystemExit(f"{name} contains CRLF line endings; the shebang would break")
    return text


START_SH = read_script("start.sh")
INSTALL_SH = read_script("install-egg.sh")


def install_script() -> str:
    if START_SH.count(HEREDOC):
        raise SystemExit(f"start.sh must not contain {HEREDOC}")
    writer = (
        f"cat > \"$SERVER_DIR/start.sh\" <<'{HEREDOC}'\n"
        f"{START_SH}"
        f"{'' if START_SH.endswith(chr(10)) else chr(10)}"
        f"{HEREDOC}\n"
        "chmod +x \"$SERVER_DIR/start.sh\"\n"
    )
    if MARKER not in INSTALL_SH:
        raise SystemExit(f"install-egg.sh lost its {MARKER} marker")
    if PLUGIN_MARKER not in INSTALL_SH:
        raise SystemExit(f"install-egg.sh lost its {PLUGIN_MARKER} marker")
    if not PLUGIN.is_file():
        raise SystemExit(f"missing {PLUGIN}; build ../mti first (see README)")

    payload = base64.encodebytes(PLUGIN.read_bytes()).decode("ascii")
    plugin_writer = (
        "base64 -d > \"$SERVER_DIR/BepInEx/plugins/ModTheIsland.dll\" <<'SD_PLUGIN_EOF'\n"
        f"{payload}"
        "SD_PLUGIN_EOF\n"
        "chmod 0644 \"$SERVER_DIR/BepInEx/plugins/ModTheIsland.dll\"\n"
    )
    script = INSTALL_SH.replace(MARKER, writer)
    return script.replace(PLUGIN_MARKER, plugin_writer)


def var(name, description, env, default, rules, editable=True):
    return {
        "name": name,
        "description": description,
        "env_variable": env,
        "default_value": default,
        "user_viewable": True,
        "user_editable": editable,
        "rules": rules,
        "field_type": "text",
    }


def secret(name, description, env, rules):
    return {
        "name": name,
        "description": description,
        "env_variable": env,
        "default_value": "",
        "user_viewable": False,
        "user_editable": True,
        "rules": rules,
        "field_type": "text",
    }


EGG = {
    "_comment": "Screw Drivers dedicated server (Windows build) under Wine. "
    "Game files come from Steam AppID 1279510, which requires a licensed account.",
    "meta": {"version": "PTDL_v2", "update_url": None},
    "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    "name": "Screw Drivers",
    "author": "local@localhost",
    "description": (
        "Dedicated server for Screw Drivers (Creactstudios). Ships only as a Windows "
        "build inside the paid depot 1279510, so it runs under Wine in this container. "
        "The server needs no Steam client at runtime: players connect by IP:PORT "
        "(Multiplayer -> Direct Connect) or via Noble Connect when enabled. "
        "The first player to join can be made host, or the server is claimed in-game "
        "with the host password printed on boot. "
        "The bundled ModTheIsland plugin (crash/DoS/exploit guards, bans) exposes an HTTP "
        "admin API and a web console at http://<node>:<admin port>/ - status, players, live "
        "chat, kick/ban, server and race settings, island switch, host commands, "
        "stop/restart - so the server can be managed without joining it. Allocate one UDP "
        "(game) and one TCP (admin) port."
    ),
    "features": None,
    "docker_images": {"Wine 10 (Debian 13)": "ghcr.io/parkervcp/yolks:wine_10"},
    "file_denylist": [],
    "startup": "./start.sh",
    "config": {
        "files": "{}",
        "startup": json.dumps({"done": "Generated random host password"}),
        "logs": "{}",
        "stop": "stop",
    },
    "scripts": {
        "installation": {
            "script": install_script(),
            "container": "ghcr.io/parkervcp/yolks:wine_10",
            "entrypoint": "bash",
        }
    },
    "variables": [
        var(
            "Server Name",
            "Shown in the in-game server list and join screen. Spaces are fine.",
            "SERVER_NAME",
            "Screw Drivers Server",
            "required|string|max:64",
        ),
        var(
            "Server Password",
            "Password players must enter to join. Leave empty for an open server.",
            "SERVER_PASSWORD",
            "",
            "nullable|string|max:64",
        ),
        var(
            "Max Players",
            "Maximum number of connected players.",
            "MAX_PLAYERS",
            "8",
            "required|integer|between:1,32",
        ),
        var(
            "Host Steam ID",
            "SteamID64 that becomes host automatically. 0 = no automatic host.",
            "HOST_STEAM_ID",
            "0",
            "required|string|max:20",
        ),
        var(
            "Allow First Player Host",
            "1 = whoever connects first becomes host. Ignored when Host Steam ID is set.",
            "ALLOW_FIRST_PLAYER_HOST",
            "0",
            "required|in:0,1",
        ),
        var(
            "Noble Connect",
            "1 = host through the Noble Connect relay instead of direct UDP (use when you cannot forward the port).",
            "NOBLE_CONNECT",
            "0",
            "required|in:0,1",
        ),
        var(
            "Extra Arguments",
            "Appended verbatim to the server command line, e.g. -ip 0.0.0.0",
            "EXTRA_ARGS",
            "",
            "nullable|string|max:256",
        ),
        var(
            "Auto Update",
            "1 = run steamcmd before every start. Requires the Steam credentials below and ~10 GB free space.",
            "AUTO_UPDATE",
            "0",
            "required|in:0,1",
        ),
        var(
            "Admin API",
            "1 = enable the bundled HTTP admin API (BepInEx mod).",
            "ADMIN_ENABLED",
            "1",
            "required|in:0,1",
        ),
        var(
            "Admin Port",
            "TCP port of the admin API. Allocate it and set it here.",
            "ADMIN_PORT",
            "38080",
            "required|integer|between:1024,65535",
        ),
        var(
            "Admin Bind Address",
            "0.0.0.0 to reach it from outside the container, 127.0.0.1 to keep it internal.",
            "ADMIN_BIND",
            "0.0.0.0",
            "required|string|max:45",
        ),
        secret(
            "Admin Token",
            "Bearer token for the admin API. Empty generates a random one per boot, printed in the console.",
            "ADMIN_TOKEN",
            "nullable|string|max:128",
        ),
        secret(
            "Steam Username",
            "Account that owns Screw Drivers. Used by the installer and by auto update.",
            "STEAM_USERNAME",
            "nullable|string|max:64",
        ),
        secret(
            "Steam Password",
            "Password of that account.",
            "STEAM_PASSWORD",
            "nullable|string|max:128",
        ),
        secret(
            "Steam Guard Code",
            "Only for the first steamcmd login from a new IP. Clear it afterwards.",
            "STEAM_GUARD_CODE",
            "nullable|string|max:16",
        ),
    ],
}

ENV_RULE = re.compile(r"^[\w]{1,191}$")
for variable in EGG["variables"]:
    name = variable["env_variable"]
    if not ENV_RULE.match(name):
        raise SystemExit(f"env_variable {name!r} does not match Pterodactyl's ^[\\w]{{1,191}}$ rule")
    if name in RESERVED_ENV_NAMES:
        raise SystemExit(
            f"env_variable {name!r} is reserved by Pterodactyl (wings supplies it); "
            "the egg would fail to import with \"The selected env variable is invalid.\""
        )

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", encoding="utf-8", newline="\n") as handle:
    handle.write(json.dumps(EGG, indent=2) + "\n")
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
