#!/usr/bin/env bash
# Pulls a full GuestFlow production backup from the Raspberry Pi to the local machine.
#
# What it saves (everything that is NOT reproducible from git):
#   - the SQLite database, taken with `sqlite3 .backup` so the WAL is folded in and the
#     snapshot is consistent even while the server is writing;
#   - `data/.env.local` — the AES-256-GCM encryption key + SMTP / Google / Qonto secrets.
#     Without it the encrypted columns of the DB are unreadable, so a DB-only backup is useless;
#   - `certs/` — the self-signed TLS cert + key (restoring them avoids re-trusting the cert on
#     every device);
#   - `server/uploads/` — user-uploaded files (logos, photos), which live outside the DB.
#
# Everything else (client build, node_modules, server code) is rebuilt by the `release` deploy.
#
# Usage:
#   scripts/backup-from-pi.sh --host pi@<pi-host>
#   GUESTFLOW_SSH_HOST=pi@<pi-host> scripts/backup-from-pi.sh
#   scripts/backup-from-pi.sh --host pi@<pi-host> --dest /Volumes/Backup/GuestFlow --keep 10
#
# Options:
#   --host <user@host>  SSH target of the Pi. Defaults to $GUESTFLOW_SSH_HOST.
#   --dest <dir>        Backup root. Defaults to $GUESTFLOW_BACKUP_DIR, else ~/GuestFlowBackups.
#   --remote-dir <dir>  GuestFlow install dir on the Pi. Default: ~/guestflow (remote-expanded).
#   --keep <n>          Keep only the N most recent backups. Default 30. Use 0 to disable pruning.
#   -h, --help          Show this help.
#
# Writes $DEST/guestflow-YYYYMMDD-HHMMSS/ (mode 0700 — it contains secrets) plus a `latest`
# symlink. Restore with scripts/restore-to-pi.sh; see specs/backup-restore.md.

set -euo pipefail

SSH_HOST="${GUESTFLOW_SSH_HOST:-}"
DEST_ROOT="${GUESTFLOW_BACKUP_DIR:-$HOME/GuestFlowBackups}"
REMOTE_DIR='$HOME/guestflow'
KEEP=30

while [ $# -gt 0 ]; do
  case "$1" in
    --host) SSH_HOST="${2:-}"; shift 2 ;;
    --dest) DEST_ROOT="${2:-}"; shift 2 ;;
    --remote-dir) REMOTE_DIR="${2:-}"; shift 2 ;;
    --keep) KEEP="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ -z "$SSH_HOST" ]; then
  echo "Error: no SSH host. Pass --host user@host or set GUESTFLOW_SSH_HOST." >&2
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$DEST_ROOT/guestflow-$STAMP"
REMOTE_SNAPSHOT="/tmp/guestflow-backup-$STAMP.db"

echo "▶ GuestFlow backup — $SSH_HOST → $DEST"

if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" true 2>/dev/null; then
  echo "Error: cannot reach $SSH_HOST over SSH (host down, or key auth not set up)." >&2
  exit 1
fi

# Resolve `$HOME`-relative remote paths once, on the Pi. Afterwards every remote command can
# single-quote the path (safe against spaces) without killing the expansion.
REMOTE_DIR="$(ssh "$SSH_HOST" "echo $REMOTE_DIR")"

mkdir -p "$DEST"
chmod 700 "$DEST"

# 1. Consistent DB snapshot. `sqlite3 .backup` checkpoints the WAL into the copy, so we never
#    ship a half-written page set — unlike a plain `cp` of guestflow.db while PM2 is running.
echo "  · snapshotting the database (sqlite3 .backup)…"
ssh "$SSH_HOST" "sqlite3 '$REMOTE_DIR/data/guestflow.db' \".backup '$REMOTE_SNAPSHOT'\" \
  && sqlite3 '$REMOTE_SNAPSHOT' 'PRAGMA integrity_check;'" > "$DEST/integrity_check.txt"

if ! grep -qx "ok" "$DEST/integrity_check.txt"; then
  echo "Error: integrity_check failed on the snapshot — see $DEST/integrity_check.txt" >&2
  ssh "$SSH_HOST" "rm -f '$REMOTE_SNAPSHOT'" || true
  exit 1
fi

scp -q "$SSH_HOST:$REMOTE_SNAPSHOT" "$DEST/guestflow.db"
ssh "$SSH_HOST" "rm -f '$REMOTE_SNAPSHOT'"

# 2. Secrets + TLS material + uploads.
echo "  · pulling .env.local, certs/ and uploads/…"
scp -q "$SSH_HOST:$REMOTE_DIR/data/.env.local" "$DEST/.env.local"
chmod 600 "$DEST/.env.local"

mkdir -p "$DEST/certs"
scp -q "$SSH_HOST:$REMOTE_DIR/certs/server.crt" "$SSH_HOST:$REMOTE_DIR/certs/server.key" "$DEST/certs/" \
  || echo "  ! no TLS cert found on the Pi — skipped (it can be regenerated)"
chmod 600 "$DEST/certs/server.key" 2>/dev/null || true

# `--exclude` drops the deploy workflow's own scratch copy so we don't nest uploads in uploads.
rsync -aq --exclude '_guestflow_uploads_backup' \
  "$SSH_HOST:$REMOTE_DIR/current/server/uploads/" "$DEST/uploads/" \
  || echo "  ! no uploads directory on the Pi — skipped"

# 3. Manifest: what the restore side needs to know about this snapshot.
{
  echo "GuestFlow backup"
  echo "date:            $(date -Iseconds)"
  echo "source:          $SSH_HOST:$REMOTE_DIR"
  echo "taken from:      $(hostname)"
  echo "local repo HEAD: $(git -C "$(dirname "$0")/.." rev-parse HEAD 2>/dev/null || echo n/a)"
  echo "origin/release:  $(git -C "$(dirname "$0")/.." rev-parse origin/release 2>/dev/null || echo n/a)"
  echo "remote node:     $(ssh "$SSH_HOST" 'node -v' 2>/dev/null || echo n/a)"
  echo "remote app ver:  $(ssh "$SSH_HOST" "node -p \"require('$REMOTE_DIR/current/server/package.json').version\"" 2>/dev/null || echo n/a)"
  echo "integrity_check: $(cat "$DEST/integrity_check.txt")"
  echo
  echo "contents:"
  ( cd "$DEST" && find . -type f -not -name manifest.txt | sort | while read -r f; do
      printf '  %-52s %8s\n' "$f" "$(du -h "$f" | cut -f1)"
    done )
} > "$DEST/manifest.txt"

( cd "$DEST" && find . -type f -not -name checksums.sha256 -exec shasum -a 256 {} + > checksums.sha256 )

ln -sfn "$DEST" "$DEST_ROOT/latest"

# 4. Rotation — oldest first, keeping the N most recent timestamped directories.
# Names are timestamped, so lexicographic sort == chronological sort. Kept portable (no
# `head -n -N`, no `mapfile`): macOS ships BSD head and bash 3.2.
if [ "$KEEP" -gt 0 ]; then
  TOTAL="$(find "$DEST_ROOT" -maxdepth 1 -type d -name 'guestflow-*' | wc -l | tr -d ' ')"
  if [ "$TOTAL" -gt "$KEEP" ]; then
    find "$DEST_ROOT" -maxdepth 1 -type d -name 'guestflow-*' | sort | head -n "$((TOTAL - KEEP))" \
      | while read -r dir; do
          echo "  · pruning old backup $(basename "$dir")"
          rm -rf "$dir"
        done
  fi
fi

echo "✓ Backup complete: $DEST ($(du -sh "$DEST" | cut -f1))"
echo "  Restore: scripts/restore-to-pi.sh --host $SSH_HOST --from $DEST"
