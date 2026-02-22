#!/usr/bin/env bash
set -euo pipefail

TEAM_NAME="${1:-CLIaaS}"
LANDING_INPUT="${2:-landing_page_${TEAM_NAME}.png}"
EXPLAINER_INPUT="explainer_${TEAM_NAME}.md"
OUTPUT_DIR="submission"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
ZIP_PATH="$OUTPUT_DIR/${TEAM_NAME}_submission_${TIMESTAMP}.zip"

mkdir -p "$OUTPUT_DIR"

if [[ ! -f "$LANDING_INPUT" ]]; then
  echo "ERROR: missing landing screenshot '$LANDING_INPUT'"
  echo "Create it at >= 1280px wide before bundling."
  exit 1
fi

if [[ ! -f "$EXPLAINER_INPUT" ]]; then
  cp explainer_CLIaaS.md "$EXPLAINER_INPUT"
  echo "Created template explainer at $EXPLAINER_INPUT"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$LANDING_INPUT" "$TMP_DIR/landing_page_${TEAM_NAME}.png"
cp "$EXPLAINER_INPUT" "$TMP_DIR/explainer_${TEAM_NAME}.md"

mkdir -p "$TMP_DIR/project"
rsync -az \
  --exclude '.git' \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude 'submission' \
  ./ "$TMP_DIR/project/"

(
  cd "$TMP_DIR"
  mkdir -p "$(dirname "$ZIP_PATH")"
  zip -qr "$ZIP_PATH" .
)

mv "$TMP_DIR/$ZIP_PATH" "$ZIP_PATH"

echo "Submission bundle created at $ZIP_PATH"
