#!/bin/bash
# guestFlow release packaging script
# Usage: ./release.sh <release-name>
# Example: ./release.sh guestflow-1.0.0
#
# Environment variables:
#   REBUILD_CLIENT=true   Force a fresh `cd client && npm run build` even if `client/dist`
#                          already exists. Default: skip rebuild when artifact present.
#                          The deploy workflow already builds the client before calling this
#                          script — skipping the rebuild here saves time per deploy on the Pi.

set -e

RELEASE_NAME=${1:-guestflow-release}
RELEASE_DIR="$RELEASE_NAME"

echo "Creating release archive: ${RELEASE_NAME}.zip"
echo "Release directory: ${RELEASE_DIR}"

# Clean up any previous release
rm -rf "$RELEASE_DIR" "$RELEASE_NAME.zip"

# Create release directory structure
mkdir -p "$RELEASE_DIR"

# Compile the React client.
#
# Vite (post-CRA migration, specs/cra-to-vite-migration.md) writes to `client/dist` and is
# configured with `build.sourcemap = false` directly in `client/vite.config.js` — no env
# var override required (the security regression H1 spotted in the 2026-06-01 audit is now
# guarded inside the config itself). The deploy workflow still pre-builds the client in its
# dedicated step (`⚛️ Build React client`), so by the time this script runs in CI the
# `client/dist` directory is already present.
#
# Behaviour:
#   - `client/dist` exists + `REBUILD_CLIENT` not set → skip (CI's normal path).
#   - `client/dist` missing OR `REBUILD_CLIENT=true` → run `npm run build`.
if [ -d client/dist ] && [ "$REBUILD_CLIENT" != "true" ]; then
  echo "ℹ client/dist already exists — skipping rebuild (set REBUILD_CLIENT=true to force)"
else
  echo "Building client (vite build)..."
  (cd client && npm run build)
fi

# Copy server (excluding dev files and node_modules)
rsync -av --exclude='node_modules' --exclude='*.log' --exclude='guestflow.db' --exclude='uploads' server "$RELEASE_DIR/"

# Copy uploads (if you want to include existing docs/photos)
if [ -d server/uploads ]; then
  cp -r server/uploads "$RELEASE_DIR/server/"
fi

# Copy client build (must be built before running this script).
# The Pi PM2 entry expects the bundle at `current/client/build` (legacy CRA name) so we
# rename `dist` to `build` inside the archive. This keeps the deployed layout backwards
# compatible with the PM2 process file + any caddy/nginx config that references it.
#
# `--mkpath` (GNU rsync ≥ 3.2.3) creates the missing intermediate parent
# `$RELEASE_DIR/client/` on the fly. Without it, rsync only mkdir's the leaf (`build/`) and
# fails because the prior step in this script (line ~46) only created `$RELEASE_DIR/server/`
# — `$RELEASE_DIR/client/` never existed. Regression introduced in the CRA → Vite migration
# (PR #111): the previous CRA path copied `client/build/` directly, so the parent layout
# was created by a different rsync invocation.
#
# The deploy runner (Pi) runs GNU rsync 3.4.1 — `--mkpath` is supported there. Note for
# local dev on macOS: the default `rsync` shipped by Apple is openrsync (BSD fork) which
# does NOT understand `--mkpath`; if you want to test this script locally, install GNU
# rsync via Homebrew (`brew install rsync`) and prepend its path to your shell.
if [ ! -d client/dist ]; then
  echo "Error: client/dist does not exist. Run 'cd client && npm run build' first."
  exit 1
fi
rsync -av --mkpath client/dist/ "$RELEASE_DIR/client/build/"

# Copy root files
cp package.json "$RELEASE_DIR/"

# Create the zip archive
zip -r "$RELEASE_NAME.zip" "$RELEASE_DIR"

# Cleanup
rm -rf "$RELEASE_DIR"

echo "Release archive created: $RELEASE_NAME.zip"
