# Screw Drivers — multi-server panel

One place to watch and drive every Screw Drivers dedicated server you run: it talks to
each server's own admin API (the ModTheIsland plugin) and shows them side by side, like a
small Pterodactyl. Sign-in is Clerk with Discord as the social connection.

```
browser ──► panel (Next.js)  ──►  server A  http://10.0.0.11:38080  (bearer token A)
          Clerk session        └─►  server B  http://10.0.0.12:38080  (bearer token B)
```

Server tokens live only in the panel process: the browser never sees them, and every call
goes through a per-server allowlisted proxy.

## What it does

- **Overview**: every server as a card — online dot, players/max, port, uptime, host,
  game version, join password, ban counters, player chips.
- **Per server**:
  - *Players* — table with host/admin/banned badges plus DM · Host · Ban (steam + rolling
    endpoint) · Kick.
  - *Chat* — live feed and a box to talk as the server.
  - *Server* — name, join password, slots; race rules (damage %, acceleration, play mode,
    rounds, downforce/repair/map-vote); island switch by **name**; ready-up / cancel.
  - *Bans* — all scopes with state/expiry/strikes, add and remove.
  - *Mod settings* — every ModTheIsland option (Discord webhook, rate limits, guard
    thresholds) with a filter box; saving one writes the server's `.cfg` and reloads that
    guard immediately (`admin` only; the `AdminApi` section needs a restart).
  - *Console* — runs the game's own host commands (`setpassword`, `addcondition`, …).
  - Restart / Stop buttons in the header.

## Clerk + Discord in five minutes

1. Create an application at <https://dashboard.clerk.com> (free tier is enough).
   The panel uses Clerk **v7** (`@clerk/nextjs`); Clerk blocks older SDK versions with an
   "outdated version of Clerk" screen, so bump with `bun add @clerk/nextjs@latest` if that
   ever appears.
2. **User & Authentication → Social connections → Discord → Enable**. Clerk ships the
   Discord OAuth app; paste your own Discord client id/secret only if you want your own
   branding.
3. Copy **Publishable key** and **Secret key** into the environment:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
   CLERK_SECRET_KEY=sk_test_…
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
   ```
4. Decide who gets in — either leave both empty (any signed-in Clerk user) or set:
   ```
   PANEL_ALLOWED_EMAILS=you@example.com,friend@example.com
   PANEL_ALLOWED_USER_IDS=user_2abc…     # Clerk user ids, useful before they sign in
   ```
5. Add Discord as the only strategy if you want a single button: Clerk dashboard →
   *User & Authentication → Email, phone, username* → disable email/password, keep
   Discord. The built-in `<SignIn />` then shows just "Continue with Discord".

## Admin page

`/admin` is the "little effort" path — no JSON editing needed:

- **Add a server**: name, admin URL, token (+ optional id, group, per-server allowlist),
  with a **Test connection** button that calls that server's `/status` before saving, so a
  wrong token or unreachable host is caught up front (`the server rejected the token (401)`).
- **Edit / remove** rows in place; servers from `PANEL_SERVERS`/`servers.json` show up as
  read-only `env` entries next to the editable `panel` ones.
- **Who can use the panel**: maintain the allowlist (Clerk emails or user ids) from the
  UI. It refuses to save a list that would lock your own account out. Admins themselves
  come from the environment only (`PANEL_ADMIN_EMAILS` / `PANEL_ADMIN_USER_IDS`), so a
  stolen session cannot promote itself.
- Everything lands in `data/panel.json` (atomic writes, invalid file backed up to
  `panel.json.invalid-<ts>`), which is the volume you back up and mount in production.

## Servers

Copy `servers.example.json` to `servers.json` (gitignored) or pass the same JSON in
`PANEL_SERVERS`:

```json
[
  { "id": "eu-1", "name": "EU #1", "url": "http://10.0.0.11:38080", "token": "…", "group": "EU" },
  { "id": "us-1", "name": "US #1", "url": "http://10.0.0.12:38080", "token": "…", "allowed": ["you@example.com"] }
]
```

- `url` is the server's **admin** port (default 38080), not the game port.
- `token` is the bearer token the server prints on boot (`ModTheIsland admin API … bearer
  token …`); set `ADMIN_TOKEN` in that server's env to keep it stable across restarts.
- `allowed` (optional) restricts one server to specific Clerk emails/user ids; omit it to
  follow the panel-wide list.

## Run it

```bash
bun install                 # or: npm ci
cp .env.example .env.local  # fill in Clerk keys, or leave them out for dev mode
cp servers.example.json servers.json

# local, no OAuth:
PANEL_DEV_AUTH=1 bun run dev        # http://localhost:3000

# production:
bun run build && bun run start
```

Docker:

```bash
docker build -t sd-panel .
docker run -d --name sd-panel -p 3000:3000 \
  -e CLERK_SECRET_KEY=… -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=… \
  -e PANEL_ALLOWED_EMAILS=you@example.com \
  -v "$PWD/servers.json:/app/servers.json:ro" sd-panel
```

## Deploying publicly

The panel is the only thing facing the internet; nginx on the host is the public entry
point (so it can keep serving your other sites) and Cloudflare sits in front of nginx.
Full walkthrough with the Cloudflare/Clerk/nginx steps: **`../setup.md`**.

```bash
./setup.sh --host panel.example.com     # creates .env, builds, starts on 127.0.0.1:3000,
                                        # waits for it, writes nginx/panel.example.com.conf
sudo cp nginx/panel.example.com.conf /etc/nginx/sites-available/panel.example.com
sudo ln -sf /etc/nginx/sites-available/panel.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`setup.sh` is idempotent: it never overwrites `.env` (only `PANEL_PORT`/`PANEL_PUBLIC_URL`),
keeps a `--port` you set once, and refuses to start without Clerk keys or an admin — with
`--skip-checks` if you really want to look at a half-configured panel.

The container publishes **loopback only** (`127.0.0.1:${PANEL_PORT}`), so nothing is
reachable except through nginx. Cloudflare: SSL/TLS **Full (strict)** with an Origin
Certificate, and a cache rule that bypasses `/api/*` (the panel polls JSON).

## Layout

```
app/page.tsx                      overview (server cards)
app/server/[id]/page.tsx          per-server view (auth check per server)
app/components/Overview.tsx       cards + polling
app/components/ServerView.tsx     tabs: players / chat / server / bans / console
app/components/usePolling.ts      one polling loop per endpoint
app/api/aggregate/route.ts        status + players of every visible server, one request
app/api/s/[id]/[...path]/route.ts allowlisted proxy to one server (token added here)
app/api/servers/route.ts          what the browser may know (no tokens)
setup.sh                          one-shot setup: .env, build, up, health check, nginx conf
nginx/panel.conf.example          host nginx site (Cloudflare real-IP, TLS, /api no-store)
app/admin/page.tsx                admin page (servers + allowlist editor)
app/components/AdminConsole.tsx   add/edit/remove servers, test connection, access list
app/api/admin/*                   admin API (servers CRUD, test, access, pterodactyl)
lib/pterodactyl.ts                application-API client: list servers, power signals
lib/config.ts                     auth mode, env registry + allowlists + admins
lib/store.ts                      editable store (data/panel.json, atomic, zod-validated)
lib/auth.ts                       Clerk viewer, allowlists/admins, per-server access
lib/upstream.ts                   server calls with timeouts, never throws
dev/mock-server.mjs               fake admin API for panel development
middleware.ts                     clerkMiddleware; public: /sign-in, /api
```

`PANEL_DEV_AUTH=1` (or running without Clerk keys outside production) signs you in as a
fake `dev` user, which is how the panel is smoke-tested without OAuth.
