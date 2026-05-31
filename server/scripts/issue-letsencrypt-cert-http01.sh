#!/usr/bin/env bash
# Issues / renews a Let's Encrypt cert for the GuestFlow server using acme.sh + HTTP-01 challenge.
#
# Why HTTP-01 (not DNS-01)?
#   - Adrien's domainesolio.com is registered at Squarespace, which doesn't expose a DNS API.
#     DNS-01 would need either a Cloudflare migration or manual TXT records on every renewal.
#   - HTTP-01 is simpler: Let's Encrypt resolves the hostname → reaches the Freebox public IP →
#     the Freebox port-forwards 80 → the Pi → acme.sh's standalone HTTP server responds → cert
#     issued. No DNS provider involvement.
#   - The trade-off: port 80 must be reachable from the Internet during issuance + every renewal.
#     The Freebox port-forward (operator step 3) keeps this true permanently; acme.sh briefly
#     binds port 80 only during the validation handshake (a few seconds, every ~60 days).
#
# Prerequisites (operator-side, see README §HTTPS):
#   1. Squarespace DNS — CNAME `guestflow` → `maisonadrisoph.freeboxos.fr` (Free's DDNS lives
#      under `.fr`, NOT `.com`; pointing at `.com` returns NXDOMAIN and the cert won't issue).
#   2. Freebox — DHCP reservation pinning the Pi at 192.168.0.196 (so the port forward never
#      breaks on the next lease renewal).
#   3. Freebox — port-forwarding:
#         WAN 80/TCP  → 192.168.0.196:80    (used only during cert issuance / renewal)
#         WAN 443/TCP → 192.168.0.196:4000  (the user-facing HTTPS traffic)
#   4. The Pi is otherwise not listening on port 80 (GuestFlow's Node binds 4000 — fine).
#
# Then run this script ON THE PI as root (port 80 is privileged):
#   sudo ./server/scripts/issue-letsencrypt-cert-http01.sh \
#     --hostname guestflow.domainesolio.com \
#     --email contact@domainesolio.com
#
# What it does:
#   - Installs acme.sh if missing.
#   - Issues a 90-day cert via HTTP-01 standalone.
#   - Installs cert + key into ~/guestflow/certs/server.{crt,key} (the paths PM2 already reads).
#   - Sets the daily renewal cron — acme.sh handles renewal at the 60-day mark + reloads PM2.
#
# Re-running with the same hostname is a no-op until the 60-day mark (acme.sh detects the still-
# valid cert and skips). Pass --force to issue early. Pass --staging to test against Let's
# Encrypt's staging server first (rate-limit friendly, untrusted cert).

set -euo pipefail

HOSTNAME=""
EMAIL=""
FORCE=0
STAGING=0
HTTP_PORT="${HTTP_PORT:-80}"

# Where the cert lands must match where Node (under PM2) reads it from. When the script is
# run via `sudo`, $HOME points to /root — but Node typically runs as the calling user (pi /
# adrien / ...), so a default of $HOME/guestflow/certs would write to /root and Node would
# silently keep serving the old cert. Fix: prefer $SUDO_USER's home when sudo is in play.
# Override entirely with CERTS_DIR env var if your setup is non-standard.
if [ -n "${CERTS_DIR:-}" ]; then
  : # explicit override wins
elif [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  CALLER_HOME=$(eval echo "~${SUDO_USER}")
  CERTS_DIR="${CALLER_HOME}/guestflow/certs"
else
  CERTS_DIR="${HOME}/guestflow/certs"
fi

# Capture the calling user before we wipe SUDO_* for acme.sh (used later for chown).
CERT_OWNER="${SUDO_USER:-root}"

usage() {
  cat <<EOF
Usage: $0 --hostname <fqdn> --email <addr> [--staging] [--force]

  --hostname FQDN  hostname the cert should be valid for (e.g. guestflow.domainesolio.com)
  --email ADDR     contact email for Let's Encrypt expiry notices
  --staging        use Let's Encrypt staging (untrusted cert, no rate limits — for testing)
  --force          force re-issue even if a valid cert already exists
  -h, --help       show this help

Environment overrides:
  HTTP_PORT        port acme.sh's standalone server binds during HTTP-01 (default 80)
  CERTS_DIR        target directory for server.crt / server.key (default: ~/guestflow/certs)

The script needs root for the privileged port 80. The Pi-side prerequisites (Freebox port
forwards + DHCP reservation + Squarespace CNAME) are documented in README §HTTPS.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --staging) STAGING=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$HOSTNAME" ] || [ -z "$EMAIL" ]; then
  echo "❌ Missing required arguments." >&2
  usage
  exit 2
fi

# Sanity check the hostname looks like one.
if ! [[ "$HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "❌ '$HOSTNAME' doesn't look like a valid FQDN." >&2
  exit 2
fi

# Root check (binding port 80 requires it).
if [ "$HTTP_PORT" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then
  echo "❌ This script needs root to bind port $HTTP_PORT (HTTP-01 standalone)." >&2
  echo "   Re-run with sudo." >&2
  exit 1
fi

# Pre-flight: confirm port 80 is reachable on the LAN (the operator might've forgotten the
# Freebox port forward; better to fail with a clear message than to time out on the ACME side).
if ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then
  echo "ℹ Neither ss nor netstat available — skipping port-busy check."
else
  if command -v ss >/dev/null 2>&1; then
    LISTENER=$(ss -ltn "( sport = :$HTTP_PORT )" 2>/dev/null | tail -n +2 | head -n 1)
  else
    LISTENER=$(netstat -ltn 2>/dev/null | awk -v p=":$HTTP_PORT$" '$4 ~ p {print; exit}')
  fi
  if [ -n "${LISTENER:-}" ]; then
    echo "❌ Port $HTTP_PORT is already bound on this host:" >&2
    echo "    $LISTENER" >&2
    echo "   acme.sh's standalone server can't listen. Stop the other process or use --httpport." >&2
    exit 1
  fi
fi

echo "→ Hostname:       $HOSTNAME"
echo "→ Contact email:  $EMAIL"
echo "→ HTTP port:      $HTTP_PORT"
echo "→ Output dir:     $CERTS_DIR"
echo "→ ACME server:    $([ "$STAGING" -eq 1 ] && echo 'letsencrypt_test (STAGING)' || echo 'letsencrypt (production)')"

mkdir -p "$CERTS_DIR"

# ----- 1. Install acme.sh if missing -----
ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
ACME_BIN="$ACME_HOME/acme.sh"

if [ ! -x "$ACME_BIN" ]; then
  echo "→ Installing acme.sh into $ACME_HOME..."
  # acme.sh's documented installer uses key=value pairs piped to `sh -s`. The legacy
  # `--install-online` / `--home` flags were dropped — the installer now infers the home
  # directory from the running user ($HOME, here /root since we're under sudo).
  curl -fsSL https://get.acme.sh | sh -s email="$EMAIL"
  echo "✓ acme.sh installed."
else
  echo "✓ acme.sh already installed."
fi

# The installer might have placed acme.sh under $HOME/.acme.sh — re-anchor ACME_BIN now
# that we know where it actually landed (covers sudo invocations where HOME=/root).
if [ ! -x "$ACME_BIN" ] && [ -x "/root/.acme.sh/acme.sh" ]; then
  ACME_HOME="/root/.acme.sh"
  ACME_BIN="$ACME_HOME/acme.sh"
fi

if [ ! -x "$ACME_BIN" ]; then
  echo "❌ acme.sh was supposed to be installed at $ACME_BIN but isn't executable." >&2
  echo "   Check the installer output above for the actual install path, then re-run." >&2
  exit 1
fi

# ----- 2. Issue the cert via HTTP-01 standalone -----
FORCE_FLAG=""
[ "$FORCE" -eq 1 ] && FORCE_FLAG="--force"
SERVER_FLAG="--server letsencrypt"
[ "$STAGING" -eq 1 ] && SERVER_FLAG="--server letsencrypt_test"

# If the previous run was against a different CA endpoint (typical staging → prod transition
# the morning after iterating with --staging), acme.sh sometimes leaves the old leaf in
# `<acme_home>/<domain>_ecc/` and `--install-cert` silently re-installs THAT instead of the
# freshly-issued one — even with `--force`. End result: cert file on disk is the staging
# cert, browsers refuse, and `openssl verify` fails with `error 20`. The fix is to wipe the
# per-domain dir when we detect a mismatch between the conf's Le_API and the SERVER_FLAG
# we're about to use. Always safe — only the per-domain cert data is removed; the acme.sh
# install + the production account stay intact.
DOMAIN_DIR="${ACME_HOME}/${HOSTNAME}_ecc"
DOMAIN_CONF="${DOMAIN_DIR}/${HOSTNAME}.conf"
if [ -f "$DOMAIN_CONF" ]; then
  PREV_API=$(grep -E "^Le_API=" "$DOMAIN_CONF" | head -1 | cut -d"'" -f2 || true)
  if [ "$STAGING" -eq 1 ]; then
    WANT_API_PATTERN="acme-staging-v02"
  else
    WANT_API_PATTERN="acme-v02"
  fi
  if [ -n "$PREV_API" ] && ! echo "$PREV_API" | grep -q "$WANT_API_PATTERN"; then
    echo "ℹ Previous issue used a different CA endpoint:" >&2
    echo "    previous: $PREV_API" >&2
    echo "    requested: $WANT_API_PATTERN" >&2
    echo "  Wiping per-domain acme.sh data ($DOMAIN_DIR) to force a clean re-issue against" >&2
    echo "  the requested CA. The acme.sh install and the production account are untouched." >&2
    "$ACME_BIN" --remove -d "$HOSTNAME" --ecc >/dev/null 2>&1 || true
    rm -rf "$DOMAIN_DIR"
  fi
fi

echo "→ Requesting cert via HTTP-01 standalone (acme.sh briefly binds port $HTTP_PORT)..."

# acme.sh refuses to run when it detects `sudo` semantics (SUDO_USER set + HOME still
# pointing at the calling user's home). We're genuinely root at this point (the script's
# pre-flight `id -u` check ensures it) and we want acme.sh's data under /root/.acme.sh.
# Clear the sudo-related env so acme.sh stops worrying, and pin HOME to /root.
unset SUDO_USER SUDO_UID SUDO_GID SUDO_COMMAND
export HOME="/root"

set +e
"$ACME_BIN" --issue \
  --standalone \
  --httpport "$HTTP_PORT" \
  -d "$HOSTNAME" \
  $SERVER_FLAG \
  $FORCE_FLAG
ACME_RC=$?
set -e

if [ "$ACME_RC" -eq 2 ]; then
  echo "ℹ acme.sh reports the cert is still valid (skipped). Pass --force to renew early."
elif [ "$ACME_RC" -ne 0 ]; then
  cat >&2 <<EOF
❌ acme.sh failed (rc=$ACME_RC). Common causes:
  - Freebox port 80 forward missing or pointing at the wrong LAN IP.
  - DNS not propagated yet: \`dig $HOSTNAME +short\` should return your Freebox public IP
    (via the chained CNAME → maisonadrisoph.freeboxos.fr → public IP).
  - ISP blocks inbound port 80 (rare on Free, but check with the Freebox admin UI's port test).
  - HTTPS_ENABLED=true on Node but with cert/key missing → Node would refuse to boot but the
    HTTP-01 test would still work since acme.sh binds port 80 only briefly.
Check the output above for the precise Let's Encrypt error message.
EOF
  exit "$ACME_RC"
fi

# ----- 3. Install cert into the paths PM2 reads -----
CERT_OUT="$CERTS_DIR/server.crt"
KEY_OUT="$CERTS_DIR/server.key"

# `pm2 restart` must run as the user PM2 was registered under (e.g. `pi`) — when run from
# the cron-as-root context that acme.sh inherits, root's PM2 daemon doesn't know about the
# `pi`-owned guestflow process and the call is a silent no-op. So if we have a non-root
# CERT_OWNER, wrap the reload in `sudo -u <user>`. We also drop the `>/dev/null 2>&1 || true`
# noise-suppression: when the reload fails, we WANT acme.sh to surface the error (and cron
# to email it on the next renewal) rather than carry on with Node still serving the old cert.
RELOAD_CMD="pm2 restart guestflow --update-env"
if [ "$CERT_OWNER" != "root" ] && id "$CERT_OWNER" >/dev/null 2>&1; then
  RELOAD_CMD="sudo -u $CERT_OWNER pm2 restart guestflow --update-env"
fi

echo "→ Installing cert into $CERTS_DIR (where PM2 already reads from)..."
"$ACME_BIN" --install-cert -d "$HOSTNAME" \
  --fullchain-file "$CERT_OUT" \
  --key-file "$KEY_OUT" \
  --reloadcmd "$RELOAD_CMD"

# Adrien's PM2 process runs under the regular user, not root. Make the cert files readable by
# everyone on the host (the key still has its acme.sh-set mode 0600 by default — we relax just
# enough for the unprivileged Node process to read).
chmod 644 "$CERT_OUT"
chmod 640 "$KEY_OUT"
# PM2 runs Node as the user who invoked us via sudo (captured up top as CERT_OWNER, e.g. pi
# on the production Pi, adrien on a dev box). chown so the unprivileged Node process can
# read the cert + key. If we're genuinely running as root (no sudo), the files stay root-owned.
if [ "$CERT_OWNER" != "root" ] && id "$CERT_OWNER" >/dev/null 2>&1; then
  chown "$CERT_OWNER:$CERT_OWNER" "$CERT_OUT" "$KEY_OUT" 2>/dev/null || true
fi

echo "✓ Cert installed:"
ls -la "$CERT_OUT" "$KEY_OUT"

# ----- 3b. Sanity-check the cert we just installed -----
# Always print the subject/issuer/validity so deploy logs make the cert state visible at a
# glance. Then run `openssl verify` against the system trust store: for a prod cert this
# MUST succeed (otherwise browsers will warn). For a staging cert it WILL fail, which is
# expected — staging intermediates aren't in any OS trust store. We tolerate that case but
# fail the script when prod was requested and verify still fails (= the cert silently came
# from staging, the bug Adrien hit on 2026-05-31).
echo
echo "→ Sanity-checking the installed cert..."
openssl x509 -in "$CERT_OUT" -noout -subject -issuer -dates
echo
SYSTEM_CA_BUNDLE=""
for candidate in \
  /etc/ssl/certs/ca-certificates.crt \
  /etc/pki/tls/certs/ca-bundle.crt \
  /etc/ssl/cert.pem; do
  [ -f "$candidate" ] && SYSTEM_CA_BUNDLE="$candidate" && break
done

if [ -z "$SYSTEM_CA_BUNDLE" ]; then
  echo "ℹ No system CA bundle found at the usual paths — skipping the verify step." >&2
elif openssl verify -CAfile "$SYSTEM_CA_BUNDLE" "$CERT_OUT" >/dev/null 2>&1; then
  echo "✓ openssl verify against $SYSTEM_CA_BUNDLE: OK (publicly trusted)."
else
  if [ "$STAGING" -eq 1 ]; then
    echo "ℹ openssl verify failed — expected for a staging cert (intermediates not in the system trust store)."
  else
    echo "❌ openssl verify against $SYSTEM_CA_BUNDLE FAILED for a cert requested in PRODUCTION mode." >&2
    openssl verify -CAfile "$SYSTEM_CA_BUNDLE" "$CERT_OUT" >&2 || true
    echo "   This usually means the install step silently re-used a stale STAGING cert from a" >&2
    echo "   previous run. Recover with:" >&2
    echo "     sudo $ACME_BIN --remove -d $HOSTNAME --ecc" >&2
    echo "     sudo rm -rf $DOMAIN_DIR" >&2
    echo "     sudo $0 --hostname $HOSTNAME --email $EMAIL    # (re-run, no --staging)" >&2
    exit 1
  fi
fi

# ----- 4. Verify cron entry -----
if ! crontab -l 2>/dev/null | grep -q "acme.sh"; then
  echo "ℹ No acme.sh cron entry found — adding the standard daily one."
  ( crontab -l 2>/dev/null; echo "27 0 * * * \"$ACME_BIN\" --cron --home \"$ACME_HOME\" > /dev/null" ) | crontab -
  echo "✓ Cron entry added (daily renewal check at 00:27)."
else
  echo "✓ acme.sh cron entry already present."
fi

cat <<EOF

✓ Done.

Next:
  1. Restart the server so it picks up the new cert (if PM2 wasn't already reloaded):
       pm2 restart guestflow --update-env
  2. From any device, open https://$HOSTNAME
     The lock icon should be solid (real Let's Encrypt cert — no warning).
     Hostname-mismatch warning instead? You're hitting the cert via IP — use the hostname.

Renewal:
  acme.sh's cron checks every day at 00:27 and renews at the 60-day mark. No action needed.
  Renewal silently re-binds port $HTTP_PORT for a few seconds. If you ever bind another service
  to port 80, switch acme.sh to webroot mode (out of scope here).

Troubleshooting:
  - Test the Freebox is forwarding correctly:
      curl -v http://$HOSTNAME/ from any device OUTSIDE your LAN (your phone on mobile data
      is the easiest). You should reach acme.sh's empty 404 response (when no validation is
      running) or Node's 4000 service if anything is listening.
  - DNS not propagated: dig $HOSTNAME +short — should chain through maisonadrisoph.freeboxos.fr
    then return your Freebox's current public IP. If you see NXDOMAIN, double-check that the
    Squarespace CNAME points at the .fr Free DDNS, NOT .com (a common copy-paste mistake).
  - Re-run with --staging first if you're worried about Let's Encrypt's rate limits while
    iterating on the Freebox config.
EOF
