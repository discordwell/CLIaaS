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
    echo "ERROR: emcc not found. Install Emscripten: brew install emscripten"
    exit 1
fi

if ! command -v cmake &> /dev/null; then
    echo "ERROR: cmake not found. Install CMake: brew install cmake"
    exit 1
fi

# Clone source if needed
if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning Daft-Freak/CnC_and_Red_Alert..."
    git clone --depth 1 https://github.com/Daft-Freak/CnC_and_Red_Alert.git "$SRC_DIR"
fi

# Ensure SDL2 port is available
echo "Ensuring Emscripten SDL2 port is built..."
echo '#include <SDL2/SDL.h>' | emcc -xc - -sUSE_SDL=2 -c -o /dev/null 2>&1 || true

# Find SDL2 config
SDL2_DIR=$(dirname "$(find "$(brew --prefix emscripten)" -name "sdl2-config.cmake" 2>/dev/null | head -1)")

# Configure
echo "Configuring CMake with Emscripten..."
rm -rf "$BUILD_DIR"
emcmake cmake -B "$BUILD_DIR" -S "$SRC_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DSDL2_DIR="$SDL2_DIR"

# Build
echo "Building Red Alert (rasdl target)..."
emmake cmake --build "$BUILD_DIR" --target rasdl -j$(sysctl -n hw.ncpu)

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
