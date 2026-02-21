#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-exports/routes}"
APP_EXPORT_DIR="$OUT_DIR/app"
INVENTORY_FILE="$OUT_DIR/route_inventory.md"

mkdir -p "$APP_EXPORT_DIR"
rsync -az --delete src/app/ "$APP_EXPORT_DIR/"

{
  echo "# Route Inventory"
  echo
  echo "Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## App files"
  find src/app \( -name 'page.tsx' -o -name 'layout.tsx' -o -name 'route.ts' \) | sort
} > "$INVENTORY_FILE"

echo "Route export written to $OUT_DIR"
