#!/usr/bin/env bash
set -euo pipefail

# Record the hero demo animation as video files
# Requires: ffmpeg, node, running Next.js server on port 3456

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/public/demo"
FRAMES_DIR="/tmp/hero-demo-frames"

echo "==> Cleaning up old frames..."
rm -rf "$FRAMES_DIR"
mkdir -p "$FRAMES_DIR" "$OUT_DIR"

echo "==> Capturing frames with Puppeteer..."
node "$SCRIPT_DIR/capture-hero-frames.mjs"

echo "==> Converting to WebM (VP9)..."
ffmpeg -y -framerate 10 -i "$FRAMES_DIR/frame-%04d.png" \
  -c:v libvpx-vp9 -crf 35 -b:v 0 -pix_fmt yuva420p \
  -an "$OUT_DIR/hero-demo.webm" 2>/dev/null

echo "==> Converting to MP4 (H.264)..."
ffmpeg -y -framerate 10 -i "$FRAMES_DIR/frame-%04d.png" \
  -c:v libx264 -crf 25 -pix_fmt yuv420p \
  -an "$OUT_DIR/hero-demo.mp4" 2>/dev/null

echo "==> Extracting poster frame (mid-point)..."
TOTAL=$(ls "$FRAMES_DIR"/frame-*.png | wc -l | tr -d ' ')
MID=$((TOTAL / 2))
MID_FILE=$(printf "$FRAMES_DIR/frame-%04d.png" "$MID")
cp "$MID_FILE" "$OUT_DIR/hero-demo-poster.png"

echo "==> Cleaning up frames..."
rm -rf "$FRAMES_DIR"

echo "==> Done!"
ls -lh "$OUT_DIR"/hero-demo*
