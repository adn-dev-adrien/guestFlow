#!/usr/bin/env bash
# The real-host check of the hosting (deploy/hosting/test/README.md): a throwaway Debian 12 host with
# systemd + MinIO, bootstrapped exactly as the runbook says, then every scenario through the console.
# Needs Docker with privileged containers; removes everything at the end (KEEP=1 keeps it).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .work
branch="$(git rev-parse --abbrev-ref HEAD)"
echo "$branch" > .work/branch
git bundle create .work/repo.bundle "$branch" >/dev/null 2>&1
cleanup() { [ "${KEEP:-}" = "1" ] || docker compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker compose up -d --build
for i in $(seq 1 60); do docker compose exec -T host systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break; sleep 2; done
docker compose exec -T host bash /hosting/test/inside.sh
