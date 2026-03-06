# Plan 16: PII Detection, Data Masking & HIPAA Compliance Path

## Competitive Context

| Platform | Capability | Price |
|----------|-----------|-------|
| Zendesk ADPP | Access logs, BYOK encryption, data retention, data masking, redaction suggestions, auto-redaction | $50/agent/month add-on |
| Freshdesk | HIPAA configuration, data masking for SSN/credit cards | Enterprise plan |
| Help Scout | Automatic redaction (GA April 2026) | Plus plan |
| Intercom | HIPAA on Expert plan with BAA | Enterprise |
| Freddy AI Trust | PII detection/anonymization, jailbreak protection | Enterprise |
| **CLIaaS today** | GDPR export/delete, retention policies, audit logging | **No PII detection or masking** |

---

## 1. Summary of What Exists Today

### Compliance Infrastructure (solid foundation)
- **GDPR data export**: `src/lib/compliance/gdpr-db.ts:32-143` -- exports tickets, messages, customers, CSAT, time entries, audit entries per user. Demo-mode fallback via `src/lib/compliance.ts:232-262`.
- **GDPR data deletion**: `src/lib/compliance/gdpr-db.ts:145-220` -- anonymizes customers (sets name to `[deleted]`, nulls email/phone), tracks deletion requests in `gdpr_deletion_requests` table (`src/db/schema.ts:1148-1166`).
- **Retention policies**: `src/lib/compliance/retention-scheduler.ts:18-91` -- enforces per-workspace retention (delete tickets/messages/audit_logs older than N days). DB table at `src/db/schema.ts:1217-1233`. Unique constraint on `(workspace_id, resource)`.
- **Retention CRUD**: `src/lib/compliance.ts:96-191` -- list/create/delete retention policies, DB-first with in-memory fallback. Existing API routes:
  - `GET/POST /api/compliance/retention` (`src/app/api/compliance/retention/route.ts:1-83`)
  - `POST /api/compliance/retention/enforce` (`src/app/api/compliance/retention/enforce/route.ts:1-35`)
- **Compliance status**: `GET /api/compliance` (`src/app/api/compliance/route.ts:1-21`) returns policy summary + data subject count. Admin-only via `requireRole(request, 'admin')`.
- **Audit report**: `src/lib/compliance/audit-report.ts:27-121` -- generates structured JSON report of automation executions, AI resolutions, ROI.
- **SOC 2 evidence**: `src/lib/security/evidence.ts:33-313` -- 20 controls mapped to CC1-CC9 trust service criteria. `generateEvidencePackage()` returns structured control assessment.
- **Access review**: `src/lib/security/access-review.ts:24-96` -- generates role breakdown, privileged access listing, recommendations (currently demo data only, not DB-backed).

### Audit Infrastructure (mature, production-grade)
- **Immutable hash-chain audit log**: `src/lib/security/audit-log.ts:184-230` -- SHA-256 chain with genesis hash, JSONL persistence via `writeJsonlFile`, DB persistence to `audit_events` with WAL fallback (`src/lib/audit-wal.ts`), chain integrity verification (`verifyChainIntegrity()` at line 354).
- **User-facing audit log**: `src/lib/audit.ts:189-228` -- `recordAudit()` writes to 10K circular buffer + DB (`audit_entries` table) + delegates to secure audit log. WAL buffer for retry on transient DB failures.
- **DB tables**: `audit_events` (`src/db/schema.ts:684-701`) and `audit_entries` (`src/db/schema.ts:744-775`) with indexes on workspace, user, action, resource, timestamp.

### Security Infrastructure
- **Rate limiter**: `src/lib/security/rate-limiter.ts`
- **Security headers**: `src/lib/security/headers.ts` -- CSP, HSTS preload, COOP, CORP, X-Frame-Options
- **RLS**: Row-level security on 37+ tables, `workspace_id` denormalized into 15 child tables. `SET LOCAL` transaction wrappers at `src/db/rls.ts`.
- **Secrets management**: SOPS + age encryption at rest (`scripts/secrets-encrypt.sh`, `scripts/secrets-decrypt.sh`, `scripts/secrets-rotate.sh`).

### User Roles (no light_agent exists)
- `src/db/schema.ts:105-112`: `userRoleEnum` = `owner`, `admin`, `agent`, `viewer`, `system`, `unknown`
- No `light_agent` or `restricted` role -- needed for role-based data masking.

### Data Model (where PII lives)
- **Messages**: `src/db/schema.ts:340-360` -- `body` (text, NOT NULL), `bodyHtml` (text, nullable) -- **primary PII vector**.
- **Tickets**: `src/db/schema.ts:287-322` -- `subject`, `description`, `customerEmail` (varchar 320), `customFields` (JSONB).
- **Customers**: `src/db/schema.ts:199-229` -- `name`, `email`, `phone`, `ipAddress` (inet), `customAttributes` (JSONB).
- **Attachments**: `src/db/schema.ts:362-377` -- `filename`, `storageKey` -- potential PII in filenames.
- **Custom field values**: `src/db/schema.ts:419-429` -- `value` (JSONB) -- may contain PII in free-text fields.
- **Custom fields definition**: `src/db/schema.ts:408-417` -- `objectType`, `name`, `fieldType`, `options`, `required`. No encryption flag.

### Event Pipeline (hook point for auto-scan)
- `src/lib/events/dispatcher.ts:18-37` -- `CanonicalEvent` type includes `message.created` and `ticket.created`. Dispatcher fans out via `Promise.allSettled` to webhooks, plugins, SSE, automation, and AI resolution.
- Existing queue infrastructure: 4 BullMQ queues (`src/lib/queue/types.ts:41-48`) with inline fallback pattern. Worker concurrency model established.

### Feature Gating
- `src/lib/features/gates.ts:21-33` -- 13 features defined. `compliance` feature available to all tiers. No `pii_masking` or `hipaa_compliance` gates.

### CLI & MCP
- CLI commands registered at `cli/commands/index.ts:1-82` -- 40 commands, no compliance group.
- MCP tools registered at `cli/mcp/server.ts:1-66` -- 16 tool modules (60 tools), no compliance module.
- MCP scope controls at `cli/mcp/tools/scopes.ts:11-36` -- 25 write tools listed.

### Compliance-Related Pages
- **No compliance page exists** -- `src/app/compliance/` directory does not exist. ARCHITECTURE.md references `/compliance` as "SOC 2 audit dashboard" but the page was never created.
- Compliance is mentioned in feature gates (`gates.ts:51`) and on marketing pages (`src/app/enterprise/page.tsx`).

---

## 2. Proposed DB Schema Changes

### 2a. New Enums (3)

```sql
CREATE TYPE pii_type AS ENUM (
  'ssn', 'credit_card', 'phone', 'email', 'address',
  'dob', 'medical_id', 'passport', 'drivers_license', 'custom'
);

CREATE TYPE pii_detection_status AS ENUM (
  'pending', 'confirmed', 'dismissed', 'redacted', 'auto_redacted'
);

CREATE TYPE pii_scan_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);
```

### 2b. New Tables (6)

#### `pii_detections` -- stores detected PII findings

```sql
CREATE TABLE pii_detections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id),
  entity_type       TEXT NOT NULL,          -- 'message', 'ticket', 'customer', 'custom_field_value', 'customer_note'
  entity_id         UUID NOT NULL,
  field_name        TEXT NOT NULL,          -- 'body', 'subject', 'description', 'email', 'phone', etc.
  pii_type          pii_type NOT NULL,
  char_offset       INTEGER NOT NULL,       -- character offset in field
  char_length       INTEGER NOT NULL,
  original_encrypted BYTEA,                 -- AES-256-GCM encrypted original match text (for recovery)
  masked_value      TEXT NOT NULL,           -- e.g. '[REDACTED-SSN]', '***-**-1234'
  confidence        REAL NOT NULL,           -- 0.0-1.0 confidence score
  detection_method  TEXT NOT NULL,           -- 'regex', 'ai', 'manual'
  status            pii_detection_status NOT NULL DEFAULT 'pending',
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  redacted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_detections_workspace_status_idx ON pii_detections(workspace_id, status);
CREATE INDEX pii_detections_entity_idx ON pii_detections(entity_type, entity_id);
CREATE INDEX pii_detections_type_idx ON pii_detections(workspace_id, pii_type);
```

#### `pii_redaction_log` -- immutable record of what was redacted (never deleted)

```sql
CREATE TABLE pii_redaction_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  detection_id    UUID NOT NULL REFERENCES pii_detections(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  original_hash   TEXT NOT NULL,            -- SHA-256 of original value (never store plaintext post-redaction)
  masked_value    TEXT NOT NULL,
  redacted_by     UUID NOT NULL REFERENCES users(id),
  reason          TEXT,                     -- 'auto', 'manual', 'retroactive_scan', 'hipaa'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_redaction_log_workspace_idx ON pii_redaction_log(workspace_id, created_at);
CREATE INDEX pii_redaction_log_entity_idx ON pii_redaction_log(entity_type, entity_id);
```

#### `pii_access_log` -- tracks who viewed unmasked PII

```sql
CREATE TABLE pii_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  pii_type        TEXT NOT NULL,
  access_type     TEXT NOT NULL,            -- 'view_unmasked', 'export', 'api_read'
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_access_log_workspace_idx ON pii_access_log(workspace_id, created_at);
CREATE INDEX pii_access_log_user_idx ON pii_access_log(user_id, created_at);
```

#### `pii_scan_jobs` -- tracks retroactive scan progress

```sql
CREATE TABLE pii_scan_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  started_by      UUID NOT NULL REFERENCES users(id),
  entity_types    TEXT[] NOT NULL,          -- which entity types to scan
  status          pii_scan_status NOT NULL DEFAULT 'queued',
  total_records   INTEGER DEFAULT 0,
  scanned_records INTEGER DEFAULT 0,
  detections_found INTEGER DEFAULT 0,
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_scan_jobs_workspace_idx ON pii_scan_jobs(workspace_id, status);
```

#### `pii_sensitivity_rules` -- per-workspace PII detection config

```sql
CREATE TABLE pii_sensitivity_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  pii_type        pii_type NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  auto_redact     BOOLEAN NOT NULL DEFAULT false,
  custom_pattern  TEXT,                     -- optional custom regex override
  masking_style   TEXT NOT NULL DEFAULT 'full', -- 'full' ([REDACTED-SSN]), 'partial' (***-**-1234), 'hash'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, pii_type)
);
```

#### `hipaa_baa_records` -- BAA tracking

```sql
CREATE TABLE hipaa_baa_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  partner_name    TEXT NOT NULL,
  partner_email   TEXT NOT NULL,
  signed_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  document_url    TEXT,
  document_hash   TEXT,                     -- SHA-256 of signed document
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'expired', 'terminated'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hipaa_baa_workspace_idx ON hipaa_baa_records(workspace_id, status);
```

### 2c. Column Additions (7)

```sql
-- Messages: redaction metadata
ALTER TABLE messages ADD COLUMN body_redacted TEXT;
ALTER TABLE messages ADD COLUMN has_pii BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN pii_scanned_at TIMESTAMPTZ;

-- Tickets: PII flag
ALTER TABLE tickets ADD COLUMN has_pii BOOLEAN DEFAULT false;
ALTER TABLE tickets ADD COLUMN pii_scanned_at TIMESTAMPTZ;

-- Custom fields: encryption + PII category
ALTER TABLE custom_fields ADD COLUMN encrypted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE custom_fields ADD COLUMN pii_category TEXT; -- 'phi', 'pii', 'financial', null

-- User role enum: add light_agent
ALTER TYPE user_role ADD VALUE 'light_agent';
```

**Totals: 6 new tables, 7 column additions, 1 enum value addition, 3 new enums.**

---

## 3. New API Routes (16)

### PII Detection & Redaction

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `POST` | `/api/compliance/pii/scan` | Scan a single entity for PII (on-demand) | admin |
| `GET` | `/api/compliance/pii/detections` | List PII detections (filters: status, pii_type, entity_type) | admin |
| `PATCH` | `/api/compliance/pii/detections/[id]` | Review a detection (confirm/dismiss) | admin |
| `POST` | `/api/compliance/pii/redact` | Redact confirmed PII detections (single or batch) | admin |
| `POST` | `/api/compliance/pii/redact-all` | Redact all confirmed detections for workspace | admin |
| `GET` | `/api/compliance/pii/access-log` | View PII access audit log | admin |
| `GET` | `/api/compliance/pii/stats` | PII detection statistics (counts by type, status, trend) | admin |

### Retroactive Scan

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `POST` | `/api/compliance/pii/scan-job` | Start a retroactive scan job | admin |
| `GET` | `/api/compliance/pii/scan-job/[id]` | Get scan job status/progress | admin |
| `DELETE` | `/api/compliance/pii/scan-job/[id]` | Cancel a running scan job | admin |

### Sensitivity Rules

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/compliance/pii/rules` | List workspace sensitivity rules | admin |
| `PUT` | `/api/compliance/pii/rules` | Upsert sensitivity rules (batch) | admin |

### HIPAA

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/compliance/hipaa/status` | HIPAA readiness checklist status | admin |
| `GET` | `/api/compliance/hipaa/baa` | List BAA records | admin |
| `POST` | `/api/compliance/hipaa/baa` | Create BAA record | admin |
| `PATCH` | `/api/compliance/hipaa/baa/[id]` | Update BAA record status | admin |

### Data Masking Access

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/messages/[id]/unmasked` | View unmasked message body (logs PII access) | admin, agent |

---

## 4. New/Modified UI Pages & Components

### New Page: `/compliance` (full compliance dashboard)

Currently **no page exists** at this route. Create:
- `src/app/compliance/page.tsx` -- server wrapper with FeatureGate
- `src/app/compliance/_content.tsx` -- client component with tabbed dashboard

**Tabs:**
1. **Overview** -- compliance score, PII detection stats, HIPAA readiness score, active scan jobs, quick actions
2. **PII Detections** -- paginated table of detected PII with filters (status, type, entity), bulk confirm/dismiss/redact actions
3. **Redaction Log** -- immutable log of all redactions performed (read-only)
4. **Sensitivity Rules** -- per-PII-type toggle grid (enabled, auto-redact, masking style selector)
5. **Retention Policies** -- wire existing `GET/POST /api/compliance/retention` to UI (currently API-only)
6. **GDPR** -- data export/deletion forms wiring existing `POST /api/compliance/export` and `POST /api/compliance/delete`
7. **HIPAA** -- readiness checklist with pass/fail indicators, BAA management table, encrypted fields config
8. **Access Log** -- PII access audit trail table (who viewed unmasked data, when, from where)

### New Components (6)

| Component | File | Purpose |
|-----------|------|---------|
| `PiiDetectionTable` | `src/components/PiiDetectionTable.tsx` | Paginated table of PII detections with inline review (confirm/dismiss) and bulk redact |
| `PiiRedactionBadge` | `src/components/PiiRedactionBadge.tsx` | Inline badge rendering `[REDACTED-SSN]` with "reveal" button for authorized roles |
| `MaskedField` | `src/components/MaskedField.tsx` | Generic text component that renders masked or unmasked value based on user role |
| `PiiScanProgress` | `src/components/PiiScanProgress.tsx` | Progress bar for retroactive scan jobs with entity count / percentage |
| `HipaaChecklist` | `src/components/HipaaChecklist.tsx` | Interactive HIPAA readiness checklist (10 controls, pass/fail/partial) |
| `SensitivityRuleEditor` | `src/components/SensitivityRuleEditor.tsx` | Grid of PII type toggles with masking style and auto-redact options |

### Modified Pages/Components

| File | Change |
|------|--------|
| Ticket detail page (message list) | Show PII badge on messages with `has_pii = true`; render `body_redacted` for `light_agent`/`viewer` roles; show "View Original" for admin/agent with audit logging |
| `src/lib/features/gates.ts` | Add `pii_masking` (pro+) and `hipaa_compliance` (enterprise+byoc) features |
| `src/components/FeatureGate.tsx` | No change needed (already supports new features via FEATURE_MATRIX lookup) |

---

## 5. New CLI Commands

### `cliaas compliance` command group

New file: `cli/commands/compliance.ts`

```
cliaas compliance pii-scan [--entity-type messages|tickets|customers] [--limit N]
    Scan entities for PII. Returns detection count and summary by type.

cliaas compliance pii-scan --retroactive [--entity-type messages] [--batch-size 100]
    Start a retroactive scan job across historical data.

cliaas compliance detections [--status pending|confirmed|redacted|dismissed] [--type ssn|credit_card|...] [--limit 50]
    List PII detections with filters.

cliaas compliance redact [--detection-id ID] [--all-confirmed] [--dry-run]
    Redact PII from confirmed detections. --dry-run shows what would be redacted.

cliaas compliance rules [--set ssn:enabled:true] [--set credit_card:auto_redact:true]
    View or modify sensitivity rules for the workspace.

cliaas compliance hipaa-status
    Show HIPAA readiness checklist with pass/fail per control.

cliaas compliance access-log [--user USER] [--from DATE] [--to DATE] [--limit 50]
    View PII access audit log.

cliaas compliance scan-status [--job-id ID]
    Show status of retroactive scan jobs.
```

Register via `registerComplianceCommands` in `cli/commands/index.ts`.

---

## 6. New MCP Tools (9)

New file: `cli/mcp/tools/compliance.ts`

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `pii_scan` | Scan a specific entity (ticket/message) for PII | `entityType`, `entityId` |
| `pii_detections` | List PII detections with filters | `status?`, `piiType?`, `entityType?`, `limit?` |
| `pii_review` | Confirm or dismiss a PII detection | `detectionId`, `action` (confirm/dismiss) |
| `pii_redact` | Redact a confirmed PII detection | `detectionId` or `allConfirmed: true` |
| `pii_rules` | View or update sensitivity rules | `action` (list/set), `piiType?`, `enabled?`, `autoRedact?` |
| `pii_stats` | Get PII detection statistics | `period?` (day/week/month) |
| `pii_access_log` | Query PII access audit log | `userId?`, `from?`, `to?`, `limit?` |
| `hipaa_status` | Get HIPAA readiness checklist | (none) |
| `retroactive_scan` | Start or check retroactive PII scan | `action` (start/status), `entityTypes?`, `jobId?` |

Register in `cli/mcp/server.ts` via `registerComplianceTools`. Add `pii_review`, `pii_redact`, `pii_rules`, `retroactive_scan` to `cli/mcp/tools/scopes.ts` `ALL_WRITE_TOOLS`.

---

## 7. Business Logic Modules

### 7a. PII Detection Engine

**New file:** `src/lib/compliance/pii-detector.ts`

**Built-in regex patterns:**

| PII Type | Pattern | Example | Notes |
|----------|---------|---------|-------|
| SSN | `\b\d{3}-\d{2}-\d{4}\b` | 123-45-6789 | Excludes 000/666/9xx area numbers |
| Credit Card | Luhn-validated `\b(?:\d{4}[\s-]?){3}\d{4}\b` | 4111-1111-1111-1111 | Visa, MC, Amex, Discover |
| Phone (US) | `\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b` | (555) 123-4567 | US format |
| Email | RFC 5322 simplified | user@example.com | Standard pattern |
| Address (US) | `\b\d{1,5}\s\w+\s(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|...)\b` | 123 Main Street | With state/zip context |
| DOB | `\b(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\d|3[01])/(?:19|20)\d{2}\b` | 01/15/1990 | MM/DD/YYYY |
| Medical ID | Configurable per workspace | MRN: 12345678 | Via custom_pattern in rules |
| Passport | `\b[A-Z]\d{8}\b` | A12345678 | US format |
| Driver's License | State-specific patterns (top 10 states) | D1234567 | NY, CA, TX, FL, etc. |

**AI-based detection (optional):**
- Uses existing `getProvider().complete()` from `cli/providers/base.ts` with structured prompt
- Only invoked for text with no regex hits but flagged by heuristics (multiple digit sequences, name-like patterns near numbers)
- Falls back to regex-only when no LLM configured
- Returns JSON array of `{pii_type, text, start, end, confidence}`

**Key exports:**
```typescript
export interface PiiMatch {
  piiType: PiiType;
  text: string;
  start: number;
  end: number;
  confidence: number;
  method: 'regex' | 'ai' | 'manual';
}

export function detectPiiRegex(text: string, rules: PiiSensitivityRule[]): PiiMatch[];
export async function detectPiiAI(text: string, provider: LLMProvider): PiiMatch[];
export async function detectPii(text: string, rules: PiiSensitivityRule[], provider?: LLMProvider): PiiMatch[];
export function maskText(text: string, matches: PiiMatch[], style: MaskingStyle): string;
export function validateLuhn(cardNumber: string): boolean;
```

### 7b. PII Masking Service

**New file:** `src/lib/compliance/pii-masking.ts`

Orchestrates detection, storage, and redaction:
```typescript
export async function scanEntity(entityType: string, entityId: string, workspaceId: string): Promise<PiiDetection[]>;
export async function redactDetection(detectionId: string, redactedBy: string, workspaceId: string): Promise<void>;
export async function redactAllConfirmed(workspaceId: string, redactedBy: string): Promise<number>;
export async function getEntityMaskedView(entityType: string, entityId: string, userRole: UserRole): Promise<MaskedEntity>;
```

### 7c. PII Encryption Utilities

**New file:** `src/lib/compliance/pii-encryption.ts`

AES-256-GCM encryption for original PII values before storage in `pii_detections.original_encrypted`:
```typescript
export function encryptPii(plaintext: string, key: Buffer): Buffer;  // IV prepended
export function decryptPii(ciphertext: Buffer, key: Buffer): string;
export function hashPii(plaintext: string): string;  // SHA-256 for redaction_log.original_hash
```

Key sourced from `PII_ENCRYPTION_KEY` env var (generated during setup, stored via SOPS).

### 7d. Role-Based Masking Middleware

**New file:** `src/lib/compliance/role-masking.ts`

```typescript
export function shouldMaskForRole(role: UserRole): boolean;
export function applyRoleMasking(data: Record<string, unknown>, role: UserRole): Record<string, unknown>;
```

Rules:
- `light_agent`, `viewer`: See `body_redacted` instead of `body`; customer email/phone masked; custom fields with `pii_category` masked.
- `agent`: See original data; PII access logged.
- `admin`, `owner`: Full access; PII access logged.

### 7e. HIPAA Readiness Checker

**New file:** `src/lib/compliance/hipaa.ts`

```typescript
export interface HipaaControl {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'fail' | 'partial' | 'na';
  evidence: string[];
  remediation?: string;
}

export async function evaluateHipaaReadiness(workspaceId: string): Promise<HipaaControl[]>;
```

**10 controls evaluated:**
1. Encryption at rest (DATABASE_URL uses SSL, encrypted custom fields enabled)
2. Encryption in transit (HTTPS enforced, HSTS header present)
3. Access controls (RBAC configured, light_agent role in use)
4. MFA (admin accounts have MFA -- checks SSO/TOTP config)
5. Audit logging (audit trail enabled, hash chain integrity verified)
6. PII detection (sensitivity rules configured, auto-scan enabled)
7. Data retention (retention policies configured with appropriate periods)
8. BAA status (active BAA on file in `hipaa_baa_records`)
9. Minimum necessary access (light_agent role assigned to at least one user)
10. Breach notification (incident response plan documented -- manual attestation)

### 7f. PII Event Hook

**Modification to:** `src/lib/events/dispatcher.ts`

Add `enqueuePiiScan()` to the dispatcher fan-out for `message.created` and `ticket.created` events. Follows the same fire-and-forget pattern as existing `enqueueAIResolution()` call.

---

## 8. Queue Changes

### New Queue: `pii-scan`

**Modify:** `src/lib/queue/types.ts`
```typescript
export interface PiiScanJob {
  scanJobId?: string;        // set for retroactive scans
  entityType: string;
  entityId?: string;         // set for single-entity scans
  batchOffset?: number;      // set for retroactive batch processing
  batchSize: number;
  workspaceId: string;
}

// Add to QUEUE_NAMES:
PII_SCAN: 'pii-scan',
```

**Modify:** `src/lib/queue/queues.ts` -- add `getPiiScanQueue()`.

**Modify:** `src/lib/queue/dispatch.ts` -- add `enqueuePiiScan()` with inline fallback.

**New file:** `src/lib/queue/workers/pii-scan-worker.ts` -- BullMQ worker (concurrency: 1). For retroactive scans, processes batches of 100 entities, updates `pii_scan_jobs.scanned_records` after each batch.

---

## 8. Migration & Rollout Plan

### Phase 1: Foundation (Week 1) -- S effort
1. **Migration `0006_pii_detection.sql`**: Create all 6 new tables, add columns to messages/tickets/custom_fields, extend `user_role` enum with `light_agent`.
2. **Drizzle schema**: Add all new tables/columns/enums to `src/db/schema.ts`.
3. **PII detector**: `src/lib/compliance/pii-detector.ts` with all regex patterns + Luhn validation.
4. **PII encryption**: `src/lib/compliance/pii-encryption.ts` (AES-256-GCM).
5. **Unit tests**: Comprehensive regex tests for all 9 PII types, Luhn validation, edge cases, false positive scenarios.

### Phase 2: Core Engine (Week 2) -- M effort
1. **PII masking service**: `src/lib/compliance/pii-masking.ts` -- scan, redact, mask orchestration.
2. **Sensitivity rules CRUD**: `src/lib/compliance/pii-rules.ts`.
3. **PII scan queue + worker**: New BullMQ queue (`pii-scan`) with inline fallback.
4. **Event hook**: Wire `message.created` and `ticket.created` in dispatcher to trigger PII scan.
5. **API routes**: All 16 new routes following existing compliance route patterns.
6. **Tests**: Integration tests for scan->detect->store->redact pipeline.

### Phase 3: Role-Based Masking & Access Logging (Week 3) -- M effort
1. **Light agent role**: Add to enum, update `src/lib/api-auth.ts` role hierarchy.
2. **Role-masking middleware**: `src/lib/compliance/role-masking.ts`.
3. **Modify message/ticket API responses**: Apply masking based on requesting user's role.
4. **PII access logging**: Log unmasked data access to `pii_access_log`.
5. **Unmasked endpoint**: `GET /api/messages/[id]/unmasked` with access logging.
6. **Tests**: Role-based access tests, access log verification.

### Phase 4: CLI & MCP (Week 3, parallel) -- S effort
1. **CLI commands**: `cli/commands/compliance.ts` (8 subcommands).
2. **MCP tools**: `cli/mcp/tools/compliance.ts` (9 tools).
3. **Registration**: Update `cli/commands/index.ts` and `cli/mcp/server.ts`.
4. **Scope controls**: Add write tools to `cli/mcp/tools/scopes.ts`.
5. **Tests**: CLI command smoke tests.

### Phase 5: UI (Week 4) -- M effort
1. **Compliance page**: 8-tab dashboard at `src/app/compliance/`.
2. **Components**: 6 new components (PiiDetectionTable, PiiRedactionBadge, MaskedField, HipaaChecklist, SensitivityRuleEditor, PiiScanProgress).
3. **Ticket detail integration**: PII badges on messages, masked/unmasked toggle.
4. **Feature gating**: Add `pii_masking` and `hipaa_compliance` to `gates.ts`.

### Phase 6: HIPAA & AI Detection (Week 4-5) -- S effort
1. **HIPAA readiness checker**: `src/lib/compliance/hipaa.ts` (10 controls).
2. **BAA management**: CRUD for `hipaa_baa_records`.
3. **Encrypted custom fields**: Application-level AES-256-GCM wrappers for fields with `encrypted: true`.
4. **AI-based PII detection**: Optional LLM enhancement for ambiguous cases using existing provider interface.
5. **BAA template**: `docs/baa-template.md`.

### Phase 7: Hardening (Week 5) -- S effort
1. **Retroactive scan at scale**: Test with 100K+ messages, optimize batch size.
2. **Performance**: Ensure PII scan on `message.created` adds <50ms (async via queue).
3. **False positive tuning**: Adjust regex patterns and confidence thresholds based on test data.
4. **Security audit**: Verify encryption, access logging completeness, key rotation.
5. **Update ARCHITECTURE.md**: Document new tables, modules, controls.

### Rollout Strategy
1. Ship behind feature flag (`pii_masking` in gates) -- available to pro+ tiers, BYOC gets everything.
2. Retroactive scan is opt-in (manual trigger via CLI/UI/MCP).
3. Auto-redaction is **off by default**; sensitivity rules default to `auto_redact: false`. Operators must explicitly enable.
4. `light_agent` role is opt-in (workspaces must explicitly assign it to users).
5. HIPAA features ship under separate gate (`hipaa_compliance`) for enterprise + BYOC.
6. `PII_ENCRYPTION_KEY` env var required for PII value storage; system operates in detect-only mode without it.

---

## 9. Effort Estimate

| Phase | Effort | New Files | Modified Files |
|-------|--------|-----------|----------------|
| Foundation (schema + detector) | S | 4 | 2 |
| Core Engine (service + API + queue) | M | 8 | 4 |
| Role-Based Masking | M | 2 | 5 |
| CLI & MCP | S | 2 | 3 |
| UI (page + components) | M | 8 | 3 |
| HIPAA & AI Detection | S | 4 | 2 |
| Hardening | S | 1 | 2 |

**Overall: L (Large)**

- **Duration**: 4-5 weeks of focused development
- **New files**: ~29
- **Modified files**: ~21
- **New LOC**: ~6,000-8,000 (excluding tests)
- **Test LOC**: ~2,000-3,000
- **New DB tables**: 6
- **Column additions**: 7 + 1 enum value
- **New enums**: 3
- **New API routes**: 16
- **New CLI subcommands**: 8
- **New MCP tools**: 9
- **New BullMQ queue**: 1 (pii-scan)

### Risk Factors

1. **False positive rate**: Regex PII detection will produce false positives (e.g., 9-digit numbers that aren't SSNs, phone-like sequences in serial numbers). Mitigation: confidence scoring, review workflow, auto-redact off by default.
2. **Performance on message creation**: Scanning every message adds latency. Mitigation: async via event dispatcher fire-and-forget pattern; scan results stored asynchronously.
3. **Encryption key management**: `PII_ENCRYPTION_KEY` must be securely generated, stored, and rotated. Mitigation: integrate with existing SOPS infrastructure. Key rotation strategy needed.
4. **Retroactive scan scale**: Scanning 100K+ messages is I/O intensive. Mitigation: BullMQ batching, progress tracking, cancellation support.
5. **HIPAA is not just software**: This plan provides HIPAA *readiness tooling*, not HIPAA certification. Actual compliance requires organizational policies, employee training, risk assessments, and a signed BAA with customers. The tooling makes the technical requirements achievable.

---

## 10. Competitive Positioning After Implementation

| Capability | Zendesk ADPP ($50/agent/mo) | CLIaaS |
|-----------|---------------------------|--------|
| PII detection | Regex-based | Regex + optional AI |
| Auto-redaction | Yes (paid add-on) | Yes (configurable per workspace, default off) |
| Redaction suggestions | Yes | Yes (detection review queue) |
| Role-based masking | Yes (light agent) | Yes (light_agent role) |
| PII access audit | Yes | Yes (dedicated pii_access_log table) |
| Retroactive scan | Manual | CLI/API/UI/MCP triggered with progress tracking |
| HIPAA readiness | BAA available | 10-point readiness checker + BAA tracking |
| Encrypted custom fields | BYOK | AES-256-GCM with SOPS-managed keys |
| Pricing | $50/agent/month add-on | Included in Pro tier; BYOC gets everything free |
| CLI/MCP native | N/A | 9 MCP tools + 8 CLI commands |

**Key differentiator**: CLIaaS makes PII detection and redaction fully automatable via MCP. An AI agent can scan tickets, review detections, and trigger redactions programmatically -- no GUI required. Combined with BYOC mode where the customer owns their data and encryption keys, this is a stronger compliance story than any competitor for privacy-conscious organizations.
