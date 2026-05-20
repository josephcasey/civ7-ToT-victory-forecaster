#!/bin/bash
# Upload the mod to Steam Workshop via steamcmd.
# Usage: ./scripts/upload_workshop.sh [steam_username]
# On first run, leave publishedfileid blank in workshop.vdf — steamcmd will
# print the new item ID. Paste it into workshop.vdf for future updates.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VDF_SRC="$REPO_ROOT/workshop.vdf"
VDF_TMP="$(mktemp /tmp/workshop_XXXXXX.vdf)"
PREVIEW="$REPO_ROOT/preview.png"
STEAM_USER="${1:-}"

if [ -z "$STEAM_USER" ]; then
  read -rp "Steam username: " STEAM_USER
fi

if ! command -v steamcmd &>/dev/null; then
  echo "steamcmd not found. Install with: brew install steamcmd"
  exit 1
fi

# Write a resolved copy of the vdf with absolute paths filled in
sed \
  -e "s|\"contentfolder\"[[:space:]]*\"[^\"]*\"|\"contentfolder\"\t\t\"$REPO_ROOT\"|" \
  -e "s|\"previewfile\"[[:space:]]*\"[^\"]*\"|\"previewfile\"\t\t\"$PREVIEW\"|" \
  "$VDF_SRC" > "$VDF_TMP"

echo "=== Resolved workshop.vdf ==="
cat "$VDF_TMP"
echo "=============================="
echo ""

steamcmd +login "$STEAM_USER" \
         +workshop_build_item "$VDF_TMP" \
         +quit

rm -f "$VDF_TMP"
