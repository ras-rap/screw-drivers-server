# Setup

Two things to stand up: **the panel** (public, behind Cloudflare → nginx on your host) and
**the game servers** (private; only the panel talks to them).

```mermaid
flowchart LR
  U["player / admin<br/>browser"] --> CF["Cloudflare<br/>TLS at the edge"]
  CF -->|"HTTPS, Origin Cert"| N["nginx on the host<br/>127.0.0.1:3000 upstream"]
  N --> P["panel container<br/>:3000"]
  P -->|"bearer token, private net"| S1["game server A<br/>:38080 admin"]
  P --> S2["game server B<br/>:38080 admin"]
  G["players"] -->|"UDP 38000"| S1
```

nginx is used because the host already serves other sites; the panel is published on
loopback only and nginx is the public entry point. Cloudflare sits in front of nginx.

---

## 0. Prerequisites

| Thing | Why |
| --- | --- |
| Docker + `docker compose` v2 on the host | runs the panel |
| nginx on the host | public entry point, TLS to Cloudflare |
| a domain on Cloudflare (proxied) | public hostname, e.g. `panel.example.com` |
| a Clerk account (free tier) | Discord sign-in |

```bash
docker --version && docker compose version
nginx -v
```

---

## 1. Clerk with Discord sign-in

1. <https://dashboard.clerk.com> → **Create application**.
2. *User & Authentication → Social connections* → **Discord** → enable. Clerk ships a
   shared Discord OAuth app; paste your own client id/secret only if you want your own
   branding.
3. Optionally disable email/password under *Email, phone, username* so the only button is
   "Continue with Discord".
4. In a **production** instance (Clerk keeps development and production separate):
   *Domains* → add `panel.example.com`.
5. Copy **Publishable key** (`pk_live_…`) and **Secret key** (`sk_live_…`).

The panel targets Clerk **v7 (Core 3)**; Clerk blocks older SDKs with an "outdated version of
Clerk" screen, so keep `@clerk/nextjs` on `latest` when you touch the panel.

You will sign in with Discord using the account whose email you put in
`PANEL_ADMIN_EMAILS` — that is what unlocks `/admin`.

---

## 2. Panel: run the setup script

```bash
cd sd-server/panel
./setup.sh --host panel.example.com
```

`setup.sh` is idempotent. It:

1. refuses to run without Docker/compose and a `Dockerfile`;
2. creates `.env` from `.env.example` (chmod 600) if missing — never overwrites yours;
3. writes `PANEL_PORT` (default `3000`) and `PANEL_PUBLIC_URL` into `.env`;
4. **stops** if `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or
   `PANEL_ADMIN_EMAILS`/`PANEL_ADMIN_USER_IDS` are empty (so you cannot end up with a
   panel nobody can administer), and warns when the user allowlist is empty or
   `PANEL_DEV_AUTH=1`;
5. `docker compose build` + `up -d`, publishing `127.0.0.1:3000` only;
6. waits for the panel to answer, then writes `nginx/panel.example.com.conf`.

Options: `--port 3100`, `--no-build`, `--skip-checks`, `--help`.

Fill `.env` (only these matter for a normal deployment):

```ini
PANEL_PUBLIC_URL=https://panel.example.com
CLERK_SECRET_KEY=sk_live_…
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
PANEL_ADMIN_EMAILS=you@example.com      # your Discord account's email in Clerk
PANEL_ALLOWED_EMAILS=                   # empty = any signed-in Clerk user; set to restrict
PANEL_ALLOWED_USER_IDS=
PANEL_DEV_AUTH=0
PANEL_PORT=3000
PANEL_DATA_FILE=/app/data/panel.json    # container path; the volume maps it
```

Then run `./setup.sh --host panel.example.com` again (or just `./setup.sh` — the script
only needs the values the second time around).

---

## 3. nginx on the host

Either let the script write the file for you (it prints the path):

```bash
sudo cp nginx/panel.example.com.conf /etc/nginx/sites-available/panel.example.com
sudo ln -sf /etc/nginx/sites-available/panel.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The template (`panel/nginx/panel.conf.example`) proxies to `127.0.0.1:<PANEL_PORT>`, adds
`X-Forwarded-*`, sets `Cache-Control: no-store` on `/api/`, and trusts Cloudflare's real
IP header (`set_real_ip_from` + `CF-Connecting-IP`) so logs and rate limits see visitors,
not Cloudflare.

Notes:

- If nginx itself runs in Docker, `127.0.0.1` is wrong — publish the panel on the docker
  bridge IP or add both containers to one network and use `http://panel:3000`.
- Keep your existing `server {}` blocks; the panel gets its own file in `sites-enabled`.
- `http2 on;` needs nginx ≥ 1.25.1; on older versions use `listen 443 ssl http2;`.

---

## 4. Cloudflare

1. **DNS**: `A` (and `AAAA` if you have IPv6) `panel` → your host IP, **proxied** (orange).
2. **SSL/TLS → Overview**: mode **Full (strict)**.
3. **SSL/TLS → Origin Server → Create certificate** for `panel.example.com` (15 years,
   free). Save the two files where the nginx config expects them:
   ```
   sudo mkdir -p /etc/ssl/cloudflare
   sudo install -m 600 panel.example.com.key /etc/ssl/cloudflare/panel.example.com.key
   sudo install -m 644 panel.example.com.pem /etc/ssl/cloudflare/panel.example.com.pem
   sudo systemctl reload nginx
   ```
   (Using certbot instead? Point `ssl_certificate*` at
   `/etc/letsencrypt/live/panel.example.com/` and skip the certificate step.)
4. **Rules → Cache Rules**: add a rule `URI Path starts with /api/` → **Bypass cache**.
   The panel polls JSON every few seconds; caching it would show stale data.
5. **SSL/TLS → Edge Certificates**: turn on *Always Use HTTPS* (optional, nginx also
   redirects).
6. Optional hardening:
   - *Security → WAF*: rate-limit `/api/*` (e.g. 60 requests/minute per IP) — the panel is
     polling, so keep it generous.
   - Block direct-to-origin traffic: allow only Cloudflare's ranges on 80/443
     (`https://www.cloudflare.com/ips/`) or enable *Authenticated Origin Pulls*.
   - No public IP on the host? Skip 443 entirely and use a **Cloudflare Tunnel**
     (`cloudflared service install`), pointing the tunnel at `http://127.0.0.1:3000`;
     then neither DNS A record nor open ports are needed.

---

## 5. First login and adding servers

1. Open `https://panel.example.com` → **Continue with Discord**.
2. You land on the overview (empty at first). The header shows an **admin** link because
   your email is in `PANEL_ADMIN_EMAILS`.
3. **admin → Add a server**: name, admin URL, token → **Test connection** (it calls that
   server's `/status`, so a bad token or unreachable host is caught before saving) →
   **Add server**.
4. Do the same for each server. Add a teammate under *Who can use the panel* if needed.

The admin URL is the server's **admin** port, not the game port:

| Where the server runs | Admin URL the panel uses |
| --- | --- |
| same Docker host, same network | `http://<container-name>:38080` |
| another host on a VPN (WireGuard/Tailscale) | `http://<overlay-ip>:38080` |
| another host, no VPN | `http://<ip>:38080`, firewalled to the panel's IP only |

The bearer token is what the server prints at boot
(`[ModTheIsland] admin API on http://0.0.0.0:38080 (bearer token …)`); pin it with
`ADMIN_TOKEN` in that server's environment so it survives restarts.

---

## 6. Game servers

On each game host (see the root `README.md` for the full story):

```bash
# one server
cp .env.example .env      # SERVER_NAME, MAX_PLAYERS, SERVER_PORT, ADMIN_PORT
# put the game's "Dedicated Server" folder into ./data (or let the egg's steamcmd do it)
docker compose up -d

# several on one node
docker compose -f docker-compose.multi.yml up -d
```

Keep the admin port private — the panel is the only client:

```bash
sudo ufw allow from <panel-ip> to any port 38080 proto tcp
sudo ufw delete allow 38080/tcp          # if you opened it earlier
```

Pterodactyl: import `pterodactyl/egg-screw-drivers-server.json`, allocate the UDP game
port **and** the TCP admin port, then add `http://<node-ip>:<admin port>` in the panel.

If an install aborts halfway (or steamcmd parks the depot under
`$HOME/Steam/steamapps/common/Screw Drivers`), just run the installer again: it now finds
the `Dedicated Server` folder wherever it landed, copies it to the volume root and removes
steamcmd's leftover library. `start.sh` and the mod are written before any download, so a
half-finished install still boots and logs what is missing.

Two details that bite:

- the **primary allocation is the game port**: wings injects it as `SERVER_PORT`, so the egg
  has no port variable for it (Pterodactyl *reserves* `SERVER_PORT`, `SERVER_IP`,
  `SERVER_MEMORY`, `STARTUP`, `ENV`, `HOME`, `USER`, `UUID`, `SERVER_UUID` — an egg that
  defines one fails to import with `The selected env variable is invalid`);
- put the **second allocation's** port into the `Admin Port` variable, and set
  `Admin Token` to a fixed value so the panel keeps working across restarts.

---

## 6b. Remote servers and Pterodactyl

The panel does not care where a server runs: it only needs that server's **ModTheIsland
admin API** (`http://<host>:<admin port>`) and its token. Same Docker host, another VPS,
bare metal or a Pterodactyl container are all the same thing to it.

### Pterodactyl-hosted servers

1. In Pterodactyl the egg allocates the admin port, so the admin URL is
   **`http://<node-ip>:<allocated admin port>`** — not `38080` unless that is what the
   allocation happens to be.
2. Set the egg variable **Admin Token** to a fixed value (otherwise the server prints a
   random token per boot and the panel loses track of it on every restart).
3. Let the panel reach that port and nobody else:
   ```bash
   sudo ufw allow from <panel-ip> to any port <allocated admin port> proto tcp
   ```
   Better still: put the node and the panel on a WireGuard/Tailscale overlay and use the
   overlay address as the admin URL.
4. In `/admin`, add it with that URL and the token (or import it, below).

### Pterodactyl API integration (optional)

With an **application** API key the panel can also list the Pterodactyl servers and start
one whose container is stopped — the one thing the admin API cannot do, because a stopped
server has no API to talk to.

```ini
PTERODACTYL_URL=https://ptero.example.com
PTERODACTYL_API_KEY=ptla_…            # Application key, permissions:
                                      # "Servers: read" and "Servers: power"
```

Then in `/admin`:

- **Import from Pterodactyl** lists every server the key can see with its node, state and
  allocations. Pick the allocation that carries the admin API, press **Import** — the
  form is filled with the URL, the name, the node as group and a link to the Pterodactyl
  server; paste the token and save.
- Linked servers show a **Start (Pterodactyl)** button on the overview while they are
  offline (`signal: start` to `/api/application/servers/{id}/power`). While a server runs,
  use the panel's own Restart/Stop — those act on the game process.

What this integration deliberately does **not** do: files, console, reinstall, backups,
schedules or per-user permissions — that is Pterodactyl's own panel. This one is the
game-aware console for the servers you run.

## 7. Day-2 operations

```bash
docker compose -f panel/docker-compose.yml logs -f panel   # panel logs
docker compose -f panel/docker-compose.yml up -d --build   # update after git pull
docker run --rm -v panel_panel-data:/d -v "$PWD":/backup alpine \
  tar czf /backup/panel-data-$(date +%F).tgz -C /d .        # back up the server list
```

| Task | How |
| --- | --- |
| rotate a server's token | change `ADMIN_TOKEN` on the server, restart it, then **/admin → Edit →** paste the new token (blank means "keep") |
| add a second admin | add the email to `PANEL_ADMIN_EMAILS`, `docker compose up -d` (env change) |
| lock the panel to specific people | `PANEL_ALLOWED_EMAILS` in `.env` + restart |
| remove a server | **/admin → Remove** (the game server keeps running) |
| panel data | `panel-data` volume → `/app/data/panel.json` |

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `502` from nginx | panel container down or wrong `PANEL_PORT`/upstream: `docker compose logs panel`, `curl -I 127.0.0.1:3000` |
| Cloudflare `521`/`524` | origin not listening / blocked by firewall; check 443 is reachable from Cloudflare |
| redirect loop on sign-in | Clerk instance mismatch (dev keys on the prod domain) or `NEXT_PUBLIC_CLERK_SIGN_IN_URL` missing |
| sign-in page says *"This app uses an outdated version of Clerk"* | Clerk refuses SDKs below its minimum. Upgrade and rebuild: `cd panel && bun add @clerk/nextjs@latest && ./setup.sh` (the repo pins v7+; this is what that error means) |
| `/admin` says "Admins only" | your signed-in email is not in `PANEL_ADMIN_EMAILS` / `PANEL_ADMIN_USER_IDS` |
| "this account is not allowed to use the panel" | `PANEL_ALLOWED_*` is set and does not include you; fix in `.env` and restart |
| "the server rejected the token (401)" | server's `ADMIN_TOKEN` differs from the one in `/admin → Edit` |
| "cannot reach http://…" | panel cannot route to the admin port (VPN/firewall/docker network) |
| stale data in the panel | Cloudflare caching `/api/*` — add the bypass cache rule |
| anyone can sign in and see servers | `PANEL_ALLOWED_EMAILS` empty by design; set it |

### Security checklist

- [ ] `/admin` reachable only by accounts in `PANEL_ADMIN_EMAILS`/`PANEL_ADMIN_USER_IDS`
- [ ] `PANEL_ALLOWED_*` set if the panel should not be open to any Clerk user
- [ ] `PANEL_DEV_AUTH=0` in the deployed `.env`
- [ ] game servers' admin port (38080) not reachable from the internet
- [ ] Cloudflare SSL mode **Full (strict)** with an Origin Certificate
- [ ] `/api/*` cache bypass rule in Cloudflare
- [ ] `panel-data` volume backed up
