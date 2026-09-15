#!/bin/bash
# Install the mod into the Civ7 Mods directory for local development.
#
# Copies rather than symlinks: a real directory is the mechanism Civ7 is known to load on
# macOS, and a failed smoke test caused by an unfollowed symlink is easy to misdiagnose as
# a bug in the mod. Re-run this after every edit.
#
# The installed copy is re-stamped as a SEPARATE mod from the published Workshop item:
# its Mod id gains a "-local" suffix and its browser name gains "[Local Dev]". Without
# that, a subscribed copy of our own Workshop item and this dev copy would share a Mod id
# and collide - the stale Workshop version can win, so local edits appear to do nothing.
# Re-stamping keeps the published payload clean while letting both coexist and stay
# tellable apart in Additional Content.
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

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
rsync -a \
	--exclude '.git' --exclude 'docs' --exclude 'scripts' --exclude 'build' \
	--exclude 'README.md' --exclude 'workshop.vdf' --exclude 'preview.png' \
	--exclude '.gitignore' \
	"$MOD_SRC"/ "$STAGE"/

# Re-stamp as a distinct local-dev mod (see the note at the top of this file).
python3 - "$STAGE/$MOD_NAME.modinfo" "$STAGE/text/en_us/ModInfoText.xml" <<'PY'
import io, re, sys
mi, txt = sys.argv[1], sys.argv[2]
s = io.open(mi, encoding='utf-8').read()
s = re.sub(r'(<Mod id=")([^"]+)(")',
           lambda m: m.group(1) + m.group(2) + ('' if m.group(2).endswith('-local') else '-local') + m.group(3),
           s, count=1)
io.open(mi, 'w', encoding='utf-8').write(s)
t = io.open(txt, encoding='utf-8').read()
t = t.replace('<Text>ToT Victory Forecaster</Text>', '<Text>ToT Victory Forecaster [Local Dev]</Text>', 1)
io.open(txt, 'w', encoding='utf-8').write(t)
PY

# Compare the RE-STAMPED manifest against what is installed: the Mods.sqlite script-list
# cache only needs invalidating when the manifest itself changed.
MANIFEST_CHANGED=0
if ! cmp -s "$STAGE/$MOD_NAME.modinfo" "$MOD_DEST/$MOD_NAME.modinfo" 2>/dev/null; then
	MANIFEST_CHANGED=1
fi

mkdir -p "$MOD_DEST"
rsync -a --delete "$STAGE"/ "$MOD_DEST"/
echo "Copied: $MOD_SRC -> $MOD_DEST"
echo "Installed as: $(grep -o '<Mod id=\"[^\"]*\"' "$MOD_DEST/$MOD_NAME.modinfo" | head -1)"

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
	echo "If you are also subscribed to the Workshop item, disable it there to avoid running both."
fi
