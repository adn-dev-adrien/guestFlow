#!/usr/bin/env bash
#
# One-time setup of a GuestFlow hosting host (specs/hosting-h1-fleet-runtime.md §4.4, §8).
# Debian 12 / Ubuntu 24.04, run as root. Idempotent: running it again changes nothing that is in place.
#
#   sudo DOMAIN=guestflow.fr ACME_EMAIL=ops@guestflow.fr \
#        REPO_URL=https://github.com/<owner>/guestFlow.git REF=v3.10.0 \
#        S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
#        bash deploy/hosting/bootstrap-host.sh
#
# The object storage keys are typed once, here (specs/hosting-h1-fleet-runtime.md rule 27): they go
# into the console's environment, which is their only source — /etc/default/litestream is rewritten
# from it at every run, and rclone takes them from the console (no `rclone config`). BACKUP_URL,
# BACKUP_ENDPOINT and BACKUP_REGION override the example's Scaleway values. Running the script again
# without them keeps what the environment already holds.
#
# What it does (see deploy/hosting/README.md for the whole runbook):
#   1. Node 24, Caddy, Litestream and rclone;
#   2. the console's user `guestflow`, Litestream's user `guestflow-backup` and the instances' group
#      `guestflow-app` (each instance gets its own user gf-c<id> later, from the console), and
#      /srv/guestflow/{instances,releases,envs,console,closed} with their owners (rule 21);
#   3. the instance unit template, the console unit, the three root wrappers and their sudoers rule;
#   4. Caddy's main file (admin API on a unix socket), the closed page; Litestream as guestflow-app,
#      its configuration root-owned and written only by guestflow-litestream-apply;
#   5. the console's source at REF, its dependencies and its build;
#   6. the console's environment from console.env.example (never overwritten once written), with the
#      licence key pair generated when the private key is empty (rule 26) and the object storage;
#   7. the firewall: SSH, HTTP, HTTPS.
# The console itself starts once its environment is filled in (step « Remplir l'environnement »).

set -euo pipefail

: "${DOMAIN:?DOMAIN est requis (ex. guestflow.fr)}"
: "${ACME_EMAIL:?ACME_EMAIL est requis}"
: "${REPO_URL:?REPO_URL est requis}"
REF="${REF:-master}"
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"
ROOT=/srv/guestflow
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '  %s\n' "$*"; }
[ "$(id -u)" = "0" ] || { echo "À lancer en root." >&2; exit 1; }

echo "GuestFlow — préparation de l'hôte ($DOMAIN)"

# ── 1. Packages ──────────────────────────────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw rclone build-essential python3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || ! node -v | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
say "✓ Node $(node -v)"

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
say "✓ Caddy $(caddy version | cut -d' ' -f1)"

if ! command -v litestream >/dev/null; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/litestream.deb "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${arch}.deb"
  dpkg -i /tmp/litestream.deb >/dev/null && rm -f /tmp/litestream.deb
fi
say "✓ Litestream $(litestream version)"

# ── 2. Users and directories (rule 21) ──────────────────────────────────────────────────────────
# No two of the console, Litestream and an instance share a user. The console is in the instances'
# group, so it creates and reads their directories; each instance (gf-c<id>, created by the console
# through guestflow-instance-identity) sees only its own directory, the releases read-only, never the
# console's directory nor the env files.
getent group guestflow-app >/dev/null || groupadd --system guestflow-app
id guestflow >/dev/null 2>&1 || useradd --system --home-dir "$ROOT/console" --shell /usr/sbin/nologin guestflow
id guestflow-backup >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid guestflow-app guestflow-backup
usermod -aG guestflow-app guestflow
mkdir -p "$ROOT/instances" "$ROOT/releases" "$ROOT/envs" "$ROOT/console/data" "$ROOT/closed"
chown root:root "$ROOT" && chmod 755 "$ROOT"
chown guestflow:guestflow-app "$ROOT/instances" && chmod 2770 "$ROOT/instances"
chown guestflow:guestflow-app "$ROOT/releases" && chmod 2750 "$ROOT/releases"
chown guestflow:guestflow "$ROOT/envs" && chmod 700 "$ROOT/envs"
chown -R guestflow:guestflow "$ROOT/console" && chmod 700 "$ROOT/console"
install -m 644 "$HERE/closed/index.html" "$ROOT/closed/index.html"
say "✓ $ROOT (instances guestflow:guestflow-app 2770, releases 2750, envs et console 0700 à guestflow)"

# ── 3. Units, wrapper, sudoers ───────────────────────────────────────────────────────────────────
install -m 644 "$HERE/guestflow@.service" /etc/systemd/system/guestflow@.service
install -m 644 "$HERE/guestflow-console.service" /etc/systemd/system/guestflow-console.service
install -o root -g root -m 755 "$HERE/guestflow-systemctl" /usr/local/sbin/guestflow-systemctl
install -o root -g root -m 755 "$HERE/guestflow-litestream-apply" /usr/local/sbin/guestflow-litestream-apply
install -o root -g root -m 755 "$HERE/guestflow-instance-identity" /usr/local/sbin/guestflow-instance-identity
install -o root -g root -m 440 "$HERE/guestflow.sudoers" /etc/sudoers.d/guestflow
visudo -cf /etc/sudoers.d/guestflow >/dev/null
systemctl daemon-reload
say "✓ unités systemd et règle sudo"

# ── 4. Caddy and Litestream ──────────────────────────────────────────────────────────────────────
mkdir -p /etc/caddy/sites /etc/systemd/system/caddy.service.d
chown guestflow:caddy /etc/caddy/sites && chmod 755 /etc/caddy/sites
usermod -aG caddy guestflow
install -m 644 "$HERE/caddy.override.conf" /etc/systemd/system/caddy.service.d/guestflow.conf
systemctl daemon-reload
# The header Caddy adds for the console (rule 21): kept in the console's env once written there.
ENVF="$ROOT/console/env"
PROXY_SECRET=""
[ -f "$ENVF" ] && PROXY_SECRET="$(sed -n 's/^CP_PROXY_SECRET=//p' "$ENVF" | head -n1)"
[ -n "$PROXY_SECRET" ] || PROXY_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=')"
# GUESTFLOW_TEST_LOCAL_CERTS=1: certificates from Caddy's own CA — the throwaway host of
# deploy/hosting/test/ only, never production.
LOCAL_CERTS=""
[ "${GUESTFLOW_TEST_LOCAL_CERTS:-}" = "1" ] && LOCAL_CERTS="local_certs"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__ACME_EMAIL__|$ACME_EMAIL|g" -e "s|__PROXY_SECRET__|$PROXY_SECRET|g" \
    -e "s|# __LOCAL_CERTS__|$LOCAL_CERTS|" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
chown root:caddy /etc/caddy/Caddyfile && chmod 640 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy
say "✓ Caddy configuré (console.$DOMAIN, app.$DOMAIN, sites/*.caddy ; API d'administration sur /run/caddy/admin.sock)"

# Root-owned, never writable by the console: it is written by guestflow-litestream-apply only.
grep -q 'guestflow-litestream-apply' /etc/litestream.yml 2>/dev/null || install -o root -g root -m 644 "$HERE/litestream.yml" /etc/litestream.yml
chown root:root /etc/litestream.yml && chmod 644 /etc/litestream.yml
mkdir -p /etc/systemd/system/litestream.service.d
install -m 644 "$HERE/litestream.override.conf" /etc/systemd/system/litestream.service.d/guestflow.conf
systemctl daemon-reload
systemctl enable litestream >/dev/null
say "✓ Litestream en guestflow-backup (/etc/litestream.yml root 644 ; ses clés viennent de l'environnement de la console, étape 6)"

# ── 5. The console's source ──────────────────────────────────────────────────────────────────────
SRC="$ROOT/console/src"
if [ ! -d "$SRC/.git" ]; then
  sudo -u guestflow git clone --quiet "$REPO_URL" "$SRC"
fi
sudo -u guestflow git -C "$SRC" fetch --quiet --tags origin
sudo -u guestflow git -C "$SRC" checkout --quiet "$REF"
sudo -u guestflow bash -c "cd '$SRC/server' && npm ci --omit=dev --silent && npm_config_build_from_source=true npm rebuild better-sqlite3 --silent"
sudo -u guestflow bash -c "cd '$SRC/control-plane/server' && npm ci --omit=dev --silent && npm_config_build_from_source=true npm rebuild better-sqlite3 --silent"
sudo -u guestflow bash -c "cd '$SRC/control-plane/client' && npm ci --silent && npm run build --silent"
say "✓ console à $REF"

# ── 6. The console's environment ─────────────────────────────────────────────────────────────────
if [ ! -f "$ENVF" ]; then
  secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=')"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__SESSION_SECRET__|$secret|g" -e "s|__PROXY_SECRET__|$PROXY_SECRET|g" "$HERE/console.env.example" > "$ENVF"
  chown guestflow:guestflow "$ENVF" && chmod 600 "$ENVF"
  say "✓ $ENVF écrit — à compléter"
else
  say "✓ $ENVF déjà en place (non modifié)"
fi

env_get() { sed -n "s/^$1=//p" "$ENVF" | head -n1 | sed -e 's/^"//' -e 's/"$//'; }
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^$key=" "$ENVF"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENVF" > "$tmp"
  else
    cat "$ENVF" > "$tmp" && printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENVF" && rm -f "$tmp"
}

# Rule 26 — the licence key pair (Ed25519, base64 DER: PKCS8 private, SPKI public), generated once.
if [ -z "$(env_get CP_LICENCE_PRIVATE_KEY)" ]; then
  KEYS="$(node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');process.stdout.write(k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')+' '+k.publicKey.export({format:'der',type:'spki'}).toString('base64'))")"
  env_set CP_LICENCE_PRIVATE_KEY "${KEYS%% *}"
  say "✓ clé de licence générée dans $ENVF (CP_LICENCE_PRIVATE_KEY) — à copier hors ligne"
  say "  clé publique : ${KEYS##* } — rien à y faire : la console l'écrit dans chaque instance"
else
  say "✓ clé de licence déjà en place"
fi

# Rule 27 — the object storage, typed once.
[ -n "${S3_ACCESS_KEY_ID:-}" ] && env_set LITESTREAM_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"
[ -n "${S3_SECRET_ACCESS_KEY:-}" ] && env_set LITESTREAM_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"
[ -n "${BACKUP_URL:-}" ] && env_set CP_BACKUP_URL "$BACKUP_URL"
[ -n "${BACKUP_ENDPOINT:-}" ] && env_set CP_BACKUP_ENDPOINT "$BACKUP_ENDPOINT"
[ -n "${BACKUP_REGION:-}" ] && env_set CP_BACKUP_REGION "$BACKUP_REGION"
chown guestflow:guestflow "$ENVF" && chmod 600 "$ENVF"
printf 'LITESTREAM_ACCESS_KEY_ID=%s\nLITESTREAM_SECRET_ACCESS_KEY=%s\n' "$(env_get LITESTREAM_ACCESS_KEY_ID)" "$(env_get LITESTREAM_SECRET_ACCESS_KEY)" > /etc/default/litestream
chown root:root /etc/default/litestream && chmod 600 /etc/default/litestream
systemctl restart litestream
if [ -n "$(env_get LITESTREAM_ACCESS_KEY_ID)" ]; then
  say "✓ stockage objet : $(env_get CP_BACKUP_URL) (clés dans $ENVF, recopiées dans /etc/default/litestream)"
else
  say "… stockage objet sans clés : relancer avec S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY"
fi
systemctl enable guestflow-console >/dev/null

# ── 7. Firewall ──────────────────────────────────────────────────────────────────────────────────
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "✓ pare-feu : 22, 80, 443"

echo
echo "Reste à faire :"
echo "  1. compléter $ENVF : SMTP de la console et SMTP de la plateforme ;"
echo "  2. copier hors ligne CP_LICENCE_PRIVATE_KEY et /srv/guestflow/console/data/.key, .directory-key (créés au premier démarrage) ;"
echo "  3. systemctl start guestflow-console && sudo -u guestflow node $SRC/control-plane/server/scripts/create-operator.js ;"
echo "  4. ouvrir https://console.$DOMAIN, page « Versions » : installer la dernière version."
