#!/usr/bin/env bash
# Generates a self-signed TLS cert + key for the GuestFlow server.
#
# Why self-signed? GuestFlow runs on a LAN (Raspberry Pi accessed via its local IP). Let's Encrypt
# needs a public domain + DNS-01 challenge for non-public IPs, which is overkill here. A
# self-signed cert with a 1-year validity is the simplest "it works in HTTPS" path: the browser
# warns once per device, the user clicks "Continue", and HSTS pins HTTPS from then on.
#
# Usage:
#   ./server/scripts/generate-self-signed-cert.sh                 # auto-detect SANs
#   ./server/scripts/generate-self-signed-cert.sh 192.168.0.196 guestflow.local
#   OUT_DIR=/some/persistent/dir ./server/scripts/generate-self-signed-cert.sh
#
# Writes:
#   $OUT_DIR/server.crt   (cert, PEM)
#   $OUT_DIR/server.key   (private key, PEM, 0600)
# Default $OUT_DIR: server/certs/ relative to this script.
#
# Re-running with existing files is a no-op (the cert isn't regenerated unless you pass --force).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${OUT_DIR:-$SERVER_DIR/certs}"
CERT_PATH="$OUT_DIR/server.crt"
KEY_PATH="$OUT_DIR/server.key"

FORCE=0
SANS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '1,/^set -euo/p' "$0" | sed -n '2,/^$/p' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) SANS+=("$arg") ;;
  esac
done

if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ] && [ "$FORCE" -ne 1 ]; then
  echo "✓ Cert + key already exist at $OUT_DIR — nothing to do (pass --force to regenerate)."
  exit 0
fi

mkdir -p "$OUT_DIR"

# Auto-detect SANs when the caller didn't pass any. We include:
#   - localhost + 127.0.0.1   (dev)
#   - every LAN IPv4 address of this host (192.168.x.y, 10.x.y.z, etc.)
#   - the short hostname
# Anyone reaching the server by any of those should get a matching cert.
if [ "${#SANS[@]}" -eq 0 ]; then
  SANS+=("localhost")
  SANS+=("127.0.0.1")
  # macOS + Linux both have `hostname`. macOS lacks `hostname -I`; fall back to ifconfig parsing.
  if hostname -I >/dev/null 2>&1; then
    while IFS= read -r ip; do
      [ -n "$ip" ] && SANS+=("$ip")
    done < <(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
  else
    while IFS= read -r ip; do
      [ -n "$ip" ] && SANS+=("$ip")
    done < <(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2 }')
  fi
  SHORT_HOST="$(hostname -s 2>/dev/null || hostname)"
  if [ -n "$SHORT_HOST" ]; then SANS+=("$SHORT_HOST"); fi
fi

# Deduplicate while preserving order. Avoids `declare -A` so the script runs on macOS' bash 3.2.
UNIQUE_SANS=()
for san in "${SANS[@]}"; do
  found=0
  for existing in "${UNIQUE_SANS[@]:-}"; do
    if [ "$existing" = "$san" ]; then found=1; break; fi
  done
  if [ "$found" -eq 0 ]; then
    UNIQUE_SANS+=("$san")
  fi
done

# Build the OpenSSL `subjectAltName` block. IPs go under `IP:`, names under `DNS:`.
SAN_BLOCK=""
for san in "${UNIQUE_SANS[@]}"; do
  if [[ "$san" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SAN_BLOCK+="IP:$san,"
  else
    SAN_BLOCK+="DNS:$san,"
  fi
done
SAN_BLOCK="${SAN_BLOCK%,}"

echo "Generating self-signed cert for: $SAN_BLOCK"
echo "Output: $OUT_DIR"

# OpenSSL 1.1+ supports passing extensions inline via -addext.
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -days 365 \
  -subj "/CN=GuestFlow LAN" \
  -addext "subjectAltName=$SAN_BLOCK" \
  -addext "extendedKeyUsage=serverAuth" \
  -addext "basicConstraints=critical,CA:false"

chmod 600 "$KEY_PATH"
chmod 644 "$CERT_PATH"

echo "✓ Cert generated: $CERT_PATH"
echo "✓ Key generated:  $KEY_PATH"
echo "✓ Valid for: $SAN_BLOCK"
echo
echo "Next step: set HTTPS_ENABLED=true in the server env (PM2 ecosystem or the deploy workflow)."
echo "The browser will warn once that the cert isn't trusted by a known CA — click 'Continuer'"
echo "(Safari) / 'Avancé → Continuer' (Chrome). HSTS makes that decision sticky from then on."
