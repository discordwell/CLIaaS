#!/bin/bash
# Package Red Alert freeware game data for the Emscripten build
#
# This script:
# 1. Downloads the freeware Red Alert Allied disc ISO from cnc-comm.com
# 2. Downloads the freeware Counterstrike disc for ant mission data
# 3. Extracts MIX files from both discs
# 4. Creates EXPAND.MIX from Counterstrike content (ant missions)
# 5. Packages essential files (no movies/music) using Emscripten's file_packager
#
# Prerequisites: p7zip, bchunk, ccmixar, emscripten
#   brew install p7zip bchunk emscripten
#   go install github.com/askeladdk/ccmixar@latest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public/ra"
WORK_DIR="/tmp/ra_gamedata_build"

echo "=== Red Alert Game Data Packager ==="

# Check prerequisites
for cmd in 7z bchunk; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "ERROR: $cmd not found. Install: brew install p7zip bchunk"
        exit 1
    fi
done

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

# ── Step 1: Download freeware Allied disc ──
ISO_ZIP="$WORK_DIR/RA_Allies.zip"
if [ ! -f "$ISO_ZIP" ]; then
    echo "Downloading Red Alert freeware Allied disc (~405MB)..."
    curl -L -o "$ISO_ZIP" "https://bigdownloads.cnc-comm.com/ra/RA_Allies.zip" --progress-bar
fi

# ── Step 2: Extract Allied ISO ──
ISO_FILE="$WORK_DIR/CD1_ALLIES.iso"
if [ ! -f "$ISO_FILE" ]; then
    echo "Extracting Allied ISO from ZIP..."
    cd "$WORK_DIR" && 7z x "$ISO_ZIP" -oiso_extract && mv iso_extract/CD1_ALLIES.iso "$ISO_FILE"
fi

# ── Step 3: Extract MIX containers from Allied ISO ──
MAIN_MIX="$WORK_DIR/MAIN.MIX"
REDALERT_MIX="$WORK_DIR/REDALERT.MIX"
if [ ! -f "$MAIN_MIX" ]; then
    echo "Extracting MIX files from Allied ISO..."
    cd "$WORK_DIR" && 7z x "$ISO_FILE" -oiso_contents "MAIN.MIX" "INSTALL/REDALERT.MIX" "INSTALL/REDALERT.INI"
    mv iso_contents/MAIN.MIX "$MAIN_MIX"
    mv iso_contents/INSTALL/REDALERT.MIX "$REDALERT_MIX"
    mv iso_contents/INSTALL/REDALERT.INI "$WORK_DIR/REDALERT.INI"
fi

# ── Step 4: Extract individual MIX files from Allied containers ──
EXTRACTED="$WORK_DIR/extracted"
mkdir -p "$EXTRACTED"

echo "Extracting sub-MIX files from Allied MAIN.MIX..."
"$CCMIXAR" unpack -game ra1 -mix "$MAIN_MIX" -dir "$EXTRACTED"

echo "Extracting sub-MIX files from REDALERT.MIX..."
"$CCMIXAR" unpack -game ra1 -mix "$REDALERT_MIX" -dir "$EXTRACTED"

# ── Step 5: Download and process Counterstrike disc (ant missions) ──
CS_ZIP="$WORK_DIR/RA_Counterstrike.zip"
if [ ! -f "$CS_ZIP" ]; then
    echo "Downloading Counterstrike freeware disc (~468MB)..."
    curl -L -o "$CS_ZIP" "https://bigdownloads.cnc-comm.com/ra/RA_Counterstrike.zip" --progress-bar
fi

CS_ISO="$WORK_DIR/cs_iso01.iso"
if [ ! -f "$CS_ISO" ]; then
    echo "Extracting Counterstrike disc..."
    cd "$WORK_DIR" && 7z x "$CS_ZIP" -ocs_zip_extract
    bchunk cs_zip_extract/CD3_Counterstrike.bin cs_zip_extract/CD3_Counterstrike.cue "$WORK_DIR/cs_iso"
fi

CS_MAIN="$WORK_DIR/CS_MAIN.MIX"
if [ ! -f "$CS_MAIN" ]; then
    echo "Extracting MAIN.MIX from Counterstrike ISO..."
    cd "$WORK_DIR" && 7z x "$CS_ISO" -ocs_iso_contents "MAIN.MIX"
    mv cs_iso_contents/MAIN.MIX "$CS_MAIN"
fi

CS_EXTRACTED="$WORK_DIR/cs_extracted"
mkdir -p "$CS_EXTRACTED"
echo "Extracting Counterstrike MIX contents..."
"$CCMIXAR" unpack -game ra1 -mix "$CS_MAIN" -dir "$CS_EXTRACTED"

# Extract CS GENERAL.MIX to get scenario files
CS_GENERAL="$WORK_DIR/cs_general_contents"
mkdir -p "$CS_GENERAL"
echo "Extracting Counterstrike GENERAL.MIX (contains ant scenarios)..."
"$CCMIXAR" unpack -game ra1 -mix "$CS_EXTRACTED/GENERAL.MIX" -dir "$CS_GENERAL"

# Create EXPAND.MIX from CS GENERAL.MIX contents (includes SCM50-59 ant missions)
EXPAND_MIX="$WORK_DIR/EXPAND.MIX"
echo "Creating EXPAND.MIX from Counterstrike content..."
"$CCMIXAR" pack -game ra1 -dir "$CS_GENERAL" -mix "$EXPAND_MIX"
echo "  EXPAND.MIX ($(du -h "$EXPAND_MIX" | cut -f1))"

# ── Step 6: Assemble essential files (skip movies/music/scores) ──
GAMEDATA="$WORK_DIR/gamedata"
rm -rf "$GAMEDATA"
mkdir -p "$GAMEDATA"

echo "Assembling essential game files..."
# Use CS CONQUER.MIX (superset with ant unit data)
if [ -f "$CS_EXTRACTED/CONQUER.MIX" ]; then
    cp "$CS_EXTRACTED/CONQUER.MIX" "$GAMEDATA/"
    echo "  CONQUER.MIX [CS] ($(du -h "$CS_EXTRACTED/CONQUER.MIX" | cut -f1))"
else
    cp "$EXTRACTED/CONQUER.MIX" "$GAMEDATA/"
    echo "  CONQUER.MIX [base] ($(du -h "$EXTRACTED/CONQUER.MIX" | cut -f1))"
fi

# Base game MIX files
for f in GENERAL.MIX SOUNDS.MIX RUSSIAN.MIX ALLIES.MIX \
         TEMPERAT.MIX SNOW.MIX INTERIOR.MIX LOCAL.MIX LORES.MIX SPEECH.MIX; do
    if [ -f "$EXTRACTED/$f" ]; then
        cp "$EXTRACTED/$f" "$GAMEDATA/"
        echo "  $f ($(du -h "$EXTRACTED/$f" | cut -f1))"
    else
        echo "  WARNING: $f not found"
    fi
done

# Expansion file
cp "$EXPAND_MIX" "$GAMEDATA/"
echo "  EXPAND.MIX ($(du -h "$EXPAND_MIX" | cut -f1))"

# Config
cp "$WORK_DIR/REDALERT.INI" "$GAMEDATA/"

# ── Step 7: Package with Emscripten file_packager ──
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
