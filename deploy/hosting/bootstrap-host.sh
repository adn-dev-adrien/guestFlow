#!/usr/bin/env bash
#
# One-time setup of a GuestFlow hosting host (specs/hosting-h1-fleet-runtime.md §4.4, §8).
# Debian 12 / Ubuntu 24.04, run as root. Idempotent: running it again changes nothing that is in place.
#
#   sudo DOMAIN=guestflow.fr ACME_EMAIL=ops@guestflow.fr \
#        REPO_URL=git@github.com:<owner>/guestFlow.git REF=v3.10.0 \
#        bash deploy/hosting/bootstrap-host.sh
#
# What it does (see deploy/hosting/README.md for the whole runbook):
#   1. Node 24, Caddy, Litestream and rclone;
#   2. two users — `guestflow` (the console) and `guestflow-app` (the instances and Litestream) — and
#      /srv/guestflow/{instances,releases,console,closed} with their owners (rule 21);
#   3. the instance unit template, the console unit, the two root wrappers and their sudoers rule;
#   4. Caddy's main file (admin API on a unix socket), the closed page; Litestream as guestflow-app,
#      its configuration root-owned and written only by guestflow-litestream-apply;
#   5. the console's source at REF, its dependencies and its build;
#   6. the console's environment from console.env.example (never overwritten once written);
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
# The console (`guestflow`) and the instances (`guestflow-app`) never share an identity. The console
# is in the instances' group, so it creates and reads their directories; the instances cannot read
# the console's directory, and each one sees only its own (guestflow@.service).
id guestflow-app >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin guestflow-app
id guestflow >/dev/null 2>&1 || useradd --system --home-dir "$ROOT/console" --shell /usr/sbin/nologin guestflow
usermod -aG guestflow-app guestflow
mkdir -p "$ROOT/instances" "$ROOT/releases" "$ROOT/console/data" "$ROOT/closed"
chown root:root "$ROOT" && chmod 755 "$ROOT"
chown guestflow:guestflow-app "$ROOT/instances" && chmod 2770 "$ROOT/instances"
chown guestflow:guestflow "$ROOT/releases" && chmod 755 "$ROOT/releases"
chown -R guestflow:guestflow "$ROOT/console" && chmod 700 "$ROOT/console"
install -m 644 "$HERE/closed/index.html" "$ROOT/closed/index.html"
say "✓ $ROOT (instances guestflow:guestflow-app 2770, releases et console à guestflow)"

# ── 3. Units, wrapper, sudoers ───────────────────────────────────────────────────────────────────
install -m 644 "$HERE/guestflow@.service" /etc/systemd/system/guestflow@.service
install -m 644 "$HERE/guestflow-console.service" /etc/systemd/system/guestflow-console.service
install -o root -g root -m 755 "$HERE/guestflow-systemctl" /usr/local/sbin/guestflow-systemctl
install -o root -g root -m 755 "$HERE/guestflow-litestream-apply" /usr/local/sbin/guestflow-litestream-apply
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
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__ACME_EMAIL__|$ACME_EMAIL|g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy
say "✓ Caddy configuré (console.$DOMAIN, app.$DOMAIN, sites/*.caddy ; API d'administration sur /run/caddy/admin.sock)"

# Root-owned, never writable by the console: it is written by guestflow-litestream-apply only.
mkdir -p /etc/guestflow && chmod 755 /etc/guestflow
if [ ! -f /etc/guestflow/backup.env ]; then
  printf 'CP_BACKUP_URL=\nCP_BACKUP_ENDPOINT=\nCP_BACKUP_REGION=\n' > /etc/guestflow/backup.env
fi
chown root:root /etc/guestflow/backup.env && chmod 600 /etc/guestflow/backup.env
grep -q 'guestflow-litestream-apply' /etc/litestream.yml 2>/dev/null || install -o root -g root -m 644 "$HERE/litestream.yml" /etc/litestream.yml
chown root:root /etc/litestream.yml && chmod 644 /etc/litestream.yml
if [ ! -f /etc/default/litestream ]; then
  printf 'LITESTREAM_ACCESS_KEY_ID=\nLITESTREAM_SECRET_ACCESS_KEY=\n' > /etc/default/litestream
fi
chown root:root /etc/default/litestream && chmod 600 /etc/default/litestream
mkdir -p /etc/systemd/system/litestream.service.d
install -m 644 "$HERE/litestream.override.conf" /etc/systemd/system/litestream.service.d/guestflow.conf
systemctl daemon-reload
systemctl enable litestream >/dev/null
say "✓ Litestream en guestflow-app (/etc/litestream.yml root 644, clés dans /etc/default/litestream, cible dans /etc/guestflow/backup.env)"

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
ENVF="$ROOT/console/env"
if [ ! -f "$ENVF" ]; then
  secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=')"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__SESSION_SECRET__|$secret|g" "$HERE/console.env.example" > "$ENVF"
  chown guestflow:guestflow "$ENVF" && chmod 600 "$ENVF"
  say "✓ $ENVF écrit — à compléter"
else
  say "✓ $ENVF déjà en place (non modifié)"
fi
systemctl enable guestflow-console >/dev/null

# ── 7. Firewall ──────────────────────────────────────────────────────────────────────────────────
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "✓ pare-feu : 22, 80, 443"

echo
echo "Reste à faire :"
echo "  1. compléter $ENVF (clé de licence, SMTP de la console, stockage objet et ses clés, SMTP de la plateforme) ;"
echo "  2. compléter /etc/default/litestream (clés) et /etc/guestflow/backup.env (CP_BACKUP_URL, _ENDPOINT, _REGION), puis : sudo -u guestflow rclone config ;"
echo "  3. systemctl start guestflow-console && sudo -u guestflow node $SRC/control-plane/server/scripts/create-operator.js ;"
echo "  4. ouvrir https://console.$DOMAIN, page « Versions » : installer la dernière version."
