#!/usr/bin/env bash
# Encrypt .env secrets using SOPS + age
set -euo pipefail

SHARED_DIR="${1:-/opt/cliaas/shared}"
ENV_FILE="${SHARED_DIR}/.env"
ENC_FILE="${SHARED_DIR}/.env.enc"
SOPS_CONFIG="${SHARED_DIR}/.sops.yaml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

if [ ! -f "$SOPS_CONFIG" ]; then
  echo "Error: $SOPS_CONFIG not found. Run secrets-rotate.sh first to generate keys."
  exit 1
fi

echo "Encrypting $ENV_FILE → $ENC_FILE"
sops --encrypt --config "$SOPS_CONFIG" "$ENV_FILE" > "$ENC_FILE"
echo "Done. Encrypted secrets at $ENC_FILE"
