#!/usr/bin/env bash
# Restores a GuestFlow backup (produced by scripts/backup-from-pi.sh) onto a Raspberry Pi.
#
# Order of operations matters: the app code must already be deployed (push the `release` branch,
# let GitHub Actions run) BEFORE restoring data, because the deploy recreates `current/` and the
# symlinks that point it at `data/guestflow.db` and `data/.env.local`.
#
# Full disaster-recovery sequence on a fresh Pi — see specs/backup-restore.md §4:
#   1. Reinstall Raspberry Pi OS + node + pm2 + the GitHub Actions runner.
#   2. Push `release` so the deploy workflow installs the app.
#   3. Run this script — it stops PM2, drops the data in place, restarts PM2.
#
# Usage:
#   scripts/restore-to-pi.sh --host pi@<pi-host> --from ~/GuestFlowBackups/latest
#   scripts/restore-to-pi.sh --host pi@<pi-host> --from <dir> --skip-certs   # regenerate TLS instead
#
# Options:
#   --host <user@host>  SSH target of the Pi. Defaults to $GUESTFLOW_SSH_HOST.
#   --from <dir>        Backup directory to restore. Defaults to $GUESTFLOW_BACKUP_DIR/latest.
#   --remote-dir <dir>  GuestFlow install dir on the Pi. Default: ~/guestflow (remote-expanded).
#   --skip-certs        Do not restore certs/ (use when the Pi has a new IP → regenerate instead).
#   --yes               Skip the confirmation prompt.
#   -h, --help          Show this help.
#
# The existing remote DB and .env.local are moved aside as `*.pre-restore-<stamp>` — never deleted.

set -euo pipefail

SSH_HOST="${GUESTFLOW_SSH_HOST:-}"
BACKUP_ROOT="${GUESTFLOW_BACKUP_DIR:-$HOME/GuestFlowBackups}"
FROM=""
REMOTE_DIR='$HOME/guestflow'
SKIP_CERTS=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --host) SSH_HOST="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --remote-dir) REMOTE_DIR="${2:-}"; shift 2 ;;
    --skip-certs) SKIP_CERTS=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

FROM="${FROM:-$BACKUP_ROOT/latest}"

if [ -z "$SSH_HOST" ]; then
  echo "Error: no SSH host. Pass --host user@host or set GUESTFLOW_SSH_HOST." >&2
  exit 2
fi
if [ ! -f "$FROM/guestflow.db" ] || [ ! -f "$FROM/.env.local" ]; then
  echo "Error: $FROM does not look like a GuestFlow backup (missing guestflow.db or .env.local)." >&2
  exit 2
fi

echo "▶ Restore $FROM → $SSH_HOST:$REMOTE_DIR"
sed -n '1,8p' "$FROM/manifest.txt" 2>/dev/null || true

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'This overwrites the production database on %s. Continue? [y/N] ' "$SSH_HOST"
  read -r answer
  case "$answer" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac
fi

STAMP="$(date +%Y%m%d-%H%M%S)"

# Resolve `$HOME`-relative remote paths once, on the Pi — see backup-from-pi.sh.
REMOTE_DIR="$(ssh "$SSH_HOST" "echo $REMOTE_DIR")"

ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR/data' '$REMOTE_DIR/certs'"

echo "  · stopping PM2…"
ssh "$SSH_HOST" 'pm2 stop guestflow >/dev/null 2>&1 || true'

# Move the current data aside rather than deleting it: if the backup turns out to be the wrong
# one, the operator still has the pre-restore state on the Pi.
echo "  · archiving current data as *.pre-restore-$STAMP…"
ssh "$SSH_HOST" "
  cd '$REMOTE_DIR/data'
  [ -f guestflow.db ] && mv guestflow.db guestflow.db.pre-restore-$STAMP
  [ -f .env.local ] && cp .env.local .env.local.pre-restore-$STAMP
  # Stale WAL/SHM belong to the OLD database file — keeping them would corrupt the restored one.
  rm -f guestflow.db-wal guestflow.db-shm
  true
"

echo "  · uploading database + .env.local…"
scp -q "$FROM/guestflow.db" "$SSH_HOST:$REMOTE_DIR/data/guestflow.db"
scp -q "$FROM/.env.local" "$SSH_HOST:$REMOTE_DIR/data/.env.local"
ssh "$SSH_HOST" "chmod 600 '$REMOTE_DIR/data/.env.local'"

if [ "$SKIP_CERTS" -eq 0 ] && [ -f "$FROM/certs/server.crt" ]; then
  echo "  · restoring TLS cert…"
  scp -q "$FROM/certs/server.crt" "$FROM/certs/server.key" "$SSH_HOST:$REMOTE_DIR/certs/"
  ssh "$SSH_HOST" "chmod 600 '$REMOTE_DIR/certs/server.key'"
fi

if [ -d "$FROM/uploads" ]; then
  echo "  · restoring uploads…"
  ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR/current/server/uploads'"
  rsync -aq "$FROM/uploads/" "$SSH_HOST:$REMOTE_DIR/current/server/uploads/"
fi

# The deploy workflow symlinks current/server/{guestflow.db,.env.local} → data/. On a fresh Pi the
# app may not be deployed yet; only re-link when the deployment directory exists.
ssh "$SSH_HOST" "
  if [ -d '$REMOTE_DIR/current/server' ]; then
    ln -sfn '$REMOTE_DIR/data/guestflow.db' '$REMOTE_DIR/current/server/guestflow.db'
    ln -sfn '$REMOTE_DIR/data/.env.local' '$REMOTE_DIR/current/server/.env.local'
  fi
"

echo "  · restarting PM2…"
ssh "$SSH_HOST" 'pm2 restart guestflow --update-env >/dev/null 2>&1 || echo "  ! guestflow not registered in PM2 — deploy the release branch first"'

echo "✓ Restore done. Check: ssh $SSH_HOST 'pm2 logs guestflow --lines 30'"
