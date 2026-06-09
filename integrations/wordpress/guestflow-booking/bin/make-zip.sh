#!/usr/bin/env bash
# Package the plugin into an installable guestflow-booking.zip (no build step — the source IS the
# artifact). Run from anywhere; the zip lands in the plugin directory's parent.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLUG="guestflow-booking"
OUT="$(dirname "$PLUGIN_DIR")/${SLUG}.zip"

cd "$(dirname "$PLUGIN_DIR")"
rm -f "$OUT"

# Zip the folder so it extracts as wp-content/plugins/guestflow-booking/.
zip -r "$OUT" "$SLUG" \
  -x "${SLUG}/.git/*" \
  -x "*/.DS_Store" \
  -x "${SLUG}/*.zip" \
  -x "${SLUG}/bin/*"

echo "Created: $OUT"
