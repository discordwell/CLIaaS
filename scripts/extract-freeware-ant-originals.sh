#!/bin/bash
# Extract original Red Alert ant sprites from the freeware Red Alert 3.03 patch.
# Produces:
#   - public/ra/assets/original/* (SHP + PNG sheets)
#   - public/ra/assets/ant1.png, ant2.png, ant3.png + manifest updates
#
# Usage:
#   bash scripts/extract-freeware-ant-originals.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="${RA_ANT_WORK_DIR:-/tmp/ra_ant_extract}"
PATCH303_EXE="$WORK_DIR/manual_patch303_english.exe"
CCMIXAR="${GOPATH:-$HOME/go}/bin/ccmixar"

echo "=== Red Alert Original Ant Asset Extractor ==="
echo "Working dir: $WORK_DIR"

for cmd in 7z curl pnpm go; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $cmd"
    exit 1
  fi
done

if [ ! -x "$CCMIXAR" ]; then
  echo "Installing ccmixar..."
  go install github.com/askeladdk/ccmixar@latest
fi

mkdir -p "$WORK_DIR"

if [ ! -f "$PATCH303_EXE" ]; then
  echo "Downloading Red Alert 3.03 patch (~2.3MB)..."
  curl -L -o "$PATCH303_EXE" \
    "https://downloads.cnc-comm.com/red-alert/patches/manual_patch303_english.exe" \
    --progress-bar
else
  echo "Using cached patch: $PATCH303_EXE"
fi

echo "Extracting EXPAND2.MIX and HIRES1.MIX from the 3.03 patch..."
rm -rf "$WORK_DIR/am_patch_work"
mkdir -p "$WORK_DIR/am_patch_work"
7z x -y "$PATCH303_EXE" \
  -o"$WORK_DIR/am_patch_work" \
  "EXPAND2.MIX" \
  "HIRES1.MIX" >/dev/null

if [ ! -f "$WORK_DIR/am_patch_work/EXPAND2.MIX" ]; then
  echo "ERROR: Failed to extract EXPAND2.MIX from the 3.03 patch."
  exit 1
fi

if [ ! -f "$WORK_DIR/am_patch_work/HIRES1.MIX" ]; then
  echo "ERROR: Failed to extract HIRES1.MIX from the 3.03 patch."
  exit 1
fi

echo "Unpacking EXPAND2.MIX..."
rm -rf "$WORK_DIR/am_expand2_unpack"
mkdir -p "$WORK_DIR/am_expand2_unpack"
"$CCMIXAR" unpack \
  -game ra1 \
  -mix "$WORK_DIR/am_patch_work/EXPAND2.MIX" \
  -dir "$WORK_DIR/am_expand2_unpack"

echo "Converting SHPs and updating active ant sheets..."
cd "$PROJECT_ROOT"
pnpm tsx scripts/extract-original-ant-assets.ts "$WORK_DIR/am_expand2_unpack"

echo ""
echo "Done."
echo "Original SHPs/PNGs: $PROJECT_ROOT/public/ra/assets/original"
echo "Active ANT sheets:  $PROJECT_ROOT/public/ra/assets/ant1.png, ant2.png, ant3.png"
echo "Expansion MIXes:    $WORK_DIR/am_patch_work/EXPAND2.MIX, HIRES1.MIX"
