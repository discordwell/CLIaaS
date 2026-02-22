#!/bin/bash
# Download Red Alert soundtrack from Internet Archive
# Source: https://archive.org/details/red_alert_soundtrack-1996
# Music by Frank Klepacki (1996), released as freeware by EA in 2008

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MUSIC_DIR="$SCRIPT_DIR/../public/ra/music"
BASE_URL="https://archive.org/download/red_alert_soundtrack-1996"

mkdir -p "$MUSIC_DIR"

declare -a TRACKS=(
  "01_hell_march:01.%20Hell%20March.mp3"
  "02_radio:02.%20Radio.mp3"
  "03_crush:03.%20Crush.mp3"
  "04_roll_out:04.%20Roll%20Out.mp3"
  "05_mud:05.%20Mud.mp3"
  "06_twin_cannon:06.%20Twin%20Cannon.mp3"
  "07_face_the_enemy:07.%20Face%20the%20Enemy.mp3"
  "08_run:08.%20Run.mp3"
  "09_terminate:09.%20Terminate.mp3"
  "10_big_foot:10.%20Big%20Foot.mp3"
  "11_workmen:11.%20Workmen.mp3"
  "12_militant_force:12.%20Militant%20Force.mp3"
  "13_dense:13.%20Dense.mp3"
  "14_vector:14.%20Vector.mp3"
  "15_smash:15.%20Smash.mp3"
)

echo "Downloading Red Alert soundtrack (15 tracks, ~122MB)..."
echo "Source: Internet Archive (Frank Klepacki, 1996)"
echo ""

DOWNLOADED=0
SKIPPED=0

for entry in "${TRACKS[@]}"; do
  name="${entry%%:*}"
  url_path="${entry#*:}"
  outfile="$MUSIC_DIR/${name}.mp3"

  if [ -f "$outfile" ] && [ "$(stat -f%z "$outfile" 2>/dev/null || stat -c%s "$outfile" 2>/dev/null)" -gt 100000 ]; then
    echo "  SKIP $name.mp3 (already exists)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "  Downloading $name.mp3..."
  curl -L -f -s -o "$outfile" "$BASE_URL/$url_path"
  DOWNLOADED=$((DOWNLOADED + 1))
done

echo ""
echo "Done! Downloaded $DOWNLOADED, skipped $SKIPPED."
echo "Music files: $MUSIC_DIR/"
du -sh "$MUSIC_DIR"
