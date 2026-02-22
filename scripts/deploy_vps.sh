#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-cliaas.com}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/cliaas}"
REMOTE_APP_DIR="${REMOTE_DIR}/current"
REMOTE_SHARED_DIR="${REMOTE_DIR}/shared"
SERVICE_NAME="${SERVICE_NAME:-cliaas}"
APP_PORT="${APP_PORT:-3101}"
DOMAIN="${DOMAIN:-cliaas.com}"
APP_USER="${APP_USER:-$VPS_USER}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
SKIP_NGINX="${SKIP_NGINX:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VPS_SSH="${VPS_USER}@${VPS_HOST}"
SUDO=""

if [[ "$VPS_USER" != "root" ]]; then
  SUDO="sudo"
fi

SSH_CMD=(ssh -p "$VPS_PORT" "$VPS_SSH")
RSYNC_SSH="ssh -p $VPS_PORT"

TMP_SERVICE="$(mktemp)"
TMP_NGINX="$(mktemp)"
trap 'rm -f "$TMP_SERVICE" "$TMP_NGINX"' EXIT

sed \
  -e "s|__APP_USER__|$APP_USER|g" \
  -e "s|__APP_GROUP__|$APP_GROUP|g" \
  -e "s|__APP_DIR__|$REMOTE_APP_DIR|g" \
  -e "s|__APP_PORT__|$APP_PORT|g" \
  -e "s|__ENV_FILE__|$REMOTE_SHARED_DIR/.env|g" \
  "$PROJECT_ROOT/deploy/cliaas.service" > "$TMP_SERVICE"

sed \
  -e "s|__DOMAIN__|$DOMAIN|g" \
  -e "s|__APP_PORT__|$APP_PORT|g" \
  "$PROJECT_ROOT/deploy/nginx.cliaas.com.conf" > "$TMP_NGINX"

echo "=== CLIaaS Deploy ==="
echo "Host: $VPS_SSH"
echo "Remote app dir: $REMOTE_APP_DIR"
echo "Service: $SERVICE_NAME"
echo "Domain: $DOMAIN"
echo ""

echo "[1/6] Creating remote directories..."
"${SSH_CMD[@]}" bash -s -- \
  "$REMOTE_DIR" \
  "$REMOTE_APP_DIR" \
  "$REMOTE_SHARED_DIR" \
  "$SUDO" \
  "$APP_USER" \
  "$APP_GROUP" <<'CMDS'
set -euo pipefail
REMOTE_DIR="$1"
APP_DIR="$2"
SHARED_DIR="$3"
SUDO_CMD="$4"
APP_USER="$5"
APP_GROUP="$6"

if [[ -n "$SUDO_CMD" ]]; then
  $SUDO_CMD mkdir -p "$APP_DIR" "$SHARED_DIR"
  $SUDO_CMD chown -R "${APP_USER}:${APP_GROUP}" "$REMOTE_DIR"
else
  mkdir -p "$APP_DIR" "$SHARED_DIR"
fi
CMDS

echo "[2/6] Syncing source..."
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude '.git' \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.env.local' \
  "$PROJECT_ROOT/" "$VPS_SSH:$REMOTE_APP_DIR/"

echo "[3/6] Installing dependencies + build on remote host..."
"${SSH_CMD[@]}" bash -s -- "$REMOTE_APP_DIR" "$REMOTE_SHARED_DIR" <<'CMDS'
set -euo pipefail
APP_DIR="$1"
SHARED_DIR="$2"
cd "$APP_DIR"

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm build
elif command -v corepack >/dev/null 2>&1; then
  corepack pnpm install --frozen-lockfile
  corepack pnpm build
elif command -v npm >/dev/null 2>&1; then
  npm install
  npm run build
else
  echo "ERROR: no supported package manager found (pnpm/corepack/npm)."
  exit 1
fi

if [[ ! -f "$SHARED_DIR/.env" ]]; then
  cp .env.example "$SHARED_DIR/.env"
fi
CMDS

echo "[4/6] Installing systemd service..."
rsync -az -e "$RSYNC_SSH" "$TMP_SERVICE" "$VPS_SSH:/tmp/${SERVICE_NAME}.service"
"${SSH_CMD[@]}" bash -s -- "$SERVICE_NAME" "$SUDO" <<'CMDS'
set -euo pipefail
SERVICE_NAME="$1"
SUDO_CMD="$2"

$SUDO_CMD cp "/tmp/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
$SUDO_CMD systemctl daemon-reload
$SUDO_CMD systemctl enable --now "$SERVICE_NAME"
$SUDO_CMD systemctl restart "$SERVICE_NAME"
CMDS

echo "[5/6] Verifying app health..."
"${SSH_CMD[@]}" bash -s -- "$APP_PORT" "$SERVICE_NAME" "$SUDO" <<'CMDS'
set -euo pipefail
APP_PORT="$1"
SERVICE_NAME="$2"
SUDO_CMD="$3"

if ! curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
  echo "ERROR: healthcheck failed"
  $SUDO_CMD journalctl -u "$SERVICE_NAME" --no-pager -n 80 || true
  exit 1
fi
CMDS

echo "[6/6] Configuring edge reverse proxy..."
if [[ "$SKIP_NGINX" == "1" ]]; then
  echo "SKIP_NGINX=1 -> skipping reverse proxy config"
else
  PROXY_MODE="$("${SSH_CMD[@]}" bash -s -- "$SUDO" <<'CMDS'
set -euo pipefail
SUDO_CMD="$1"
if $SUDO_CMD docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^kamal-proxy$'; then
  echo "kamal"
elif command -v nginx >/dev/null 2>&1; then
  echo "nginx"
else
  echo "none"
fi
CMDS
)"

  if [[ "$PROXY_MODE" == "kamal" ]]; then
    "${SSH_CMD[@]}" bash -s -- "$SERVICE_NAME" "$DOMAIN" "$APP_PORT" "$SUDO" <<'CMDS'
set -euo pipefail
SERVICE_NAME="$1"
DOMAIN="$2"
APP_PORT="$3"
SUDO_CMD="$4"
SERVICE_ROUTE="${SERVICE_NAME}-web"

$SUDO_CMD docker exec kamal-proxy kamal-proxy deploy "$SERVICE_ROUTE" \
  --host "$DOMAIN" \
  --host "www.$DOMAIN" \
  --path-prefix / \
  --target "172.18.0.1:${APP_PORT}" \
  --health-check-path /api/health \
  --tls \
  --forward-headers
CMDS
  elif [[ "$PROXY_MODE" == "nginx" ]]; then
    rsync -az -e "$RSYNC_SSH" "$TMP_NGINX" "$VPS_SSH:/tmp/${SERVICE_NAME}.nginx.conf"
    "${SSH_CMD[@]}" bash -s -- "$SERVICE_NAME" "$SUDO" <<'CMDS'
set -euo pipefail
SERVICE_NAME="$1"
SUDO_CMD="$2"

if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
  $SUDO_CMD cp "/tmp/${SERVICE_NAME}.nginx.conf" "/etc/nginx/sites-available/${SERVICE_NAME}.conf"
  $SUDO_CMD ln -sf "/etc/nginx/sites-available/${SERVICE_NAME}.conf" "/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
elif [[ -d /etc/nginx/conf.d ]]; then
  $SUDO_CMD cp "/tmp/${SERVICE_NAME}.nginx.conf" "/etc/nginx/conf.d/${SERVICE_NAME}.conf"
else
  echo "WARN: Unsupported nginx layout; install config manually from deploy/nginx.cliaas.com.conf"
  exit 0
fi

$SUDO_CMD nginx -t
$SUDO_CMD systemctl reload nginx
CMDS
  else
    echo "WARN: No supported reverse proxy detected (kamal-proxy/nginx)."
  fi
fi

echo ""
echo "Deploy complete."
echo "- App health endpoint: http://$VPS_HOST/api/health"
echo "- Domain target: https://$DOMAIN"
