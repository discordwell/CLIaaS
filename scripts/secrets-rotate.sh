#!/usr/bin/env bash
# Generate new AUTH_SECRET, re-encrypt secrets, restart service
set -euo pipefail

SHARED_DIR="${1:-/opt/cliaas/shared}"
ENV_FILE="${SHARED_DIR}/.env"
AGE_KEY="${SHARED_DIR}/age-key.txt"
SOPS_CONFIG="${SHARED_DIR}/.sops.yaml"

# Generate age key if not present
if [ ! -f "$AGE_KEY" ]; then
  echo "Generating new age key..."
  age-keygen -o "$AGE_KEY" 2>/dev/null
  chmod 600 "$AGE_KEY"
  echo "Age key generated at $AGE_KEY"
fi

# Extract public key from age key file
AGE_PUBLIC_KEY=$(grep '^# public key:' "$AGE_KEY" | awk '{print $4}')

# Write SOPS config
cat > "$SOPS_CONFIG" << EOF
creation_rules:
  - path_regex: \.env$
    age: "$AGE_PUBLIC_KEY"
EOF

# Generate new AUTH_SECRET
NEW_SECRET=$(openssl rand -base64 32)
if [ -f "$ENV_FILE" ]; then
  # Replace existing AUTH_SECRET or append
  if grep -q '^AUTH_SECRET=' "$ENV_FILE"; then
    sed -i.bak "s|^AUTH_SECRET=.*|AUTH_SECRET=${NEW_SECRET}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    echo "AUTH_SECRET=${NEW_SECRET}" >> "$ENV_FILE"
  fi
else
  echo "AUTH_SECRET=${NEW_SECRET}" > "$ENV_FILE"
fi

echo "AUTH_SECRET rotated."

# Encrypt
export SOPS_AGE_KEY_FILE="$AGE_KEY"
bash "$(dirname "$0")/secrets-encrypt.sh" "$SHARED_DIR"

# Restart service if running
if systemctl is-active --quiet cliaas 2>/dev/null; then
  echo "Restarting cliaas service..."
  sudo systemctl restart cliaas
  echo "Service restarted."
fi

echo "Secret rotation complete."
