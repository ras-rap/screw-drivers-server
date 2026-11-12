#!/usr/bin/env bash
# Panel setup: build the image, start it on a loopback port for nginx, sanity-check it.
#
#   ./setup.sh --host panel.example.com            # generate nginx config too
#   ./setup.sh --host panel.example.com --port 3100
#
# Safe to re-run: it never overwrites an existing .env, only updates PANEL_PORT and
# PANEL_PUBLIC_URL in it, and `docker compose up -d` is idempotent.
set -euo pipefail

cd "$(dirname "$0")"

# A key that is not in .env yet must not abort the script (pipefail makes grep fail).
trap 'printf "setup failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

PORT_ARG=""
PUBLIC_HOST=""
SKIP_CHECKS=0
BUILD=1

usage() {
	cat <<'USAGE'
Usage: ./setup.sh [options]

  --host <name>     public hostname behind nginx/Cloudflare (e.g. panel.example.com);
                    also writes nginx/<name>.conf
  --port <port>     loopback port the panel listens on (default 3000)
  --no-build        skip "docker compose build" (image already current)
  --skip-checks     start even if Clerk keys / admin list are missing (not for production)
  -h, --help        this text

The panel is published on 127.0.0.1:<port> only. nginx on the host proxies to it.
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--host)
		PUBLIC_HOST="${2:?--host needs a value}"
		shift 2
		;;
	--port)
		PORT_ARG="${2:?--port needs a value}"
		shift 2
		;;
	--no-build)
		BUILD=0
		shift
		;;
	--skip-checks)
		SKIP_CHECKS=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "unknown option: $1" >&2
		usage
		exit 2
		;;
	esac
done

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

# ------------------------------------------------------------------ preflight
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available"
[[ -f Dockerfile ]] || die "run this from the panel directory (Dockerfile not found)"

# ---------------------------------------------------------------------- .env
if [[ ! -f .env ]]; then
	say "creating .env from .env.example"
	cp .env.example .env
	chmod 600 .env
	NEW_ENV=1
else
	NEW_ENV=0
fi

# upsert a key without duplicating it (idempotent re-runs)
set_env() {
	local key="$1" value="$2"
	if grep -qE "^${key}=" .env; then
		sed -i.bak -E "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
	else
		printf '%s=%s\n' "$key" "$value" >>.env
	fi
}

env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true ; }

# Re-runs keep whatever the .env already says; --port / --host override it.
PANEL_PORT="${PORT_ARG:-$(env_value PANEL_PORT)}"
PANEL_PORT="${PANEL_PORT:-3000}"
set_env PANEL_PORT "$PANEL_PORT"
if [[ -n "$PUBLIC_HOST" ]]; then
	set_env PANEL_PUBLIC_URL "https://${PUBLIC_HOST}"
fi

# ---------------------------------------------------------------- validation
MISSING=()
[[ -n "$(env_value CLERK_SECRET_KEY)" ]] || MISSING+=("CLERK_SECRET_KEY")
[[ -n "$(env_value NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)" ]] || MISSING+=("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
if [[ -z "$(env_value PANEL_ADMIN_EMAILS)$(env_value PANEL_ADMIN_USER_IDS)" ]]; then
	MISSING+=("PANEL_ADMIN_EMAILS (or PANEL_ADMIN_USER_IDS)")
fi
if [[ "$(env_value PANEL_DEV_AUTH)" == "1" ]]; then
	warn "PANEL_DEV_AUTH=1 is set: anyone who can reach the port is a signed-in 'dev' admin. Use it locally only."
fi
if [[ -z "$(env_value PANEL_ALLOWED_EMAILS)$(env_value PANEL_ALLOWED_USER_IDS)" ]]; then
	warn "no PANEL_ALLOWED_EMAILS/USER_IDS: any Clerk account that signs in can see the panel and use it."
fi

if ((${#MISSING[@]} > 0)); then
	printf 'missing in .env:\n' >&2
	for item in "${MISSING[@]}"; do printf '  - %s\n' "$item" >&2; done
	if [[ $SKIP_CHECKS -eq 0 ]]; then
		cat >&2 <<'HELP'

Fill those in (see .env.example and setup.md), then re-run this script.
Re-running with --skip-checks starts the panel anyway; without Clerk keys it answers
"not configured for sign-in" and /admin stays locked.
HELP
		exit 1
	fi
	warn "continuing because of --skip-checks"
fi

# --------------------------------------------------------------------- bring up
if [[ $BUILD -eq 1 ]]; then
	say "building the panel image (first build pulls node + bun images)"
	docker compose build
fi

say "starting the panel on 127.0.0.1:${PANEL_PORT}"
docker compose up -d

say "waiting for the panel to answer"
READY=0
for _ in $(seq 1 60); do
	# any HTTP status means next is listening; 401 just means "not signed in yet"
	CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 2 "http://127.0.0.1:${PANEL_PORT}/api/servers" 2>/dev/null || true)"
	if [[ -n "$CODE" && "$CODE" != "000" ]]; then
		READY=1
		echo "panel answered with HTTP ${CODE}"
		break
	fi
	sleep 1
done
if [[ $READY -ne 1 ]]; then
	warn "no answer on http://127.0.0.1:${PANEL_PORT} after 60s; check: docker compose logs panel"
	exit 1
fi
echo "panel is up"

# ------------------------------------------------------------------ nginx site
if [[ -n "$PUBLIC_HOST" ]]; then
	mkdir -p nginx
	TARGET="nginx/${PUBLIC_HOST}.conf"
	say "writing ${TARGET}"
	sed -e "s|{{HOST}}|${PUBLIC_HOST}|g" -e "s|{{PORT}}|${PANEL_PORT}|g" nginx/panel.conf.example >"$TARGET"
fi

# --------------------------------------------------------------------- summary
cat <<SUMMARY

──────────────────────────────────────────────────────────────────────────────
panel:    http://127.0.0.1:${PANEL_PORT}   (loopback only, nginx proxies to it)
logs:     docker compose logs -f panel
data:     docker volume (panel-data) → /app/data/panel.json  (back this up)
next:
  1. $( [[ -n "$PUBLIC_HOST" ]] && echo "copy nginx/${PUBLIC_HOST}.conf into /etc/nginx/sites-available, symlink it," || echo "generate the nginx site: ./setup.sh --host panel.example.com" )
     then: nginx -t && systemctl reload nginx
  2. Cloudflare: SSL/TLS mode "Full (strict)", Origin Certificate installed in nginx,
     and a cache rule that bypasses /api/* (see setup.md)
  3. open https://<your host>/admin and add your game servers there
──────────────────────────────────────────────────────────────────────────────
SUMMARY

if [[ $NEW_ENV -eq 1 ]]; then
	echo
	echo "created .env (chmod 600). It still needs real values - see setup.md."
fi
