#!/usr/bin/env bash
# Decrypt .env.enc → .env using SOPS + age
# Intended as ExecStartPre in systemd service
set -euo pipefail

SHARED_DIR="${1:-/opt/cliaas/shared}"
ENC_FILE="${SHARED_DIR}/.env.enc"
ENV_FILE="${SHARED_DIR}/.env"
AGE_KEY="${SHARED_DIR}/age-key.txt"

if [ ! -f "$ENC_FILE" ]; then
  echo "No encrypted env file found at $ENC_FILE — using plaintext .env"
  exit 0
fi

if [ ! -f "$AGE_KEY" ]; then
  echo "Error: age key not found at $AGE_KEY"
  exit 1
fi

export SOPS_AGE_KEY_FILE="$AGE_KEY"
echo "Decrypting $ENC_FILE → $ENV_FILE"
sops --decrypt "$ENC_FILE" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Done. Secrets decrypted."
