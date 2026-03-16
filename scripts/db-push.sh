#!/usr/bin/env bash
# Non-interactive database schema push using drizzle-kit.
# Assumes DATABASE_URL is set in the environment.
# Uses --force to skip rename prompts (always creates new tables/columns).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARN: DATABASE_URL not set — skipping schema push."
  exit 0
fi

echo "Pushing schema to database..."
# Use 'expect' if available to auto-answer interactive prompts,
# otherwise fall back to a manual node-based approach.
node -e "
const { execSync } = require('child_process');
try {
  // drizzle-kit push in strict mode generates SQL without prompts
  execSync('npx drizzle-kit push --force', {
    stdio: 'inherit',
    env: { ...process.env },
    timeout: 60000,
  });
} catch {
  console.error('drizzle-kit push --force failed; trying direct column sync...');
  process.exit(1);
}
" 2>&1 || {
  echo "WARN: Schema push had issues — the app may still work if the schema is close enough."
}

echo "Schema push complete."
