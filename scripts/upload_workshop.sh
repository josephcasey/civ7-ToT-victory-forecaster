#!/bin/bash
# Publish / update the mod on the Steam Workshop.
#
# Runs workshop_build_item TWICE, because Steam does not reliably accept content
# and a preview image in the same call:
#
#   1. content  - the staged mod payload, title, description, visibility
#   2. preview  - a minimal VDF carrying only appid + publishedfileid +
#                 previewfile. `contentfolder` is optional in
#                 workshop_build_item and omitting it leaves the uploaded files
#                 untouched, so this cannot clobber step 1.
#
# Two things that make preview upload fail silently, both handled here:
#   - a preview over 1 MB is rejected without an error
#   - the preview must live OUTSIDE the content folder, so it is kept at the
#     repo root while content is staged under build/steam/content/
#
# steamcmd cannot be driven from a non-TTY shell, so login goes through the
# expect wrapper, which reads the password from the macOS Keychain (never
# printed) and surfaces Steam Guard in a dialog.
#
# Usage:
#   ./scripts/upload_workshop.sh [--changenote "text"] [--content-only|--preview-only]
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
DO_PREVIEW=1
while [ $# -gt 0 ]; do
	case "$1" in
		--changenote)   CHANGENOTE="$2"; shift 2 ;;
		--content-only) DO_PREVIEW=0; shift ;;
		--preview-only) DO_CONTENT=0; shift ;;
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
		echo "!! Preview upload failed (exit $rc). The content upload above still succeeded." >&2
		echo "   Set the image manually on the item's Edit page: preview.png at the repo root." >&2
		exit "$rc"
	fi
fi

echo ""
echo "Done. Item: https://steamcommunity.com/sharedfiles/filedetails/?id=$(current_id)"
