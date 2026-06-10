#!/usr/bin/env bash
#
# setup-reverse-proxy.sh — install/configure the Caddy reverse proxy on the Raspberry Pi.
# See specs/reverse-proxy-caddy.md.
#
# Routes (TLS terminated by Caddy, Let's Encrypt issued + auto-renewed, HTTP→HTTPS redirect):
#   domainesolio.com, www.domainesolio.com  → WordPress  (wp_app, 127.0.0.1:8080)
#   guestflow.domainesolio.com              → GuestFlow  (PM2,   127.0.0.1:4000)
#
# Idempotent + re-runnable: installs Caddy only when missing, (re)writes the Caddyfile, validates
# it, reloads the service, and removes any leftover acme.sh renewal cron from the old setup.
#
# Run ON THE PI, as root:
#   sudo bash scripts/setup-reverse-proxy.sh
#
# Override any value via env, e.g.:
#   sudo WP_UPSTREAM=127.0.0.1:9000 ACME_EMAIL=me@example.com bash scripts/setup-reverse-proxy.sh

set -euo pipefail

# ─── Config (override via env) ──────────────────────────────────────────────
WP_DOMAIN="${WP_DOMAIN:-domainesolio.com}"
GUESTFLOW_DOMAIN="${GUESTFLOW_DOMAIN:-guestflow.domainesolio.com}"
WP_UPSTREAM="${WP_UPSTREAM:-127.0.0.1:8080}"
GUESTFLOW_UPSTREAM="${GUESTFLOW_UPSTREAM:-127.0.0.1:4000}"
ACME_EMAIL="${ACME_EMAIL:-adrien.jouve@adn-dev.fr}"
CADDYFILE_DEST="${CADDYFILE_DEST:-/etc/caddy/Caddyfile}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../deploy/caddy/Caddyfile"

log()  { printf '\033[0;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Preconditions ──────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Run as root (sudo bash scripts/setup-reverse-proxy.sh)."
[ -f "$TEMPLATE" ]   || die "Caddyfile template not found at $TEMPLATE"

# Refuse to clobber :80 / :443 if held by something other than Caddy (e.g. a stale Node on :443).
for port in 80 443; do
  holder="$(ss -tlnHp "( sport = :$port )" 2>/dev/null | grep -oE 'users:\(\("[^"]+' | sed 's/.*"//' | sort -u | tr '\n' ' ')"
  if [ -n "${holder// /}" ] && ! echo "$holder" | grep -qw caddy; then
    die "Port :$port is already bound by: ${holder}. Free it (or stop the old Node :443 / Freebox-forward) before installing Caddy."
  fi
done

# ─── Install Caddy (official apt repo) if missing ───────────────────────────
if command -v caddy >/dev/null 2>&1; then
  ok "Caddy already installed ($(caddy version | head -n1))."
else
  log "Installing Caddy from the official apt repository…"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  ok "Caddy installed ($(caddy version | head -n1))."
fi

# ─── Render the Caddyfile from the template ─────────────────────────────────
log "Writing $CADDYFILE_DEST"
mkdir -p "$(dirname "$CADDYFILE_DEST")"
sed \
  -e "s|__ACME_EMAIL__|${ACME_EMAIL}|g" \
  -e "s|__WP_DOMAIN__|${WP_DOMAIN}|g" \
  -e "s|__WP_UPSTREAM__|${WP_UPSTREAM}|g" \
  -e "s|__GUESTFLOW_DOMAIN__|${GUESTFLOW_DOMAIN}|g" \
  -e "s|__GUESTFLOW_UPSTREAM__|${GUESTFLOW_UPSTREAM}|g" \
  "$TEMPLATE" > "$CADDYFILE_DEST"

# ─── Validate + (re)load ────────────────────────────────────────────────────
log "Validating config…"
caddy validate --config "$CADDYFILE_DEST" --adapter caddyfile || die "Caddyfile validation failed — not reloading."
ok "Config is valid."

systemctl enable caddy >/dev/null 2>&1 || true
if systemctl is-active --quiet caddy; then
  log "Reloading Caddy (zero-downtime)…"
  systemctl reload caddy || systemctl restart caddy
else
  log "Starting Caddy…"
  systemctl start caddy
fi
ok "Caddy is running."

# ─── Remove leftover acme.sh renewal cron from the old GuestFlow TLS setup ──
clean_acme_cron() {
  local user="$1"
  crontab -l -u "$user" >/dev/null 2>&1 || return 0
  if crontab -l -u "$user" 2>/dev/null | grep -q 'acme.sh'; then
    crontab -l -u "$user" 2>/dev/null | grep -v 'acme.sh' | crontab -u "$user" -
    ok "Removed leftover acme.sh cron for '$user'."
  fi
}
clean_acme_cron root
[ -n "${SUDO_USER:-}" ] && clean_acme_cron "$SUDO_USER"

# ─── Summary + manual prerequisites ─────────────────────────────────────────
cat <<EOF

──────────────────────────────────────────────────────────────────────────────
$(ok "Reverse proxy configured.")
  ${WP_DOMAIN}, www.${WP_DOMAIN}  → ${WP_UPSTREAM}        (WordPress)
  ${GUESTFLOW_DOMAIN}             → ${GUESTFLOW_UPSTREAM} (GuestFlow)

Caddy obtains + auto-renews the Let's Encrypt certificates itself — no cron to maintain.

MANUAL PREREQUISITES (outside this script):
  1. DNS — at the registrar of ${WP_DOMAIN}:
       ${WP_DOMAIN}            A     → home WAN IP (apex; or registrar ALIAS/ANAME → Freebox dyndns)
       www.${WP_DOMAIN}       CNAME → ${WP_DOMAIN}
       ${GUESTFLOW_DOMAIN}    CNAME → ${WP_DOMAIN}  (or the Freebox dyndns host)
  2. Freebox port-forward — WAN:80 → Pi:80 AND WAN:443 → Pi:443 (both to THIS host / Caddy,
     no longer 443 → :4000).
  3. WordPress behind a proxy — wp-config must trust X-Forwarded-Proto so WP knows it's HTTPS
     (avoid redirect loops / mixed content), e.g.:
       if (!empty(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO']==='https') \$_SERVER['HTTPS']='on';
     and set WP_HOME / WP_SITEURL to https://${WP_DOMAIN}.

Watch certificate issuance:  journalctl -u caddy -f
Re-run this script anytime — it's idempotent.
──────────────────────────────────────────────────────────────────────────────
EOF
