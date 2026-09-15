#!/bin/bash
# Install the mod into the Civ7 Mods directory for local development.
#
# Copies rather than symlinks: a real directory is the mechanism Civ7 is known to load on
# macOS, and a failed smoke test caused by an unfollowed symlink is easy to misdiagnose as
# a bug in the mod. Re-run this after every edit.
set -e

MOD_NAME="civ7-tot-victory-forecaster"
MOD_SRC="$(cd "$(dirname "$0")/.." && pwd)"

CIV_DIR="$HOME/Library/Application Support/Civilization VII"
MOD_DEST="$CIV_DIR/Mods/$MOD_NAME"

echo "=== Installing $MOD_NAME ==="

RUNNING=0
if pgrep -qi CivilizationVII 2>/dev/null; then RUNNING=1; fi

if [ -L "$MOD_DEST" ]; then
	echo "Removing stale symlink from an earlier install..."
	rm "$MOD_DEST"
fi

# Does the manifest differ from what is already installed? That decides whether the
# Mods.sqlite script-list cache has to be invalidated.
MANIFEST_CHANGED=0
if ! cmp -s "$MOD_SRC/$MOD_NAME.modinfo" "$MOD_DEST/$MOD_NAME.modinfo" 2>/dev/null; then
	MANIFEST_CHANGED=1
fi

mkdir -p "$MOD_DEST"
rsync -a --delete \
	--exclude '.git' --exclude 'docs' --exclude 'scripts' \
	--exclude 'README.md' --exclude 'workshop.vdf' \
	"$MOD_SRC"/ "$MOD_DEST"/
echo "Copied: $MOD_SRC -> $MOD_DEST"

# Civ7 caches the per-mod UIScript LIST in Mods.sqlite. Adding, removing or renaming a
# <UIScript> <Item> is NOT picked up unless that cache is deleted. Editing the CONTENTS of an
# already-listed script needs no cache clear at all — just a game restart. So only insist on
# quitting the game when the manifest itself changed.
CACHE_FILE="$CIV_DIR/Mods.sqlite"
if [ "$MANIFEST_CHANGED" = "1" ]; then
	if [ "$RUNNING" = "1" ]; then
		echo ""
		echo "!! The manifest changed, so Mods.sqlite must be cleared — but Civ7 is running and"
		echo "   rewrites that file on exit. Quit Civ7 and re-run this script."
		exit 1
	fi
	[ -f "$CACHE_FILE" ] && rm "$CACHE_FILE" && echo "Manifest changed — cleared Mods.sqlite cache"
else
	echo "Script list unchanged — no cache clear needed."
fi

echo ""
if [ "$RUNNING" = "1" ]; then
	echo "Civ7 is running: the new code is in place but the OLD copy is still loaded."
	echo "Quit and relaunch Civ7 to pick it up — no need to re-run this script."
else
	echo "Launch Civ7 and enable 'ToT Victory Forecaster [Local Dev]' in Additional Content."
fi
