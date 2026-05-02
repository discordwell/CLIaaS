#!/bin/bash
# Build Red Alert WebAssembly from the Daft-Freak SDL2 port
# Prerequisites: emscripten (brew install emscripten), cmake
#
# This script:
# 1. Configures and builds the Red Alert C++ source with Emscripten
# 2. Copies WASM/JS outputs to public/ra/
#
# Game data files (MIX files) must be packaged separately - see package-gamedata.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="$SCRIPT_DIR/CnC_and_Red_Alert"
BUILD_DIR="$SRC_DIR/build-wasm"
OUTPUT_DIR="$PROJECT_ROOT/public/ra"

echo "=== Red Alert WASM Build ==="
echo "Source: $SRC_DIR"
echo "Output: $OUTPUT_DIR"

# Check prerequisites
if ! command -v emcc &> /dev/null; then
    echo "ERROR: emcc not found. Install Emscripten (macOS: brew install emscripten; Windows: install/activate emsdk)"
    exit 1
fi

if ! command -v cmake &> /dev/null; then
    echo "ERROR: cmake not found. Install CMake (macOS: brew install cmake; Windows: winget install Kitware.CMake)"
    exit 1
fi

# Populate ignored upstream source files if needed. The repo tracks a small
# set of patched RA files in this directory, so checking only for the directory
# is not enough on a fresh checkout.
if [ ! -f "$SRC_DIR/RA/bdata.cpp" ]; then
    echo "Populating Daft-Freak/CnC_and_Red_Alert source..."
    (cd "$PROJECT_ROOT" && pnpm ra:ensure-source)
fi

# Ensure SDL2 port is available
echo "Ensuring Emscripten SDL2 port is built..."
echo '#include <SDL2/SDL.h>' | emcc -xc - -sUSE_SDL=2 -c -o /dev/null 2>&1 || true

SDL2_CMAKE_ARGS=()
if command -v brew &> /dev/null; then
    SDL2_DIR=$(dirname "$(find "$(brew --prefix emscripten)" -name "sdl2-config.cmake" 2>/dev/null | head -1)")
    if [ -n "$SDL2_DIR" ] && [ -f "$SDL2_DIR/sdl2-config.cmake" ]; then
        SDL2_CMAKE_ARGS=(-DSDL2_DIR="$SDL2_DIR")
    fi
fi

# Configure
echo "Configuring CMake with Emscripten..."
rm -rf "$BUILD_DIR"
# Use ${arr[@]+...} to safely expand possibly-empty array under set -u
emcmake cmake -B "$BUILD_DIR" -S "$SRC_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    ${SDL2_CMAKE_ARGS[@]+"${SDL2_CMAKE_ARGS[@]}"}

# Build
echo "Building Red Alert (rasdl target)..."
JOBS=1
if command -v sysctl &> /dev/null; then
    JOBS=$(sysctl -n hw.ncpu)
elif command -v nproc &> /dev/null; then
    JOBS=$(nproc)
fi
emmake cmake --build "$BUILD_DIR" --target rasdl -j"$JOBS"

# Copy outputs
mkdir -p "$OUTPUT_DIR"
cp "$BUILD_DIR/RA/rasdl.js" "$OUTPUT_DIR/"
cp "$BUILD_DIR/RA/rasdl.wasm" "$OUTPUT_DIR/"

echo ""
echo "=== Build complete ==="
echo "WASM: $OUTPUT_DIR/rasdl.wasm ($(du -h "$OUTPUT_DIR/rasdl.wasm" | cut -f1))"
echo "JS:   $OUTPUT_DIR/rasdl.js ($(du -h "$OUTPUT_DIR/rasdl.js" | cut -f1))"
echo ""
echo "Next: Run package-gamedata.sh to package game assets."
