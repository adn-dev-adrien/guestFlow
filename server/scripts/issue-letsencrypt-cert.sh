#!/usr/bin/env bash
# Issues / renews a Let's Encrypt cert for the GuestFlow server using acme.sh + Cloudflare DNS-01.
#
# Why DNS-01 (not HTTP-01)? GuestFlow runs on a LAN (Raspberry Pi at a private RFC1918 IP). Let's
# Encrypt can't reach the Pi via the public Internet, so HTTP-01 / TLS-ALPN-01 are out. DNS-01
# proves domain ownership by adding a TXT record — works for any host, public or not.
#
# Why Cloudflare? Squarespace (the registrar for domainesolio.com) doesn't expose a DNS API. We
# migrate DNS hosting to Cloudflare (free), keep the registrar where it is, and acme.sh uses
# Cloudflare's API to publish the TXT record automatically.
#
# Prerequisites (one-time, manual, on Adrien's side — see README §HTTPS):
#   1. Create a free Cloudflare account, add `domainesolio.com` site.
#   2. Cloudflare gives 2 nameservers — paste them into Squarespace > Domain Settings >
#      Advanced DNS Settings > Use Custom Nameservers. Wait ~1-2 h for propagation.
#   3. In the Cloudflare DNS panel, add an A record:
#        Name:    guestflow   (gives guestflow.domainesolio.com)
#        IPv4:    192.168.0.196
#        Proxy:   DNS only (gray cloud — orange "Proxied" doesn't work with private IPs)
#   4. Create a Cloudflare API token: My Profile > API Tokens > Create Token > Edit zone DNS,
#      restricted to the `domainesolio.com` zone. Copy the token (shown once).
#
# Then run this script ON THE PI:
#   sudo ./server/scripts/issue-letsencrypt-cert.sh \
#     --hostname guestflow.domainesolio.com \
#     --email contact@domainesolio.com \
#     --cf-token <CLOUDFLARE_API_TOKEN>
#
# What it does:
#   - Installs acme.sh if missing (idempotent).
#   - Configures Cloudflare DNS plugin with the API token.
#   - Issues a 90-day cert for the hostname via DNS-01.
#   - Installs cert + key into ~/guestflow/certs/server.{crt,key} (the paths PM2 already reads).
#   - Sets up a daily cron entry — acme.sh handles the 60-day-mark auto-renewal internally.
#
# After it succeeds:
#   - Restart PM2: `pm2 restart guestflow --update-env`
#   - Access GuestFlow via `https://guestflow.domainesolio.com:4000` (NOT via the IP — the cert
#     is signed for the hostname, the IP would still trigger a hostname-mismatch warning).
#
# Re-running this script with the same hostname is a no-op (acme.sh detects an existing
# certificate and skips). Pass --force to renew before the 60-day mark.

set -euo pipefail

HOSTNAME=""
EMAIL=""
CF_TOKEN=""
FORCE=0
CERTS_DIR="${HOME}/guestflow/certs"

usage() {
  cat <<EOF
Usage: $0 --hostname <fqdn> --email <email> --cf-token <token> [--force]

  --hostname FQDN  hostname the cert should be valid for (e.g. guestflow.domainesolio.com)
  --email ADDR     contact email for Let's Encrypt expiry notices
  --cf-token TOK   Cloudflare API token with "Edit zone DNS" on the domain's zone
  --force          force re-issue even if a valid cert already exists
  -h, --help       show this help

Environment overrides:
  CERTS_DIR        target directory for server.crt / server.key (default: ~/guestflow/certs)

The Cloudflare token is required so acme.sh can publish the DNS-01 TXT record. Permissions:
"Zone — DNS — Edit" restricted to the domain you're issuing the cert for.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --cf-token) CF_TOKEN="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$HOSTNAME" ] || [ -z "$EMAIL" ] || [ -z "$CF_TOKEN" ]; then
  echo "❌ Missing required arguments." >&2
  usage
  exit 2
fi

# Sanity check the hostname looks like one.
if ! [[ "$HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "❌ '$HOSTNAME' doesn't look like a valid FQDN." >&2
  exit 2
fi

echo "→ Hostname:       $HOSTNAME"
echo "→ Contact email:  $EMAIL"
echo "→ Output dir:     $CERTS_DIR"

mkdir -p "$CERTS_DIR"

# ----- 1. Install acme.sh if missing -----
ACME_HOME="${HOME}/.acme.sh"
ACME_BIN="${ACME_HOME}/acme.sh"

if [ ! -x "$ACME_BIN" ]; then
  echo "→ Installing acme.sh into $ACME_HOME (first run)..."
  curl -fsSL https://get.acme.sh | sh -s -- --install-online --email "$EMAIL" --home "$ACME_HOME"
  echo "✓ acme.sh installed."
else
  echo "✓ acme.sh already installed."
fi

# ----- 2. Configure Cloudflare token for the DNS-01 plugin -----
# acme.sh reads CF_Token from the env at issue time. We persist it in the account.conf so future
# renewals (run via cron) pick it up automatically without us re-passing it on every run.
ACME_ACCOUNT_CONF="${ACME_HOME}/account.conf"
if ! grep -q '^SAVED_CF_Token=' "$ACME_ACCOUNT_CONF" 2>/dev/null \
   || ! grep -Fxq "SAVED_CF_Token='$CF_TOKEN'" "$ACME_ACCOUNT_CONF" 2>/dev/null; then
  echo "→ Persisting Cloudflare token in acme.sh account.conf..."
  # acme.sh expects SAVED_<KEY>=... in account.conf. We replace any existing one then append.
  if grep -q '^SAVED_CF_Token=' "$ACME_ACCOUNT_CONF" 2>/dev/null; then
    sed -i.bak "/^SAVED_CF_Token=/d" "$ACME_ACCOUNT_CONF"
  fi
  echo "SAVED_CF_Token='$CF_TOKEN'" >> "$ACME_ACCOUNT_CONF"
  chmod 600 "$ACME_ACCOUNT_CONF"
  echo "✓ Cloudflare token saved (file mode 600)."
fi

# ----- 3. Issue (or skip if recent) -----
FORCE_FLAG=""
if [ "$FORCE" -eq 1 ]; then FORCE_FLAG="--force"; fi

export CF_Token="$CF_TOKEN"

echo "→ Requesting cert via DNS-01 (will publish + clean up a TXT record on $HOSTNAME)..."
if ! "$ACME_BIN" --issue --dns dns_cf -d "$HOSTNAME" $FORCE_FLAG --server letsencrypt; then
  RC=$?
  if [ "$RC" -eq 2 ]; then
    echo "ℹ acme.sh reports the cert is still valid (skipped). Pass --force to renew early."
  else
    echo "❌ acme.sh failed (rc=$RC). Check the output above for DNS / token errors." >&2
    exit "$RC"
  fi
fi

# ----- 4. Install cert into the paths PM2 reads -----
CERT_OUT="$CERTS_DIR/server.crt"
KEY_OUT="$CERTS_DIR/server.key"

echo "→ Installing cert into $CERTS_DIR (the path PM2 already points at)..."
"$ACME_BIN" --install-cert -d "$HOSTNAME" \
  --fullchain-file "$CERT_OUT" \
  --key-file "$KEY_OUT" \
  --reloadcmd "pm2 restart guestflow --update-env >/dev/null 2>&1 || true"

chmod 600 "$KEY_OUT"
chmod 644 "$CERT_OUT"

echo "✓ Cert installed:"
ls -la "$CERT_OUT" "$KEY_OUT"

# ----- 5. Verify the renewal cron is in place -----
# acme.sh sets a daily cron entry at install time; this is just a paranoid double-check.
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
  1. Restart the server so it picks up the new cert:
       pm2 restart guestflow --update-env
  2. Open https://$HOSTNAME:4000 in a browser.
     The lock icon should be solid green (real Let's Encrypt cert — no warning).
     If your browser still shows a warning, you may be hitting the old cached self-signed cert
     — clear HSTS for the host (README §HTTPS) and reload.

Renewal:
  acme.sh checks every day at 00:27 and renews at the 60-day mark. No action needed.
  To force-renew now: re-run this script with --force.

If the issuance failed:
  - Check the Cloudflare API token has "Zone — DNS — Edit" on the domain.
  - Confirm the DNS A record for $HOSTNAME exists in Cloudflare and resolves
    (run \`dig $HOSTNAME +short\` from anywhere — should return your Pi's LAN IP).
  - Check the propagation of the nameservers if you just migrated to Cloudflare
    (\`dig NS domainesolio.com +short\` should return Cloudflare's nameservers).
EOF
