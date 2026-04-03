#!/bin/bash
# guestFlow release packaging script
# Usage: ./release.sh <release-name>
# Example: ./release.sh guestflow-1.0.0

set -e

RELEASE_NAME=${1:-guestflow-release}
RELEASE_DIR="$RELEASE_NAME"

echo "Creating release archive: ${RELEASE_NAME}.zip"
echo "Release directory: ${RELEASE_DIR}"

# Clean up any previous release
rm -rf "$RELEASE_DIR" "$RELEASE_NAME.zip"

# Create release directory structure
mkdir -p "$RELEASE_DIR"

# Compile Client part
npm run build

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
