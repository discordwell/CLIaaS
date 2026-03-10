#!/usr/bin/env bash
# Download Red Alert FMV cutscenes from Internet Archive.
# Run on the VPS: bash scripts/download-fmv.sh
# Files are placed in public/ra/fmv/ and served as static assets.

set -euo pipefail

DEST="${1:-public/ra/fmv}"
BASE_URL="https://archive.org/download/Red_Alert-Cutscenes"
SUFFIX="_512kb.mp4"

mkdir -p "$DEST"

MOVIES=(
aagun aftrmath airfield ally1 ally10 ally11 ally12 ally14 ally2 ally4
ally5 ally6 ally8 ally9 allyend allymorf antbrf antend antintro apcescpe
assess averted battle beachead binoc bmap bombrun brdgtilt countdwn cronfail
crontest destroyr double dpthchrg dud elevator execute flare frozen grvestne
landing masasslt mcv mcv_land mcvbrdge mig montpass movingin mtnkfact nukestok
oildrum onthprwl overrun periscop radrraid search sfrozen shipsink shorbom1
shorbom2 shorbomb sitduck slntsrvc snowbomb snstrafe sovbatl sovcemet sovfinal
soviet1 soviet10 soviet11 soviet12 soviet13 soviet14 soviet2 soviet3 soviet4
soviet5 soviet6 soviet7 soviet8 soviet9 sovmcv sovtstar spotter spy strafe
take_off tanya1 tanya2 tesla toofar trinity v2rocket
)

echo "Downloading ${#MOVIES[@]} FMV cutscenes to $DEST ..."
DOWNLOADED=0
SKIPPED=0
FAILED=0

for name in "${MOVIES[@]}"; do
  OUT="$DEST/${name}.mp4"
  if [ -f "$OUT" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  if curl -sL -o "$OUT" "${BASE_URL}/${name}${SUFFIX}"; then
    SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null)
    if [ "$SIZE" -lt 1000 ]; then
      echo "  WARN: $name too small (${SIZE}B), removing"
      rm -f "$OUT"
      FAILED=$((FAILED + 1))
    else
      DOWNLOADED=$((DOWNLOADED + 1))
    fi
  else
    echo "  FAIL: $name"
    rm -f "$OUT"
    FAILED=$((FAILED + 1))
  fi
done

TOTAL_SIZE=$(du -sh "$DEST" 2>/dev/null | awk '{print $1}')
echo ""
echo "Done: $DOWNLOADED downloaded, $SKIPPED already existed, $FAILED failed"
echo "Total size: $TOTAL_SIZE"
