#!/usr/bin/env bash
# =============================================================================
# CLIaaS BYOC (Bring Your Own Cloud) Install Script
#
# Sets up a self-hosted CLIaaS instance with local Postgres, LLM provider,
# and optional connector for initial data sync.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/discordwell/CLIaaS/main/scripts/install-byoc.sh | bash
#   # or from a cloned repo:
#   bash scripts/install-byoc.sh
# =============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { printf "${CYAN}[info]${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}[ok]${NC}    %s\n" "$1"; }
warn()  { printf "${YELLOW}[warn]${NC}  %s\n" "$1"; }
err()   { printf "${RED}[error]${NC} %s\n" "$1"; }
step()  { printf "\n${BOLD}── %s ──${NC}\n\n" "$1"; }

# ── Prerequisites Check ────────────────────────────────────────────────────

step "Checking prerequisites"

# Node 18+
if ! command -v node &>/dev/null; then
  err "Node.js is not installed. Install Node 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  err "Node.js $NODE_VERSION found but 18+ is required. Upgrade at https://nodejs.org"
  exit 1
fi
ok "Node.js $(node -v)"

# pnpm
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing via corepack..."
  corepack enable && corepack prepare pnpm@latest --activate
  if ! command -v pnpm &>/dev/null; then
    err "Failed to install pnpm. Install manually: npm install -g pnpm"
    exit 1
  fi
fi
ok "pnpm $(pnpm --version)"

# PostgreSQL (psql)
if ! command -v psql &>/dev/null; then
  warn "psql not found. PostgreSQL is recommended for full features."
  warn "Install: https://www.postgresql.org/download/"
  warn "Or use Docker: docker compose up -d"
  HAS_PSQL=false
else
  ok "psql (PostgreSQL client) available"
  HAS_PSQL=true
fi

# git
if ! command -v git &>/dev/null; then
  err "git is not installed. Install from https://git-scm.com"
  exit 1
fi
ok "git $(git --version | awk '{print $3}')"

# ── Configuration Prompts ──────────────────────────────────────────────────

step "Configuration"

# Database URL
DEFAULT_DB_URL="postgresql://cliaas:cliaas@localhost:5432/cliaas"
printf "PostgreSQL connection URL\n"
printf "  Default: ${CYAN}%s${NC}\n" "$DEFAULT_DB_URL"
printf "  Enter URL (or press Enter for default): "
read -r DATABASE_URL
DATABASE_URL="${DATABASE_URL:-$DEFAULT_DB_URL}"
info "Using: $DATABASE_URL"

# LLM Provider
printf "\nLLM provider for AI features:\n"
printf "  1) claude  (Anthropic Claude — recommended)\n"
printf "  2) openai  (OpenAI GPT)\n"
printf "  3) openclaw (self-hosted / custom endpoint)\n"
printf "  Select [1-3] (default: 1): "
read -r LLM_CHOICE
case "${LLM_CHOICE:-1}" in
  1) LLM_PROVIDER="claude" ;;
  2) LLM_PROVIDER="openai" ;;
  3) LLM_PROVIDER="openclaw" ;;
  *) LLM_PROVIDER="claude" ;;
esac
info "Provider: $LLM_PROVIDER"

# API Key
LLM_API_KEY=""
if [ "$LLM_PROVIDER" = "claude" ]; then
  printf "  Enter ANTHROPIC_API_KEY (or press Enter to skip): "
  read -r LLM_API_KEY
elif [ "$LLM_PROVIDER" = "openai" ]; then
  printf "  Enter OPENAI_API_KEY (or press Enter to skip): "
  read -r LLM_API_KEY
elif [ "$LLM_PROVIDER" = "openclaw" ]; then
  printf "  Enter OpenClaw base URL (default: http://localhost:11434): "
  read -r OPENCLAW_URL
  OPENCLAW_URL="${OPENCLAW_URL:-http://localhost:11434}"
  printf "  Enter model name (default: llama3): "
  read -r OPENCLAW_MODEL
  OPENCLAW_MODEL="${OPENCLAW_MODEL:-llama3}"
fi

# Connector
printf "\nHelpdesk connector for initial data sync (optional):\n"
printf "  0) skip (set up later)\n"
printf "  1) zendesk\n"
printf "  2) kayako\n"
printf "  3) kayako-classic\n"
printf "  4) freshdesk\n"
printf "  5) helpcrunch\n"
printf "  6) groove\n"
printf "  7) intercom\n"
printf "  8) helpscout\n"
printf "  9) zoho-desk\n"
printf " 10) hubspot\n"
printf "  Select [0-10] (default: 0): "
read -r CONNECTOR_CHOICE
case "${CONNECTOR_CHOICE:-0}" in
  1)  CONNECTOR="zendesk" ;;
  2)  CONNECTOR="kayako" ;;
  3)  CONNECTOR="kayako-classic" ;;
  4)  CONNECTOR="freshdesk" ;;
  5)  CONNECTOR="helpcrunch" ;;
  6)  CONNECTOR="groove" ;;
  7)  CONNECTOR="intercom" ;;
  8)  CONNECTOR="helpscout" ;;
  9)  CONNECTOR="zoho-desk" ;;
  10) CONNECTOR="hubspot" ;;
  *)  CONNECTOR="" ;;
esac

CONNECTOR_ENV_LINES=""
if [ -n "$CONNECTOR" ]; then
  info "Connector: $CONNECTOR"
  printf "\n  Enter credentials for %s:\n" "$CONNECTOR"

  case "$CONNECTOR" in
    zendesk)
      printf "    ZENDESK_SUBDOMAIN: "; read -r ZD_SUB
      printf "    ZENDESK_EMAIL: "; read -r ZD_EMAIL
      printf "    ZENDESK_TOKEN: "; read -r ZD_TOKEN
      CONNECTOR_ENV_LINES="ZENDESK_SUBDOMAIN=$ZD_SUB\nZENDESK_EMAIL=$ZD_EMAIL\nZENDESK_TOKEN=$ZD_TOKEN"
      ;;
    kayako)
      printf "    KAYAKO_DOMAIN: "; read -r KY_DOMAIN
      printf "    KAYAKO_EMAIL: "; read -r KY_EMAIL
      printf "    KAYAKO_PASSWORD: "; read -r KY_PASS
      CONNECTOR_ENV_LINES="KAYAKO_DOMAIN=$KY_DOMAIN\nKAYAKO_EMAIL=$KY_EMAIL\nKAYAKO_PASSWORD=$KY_PASS"
      ;;
    kayako-classic)
      printf "    KAYAKO_CLASSIC_DOMAIN: "; read -r KC_DOMAIN
      printf "    KAYAKO_CLASSIC_API_KEY: "; read -r KC_KEY
      printf "    KAYAKO_CLASSIC_SECRET_KEY: "; read -r KC_SECRET
      CONNECTOR_ENV_LINES="KAYAKO_CLASSIC_DOMAIN=$KC_DOMAIN\nKAYAKO_CLASSIC_API_KEY=$KC_KEY\nKAYAKO_CLASSIC_SECRET_KEY=$KC_SECRET"
      ;;
    freshdesk)
      printf "    FRESHDESK_DOMAIN: "; read -r FD_DOMAIN
      printf "    FRESHDESK_API_KEY: "; read -r FD_KEY
      CONNECTOR_ENV_LINES="FRESHDESK_DOMAIN=$FD_DOMAIN\nFRESHDESK_API_KEY=$FD_KEY"
      ;;
    helpcrunch)
      printf "    HELPCRUNCH_DOMAIN: "; read -r HC_DOMAIN
      printf "    HELPCRUNCH_API_KEY: "; read -r HC_KEY
      CONNECTOR_ENV_LINES="HELPCRUNCH_DOMAIN=$HC_DOMAIN\nHELPCRUNCH_API_KEY=$HC_KEY"
      ;;
    groove)
      printf "    GROOVE_API_KEY: "; read -r GR_KEY
      CONNECTOR_ENV_LINES="GROOVE_API_KEY=$GR_KEY"
      ;;
    intercom)
      printf "    INTERCOM_TOKEN: "; read -r IC_TOKEN
      CONNECTOR_ENV_LINES="INTERCOM_TOKEN=$IC_TOKEN"
      ;;
    helpscout)
      printf "    HELPSCOUT_APP_ID: "; read -r HS_ID
      printf "    HELPSCOUT_APP_SECRET: "; read -r HS_SECRET
      CONNECTOR_ENV_LINES="HELPSCOUT_APP_ID=$HS_ID\nHELPSCOUT_APP_SECRET=$HS_SECRET"
      ;;
    zoho-desk)
      printf "    ZOHO_DESK_DOMAIN: "; read -r ZH_DOMAIN
      printf "    ZOHO_DESK_ORG_ID: "; read -r ZH_ORG
      printf "    ZOHO_DESK_TOKEN: "; read -r ZH_TOKEN
      CONNECTOR_ENV_LINES="ZOHO_DESK_DOMAIN=$ZH_DOMAIN\nZOHO_DESK_ORG_ID=$ZH_ORG\nZOHO_DESK_TOKEN=$ZH_TOKEN"
      ;;
    hubspot)
      printf "    HUBSPOT_TOKEN: "; read -r HB_TOKEN
      CONNECTOR_ENV_LINES="HUBSPOT_TOKEN=$HB_TOKEN"
      ;;
  esac
fi

# ── Install Dependencies ───────────────────────────────────────────────────

step "Installing dependencies"

pnpm install
ok "Dependencies installed"

# ── Write .env ─────────────────────────────────────────────────────────────

step "Writing configuration files"

ENV_FILE=".env"
if [ -f "$ENV_FILE" ]; then
  warn ".env already exists — backing up to .env.backup"
  cp "$ENV_FILE" "${ENV_FILE}.backup"
fi

{
  echo "# CLIaaS BYOC Configuration"
  echo "# Generated by install-byoc.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo ""
  echo "# Mode"
  echo "CLIAAS_MODE=local"
  echo ""
  echo "# Database"
  echo "DATABASE_URL=$DATABASE_URL"
  echo ""
  echo "# LLM Provider"
  if [ "$LLM_PROVIDER" = "claude" ] && [ -n "$LLM_API_KEY" ]; then
    echo "ANTHROPIC_API_KEY=$LLM_API_KEY"
  elif [ "$LLM_PROVIDER" = "openai" ] && [ -n "$LLM_API_KEY" ]; then
    echo "OPENAI_API_KEY=$LLM_API_KEY"
  elif [ "$LLM_PROVIDER" = "openclaw" ]; then
    echo "OPENCLAW_BASE_URL=${OPENCLAW_URL:-}"
    echo "OPENCLAW_MODEL=${OPENCLAW_MODEL:-}"
  fi
  echo ""
  echo "# Connector credentials"
  if [ -n "$CONNECTOR_ENV_LINES" ]; then
    printf "%b\n" "$CONNECTOR_ENV_LINES"
  fi
} > "$ENV_FILE"

chmod 600 "$ENV_FILE"
ok "Wrote .env (mode 0600)"

# ── Write CLI Config ────────────────────────────────────────────────────────

CONFIG_DIR="$HOME/.cliaas"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

CLI_CONFIG='{
  "provider": "'$LLM_PROVIDER'",
  "mode": "local"'

if [ "$LLM_PROVIDER" = "claude" ] && [ -n "$LLM_API_KEY" ]; then
  CLI_CONFIG="$CLI_CONFIG"',
  "claude": { "apiKey": "'$LLM_API_KEY'" }'
elif [ "$LLM_PROVIDER" = "openai" ] && [ -n "$LLM_API_KEY" ]; then
  CLI_CONFIG="$CLI_CONFIG"',
  "openai": { "apiKey": "'$LLM_API_KEY'" }'
elif [ "$LLM_PROVIDER" = "openclaw" ]; then
  CLI_CONFIG="$CLI_CONFIG"',
  "openclaw": { "baseUrl": "'${OPENCLAW_URL:-}'", "model": "'${OPENCLAW_MODEL:-}'" }'
fi

CLI_CONFIG="$CLI_CONFIG
}"

echo "$CLI_CONFIG" > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
ok "Wrote ~/.cliaas/config.json (mode 0600)"

# ── Set up MCP Config ──────────────────────────────────────────────────────

if [ -f ".mcp.json.example" ]; then
  if [ ! -f ".mcp.json" ]; then
    sed "s|postgresql://user:password@localhost:5432/cliaas|$DATABASE_URL|g" \
      .mcp.json.example > .mcp.json
    ok "Wrote .mcp.json from template"
  else
    warn ".mcp.json already exists — skipping"
  fi
fi

# ── Run Database Migrations ────────────────────────────────────────────────

step "Running database migrations"

if [ "$HAS_PSQL" = true ]; then
  # Test the connection first
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_PORT="${DB_PORT:-5432}"

  if pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
    ok "PostgreSQL is reachable at $DB_HOST:$DB_PORT"
    pnpm drizzle-kit push 2>/dev/null && ok "Database migrations applied" || warn "Migration failed — you may need to create the database first"
  else
    warn "PostgreSQL not reachable at $DB_HOST:$DB_PORT"
    warn "Start Postgres and run: pnpm drizzle-kit push"
  fi
else
  warn "psql not available — skipping migration"
  warn "When Postgres is ready, run: pnpm drizzle-kit push"
fi

# ── Optional Initial Sync ──────────────────────────────────────────────────

if [ -n "$CONNECTOR" ]; then
  step "Running initial sync"

  printf "Run initial sync from %s now? [y/N]: " "$CONNECTOR"
  read -r DO_SYNC
  if [ "${DO_SYNC:-n}" = "y" ] || [ "${DO_SYNC:-n}" = "Y" ]; then
    npx tsx cli/index.ts sync run --connector "$CONNECTOR" && ok "Initial sync complete" || warn "Sync failed — check credentials and try: pnpm cliaas sync run --connector $CONNECTOR"
  else
    info "Skipping sync. Run later: pnpm cliaas sync run --connector $CONNECTOR"
  fi
fi

# ── Success ─────────────────────────────────────────────────────────────────

step "Setup Complete"

printf "${GREEN}${BOLD}CLIaaS BYOC is ready!${NC}\n\n"
printf "  ${BOLD}Quick Start:${NC}\n"
printf "    pnpm cliaas demo          # Generate sample data\n"
printf "    pnpm cliaas triage        # AI-powered ticket triage\n"
printf "    pnpm cliaas queue stats   # View queue metrics\n"
printf "    pnpm dev                  # Start web dashboard\n"
printf "\n"
printf "  ${BOLD}MCP (AI Agent) Setup:${NC}\n"
printf "    pnpm cliaas mcp test      # Verify MCP server\n"
printf "    pnpm cliaas mcp install   # Install into Claude Code\n"
printf "\n"
printf "  ${BOLD}Files Created:${NC}\n"
printf "    .env                      # Environment configuration\n"
printf "    ~/.cliaas/config.json     # CLI configuration\n"
if [ -f ".mcp.json" ]; then
printf "    .mcp.json                 # MCP server configuration\n"
fi
printf "\n"
printf "  ${BOLD}Documentation:${NC}\n"
printf "    WIZARD/claude.md          # AI setup assistant\n"
printf "    WIZARD/agents.md          # MCP tool reference\n"
printf "    WIZARD/TROUBLESHOOTING.md # Common issues & fixes\n"
printf "\n"
