#!/bin/bash
# guestFlow release packaging script
# Usage: ./release.sh <release-name>
# Example: ./release.sh guestflow-1.0.0
#
# Environment variables:
#   REBUILD_CLIENT=true   Force a fresh `cd client && npm run build` even if `client/build`
#                          already exists. Default: skip rebuild when artifact present.
#                          The deploy workflow already builds the client (with
#                          `GENERATE_SOURCEMAP=false`) before calling this script — skipping
#                          the rebuild here saves ~2-3 minutes per deploy on the Pi.

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
# The deploy workflow always pre-builds the client in a dedicated step (`⚛️ Build React
# client`) with `GENERATE_SOURCEMAP=false` — so by the time this script runs in CI, the
# `client/build` directory is already present and the artifact has no .map files in it.
# Rebuilding here would (a) waste 2-3 minutes per deploy on the Pi, and (b) silently
# regenerate the sourcemaps because this script's `npm run build` ran without the env var
# guard, leaking the un-minified bundle on the prod server. That was the security regression
# H1 spotted in the 2026-06-01 audit.
#
# Behaviour:
#   - `client/build` exists + `REBUILD_CLIENT` not set → skip (CI's normal path).
#   - `client/build` missing OR `REBUILD_CLIENT=true` → build with `GENERATE_SOURCEMAP=false`
#     forced so no map files leak regardless of caller environment.
if [ -d client/build ] && [ "$REBUILD_CLIENT" != "true" ]; then
  echo "ℹ client/build already exists — skipping rebuild (set REBUILD_CLIENT=true to force)"
else
  echo "Building client (GENERATE_SOURCEMAP=false)..."
  (cd client && GENERATE_SOURCEMAP=false npm run build)
fi

# Copy server (excluding dev files and node_modules)
rsync -av --exclude='node_modules' --exclude='*.log' --exclude='guestflow.db' --exclude='uploads' server "$RELEASE_DIR/"

# Copy uploads (if you want to include existing docs/photos)
if [ -d server/uploads ]; then
  cp -r server/uploads "$RELEASE_DIR/server/"
fi

# Copy client build (must be built before running this script)
if [ ! -d client/build ]; then
  echo "Error: client/build does not exist. Run 'cd client && npm run build' first."
  exit 1
fi
rsync -av client/build "$RELEASE_DIR/client/"

# Copy root files
cp package.json "$RELEASE_DIR/"

# Create the zip archive
zip -r "$RELEASE_NAME.zip" "$RELEASE_DIR"

# Cleanup
rm -rf "$RELEASE_DIR"

echo "Release archive created: $RELEASE_NAME.zip"
