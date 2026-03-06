# Plan 04: Marketplace & Plugin Platform

## 1. Summary of What Exists Today

### Plugin Registry (JSONL/in-memory)
- **`src/lib/plugins.ts`**: Singleton `PluginRegistryImpl` class backed by JSONL file (`plugins.jsonl`). Falls back to 3 hardcoded demo plugins (GitHub Sync, PagerDuty Alerts, Stripe Context) on first load (:58-161).
- **`PluginManifest`** type (:8-33): `id`, `name`, `version`, `description`, `author`, `hooks[]`, `actions[]`, `enabled`, `installedAt`, `config?`. No permissions model, no UI slots, no OAuth.
- **`PluginHookType`** (:8-14): Only 6 hook types: `ticket.created`, `ticket.updated`, `ticket.resolved`, `message.created`, `sla.breached`, `csat.submitted`.
- **Handler execution** (:201-217): `executeHook()` runs all registered handlers for a hook in parallel via `Promise.allSettled`. No sandboxing, no timeout, no resource limits.
- **No handler loading from external code** — handlers must be registered programmatically in-process via `registerHandler()` (:193). There is no mechanism to load plugin code from disk, URL, or package.

### Event Dispatcher Integration
- **`src/lib/events/dispatcher.ts`**: `dispatch()` fans out to 5 channels including `executePluginHook()` (:110-115). Plugins are a first-class dispatch target.
- 19 canonical event types defined (:18-37), but only 6 are wired to plugin hooks.

### Sandbox System (data isolation, NOT plugin sandboxing)
- **`src/lib/sandbox.ts`**: Workspace-level data sandboxing (clone JSONL data into isolated directories). NOT plugin execution sandboxing.
- **`src/lib/sandbox-clone.ts`**: Clones JSONL files into sandbox directories with ID remapping.
- **`src/lib/sandbox-diff.ts`**: Diffs sandbox data against production, supports selective promotion.
- These are useful for plugin *testing* environments but not for runtime isolation.

### API Routes
- **`src/app/api/plugins/route.ts`**: `GET /api/plugins` (list), `POST /api/plugins` (register, admin-only).
- **`src/app/api/plugins/[id]/route.ts`**: `GET /api/plugins/:id` (get), `DELETE /api/plugins/:id` (unregister, admin-only).
- No PATCH (toggle enable/disable, update config). No plugin execution endpoint.

### UI
- **`src/app/integrations/page.tsx`**: Tabbed page (Webhooks, Slack & Teams, Plugins, API). Plugins tab (:753-895) shows expandable cards with name, version, status, hooks, actions, config JSON, and uninstall button. No install flow, no marketplace browse, no config editor.

### Database
- **`integrations` table** (`src/db/schema.ts:569`): Generic integration tracking with `provider` enum, `credentialsRef`, `metadata` JSONB. Used for connector integrations (Zendesk, Freshdesk, etc.), not plugins.
- **No `plugins` table in Postgres** — plugins are JSONL-only.

### MCP Tools
- **No plugin-related MCP tools** exist in `cli/mcp/tools/`.

### CLI Commands
- **No plugin-related CLI commands** exist.

---

## 2. Proposed DB Schema Changes

### New Tables

```sql
-- Plugin definitions (replaces JSONL)
CREATE TABLE plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  slug TEXT NOT NULL,                    -- unique identifier e.g. "github-sync"
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  author TEXT,
  icon_url TEXT,                         -- marketplace listing icon
  source_url TEXT,                       -- git repo or package URL
  manifest JSONB NOT NULL,               -- full manifest (hooks, permissions, ui_slots, etc.)
  status TEXT NOT NULL DEFAULT 'installed', -- installed | active | disabled | error
  installed_by UUID REFERENCES users(id),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  config JSONB,                          -- user-provided config values
  credentials_ref TEXT,                  -- encrypted ref for plugin OAuth tokens
  error_message TEXT,                    -- last error if status='error'
  UNIQUE(workspace_id, slug)
);

-- Plugin event hooks (denormalized from manifest for fast lookup)
CREATE TABLE plugin_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,              -- e.g. 'ticket.created'
  priority INT NOT NULL DEFAULT 100,     -- execution order (lower = first)
  filter JSONB,                          -- optional condition filter
  UNIQUE(plugin_id, event_type)
);
CREATE INDEX plugin_hooks_event_idx ON plugin_hooks(event_type);

-- Plugin execution log
CREATE TABLE plugin_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | success | error | timeout
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  input_summary JSONB,                   -- truncated event payload
  output JSONB,                          -- plugin response/actions taken
  error TEXT,
  INDEX plugin_executions_plugin_idx (plugin_id),
  INDEX plugin_executions_workspace_idx (workspace_id)
);

-- Plugin OAuth credentials (encrypted)
CREATE TABLE plugin_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL,                -- e.g. 'github', 'jira', 'salesforce'
  access_token_enc TEXT NOT NULL,        -- AES-256-GCM encrypted
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plugin_id, workspace_id, provider)
);

-- Marketplace catalog (for hosted tier — curated/approved plugins)
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  long_description TEXT,                 -- markdown
  author TEXT NOT NULL,
  author_url TEXT,
  icon_url TEXT,
  banner_url TEXT,
  category TEXT NOT NULL,                -- e.g. 'communication', 'crm', 'analytics', 'productivity'
  tags TEXT[],
  manifest_url TEXT NOT NULL,            -- URL to fetch latest manifest
  source_url TEXT,                       -- git repo
  latest_version TEXT NOT NULL,
  min_cliaas_version TEXT,
  install_count INT NOT NULL DEFAULT 0,
  avg_rating NUMERIC(2,1),
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | published | deprecated
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketplace reviews
CREATE TABLE marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, user_id)
);
```

### Modified Tables

```sql
-- No modifications needed to existing tables.
-- The existing `integrations` table remains for connectors.
-- Plugins get their own dedicated table.
```

---

## 3. New API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/plugins` | List installed plugins (workspace-scoped) |
| `POST` | `/api/plugins` | Install plugin (from manifest URL or inline) |
| `GET` | `/api/plugins/:id` | Get plugin details |
| `PATCH` | `/api/plugins/:id` | Update config, toggle enabled/disabled |
| `DELETE` | `/api/plugins/:id` | Uninstall plugin |
| `POST` | `/api/plugins/:id/execute` | Manually trigger a plugin action |
| `GET` | `/api/plugins/:id/logs` | Get execution log for a plugin |
| `POST` | `/api/plugins/:id/test` | Dry-run plugin against sample event |
| `GET` | `/api/plugins/:id/credentials` | List OAuth connections |
| `POST` | `/api/plugins/:id/credentials` | Initiate OAuth flow |
| `DELETE` | `/api/plugins/:id/credentials/:provider` | Revoke OAuth connection |
| `GET` | `/api/marketplace` | Browse marketplace listings |
| `GET` | `/api/marketplace/:slug` | Get listing details |
| `POST` | `/api/marketplace/:slug/install` | Install from marketplace |
| `GET` | `/api/marketplace/:slug/reviews` | Get reviews |
| `POST` | `/api/marketplace/:slug/reviews` | Submit review |

---

## 4. New/Modified UI Pages/Components

### New Pages
| Page | Path | Description |
|------|------|-------------|
| Marketplace Browse | `/marketplace` | Grid of available plugins with search, category filters, install counts, ratings |
| Marketplace Detail | `/marketplace/[slug]` | Full listing with screenshots, description, reviews, install button |
| Plugin Settings | `/settings/plugins/[id]` | Per-plugin config editor, OAuth connections, execution logs |

### Modified Pages
| Page | Change |
|------|--------|
| `/integrations` (Plugins tab) | Replace static card list with richer cards showing health status, last execution, quick config toggle. Add "Browse Marketplace" CTA button. |
| Ticket detail (`/tickets/[id]`) | Add **Plugin Sidebar Panels** — extension point where plugins can inject UI (e.g., Stripe customer data, GitHub issue link). Initially server-rendered from plugin output JSONB. |
| Dashboard | Add **Plugin Widget Slots** — extension point for dashboard widgets contributed by plugins. |
| Settings | Add Plugin management sub-section under admin settings. |

### New Components
| Component | Purpose |
|-----------|---------|
| `PluginCard` | Marketplace listing card (icon, name, category, rating, install count) |
| `PluginConfigEditor` | JSON-schema-driven config form (renders form fields from manifest `configSchema`) |
| `PluginSidebarPanel` | Generic sidebar panel in ticket view for plugin-contributed content |
| `PluginExecutionLog` | Sortable/filterable log table of plugin executions |
| `MarketplaceSearch` | Search + category filter bar for marketplace browse |
| `OAuthConnectButton` | Initiates OAuth flow for a plugin's third-party integration |

---

## 5. New CLI Commands

```
cliaas plugins list                          # List installed plugins
cliaas plugins install <slug|manifest-url>   # Install a plugin
cliaas plugins uninstall <slug>              # Uninstall a plugin
cliaas plugins enable <slug>                 # Enable a disabled plugin
cliaas plugins disable <slug>                # Disable a plugin
cliaas plugins config <slug> [--set key=val] # View or update plugin config
cliaas plugins logs <slug> [--limit 50]      # View execution logs
cliaas plugins test <slug> --event ticket.created --data '{...}'  # Dry-run
cliaas plugins dev <path>                    # Start local dev server for plugin development
cliaas marketplace search [query]            # Search marketplace
cliaas marketplace info <slug>               # Show listing details
```

---

## 6. New MCP Tools

| Tool | Description |
|------|-------------|
| `plugin_list` | List installed plugins with status |
| `plugin_install` | Install a plugin by slug or manifest URL |
| `plugin_uninstall` | Uninstall a plugin |
| `plugin_toggle` | Enable/disable a plugin |
| `plugin_config` | View or update plugin configuration |
| `plugin_logs` | Get recent execution logs for a plugin |
| `plugin_test` | Dry-run a plugin against a sample event |
| `marketplace_search` | Search the marketplace catalog |
| `marketplace_install` | Install a marketplace plugin |

---

## 7. Migration/Rollout Plan

### Phase 1: Foundation (M effort)
1. **DB migration**: Create `plugins`, `plugin_hooks`, `plugin_executions` tables.
2. **Plugin SDK types**: Define `PluginManifest v2` with permissions, configSchema (JSON Schema), UI slots, hook filters.
3. **Migrate from JSONL to DB**: Rewrite `src/lib/plugins.ts` to use Postgres. Keep JSONL as fallback for BYOC/local mode.
4. **Execution engine**: Replace naive `Promise.allSettled` with isolated execution — `vm.runInNewContext` with timeout (5s default), memory limit (128MB), and no filesystem/network access.
5. **Execution logging**: Log every hook invocation to `plugin_executions` table.
6. **Expand hook types**: Wire all 19 canonical events (from dispatcher.ts) to plugin hooks, not just 6.
7. **API routes**: Implement full CRUD + toggle + logs endpoints.
8. **PATCH endpoint**: Add enable/disable and config update to existing API.

### Phase 2: Plugin SDK & Dev Experience (M effort)
1. **Plugin manifest v2 spec**: Formal JSON schema defining hooks, permissions, configSchema, uiSlots, oauthProviders.
2. **`cliaas plugins dev`**: Local dev server that watches a plugin directory, auto-reloads on change, provides a mock event emitter for testing hooks.
3. **Plugin template**: `cliaas plugins init` scaffolds a new plugin project with TypeScript, manifest, and example hook handler.
4. **Config validation**: Validate user-provided config against the plugin's `configSchema` (JSON Schema) at install and update time.
5. **Permission model**: Plugins declare required permissions (read_tickets, write_tickets, read_customers, send_notifications, webhook_outbound). Installation shows permission consent screen.

### Phase 3: OAuth & Credentials (S effort)
1. **Plugin OAuth flow**: Plugin manifest declares `oauthProviders` (e.g., `{provider: 'github', scopes: ['repo']}`). CLIaaS handles the OAuth dance and stores encrypted tokens.
2. **`plugin_credentials` table** with AES-256-GCM encryption at rest.
3. **Token refresh**: Background job refreshes expiring tokens.
4. **Credential injection**: When a plugin hook fires, the execution context includes decrypted tokens for the plugin's configured providers.

### Phase 4: UI Extension Points (M effort)
1. **Ticket sidebar panels**: Plugins register `uiSlots: ['ticket.sidebar']` in manifest. When ticket detail loads, query active plugins with that slot, render their output.
2. **Dashboard widgets**: Same pattern with `uiSlots: ['dashboard.widget']`.
3. **Settings pages**: Plugins can contribute a settings sub-page.
4. **Initial implementation**: Server-side rendered (plugin returns structured data, CLIaaS renders). No client-side plugin JS initially (security concern deferred).

### Phase 5: Marketplace (L effort)
1. **`marketplace_listings` and `marketplace_reviews` tables**.
2. **Marketplace browse UI**: Grid layout, category filters, search, sort by popularity/rating.
3. **Marketplace detail page**: Long description (markdown), screenshots, reviews, install button.
4. **Listing submission**: Admin API for publishing plugins to marketplace (hosted tier).
5. **Install from marketplace**: One-click install that fetches manifest from `manifest_url`, validates, and creates `plugins` row.
6. **Reviews**: Authenticated users can rate and review installed plugins.

### Phase 6: First-Party Reference Plugins (M effort)
Build 3-4 reference plugins to validate the SDK and populate the marketplace:
1. **Slack Notifications**: Post to Slack on ticket events (replaces current env-var-based webhook).
2. **Jira Sync**: Create/link Jira issues from tickets, bidirectional status sync.
3. **Stripe Context**: Enrich ticket sidebar with Stripe customer data (subscription, MRR, invoices).
4. **GitHub Issues**: Create GitHub issues from tickets, link PRs. (Upgrade from current demo plugin.)

### Rollout Order
```
Phase 1 (Foundation)          → immediate prerequisite for everything
Phase 2 (SDK & Dev)           → enables internal + community plugin development
Phase 3 (OAuth & Credentials) → enables plugins that connect to external services
Phase 4 (UI Extension Points) → enables rich plugin experiences
Phase 6 (Reference Plugins)   → can start alongside Phase 3-4, validates SDK
Phase 5 (Marketplace)         → last, requires sufficient plugin ecosystem
```

---

## 8. Effort Estimate

**Overall: XL**

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 1: Foundation | M (1-2 weeks) | None |
| Phase 2: SDK & Dev Experience | M (1-2 weeks) | Phase 1 |
| Phase 3: OAuth & Credentials | S (3-5 days) | Phase 1 |
| Phase 4: UI Extension Points | M (1-2 weeks) | Phase 1 |
| Phase 5: Marketplace | L (2-3 weeks) | Phase 1, Phase 4 |
| Phase 6: Reference Plugins | M (1-2 weeks) | Phase 2, Phase 3 |

**Total: ~8-12 weeks** for full implementation with marketplace. Phases 1-3 are viable as a standalone "Plugin Platform" MVP in ~3-4 weeks.

---

## Key Architectural Decisions

1. **DB-backed + JSONL fallback**: Postgres for hosted/hybrid tiers, JSONL for BYOC (consistent with CLIaaS tiering model).
2. **Server-side execution only** (Phase 1-3): Plugins run on the server in V8 isolates. No client-side plugin JS until trust model is established.
3. **No Wasm initially**: V8 `vm` module with strict timeouts is simpler and sufficient. Wasm sandboxing is a future upgrade if needed.
4. **Manifest-driven**: Everything about a plugin is declared in its manifest. No magic discovery or convention-over-configuration.
5. **Execution logging by default**: Every plugin invocation is logged. Critical for debugging, billing, and trust.
6. **OAuth handled by platform**: Plugins never see raw OAuth credentials outside their execution context. CLIaaS manages token lifecycle.
