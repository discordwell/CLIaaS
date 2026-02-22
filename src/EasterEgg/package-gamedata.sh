#!/bin/bash
# Package Red Alert freeware game data for the Emscripten build
#
# This script:
# 1. Downloads the freeware Red Alert Allied disc ISO from cnc-comm.com
# 2. Extracts MAIN.MIX and REDALERT.MIX from the ISO
# 3. Extracts individual MIX files from the containers
# 4. Packages essential files (no movies/music) using Emscripten's file_packager
#
# Prerequisites: p7zip (brew install p7zip), ccmixar (go install github.com/askeladdk/ccmixar@latest)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public/ra"
WORK_DIR="/tmp/ra_gamedata_build"

echo "=== Red Alert Game Data Packager ==="

# Check prerequisites
if ! command -v 7z &> /dev/null; then
    echo "ERROR: 7z not found. Install: brew install p7zip"
    exit 1
fi

CCMIXAR="${GOPATH:-$HOME/go}/bin/ccmixar"
if [ ! -f "$CCMIXAR" ]; then
    echo "Installing ccmixar..."
    go install github.com/askeladdk/ccmixar@latest
fi

EMSCRIPTEN_DIR="$(brew --prefix emscripten)/libexec"
FILE_PACKAGER="$EMSCRIPTEN_DIR/tools/file_packager.py"
if [ ! -f "$FILE_PACKAGER" ]; then
    echo "ERROR: Emscripten file_packager not found at $FILE_PACKAGER"
    exit 1
fi

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

# Step 1: Download freeware ISO
ISO_ZIP="$WORK_DIR/RA_Allies.zip"
if [ ! -f "$ISO_ZIP" ]; then
    echo "Downloading Red Alert freeware Allied disc (~405MB)..."
    curl -L -o "$ISO_ZIP" "https://bigdownloads.cnc-comm.com/ra/RA_Allies.zip" --progress-bar
fi

# Step 2: Extract ISO from ZIP
ISO_FILE="$WORK_DIR/CD1_ALLIES.iso"
if [ ! -f "$ISO_FILE" ]; then
    echo "Extracting ISO from ZIP..."
    cd "$WORK_DIR" && 7z x "$ISO_ZIP" -oiso_extract && mv iso_extract/CD1_ALLIES.iso "$ISO_FILE"
fi

# Step 3: Extract MIX containers from ISO
MAIN_MIX="$WORK_DIR/MAIN.MIX"
REDALERT_MIX="$WORK_DIR/REDALERT.MIX"
if [ ! -f "$MAIN_MIX" ]; then
    echo "Extracting MIX files from ISO..."
    cd "$WORK_DIR" && 7z x "$ISO_FILE" -oiso_contents "MAIN.MIX" "INSTALL/REDALERT.MIX" "INSTALL/REDALERT.INI"
    mv iso_contents/MAIN.MIX "$MAIN_MIX"
    mv iso_contents/INSTALL/REDALERT.MIX "$REDALERT_MIX"
    mv iso_contents/INSTALL/REDALERT.INI "$WORK_DIR/REDALERT.INI"
fi

# Step 4: Extract individual MIX files from containers
EXTRACTED="$WORK_DIR/extracted"
mkdir -p "$EXTRACTED"

echo "Extracting sub-MIX files from MAIN.MIX..."
"$CCMIXAR" unpack -game ra1 -mix "$MAIN_MIX" -dir "$EXTRACTED"

echo "Extracting sub-MIX files from REDALERT.MIX..."
"$CCMIXAR" unpack -game ra1 -mix "$REDALERT_MIX" -dir "$EXTRACTED"

# Step 5: Assemble essential files (skip movies and hi-res)
GAMEDATA="$WORK_DIR/gamedata"
mkdir -p "$GAMEDATA"

echo "Assembling essential game files..."
for f in CONQUER.MIX GENERAL.MIX SOUNDS.MIX RUSSIAN.MIX ALLIES.MIX \
         TEMPERAT.MIX SNOW.MIX INTERIOR.MIX LOCAL.MIX LORES.MIX SPEECH.MIX; do
    if [ -f "$EXTRACTED/$f" ]; then
        cp "$EXTRACTED/$f" "$GAMEDATA/"
        echo "  $f ($(du -h "$EXTRACTED/$f" | cut -f1))"
    else
        echo "  WARNING: $f not found"
    fi
done
cp "$WORK_DIR/REDALERT.INI" "$GAMEDATA/"

# Step 6: Package with Emscripten file_packager
echo "Packaging for Emscripten..."
cd "$GAMEDATA"
python3 "$FILE_PACKAGER" \
    "$OUTPUT_DIR/gamedata.data" \
    --js-output="$OUTPUT_DIR/gamedata.js" \
    --preload . \
    --no-node

echo ""
echo "=== Packaging complete ==="
echo "Data: $OUTPUT_DIR/gamedata.data ($(du -h "$OUTPUT_DIR/gamedata.data" | cut -f1))"
echo "JS:   $OUTPUT_DIR/gamedata.js ($(du -h "$OUTPUT_DIR/gamedata.js" | cut -f1))"
echo ""
echo "Total public/ra/ size: $(du -sh "$OUTPUT_DIR" | cut -f1)"
