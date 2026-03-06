# CLIaaS Plugin SDK

This document describes the plugin interface, hook types, lifecycle, and credential management for building CLIaaS plugins.

## Plugin Architecture

CLIaaS plugins are event-driven extensions that react to platform events (ticket created, SLA breached, etc.). Plugins can run as:

- **Node plugins** (`runtime: "node"`): Executed in a sandboxed VM context on the server
- **Webhook plugins** (`runtime: "webhook"`): Receive HTTP POST callbacks at a configured URL

## Manifest (PluginManifestV2)

Every plugin must declare a manifest with the following fields:

```typescript
interface PluginManifestV2 {
  id: string;              // Unique slug, e.g. "my-plugin"
  name: string;            // Human-readable name
  version: string;         // Semver version
  description: string;     // What the plugin does
  author: string;          // Author name or organization
  hooks: PluginHookType[]; // Events the plugin listens to
  permissions: PluginPermission[]; // Required permissions
  actions: PluginAction[]; // Manual actions the plugin exposes
  uiSlots: PluginUISlot[]; // UI injection points
  oauthRequirements: PluginOAuthRequirement[]; // OAuth providers needed
  configSchema?: object;   // JSON Schema for configuration
  entrypoint?: string;     // Handler code (node runtime)
  webhookUrl?: string;     // Callback URL (webhook runtime)
  runtime: "node" | "webhook";
  icon?: string;           // Icon identifier
  category?: string;       // Marketplace category
}
```

## Hook Types

Plugins can subscribe to any of these event hooks:

### Ticket Lifecycle
- `ticket.created` - New ticket created
- `ticket.updated` - Ticket fields changed
- `ticket.resolved` - Ticket marked as solved/closed
- `ticket.deleted` - Ticket deleted
- `ticket.assigned` - Ticket assigned to an agent
- `ticket.tagged` - Tags added/removed
- `ticket.priority_changed` - Priority level changed

### Messages
- `message.created` - New message on a ticket
- `message.updated` - Message edited

### SLA
- `sla.breached` - SLA deadline exceeded
- `sla.warning` - SLA deadline approaching

### Customer
- `customer.created` - New customer record
- `customer.updated` - Customer data changed
- `customer.merged` - Two customer records merged

### Satisfaction
- `csat.submitted` - CSAT rating received
- `survey.submitted` - Survey response submitted

### Knowledge Base
- `kb.article_created` - New KB article published
- `kb.article_updated` - KB article edited

### Campaigns
- `campaign.sent` - Campaign message sent

### Plugin Lifecycle
- `plugin.installed` - Plugin installed in workspace
- `plugin.uninstalled` - Plugin removed
- `plugin.enabled` - Plugin turned on
- `plugin.disabled` - Plugin turned off
- `plugin.configured` - Plugin config changed

## Handler Interface

### Node Runtime

For node plugins, implement a handler that receives a `PluginHookContext` and returns a `PluginHandlerResult`:

```typescript
interface PluginHookContext {
  event: string;                       // The hook event name
  data: Record<string, unknown>;       // Event payload
  timestamp: string;                   // ISO 8601 timestamp
  workspaceId?: string;                // Workspace ID
  pluginId?: string;                   // Your plugin ID
  config?: Record<string, unknown>;    // Your plugin's config
}

interface PluginHandlerResult {
  ok: boolean;                         // Success/failure
  data?: Record<string, unknown>;      // Result data (logged)
  error?: string;                      // Error message if !ok
}
```

Example handler:

```typescript
import type { PluginHookContext, PluginHandlerResult } from './types';

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;

  if (event === 'ticket.created') {
    const subject = data.subject as string;
    // Do something with the ticket...
    return { ok: true, data: { processed: true } };
  }

  return { ok: true };
}
```

### Webhook Runtime

Webhook plugins receive an HTTP POST with:

- **Body**: JSON-encoded `PluginHookContext`
- **Headers**:
  - `Content-Type: application/json`
  - `X-CLIaaS-Signature: sha256=<HMAC>` (HMAC-SHA256 of body using plugin secret)
  - `X-CLIaaS-Event: <hook_name>`
  - `X-CLIaaS-Plugin: <plugin_id>`

Verify the signature before processing:

```javascript
const crypto = require('crypto');
const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', YOUR_SECRET)
  .update(rawBody)
  .digest('hex');

if (expectedSig !== request.headers['x-cliaas-signature']) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

## Permissions

Plugins must declare the permissions they need. The platform enforces these at runtime:

| Permission | Description |
|-----------|-------------|
| `tickets:read` | Read ticket data |
| `tickets:write` | Modify tickets |
| `customers:read` | Read customer data |
| `customers:write` | Modify customer records |
| `kb:read` | Read knowledge base articles |
| `kb:write` | Create/update KB articles |
| `messages:read` | Read ticket messages |
| `messages:write` | Send messages on tickets |
| `analytics:read` | Access analytics data |
| `webhooks:manage` | Manage webhook subscriptions |
| `oauth:external` | Make OAuth-authenticated API calls |

## Sandboxed Execution (Node Runtime)

Node plugins run in a restricted `node:vm` context with:

- **Available globals**: `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`, `Promise`, `Error`
- **Blocked globals**: `setTimeout`, `setInterval`, `process`, `require`, `__dirname`, `__filename`, `global`, `globalThis`
- **Timeout**: 5 seconds (configurable)
- **SDK injection**: The `cliaas` object provides a scoped SDK based on declared permissions

## Credential Management

Plugins that need API keys or tokens should use the credential management API rather than storing secrets in plaintext config.

### Storing Credentials

```
PUT /api/plugins/:installationId/credentials
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "credentials": {
    "api_key": "sk-...",
    "webhook_secret": "whsec_..."
  }
}
```

Credentials are encrypted with AES-256-GCM before storage. The encryption key is derived from `PLUGIN_ENCRYPTION_KEY` env var or `DATABASE_URL`.

### Retrieving Credentials

```
GET /api/plugins/:installationId/credentials
Authorization: Bearer <admin-token>
```

Returns masked values (last 4 chars visible) and the list of credential keys. Full decryption happens server-side only when the plugin executes.

## Plugin Lifecycle

1. **Discovery**: Plugin appears in the marketplace (published listing)
2. **Installation**: Admin installs the plugin; an `PluginInstallation` record is created
3. **Configuration**: Admin sets config values and credentials
4. **Enable**: Admin enables the plugin; hooks are now active
5. **Execution**: Platform dispatches matching events to the plugin
6. **Disable/Uninstall**: Admin can disable (pause) or uninstall (remove) the plugin

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plugins` | List plugins |
| `POST` | `/api/plugins` | Register a plugin |
| `GET` | `/api/plugins/:id` | Get plugin details |
| `PATCH` | `/api/plugins/:id` | Update plugin config |
| `DELETE` | `/api/plugins/:id` | Uninstall plugin |
| `GET` | `/api/plugins/:id/logs` | Get execution logs |
| `POST` | `/api/plugins/:id/execute` | Manually trigger a hook |
| `GET` | `/api/plugins/:id/credentials` | Get credentials (masked) |
| `PUT` | `/api/plugins/:id/credentials` | Store encrypted credentials |

## Reference Plugins

Three reference plugins are included in `src/lib/plugins/reference/`:

### hello-world
The simplest possible plugin. Logs every event it receives. Use as a starting template.

### slack-notifier
Demonstrates channel-based routing, priority-aware notification channels, per-event toggles, and credential usage for the Slack Web API.

### auto-tagger
Demonstrates keyword-based tag assignment using configurable regex patterns, conditional logic per event type, and ticket-write permissions.

## Building a Plugin

1. Create a directory under `src/lib/plugins/reference/` (or your own location)
2. Export a `manifest` object matching `PluginManifestV2`
3. Export a `handle(context: PluginHookContext): Promise<PluginHandlerResult>` function
4. Register in the marketplace via the seed mechanism or API
5. Install and configure in the target workspace
