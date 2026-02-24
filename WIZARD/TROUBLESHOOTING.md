# CLIaaS BYOC Troubleshooting

Common issues and fixes for self-hosted CLIaaS installations.

---

## PostgreSQL Connection Errors

### "Connection refused" or "could not connect to server"

**Cause:** PostgreSQL is not running or not reachable at the configured host/port.

**Fix:**
```bash
# Check if Postgres is running
pg_isready -h localhost -p 5432

# If using Docker:
docker compose up -d
docker compose ps   # Verify container is running

# If using local Postgres:
# macOS (Homebrew):
brew services start postgresql@16
# Linux (systemd):
sudo systemctl start postgresql
```

### "FATAL: database does not exist"

**Cause:** The `cliaas` database has not been created yet.

**Fix:**
```bash
createdb cliaas
# Or via psql:
psql -U postgres -c "CREATE DATABASE cliaas;"
```

### "FATAL: password authentication failed"

**Cause:** The username/password in `DATABASE_URL` does not match PostgreSQL config.

**Fix:**
```bash
# Check your DATABASE_URL in .env:
# postgresql://USER:PASSWORD@HOST:PORT/DATABASE

# Create the user if it doesn't exist:
psql -U postgres -c "CREATE USER cliaas WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE cliaas TO cliaas;"
```

### "FATAL: role does not exist"

**Cause:** The PostgreSQL user specified in `DATABASE_URL` has not been created.

**Fix:**
```bash
psql -U postgres -c "CREATE ROLE cliaas WITH LOGIN PASSWORD 'cliaas';"
psql -U postgres -c "ALTER ROLE cliaas CREATEDB;"
```

---

## Migration Failures

### "relation already exists"

**Cause:** Migrations were partially applied. Safe to ignore — Drizzle handles idempotent migrations.

**Fix:**
```bash
# Force-push schema (non-destructive):
pnpm drizzle-kit push

# Or if you need a clean slate:
# WARNING: This deletes all data
dropdb cliaas && createdb cliaas && pnpm drizzle-kit push
```

### "drizzle-kit: command not found"

**Cause:** Dependencies not installed or not in PATH.

**Fix:**
```bash
pnpm install
pnpm drizzle-kit push
```

### "Cannot find module './src/db/schema'"

**Cause:** TypeScript compilation issue with Drizzle config.

**Fix:**
```bash
# Ensure drizzle.config.ts points to the correct schema path
# Check: schema: './src/db/schema.ts' in drizzle.config.ts
pnpm typecheck   # Verify no TS errors
pnpm drizzle-kit push
```

---

## Missing API Keys

### "No Claude/OpenAI API key configured"

**Cause:** AI features require an LLM provider API key.

**Fix:**
```bash
# Option 1: Set in .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# Option 2: Set in CLI config
pnpm cliaas config set-provider claude
# Then add key to ~/.cliaas/config.json:
# { "provider": "claude", "claude": { "apiKey": "sk-ant-..." } }

# Option 3: Set as environment variable
export ANTHROPIC_API_KEY=sk-ant-...
```

### "Invalid API key"

**Cause:** The API key is malformed or expired.

**Fix:**
- Claude keys start with `sk-ant-`
- OpenAI keys start with `sk-`
- Check the key hasn't been revoked at the provider's dashboard
- Ensure there are no trailing spaces or newlines in the key

---

## Connector Auth Issues

### "Missing authentication for zendesk"

**Cause:** Required connector environment variables are not set.

**Fix:**
```bash
# Check which vars are needed:
# Zendesk: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN
# Kayako: KAYAKO_DOMAIN, KAYAKO_EMAIL, KAYAKO_PASSWORD
# See .env.example for the full list

# Set them in .env:
ZENDESK_SUBDOMAIN=yourcompany
ZENDESK_EMAIL=admin@yourcompany.com
ZENDESK_TOKEN=your-api-token
```

### "401 Unauthorized" during sync

**Cause:** Credentials are set but invalid or expired.

**Fix:**
- **Zendesk:** Regenerate API token at Admin > Channels > API
- **Kayako:** Verify email/password, check if 2FA is enabled
- **Freshdesk:** Regenerate API key at Profile Settings > API Key
- **Intercom:** Create a new access token at Developer Hub > Your Apps

### "403 Forbidden" during sync

**Cause:** The API credentials lack required permissions.

**Fix:**
- Ensure the user/token has admin or read access to tickets, users, and KB
- Some platforms require specific scopes (e.g., Intercom requires `read_conversations`)

### "Rate limited" or "429 Too Many Requests"

**Cause:** Exceeded the connector's API rate limits.

**Fix:**
```bash
# Wait a few minutes, then retry with smaller batches
pnpm cliaas sync run --connector zendesk

# For large imports, the sync engine handles cursor-based pagination
# and will resume from where it left off
```

---

## MCP Server Not Starting

### "Cannot find module 'cli/mcp/server.ts'"

**Cause:** Wrong working directory or missing dependencies.

**Fix:**
```bash
# Ensure you're in the project root:
cd /path/to/CLIaaS

# Reinstall dependencies:
pnpm install

# Test the MCP server:
pnpm cliaas mcp test
```

### "JSON-RPC parse error" or garbled output

**Cause:** Something is writing to stdout (console.log) in the MCP server code. The MCP stdio transport requires clean JSON-RPC on stdout.

**Fix:**
- Never use `console.log` in MCP code — use `process.stderr.write()` or the `log()` helper from `cli/mcp/util.ts`
- Check that no dependency is printing to stdout during import

### ".mcp.json not found"

**Cause:** The MCP config file is missing.

**Fix:**
```bash
# Generate from template:
cp .mcp.json.example .mcp.json

# Or install via CLI:
pnpm cliaas mcp install

# Edit .mcp.json to set your DATABASE_URL
```

### "MCP server timeout" or "no tools registered"

**Cause:** The MCP server is failing during startup.

**Fix:**
```bash
# Run the server directly to see errors:
npx tsx cli/mcp/server.ts 2>&1

# Check stderr for error messages
# Common causes:
# - Missing DATABASE_URL (set in .mcp.json env block)
# - Missing dependencies (run pnpm install)
# - Port conflict (MCP uses stdio, not a port)
```

---

## Web Dashboard Issues

### "Module not found" errors on pnpm dev

**Cause:** Dependencies not installed or stale cache.

**Fix:**
```bash
rm -rf node_modules .next
pnpm install
pnpm dev
```

### Setup page shows "connection failed"

**Cause:** The API route at `/api/setup` cannot reach the database.

**Fix:**
1. Verify `DATABASE_URL` in `.env`
2. Ensure Postgres is running: `pg_isready`
3. Check the browser console for detailed error messages

### Dashboard shows no data

**Cause:** No data has been imported or generated.

**Fix:**
```bash
# Generate sample data:
pnpm cliaas demo

# Or sync from a connector:
pnpm cliaas sync run --connector zendesk
```

---

## General Debugging

### Check configuration state

```bash
# View CLI config:
cat ~/.cliaas/config.json

# View environment:
cat .env

# View MCP config:
cat .mcp.json

# Check detected mode:
pnpm cliaas config show
```

### Run TypeScript checks

```bash
pnpm typecheck    # Verify no compilation errors
pnpm lint         # ESLint check
pnpm test         # Run test suite
```

### Reset everything

```bash
# WARNING: This deletes all local data
rm -rf node_modules .next
rm .env
rm ~/.cliaas/config.json
pnpm install
bash scripts/install-byoc.sh
```
