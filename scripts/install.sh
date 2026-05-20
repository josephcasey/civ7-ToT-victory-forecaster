#!/bin/bash
# Symlink the mod into the Civ7 Mods directory for local development.

MOD_NAME="civ7-tot-victory-forecaster"
MOD_SRC="$(cd "$(dirname "$0")/.." && pwd)"

# macOS default path — adjust for your platform if needed.
MOD_DEST="$HOME/Library/Application Support/Civilization VII/Mods/$MOD_NAME"

echo "=== Installing $MOD_NAME ==="

if [ -L "$MOD_DEST" ]; then
	echo "Symlink already exists, removing..."
	rm "$MOD_DEST"
elif [ -d "$MOD_DEST" ]; then
	echo "WARNING: Real directory exists at $MOD_DEST"
	echo "Remove it manually to use the symlink install."
	exit 1
fi

ln -s "$MOD_SRC" "$MOD_DEST"
echo "Linked: $MOD_DEST -> $MOD_SRC"

# Clear mod cache so Civ7 picks up changes.
CACHE_FILE="$HOME/Library/Application Support/Civilization VII/Mods.sqlite"
if [ -f "$CACHE_FILE" ]; then
	rm "$CACHE_FILE"
	echo "Cleared Mods.sqlite cache"
fi

echo ""
echo "Done. Launch Civ7 and enable 'ToT Victory Forecaster [Local Dev]' in Additional Content."
