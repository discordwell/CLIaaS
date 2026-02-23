#!/bin/bash
# Extract original Red Alert ant sprites from freeware Aftermath patch payload.
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
AFTERMATH_ZIP="$WORK_DIR/RA_Aftermath.zip"
CCMIXAR="${GOPATH:-$HOME/go}/bin/ccmixar"
DOSBOX_BIN="${DOSBOX_BIN:-/Applications/dosbox.app/Contents/MacOS/DOSBox}"

echo "=== Red Alert Original Ant Asset Extractor ==="
echo "Working dir: $WORK_DIR"

for cmd in 7z bchunk pnpm go; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $cmd"
    exit 1
  fi
done

if [ ! -x "$DOSBOX_BIN" ]; then
  if command -v dosbox >/dev/null 2>&1; then
    DOSBOX_BIN="$(command -v dosbox)"
  else
    echo "ERROR: DOSBox not found. Install DOSBox or set DOSBOX_BIN."
    exit 1
  fi
fi

if [ ! -x "$CCMIXAR" ]; then
  echo "Installing ccmixar..."
  go install github.com/askeladdk/ccmixar@latest
fi

mkdir -p "$WORK_DIR"

if [ ! -f "$AFTERMATH_ZIP" ]; then
  echo "Downloading freeware Aftermath archive (~521MB)..."
  curl -L -o "$AFTERMATH_ZIP" "https://bigdownloads.cnc-comm.com/ra/RA_Aftermath.zip" --progress-bar
else
  echo "Using cached archive: $AFTERMATH_ZIP"
fi

if [ ! -f "$WORK_DIR/am_iso01.iso" ]; then
  echo "Extracting CD4 bin/cue from ZIP..."
  rm -rf "$WORK_DIR/am_zip_extract"
  7z x "$AFTERMATH_ZIP" -o"$WORK_DIR/am_zip_extract" >/dev/null

  echo "Converting bin/cue to ISO..."
  bchunk \
    "$WORK_DIR/am_zip_extract/CD4_Aftermath.bin" \
    "$WORK_DIR/am_zip_extract/CD4_Aftermath.cue" \
    "$WORK_DIR/am_iso" >/dev/null
else
  echo "Using cached ISO: $WORK_DIR/am_iso01.iso"
fi

echo "Extracting Aftermath patch payload..."
rm -rf "$WORK_DIR/am_iso_patch"
7z x "$WORK_DIR/am_iso01.iso" \
  -o"$WORK_DIR/am_iso_patch" \
  "SETUP/INSTALL/PATCH.EXE" \
  "SETUP/INSTALL/PATCH.RTP" \
  "SETUP/INSTALL/PATCH.RTD" >/dev/null

echo "Applying RTP patch in DOSBox to materialize EXPAND2.MIX..."
rm -rf "$WORK_DIR/am_patch_work"
mkdir -p "$WORK_DIR/am_patch_work"
"$DOSBOX_BIN" \
  -c "mount c $WORK_DIR/am_iso_patch/SETUP/INSTALL" \
  -c "mount d $WORK_DIR/am_patch_work" \
  -c "c:" \
  -c "patch -ignoremissing -noconfirm -nomessage d:\\ patch.rtp" \
  -c "exit" >/dev/null 2>&1

if [ ! -f "$WORK_DIR/am_patch_work/EXPAND2.MIX" ]; then
  echo "ERROR: Failed to produce EXPAND2.MIX via PATCH.RTP."
  if [ -f "$WORK_DIR/am_patch_work/PATCH.ERR" ]; then
    echo "--- PATCH.ERR ---"
    cat "$WORK_DIR/am_patch_work/PATCH.ERR"
  fi
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
