# Screw Drivers dedicated server on Linux (Docker + Pterodactyl + admin API)

Runs the game's own dedicated server 24/7 on a Linux box, in Docker, optionally as a
Pterodactyl egg. Ships the **ModTheIsland** BepInEx plugin (crash/DoS/exploit guards,
bans) with an HTTP admin API, so the server can be run and moderated without joining it.

## What the game actually ships

Everything below comes from the installed game (AppID `1279510`, v1.2.12) and its
assemblies, not from guesswork:

| Fact | Evidence |
| --- | --- |
| Server binary ships inside the paid game depot | `Dedicated Server/Screw Drivers Server.exe` inside `steamapps/common/Screw Drivers`, 2.7 GB |
| Windows only | `store.steampowered.com/api/appdetails?appids=1279510` → `platforms.linux=false`, depot `1279511` holds only Windows builds |
| No anonymous download | `steamcmd +login anonymous +app_update 1279510` → `ERROR! Failed to install app '1279510' (No subscription)` |
| No separate dedicated-server AppID | `steamcmd +login anonymous +app_info_print 1279510` lists one depot plus the workshop depot |
| No Steam client needed at runtime | `SteamServerManager.Start()` bails out unless `RegisterAsSteamDedicatedServer` is set in the shipped `NetworkConfiguration` asset, and it is not – the run log has no `SteamAPI.Init`/`LogOnAnonymous` output |
| Runs headless | `-batchmode -nographics` → `Forcing GfxDevice: Null`, `Server started on port: 38000` |
| Players join by IP | `Multiplayer → Direct Connect` (`ConnectToIPAndPort`); the shipped config does not register in the Steam server browser |
| Moddable | Mono runtime + `MonoBleedingEdge`, BepInEx 5.4.23.6 (Doorstop 4) hooks it on Unity `6000.0.73` – verified in the container |

The build is a normal Windows Unity 6 player, so on Linux it runs under Wine – that is
what this repo wraps. Wine only translates the binary; there is no GPU work to do
because the build is compiled with *Dedicated Server Optimizations* (null renderer).

## 1. Get the server files

The runtime never checks a licence, but Valve only hands the files to an account that
owns the game. Two supported ways:

**A – copy from your own installation (fast, 2.7 GB)**
Copy the folder `Steam\steamapps\common\Screw Drivers\Dedicated Server` into the
server's data directory, so that `Screw Drivers Server.exe` sits directly in it:

```
data/
├── Screw Drivers Server.exe
├── Screw Drivers Server_Data/
├── MonoBleedingEdge/
├── UnityPlayer.dll
└── steam_appid.txt
```

Over SFTP (Pterodactyl) or `scp`/`rsync` for plain Docker. `D3D12/` is dead weight
headless (`-nographics` uses the null renderer and nothing maps `D3D12Core.dll`) but it
is only 1 MB, so copying it keeps the folder identical to the Steam install.

**B – SteamCMD with a licensed account (9.3 GB download, 2.7 GB kept)**
The installer / `AUTO_UPDATE=1` does this automatically:

```
steamcmd +force_install_dir /tmp/dl +@sSteamCmdForcePlatformType windows \
         +login <user> <pass> [<steamguard>] +app_update 1279510 validate +quit
# then keep only "/tmp/dl/Screw Drivers/Dedicated Server/*"
```

Steam Guard is only asked for the first login from a new IP; the sentry file stays in
`.steamcmd/`, so later updates need no code.

## 2. Docker

```bash
cp .env.example .env          # optional, all values have defaults
# put the server files into ./data (see above)
docker compose up -d --build
docker compose logs -f
```

Ready when the log shows:

```
[sd] admin api  : http://0.0.0.0:38080 (bearer token 6f2c…)
[ModTheIsland] PacketGuard active (3000 pkt/s burst, 4000000 pkt/h rolling, …
[ModTheIsland] admin API listening on http://0.0.0.0:38080
Server started on port: 38000
Generated random host password: 51e0b15c
```

First start copies a pre-baked Wine prefix into `data/.wine` (~1.4 GB) and drops
BepInEx plus the admin plugin into the volume. Afterwards a restart reaches
`Server started on port` in well under a minute (measured: 24–50 s).

Publish **one UDP port** for the game (default `38000`) and **one TCP port** for the
admin API (default `38080`). Nothing else is bound – the `8766`/`27011` from the
official port-forwarding guide are only used by the client's UPnP/NAT helper and by the
(disabled) Steam server listing.

## 3. Configuration

All variables are read by `start.sh`; see `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SERVER_NAME` | `Screw Drivers Server` | Name shown in the join screen |
| `SERVER_PASSWORD` | *(empty)* | Join password; empty = open server |
| `MAX_PLAYERS` | `8` | 1–32 |
| `SERVER_PORT` | `38000` | Game UDP port, must match the published port |
| `HOST_STEAM_ID` | `0` | SteamID64 that becomes host automatically |
| `ALLOW_FIRST_PLAYER_HOST` | `0` | `1` = first player to connect becomes host |
| `NOBLE_CONNECT` | `0` | `1` = host through the Noble Connect relay instead of direct UDP |
| `EXTRA_ARGS` | *(empty)* | Appended verbatim, e.g. `-ip 0.0.0.0` |
| `ADMIN_ENABLED` | `1` | `0` = run without the admin API plugin |
| `ADMIN_PORT` | `38080` | TCP port of the admin API |
| `ADMIN_BIND` | `0.0.0.0` | `127.0.0.1` keeps the API inside the container |
| `ADMIN_TOKEN` | *(empty)* | Bearer token; empty = generated per boot and printed |
| `AUTO_UPDATE` | `0` | `1` = run SteamCMD before every start (needs credentials) |
| `RESTART_ON_EXIT` | `1` | `0` = exit instead of restarting after a crash |
| `STDIN_COMMANDS` | `1` | Accept `stop`/`shutdown`/`quit` on stdin (Pterodactyl stop) |

Guard, ban and rate-limit knobs live in `data/BepInEx/config/ModTheIsland.cfg` (see
section 5 for the defaults this repo ships).

Complete server command line (from `ServerCommandLineParser` in `Assembly-CSharp`):
`-ip`, `-port`, `-password`, `-servername`, `-maxplayers`, `-nobleconnect`,
`-hostcsteamid`, `-allowfirstplayerhost`, plus Unity's `-batchmode -nographics -logFile`.

## 4. Join and claim the server

1. `Multiplayer → Direct Connect`, enter `your.host:38000`.
2. The server starts with **no host**. Inside the game the first player opens
   *Server Settings* and claims it with the host password. The password is printed on
   boot (`Generated random host password: …`) and stored as `host_password.txt` next to
   the executable.
3. Alternatively pin a host up-front with `HOST_STEAM_ID=<your steamid64>`, let the
   first player win the race with `ALLOW_FIRST_PLAYER_HOST=1`, or set it from the admin
   API once a player is connected (`POST /host`).

The host is the only player who can change name/password/map settings – the admin API
bypasses that, it acts with server authority.

## 5. Admin API (control without joining)

The plugin is **ModTheIsland** (`../mti`): the same mod that hardens the transport,
blocks the DoS/host-takeover exploits and keeps the ban list, now with an HTTP admin API
inside it. `start.sh` installs it from `/opt/bepinex` into the volume on first boot and
updates it when the image changes; it forces `winhttp=n,b` because Wine would otherwise
load its builtin `winhttp` instead of Doorstop's proxy and the plugin would never load.

Auth: `Authorization: Bearer <ADMIN_TOKEN>` (or `?token=`). `GET /health` is open for
Docker/panel health checks. All calls run on Unity's main thread (10 s timeout); errors
are 400 (bad input / no such player), 409 (server not ready, or no host assigned) and
503 (main thread busy). Rejected calls never partially apply.

### Host actions – the same things the in-game host can do

| Request | Body | Effect |
| --- | --- | --- |
| `GET /status` | – | version, name, scene, uptime, port, players, host, race settings, ban counters |
| `GET /players` | – | `[{playerId,name,steamId,endpoint,ping,idleSeconds,isHost,isAdmin,banned}]` |
| `POST /command` | `{"command":"setpassword hunter2"}` | runs one of the game's own host chat commands as the host: `setservername`, `setpassword`, `sethost`, `addcondition`/`removecondition`/`clearconditions`, `setmap`, `setking`, `sethostadmin` |
| `POST /gamestate` | `{"state":"waiting"\|"none"\|"running","challengeUniqueId":?,"laps":?}` | ready-up / start / stop a challenge, like the host menu |
| `GET /islands` | – | island uniqueIds + the current one |
| `POST /island` | `{"uniqueId":-396930304}` | switch island |
| `POST /host` | `{"playerId"\|"steamId"\|"name"}` | make a connected player host |
| `POST /settings` | `{"name","password","maxPlayers"}` | rename / join password / slots |
| `POST /hostsettings` | `{"damagePercentage":50,"maxAcceleration":300,"repairingAllowed":false,"downforceAllowed":true,"mapVoteAtEnd":true,"playMode":1,"amountOfRounds":5}` | the race rules the host sets |
| `POST /kick` | `{"playerId"\|"steamId"\|"name","reason"}` | disconnect one player |
| `POST /kickall` | `{"keepAdmins":true}` | disconnect everyone |
| `POST /stop` / `POST /restart` | `{"delaySeconds":1}` | quit + stay down / quit + relaunch |

Host-gated actions replay the game's own host message with the current host as the
sender (that is also why ModTheIsland's "server control" guard lets them through), so
they need a host: `/host` first, or start the server with `HOST_STEAM_ID` /
`ALLOW_FIRST_PLAYER_HOST=1`. Without one they answer `409 no host assigned`.

### Chat – read it and talk in it

| Request | Body | Effect |
| --- | --- | --- |
| `GET /chat?since=<seq>&limit=200` | – | rolling feed (last 1000 lines): `kind` = `player`, `command`, `server`, `admin` |
| `POST /say` | `{"message":"restarting in 5 minutes"}` | broadcast as the server |
| `POST /dm` | `{"playerId"\|"name","message"}` | whisper one player |

Poll with the last `seq` you saw (`/chat?since=137`) – the API keeps no per-client state,
so a web UI can tail the conversation with one cheap request.

### Bans

| Request | Body | Effect |
| --- | --- | --- |
| `GET /bans` | – | every ban: scope, target, state, reason, expiry, strikes in window |
| `POST /bans` | `{"scope":"steam"\|"ip"\|"endpoint","target":"…","minutes":60,"reason":"…"}` | add a ban (`minutes` 0 = permanent) |
| `DELETE /bans` | `{"scope","target"}` | remove a ban |

- `steam` – permanent SteamID64 ban.
- `ip` – permanent whole-IP ban (manual only; automatic bans never use it).
- `endpoint` – `ip:port` ban with a **rolling window** (default 60 min): it is released
  one window after the *last* offence, and every new offence inside the window extends
  it. A shared NAT address therefore cannot be locked out forever by one abuser, while
  an endpoint that keeps misbehaving stays banned as long as it keeps misbehaving.
- Automatic bans (exploit strikes, packet/connect floods) = permanent SteamID + rolling
  endpoint ban. They trigger at `ExploitGuard/AutoBanThreshold` strikes inside the
  window (default 10).
- Bans persist in `data/BepInEx/config/ModTheIsland.cfg` (`BanList/*`).

Raised guard defaults (all still configurable in the same file):

| Setting | Old | New |
| --- | --- | --- |
| `PacketGuard/MaxConnectsPerMinutePerIP` | 20 | 60 |
| `PacketGuard/MaxSlotsPerIP` | 8 | 16 |
| `PacketGuard/MaxPacketsPerSecond` | 1500 | 3000 |
| `PacketGuard/MaxPacketsPerHourPerEndpoint` | 1.5 M | 4 M |
| `PacketGuard/MaxBytesPerHourPerEndpoint` | 5 GB | 10 GB |
| `ExploitGuard/AutoBanThreshold` | 5 (unbounded counter) | 10 (rolling window) |
| `HostGuard/MaxHostPasswordAttemptsPerMinute` | 5 | 10 |

```bash
T="Authorization: Bearer $ADMIN_TOKEN"; U=http://my.host:38080
curl -s -H "$T" $U/status
curl -s -H "$T" "$U/chat?since=0"
curl -s -H "$T" -X POST -d '{"message":"admin here"}' $U/say
curl -s -H "$T" -X POST -d '{"name":"griefer","reason":"griefing"}' $U/kick
curl -s -H "$T" -X POST -d '{"scope":"steam","target":"7656119…","reason":"ban evasion"}' $U/bans
curl -s -H "$T" -X POST -d '{"scope":"endpoint","target":"203.0.113.7:40000","minutes":60}' $U/bans
curl -s -H "$T" -X POST -d '{"command":"setpassword hunter2"}' $U/command
curl -s -H "$T" -X POST -d '{"state":"waiting"}' $U/gamestate
```

Notes:

- `/stop` writes `.sd-stop`; the launcher sees it after the game exits and exits instead
  of restarting. With `restart: on-failure` the container stays down.
- `/gamestate` reads the current race settings first and only overrides the fields you
  send, so it never resets the server name/password/slots by accident.
- Verified against the real server (Wine-free Windows run with a synthetic connected
  player as host): status/players/chat/say/dm, settings, hostsettings, kick, kickall,
  `command` (`setservername`, `setpassword`, `addcondition`), `gamestate` (waiting/none),
  island switch (server moved from island A to B), ban add/list/delete with the rolling
  expiry, ban persistence across a restart, and `/stop`.

### Web console

The plugin serves a small admin console itself – same port as the API, no extra
container or static host:

```
http://<host>:38080/          → console; paste the bearer token once (kept in localStorage)
```

- Header: server name/version, players x/max, UDP port, uptime, current host, plus
  Restart and Stop (with confirm).
- Players: name, SteamID, endpoint (ip:port), ping, idle, host/admin/banned badges, and
  per-row DM · Host · Ban · Kick.
- Chat: live feed (`player`/`command`/`server`/`admin`) and a box to talk as the server.
- Server: name/password/max players, race rules (damage %, acceleration, play mode,
  rounds, downforce/repair/map-vote), island switch, ready-up / cancel, and a host
  console for `setpassword`, `addcondition`, … .
- Bans: list with scope/state/expiry/strikes + inline unban, and a form to add
  `steam`/`ip`/`endpoint` bans with a duration.

It polls `/status`, `/players`, `/bans`, `/islands` and `/chat?since=` every 4 s. The
assets are embedded in `ModTheIsland.dll` (`Admin/Web/*`), responses carry
`Access-Control-Allow-Origin: *`, so a nicer front end can later be hosted anywhere
against the same API.

Auth is the bearer token only – there are no users or sessions yet. If you expose the
port publicly, put it behind a reverse proxy that terminates TLS and adds its own login.

## 6. Panel: one UI for many servers

`panel/` is a small Next.js app that manages every server from one place — the
Pterodactyl-style view you asked for: cards for all servers, per-server players, live
chat, settings, bans, host console and lifecycle buttons.

- Auth: **Clerk**, with **Discord** as the social connection (hosted free tier is
  enough). Allowlist by email or Clerk user id; empty = any signed-in user; admins come
  from `PANEL_ADMIN_EMAILS`/`PANEL_ADMIN_USER_IDS`.
- **`/admin` page**: add/edit/remove servers with a *Test connection* button, and maintain
  the allowlist — no JSON editing. Panel-added servers live in `data/panel.json`; the
  `PANEL_SERVERS`/`servers.json` entries stay read-only next to them.
- Public hosting: `setup.md` walks through it — the panel publishes on loopback only,
  **nginx on the host** (with its other sites) fronts it, and Cloudflare terminates public
  TLS. `panel/setup.sh --host panel.example.com` does the panel half in one command.
- Server tokens never reach the browser: every call goes
  `browser → /api/s/<id>/<endpoint> → that server's admin API (token added server-side)`,
  and only an allowlist of endpoints is proxied.
- Server list comes from `panel/servers.json` (or `PANEL_SERVERS` inline JSON).
- `PANEL_DEV_AUTH=1` fakes a signed-in `dev` user so the panel can be developed and
  smoke-tested without OAuth.

```bash
cd panel && ./setup.sh --host panel.example.com   # production: build, start, nginx conf
# or for local work:
bun install && PANEL_DEV_AUTH=1 bun run dev        # http://localhost:3000
```

Setup details (Clerk dashboard: enable Discord, copy keys, restrict strategies) and the
verified behaviour are in `panel/README.md`.

## 7. Several servers on one node

Yes, if the node has the resources. Measured on one instance with zero players:

| Resource | Per instance |
| --- | --- |
| RAM | 3.2 GiB RSS while an island loads, 4.1 GiB once idle (`Application.targetFrameRate = 60`, the sim keeps ticking) |
| CPU | ~1.2 cores sustained |
| Disk | 2.7 GB game files + 1.4 GB wine prefix (+ small logs/saveables) |
| Ports | 1 UDP (game) + 1 TCP (admin) |

So a 16 GB / 4-core node runs two instances comfortably, three is tight, and below that
it is not worth it. Measured on this 7.3 GB node: two containers ran side by side
(`38000`/`38080` and `38010`/`38081` both listening, `/status` reporting "Screw Drivers
#1" and "Screw Drivers #2") at 3.2 GiB each – but with 6.5 GiB of 7.3 GiB used the
main thread already stalled enough to time out an API call. Three instances on the same
VM ran out of memory and one process died on a Unity breakpoint: the machine, not the
game, was the limit. Rule of thumb: 6 GB free RAM per instance.

`docker-compose.multi.yml` shows two independent servers: separate volumes, ports and
tokens, nothing shared, so one can be updated or stopped without touching the other:

```bash
docker compose -f docker-compose.multi.yml up -d
# disk trick: share the big read-only asset files via hardlinks instead of copying
cp -al data1/. data2/
rm -rf data2/.wine data2/saveables.dat* data2/host_password.txt data2/.sd-stop
```

Per instance you must change `SERVER_PORT`, `ADMIN_PORT`, the port mappings and
`ADMIN_TOKEN`. Each instance keeps its own wine prefix (`.wine`) – sharing one between
two running servers is not safe.

## 8. Pterodactyl

1. *Admin → Nests → Import Egg* → `pterodactyl/egg-screw-drivers-server.json`.
2. Create a server from the egg. The default image is
   `ghcr.io/parkervcp/yolks:wine_10` (a standard yolk, no custom image to publish).
3. During install either
   - fill `Steam Username` / `Steam Password` (account must own Screw Drivers) and run
     the installer, or
   - upload the `Dedicated Server` folder contents through the file manager / SFTP
     first, then run the installer.

   The installer keeps the game files, installs BepInEx + the admin plugin (embedded in
   the egg as base64, so it needs no extra hosting) and pre-builds the wine prefix.
4. Allocate **two** ports. The **first (primary) allocation is the game port** — wings
   passes it to the container as `SERVER_PORT`, which `start.sh` uses, so there is no
   "server port" variable to fill in (Pterodactyl reserves that name and an egg defining
   it fails to import with *"The selected env variable is invalid."*). Set the second
   allocation's port in **`Admin Port`** (TCP, the admin API).
5. Start. The console shows the same `[sd]` lines as in Docker and prints the admin
   token; the panel's stop button sends `stop`, which the runner turns into a clean
   SIGTERM.

The egg's `start` command is `./start.sh` – the installer writes that script (the same
file as `start.sh` in this repo) into the server volume, so runtime behaviour is
identical to the Docker image. Ready-detection regex: `Generated random host password`.

## 9. Updating

The client must run the same version as the server. Update by replacing the files:

```bash
docker compose down
rsync -a --delete "<Steam>/steamapps/common/Screw Drivers/Dedicated Server/" data/ \
     --exclude .wine --exclude BepInEx --exclude winhttp.dll --exclude doorstop_config.ini
docker compose up -d
```

Keep `data/.wine`, `data/BepInEx`, `host_password.txt` and `saveables.dat` if you care
about the current session state. Or set `AUTO_UPDATE=1` with Steam credentials and let
the container pull the depot on every boot.

Mod updates: rebuild the plugin (`dotnet build -c Release ../mti`), copy
`ModTheIsland.dll` into `dist/`, then `docker compose up -d --build`; on boot `start.sh`
compares `BepInEx/.sd-version` and each plugin DLL and replaces them when they differ
(the old separate `ScrewDriversAdmin.dll` is removed automatically).

## 10. Limits worth knowing

- No RCON and no server console in the shipped build (it never reads `Console.ReadLine`)
  – the admin API above is the control surface; `stop` on stdin still works as a
  fallback.
- Not listed in the Steam server browser with the shipped config, so direct connect is
  the join path; enable `NOBLE_CONNECT=1` only if you cannot forward the UDP port.
- Crash loop protection: 5 s → 10 s → … → 60 s backoff, reset after 5 minutes of uptime.
- The dedicated server build is compiled with *Dedicated Server Optimizations*: shaders
  are stripped, so expect `ArgumentNullException: … Parameter name: shader` noise from
  Crest/water scripts in the log – harmless, the server runs fine.
- Disk: 2.7 GB game files + 1.4 GB wine prefix. Cold start ~80 s, warm restart ~25–50 s,
  Docker stop grace period of 30 s is enough to reach `[sd] stopped`.

## 11. Layout

```
Dockerfile                      wine_10 base, baked prefix, BepInEx 5.4.23.6 + plugin
start.sh                        env → CLI args, mod install, run loop, SIGTERM, .sd-stop
panel/                          Next.js multi-server panel (Clerk + Discord, per-server BFF)
panel/setup.sh                  one-command panel setup (env, build, up, health, nginx conf)
setup.md                        full deployment guide (nginx + Cloudflare + Clerk)
docker-compose.yml              single server
docker-compose.multi.yml        two independent servers on one node
.env.example                    every knob
dist/ModTheIsland.dll           plugin build output (built from ../mti), used by image + egg
install-egg.sh                  Pterodactyl install script (steamcmd/upload + BepInEx)
tools/build_egg.py              embeds start.sh + install script + plugin into the egg
pterodactyl/egg-screw-drivers-server.json   generated egg (do not edit by hand)

../mti/ModTheIsland.cs           the mod: guards, bans, admin API wiring
../mti/Admin/                    admin API (HTTP, JSON, chat log, ban store, game actions)
../mti/tests/BanWindowTests      rolling-window ban tests (dotnet run)
../mti/tests/FakePlayerProbe     dev-only probe that fakes a connected host for testing
```

Build the plugin (needs the .NET 8 SDK, a game install for the reference assemblies and
BepInEx core for `0Harmony.dll`/`BepInEx.dll`):

```bash
cd ../mti
dotnet build -c Release -p:BepInExCoreDir="<game>/BepInEx/core"
dotnet run --project tests/BanWindowTests        # rolling-window ban tests
cp bin/Release/net48/ModTheIsland.dll ../sd-server/dist/
cd ../sd-server && python3 tools/build_egg.py    # after touching start.sh, install-egg.sh or the plugin
```
