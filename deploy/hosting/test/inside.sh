#!/usr/bin/env bash
# Runs INSIDE the throwaway host (run.sh starts it): bootstrap as the runbook says, fill in the
# environment for this lab (MinIO, a local SMTP sink, Caddy's own CA), then the scenarios.
set -euo pipefail
ROOT=/srv/guestflow
BRANCH="$(cat /work/branch)"
echo "== bootstrap"
DOMAIN=gf.test ACME_EMAIL=ops@gf.test REPO_URL=/work/repo.bundle REF="$BRANCH" GUESTFLOW_TEST_LOCAL_CERTS=1 \
  bash /hosting/bootstrap-host.sh

echo "== lab: names, SMTP sink, object storage keys"
grep -q 'gf.test' /etc/hosts || echo "127.0.0.1 console.gf.test app.gf.test aulnes.gf.test moulin.gf.test les-moulin.gf.test" >> /etc/hosts
systemctl is-active gf-smtp >/dev/null 2>&1 || systemd-run --unit gf-smtp python3 -m smtpd -n -c DebuggingServer 127.0.0.1:1025
printf 'LITESTREAM_ACCESS_KEY_ID=gfaccess\nLITESTREAM_SECRET_ACCESS_KEY=gfsecret-0123456789\n' > /etc/default/litestream
KEY="$(node -e "const c=require('crypto');const {privateKey}=c.generateKeyPairSync('ed25519');process.stdout.write(privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))")"
ENVF=$ROOT/console/env
set_env() { if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
set_env CP_LICENCE_PRIVATE_KEY "$KEY"
set_env CP_SMTP_HOST 127.0.0.1; set_env CP_SMTP_PORT 1025
set_env CP_PLATFORM_SMTP_HOST 127.0.0.1; set_env CP_PLATFORM_SMTP_PORT 1025
set_env CP_BACKUP_URL s3://gf-backups/fleet
set_env CP_BACKUP_ENDPOINT http://minio:9000
set_env CP_BACKUP_REGION us-east-1
set_env LITESTREAM_ACCESS_KEY_ID gfaccess
set_env LITESTREAM_SECRET_ACCESS_KEY gfsecret-0123456789
set_env CP_RCLONE_REMOTE gfbackup:gf-backups/fleet
set_env RCLONE_CONFIG_GFBACKUP_TYPE s3
set_env RCLONE_CONFIG_GFBACKUP_PROVIDER Minio
set_env RCLONE_CONFIG_GFBACKUP_ENDPOINT http://minio:9000
set_env RCLONE_CONFIG_GFBACKUP_ACCESS_KEY_ID gfaccess
set_env RCLONE_CONFIG_GFBACKUP_SECRET_ACCESS_KEY gfsecret-0123456789
set_env CP_HEALTH_TIMEOUT_MS 45000
# Caddy's own CA, trusted by the console for its health checks (lab only).
for i in $(seq 1 30); do [ -f /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt ] && break; sleep 1; done
cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt /usr/local/share/ca-certificates/caddy-lab.crt
update-ca-certificates >/dev/null 2>&1
set_env NODE_EXTRA_CA_CERTS /etc/ssl/certs/ca-certificates.crt
env RCLONE_CONFIG_GFBACKUP_TYPE=s3 RCLONE_CONFIG_GFBACKUP_PROVIDER=Minio RCLONE_CONFIG_GFBACKUP_ENDPOINT=http://minio:9000 \
  RCLONE_CONFIG_GFBACKUP_ACCESS_KEY_ID=gfaccess RCLONE_CONFIG_GFBACKUP_SECRET_ACCESS_KEY=gfsecret-0123456789 rclone mkdir gfbackup:gf-backups
systemctl restart litestream

echo "== first release, operator, console"
SRC=$ROOT/console/src
sudo -u guestflow node $SRC/control-plane/server/scripts/dev-release.js $ROOT/releases 9.0.0 --copy-modules
sudo -u guestflow bash -c "set -a; . $ENVF; set +a; cd $SRC/control-plane/server && CP_OPERATOR_PASSWORD='lab-operator-pass!' node scripts/create-operator.js --email ops@gf.test --name Ops" || true
systemctl restart guestflow-console
for i in $(seq 1 30); do curl -fsS -o /dev/null https://console.gf.test/api/auth/me -w '' 2>/dev/null; code=$?; [ $code -ne 7 ] && break; sleep 1; done

echo "== scenarios"
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt node /hosting/test/scenarios.js
