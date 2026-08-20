#!/usr/bin/env bash
#
# GuestFlow self-update — swap phase (specs/self-update-and-releases.md §3.E).
#
# Spawned DETACHED by the running application, which then dies when PM2 restarts it. This script has
# to outlive its parent: it is the PM2 transposition of sowel's helper container (sowel spec 060) —
# a process cannot orchestrate its own replacement.
#
# It never builds anything and never touches the database: staging already downloaded, verified,
# installed and backed up. All that is left is: point `current` at the new release, restart, and
# PROVE the new version actually came up. If it did not, roll the symlink back and restart again.
#
# Usage (every value is validated by the caller before it gets here):
#   apply-update.sh --root DIR --target X.Y.Z --previous-dir DIR --pm2 PATH --ecosystem FILE \
#                   --status FILE --runtime FILE --log FILE --health URL --started-at ISO \
#                   --from X.Y.Z [--timeout SECONDS]

set -uo pipefail

ROOT="" TARGET="" PREVIOUS_DIR="" PM2_BIN="" ECOSYSTEM="" STATUS_FILE="" RUNTIME_FILE=""
LOG_FILE="" HEALTH_URL="" STARTED_AT="" FROM_VERSION="" TIMEOUT=120

while [ $# -gt 0 ]; do
  case "$1" in
    --root)        ROOT="$2"; shift 2 ;;
    --target)      TARGET="$2"; shift 2 ;;
    --previous-dir) PREVIOUS_DIR="$2"; shift 2 ;;
    --pm2)         PM2_BIN="$2"; shift 2 ;;
    --ecosystem)   ECOSYSTEM="$2"; shift 2 ;;
    --status)      STATUS_FILE="$2"; shift 2 ;;
    --runtime)     RUNTIME_FILE="$2"; shift 2 ;;
    --log)         LOG_FILE="$2"; shift 2 ;;
    --health)      HEALTH_URL="$2"; shift 2 ;;
    --started-at)  STARTED_AT="$2"; shift 2 ;;
    --from)        FROM_VERSION="$2"; shift 2 ;;
    --timeout)     TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

mkdir -p "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(now_iso)] $*"; }

# Rewrite the whole status document each time: the script holds every field, so there is nothing to
# merge, and a tmp-file + mv keeps the reader from ever seeing a half-written file.
write_status() {
  phase="$1"
  error_code="${2:-}"
  if [ -n "$error_code" ]; then
    error_json="\"$error_code\""
  else
    error_json="null"
  fi
  tmp="${STATUS_FILE}.tmp"
  printf '{\n  "phase": "%s",\n  "fromVersion": "%s",\n  "targetVersion": "%s",\n  "startedAt": "%s",\n  "updatedAt": "%s",\n  "logFile": "%s",\n  "errorCode": %s,\n  "historyRecorded": false\n}\n' \
    "$phase" "$FROM_VERSION" "$TARGET" "$STARTED_AT" "$(now_iso)" "$LOG_FILE" "$error_json" > "$tmp" \
    && mv "$tmp" "$STATUS_FILE"
}

running_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME_FILE" 2>/dev/null | head -1
}

# Alive AND on the expected version. The HTTP probe alone would happily pass on the old code, which
# is precisely the false "update succeeded" this script exists to prevent.
wait_for_version() {
  expected="$1"
  deadline=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsSk -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null; then
      current="$(running_version)"
      if [ "$current" = "$expected" ]; then
        return 0
      fi
    fi
    sleep 3
  done
  return 1
}

point_current_at() {
  ln -sfn "$1" "$ROOT/current"
}

restart_app() {
  "$PM2_BIN" startOrRestart "$ECOSYSTEM" --update-env
}

log "=== self-update $FROM_VERSION -> $TARGET ==="

# Let the HTTP response that triggered this reach the browser before we kill the process serving it.
sleep 3

write_status "swapping"
log "pointing current -> releases/$TARGET"
if ! point_current_at "$ROOT/releases/$TARGET"; then
  log "FAILED to update the current symlink"
  write_status "failed" "SYMLINK_FAILED"
  exit 1
fi

write_status "restarting"
log "restarting via $PM2_BIN startOrRestart $ECOSYSTEM"
if ! restart_app; then
  log "pm2 restart returned non-zero — attempting rollback"
  RESTART_FAILED=1
else
  RESTART_FAILED=0
fi

if [ "$RESTART_FAILED" -eq 0 ] && wait_for_version "$TARGET"; then
  log "verified: $TARGET is serving"
  write_status "done"
  log "=== update complete ==="
  exit 0
fi

observed="$(running_version)"
log "verification FAILED (observed version: '${observed:-none}') — rolling back"

if [ -z "$PREVIOUS_DIR" ] || [ ! -d "$PREVIOUS_DIR" ]; then
  log "no previous release directory available — cannot roll back"
  write_status "failed" "NO_PREVIOUS_RELEASE"
  exit 1
fi

if [ "$RESTART_FAILED" -eq 1 ]; then
  FAILURE_CODE="PM2_FAILED"
elif [ -n "$observed" ] && [ "$observed" != "$TARGET" ]; then
  FAILURE_CODE="WRONG_VERSION"
else
  FAILURE_CODE="HEALTHCHECK_TIMEOUT"
fi

write_status "swapping" "$FAILURE_CODE"
point_current_at "$PREVIOUS_DIR"
restart_app

if wait_for_version "$FROM_VERSION"; then
  log "rollback complete — $FROM_VERSION is serving again"
  write_status "rolled_back" "$FAILURE_CODE"
  exit 1
fi

log "ROLLBACK FAILED — the application may be down. Recover with:"
log "  ln -sfn $PREVIOUS_DIR $ROOT/current && $PM2_BIN startOrRestart $ECOSYSTEM --update-env"
write_status "failed" "ROLLBACK_FAILED"
exit 1
