#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3101}"

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm start --hostname "$HOST" --port "$PORT"
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm start --hostname "$HOST" --port "$PORT"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm run start -- --hostname "$HOST" --port "$PORT"
fi

echo "Neither pnpm/corepack nor npm is available on this host."
exit 1
