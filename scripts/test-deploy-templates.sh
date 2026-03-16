#!/usr/bin/env bash
# Validates that every __PLACEHOLDER__ in deploy templates has a matching
# sed substitution in deploy_vps.sh. Catches missing-substitution bugs
# like the __SHARED_DIR__ incident.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$PROJECT_ROOT/scripts/deploy_vps.sh"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
FAILURES=0

for tmpl in "$DEPLOY_DIR"/*; do
  [[ -f "$tmpl" ]] || continue
  filename="$(basename "$tmpl")"

  # Extract all unique __FOO__ placeholders from the template
  placeholders=$(grep -oE '__[A-Z_]+__' "$tmpl" | sort -u)

  for ph in $placeholders; do
    # Check that deploy_vps.sh has a sed substitution for this placeholder
    if ! grep -qE "s\|${ph}\|" "$DEPLOY_SCRIPT"; then
      echo "FAIL: $filename uses $ph but deploy_vps.sh has no substitution for it"
      FAILURES=$((FAILURES + 1))
    fi
  done
done

if [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "$FAILURES unsubstituted placeholder(s) found."
  exit 1
fi

echo "OK: All deploy template placeholders have matching substitutions."
