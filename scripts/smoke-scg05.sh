#!/usr/bin/env bash
# Phase 0.5: SCG05 spy delivery smoke test.
#
# Mandatory pre-commit check for any vessel or combat parity change.
# Two prior vessel door-gate attempts (Sessions 7 and Round-2 Session 25)
# broke spy delivery via LST. Run this script BEFORE committing any change
# touching vessel.cpp parity, STAGE A/E Commence gates, or LST behavior.
#
# Usage: bash scripts/smoke-scg05.sh
# Exit code: 0 = pass, non-zero = at least one test failed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> SCG05EA spy smoke test"
echo "    Running scg05ea-liveterrain.test.ts and scg05ea-spy-debug.test.ts"
echo

npx vitest run \
  src/EasterEgg/__tests__/scg05ea-liveterrain.test.ts \
  src/EasterEgg/__tests__/scg05ea-spy-debug.test.ts \
  --reporter=verbose 2>&1 | tail -40

echo
echo "==> SCG05EA smoke PASS"
