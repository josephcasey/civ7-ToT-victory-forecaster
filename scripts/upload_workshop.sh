#!/bin/bash
# Publish / update the mod on the Steam Workshop.
#
# Uploads the staged mod payload. The PREVIEW IMAGE CANNOT BE UPLOADED for this
# app and must be set by hand on the item's Edit page - proven, with the item
# created on 2026-09-15:
#
#   Uploading preview image...clientugc.cpp (2069) :
#       k_EPublishedFileStorageSystemLegacyCloud == eStorage
#   ERROR! Failed to update workshop item (Access Denied).
#
# That is an assertion inside Steam's own client: its preview-upload path only
# supports items held in LEGACY CLOUD storage, and Civ VII items use the newer
# UGC storage. So it fails regardless of image size, path, or VDF shape. Nothing
# in this script can work around it.
#
# `--try-preview` keeps the attempt available in case Valve ever fixes it. It
# runs a second workshop_build_item with a minimal VDF (appid + publishedfileid +
# previewfile only); `contentfolder` is optional and omitting it leaves the
# uploaded files untouched, so a retry cannot clobber the content.
#
# steamcmd cannot be driven from a non-TTY shell, so login goes through the
# expect wrapper, which reads the password from the macOS Keychain (never
# printed) and surfaces Steam Guard in a dialog.
#
# Usage:
#   ./scripts/upload_workshop.sh [--changenote "text"] [--try-preview|--preview-only]
set -euo pipefail

STEAM_LOGIN="${STEAM_LOGIN:-josephcasey}"
KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-civ7-steamcmd-upload}"
MOD_NAME="civ7-tot-victory-forecaster"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/steam"
STAGE="$BUILD/content/$MOD_NAME"
PREVIEW="$ROOT/preview.png"
WRAPPER="$ROOT/scripts/steamcmd_upload_with_keychain.expect"
GEN="$ROOT/scripts/build_workshop_vdf.py"

CHANGENOTE=""
DO_CONTENT=1
DO_PREVIEW=0   # see the note above: impossible for this app
while [ $# -gt 0 ]; do
	case "$1" in
		--changenote)   CHANGENOTE="$2"; shift 2 ;;
		--try-preview)  DO_PREVIEW=1; shift ;;
		--preview-only) DO_CONTENT=0; DO_PREVIEW=1; shift ;;
		*) echo "unknown argument: $1" >&2; exit 1 ;;
	esac
done

command -v steamcmd >/dev/null || { echo "steamcmd not found (brew install steamcmd)" >&2; exit 1; }
[ -x "$WRAPPER" ] || { echo "missing $WRAPPER" >&2; exit 1; }
security find-generic-password -w -a "$STEAM_LOGIN" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 \
	|| { echo "No Keychain password for '$STEAM_LOGIN' in service '$KEYCHAIN_SERVICE'." >&2; exit 1; }

current_id() { python3 -c "
import re,sys
print((re.search(r'\"publishedfileid\"\s*\"([^\"]*)\"', open('$ROOT/workshop.vdf').read()) or [None,''])[1])"; }

mkdir -p "$BUILD"

# ── 1. content ───────────────────────────────────────────────────────────────
if [ "$DO_CONTENT" = "1" ]; then
	# Stage ONLY what the game loads. The repo root would drag in .git, docs,
	# scripts, the README and the preview image itself.
	rm -rf "$BUILD/content"
	mkdir -p "$STAGE"
	cp "$ROOT/$MOD_NAME.modinfo" "$STAGE/"
	cp -R "$ROOT/ui" "$STAGE/"
	cp -R "$ROOT/text" "$STAGE/"
	echo "=== staged payload ==="
	(cd "$STAGE" && find . -type f | sort | sed 's/^/  /')

	python3 "$GEN" --mode content --out "$BUILD/content.vdf" --contentfolder "$STAGE" \
		${CHANGENOTE:+--changenote "$CHANGENOTE"}

	echo "=== uploading content ==="
	set +e
	"$WRAPPER" "$STEAM_LOGIN" "$KEYCHAIN_SERVICE" "$BUILD/content.vdf" 2>&1 | tee "$BUILD/content.log"
	rc=${PIPESTATUS[0]}
	set -e
	[ "$rc" = "0" ] || { echo "content upload failed (exit $rc); see $BUILD/content.log" >&2; exit "$rc"; }

	# First publish: steamcmd prints the new id. Persist it so updates go to the
	# same item instead of creating a second one.
	if [ -z "$(current_id)" ]; then
		NEW_ID="$(grep -oE '[0-9]{7,}' "$BUILD/content.log" | tail -1 || true)"
		if [ -n "$NEW_ID" ]; then
			python3 - "$ROOT/workshop.vdf" "$NEW_ID" <<'PY'
import io,re,sys
p,new=sys.argv[1],sys.argv[2]
s=io.open(p,encoding='utf-8').read()
s=re.sub(r'("publishedfileid"\s*")[^"]*(")', lambda m: m.group(1)+new+m.group(2), s, count=1)
io.open(p,'w',encoding='utf-8').write(s)
print('wrote publishedfileid %s back into workshop.vdf' % new)
PY
		else
			echo "!! Could not find the new publishedfileid in $BUILD/content.log." >&2
			echo "   Read it off the Workshop page and paste it into workshop.vdf," >&2
			echo "   then run: ./scripts/upload_workshop.sh --preview-only" >&2
			exit 1
		fi
	fi
fi

# ── 2. preview ───────────────────────────────────────────────────────────────
if [ "$DO_PREVIEW" = "1" ]; then
	ID="$(current_id)"
	[ -n "$ID" ] || { echo "no publishedfileid in workshop.vdf; publish content first" >&2; exit 1; }

	python3 "$GEN" --mode preview --out "$BUILD/preview.vdf" --previewfile "$PREVIEW" --id "$ID"
	echo "=== uploading preview ($(du -h "$PREVIEW" | cut -f1)) ==="
	cat "$BUILD/preview.vdf"
	set +e
	"$WRAPPER" "$STEAM_LOGIN" "$KEYCHAIN_SERVICE" "$BUILD/preview.vdf" 2>&1 | tee "$BUILD/preview.log"
	rc=${PIPESTATUS[0]}
	set -e
	if [ "$rc" != "0" ]; then
		echo "" >&2
		echo "!! Preview upload failed (exit $rc), as expected for this app." >&2
		echo "   Check $BUILD/preview.log for 'LegacyCloud == eStorage' to confirm it is" >&2
		echo "   the storage-system limitation and not something new." >&2
		echo "   Content upload above still succeeded." >&2
	fi
fi

ID="$(current_id)"
echo ""
echo "Done. Item: https://steamcommunity.com/sharedfiles/filedetails/?id=$ID"
if [ "$DO_PREVIEW" = "0" ]; then
	echo ""
	echo "PREVIEW IMAGE: set it by hand - steamcmd cannot upload it for this app."
	echo "  1. open https://steamcommunity.com/sharedfiles/itemedittext/?id=$ID"
	echo "  2. upload $PREVIEW"
	echo "It only has to be done when the image changes, not on every content update."
fi
