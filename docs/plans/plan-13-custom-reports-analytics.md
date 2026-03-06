# Plan 13: Custom Report Builder, Scheduled Exports, Real-Time Live Dashboard

## Competitive Context

| Capability | Zendesk Explore | Freshdesk | Intercom | Help Scout | CLIaaS Today |
|---|---|---|---|---|---|
| Custom report builder | Full (from scratch) | Pro+ | Advanced+ | No | No |
| Pre-built reports | 100+ templates | Yes | 12 templates | Pre-built only | Single analytics page |
| Custom dashboards | Drag-and-drop canvas | Pro+ | Advanced+ | No | No |
| Scheduled exports | Daily/weekly/monthly email | Yes | No | No | No |
| Real-time dashboard | Live agent/queue view | Yes | Yes | No | No |
| Calculated metrics | Yes (formulas) | Yes | No | No | No |
| Drill-down | Click-to-underlying-data | Yes | No | No | No |
| Chart types | 100+ | ~10 | ~5 | Bar only | Bar (1 custom) |
| Shareable links | Yes | Yes | No | No | No |

---

## 1. What Exists Today

### Analytics Page (GUI)
- **`src/app/analytics/page.tsx`** (lines 1-10): Server component wrapper with `FeatureGate` gating on `analytics` feature.
- **`src/app/analytics/_content.tsx`** (lines 1-508): Client component with hardcoded dashboard showing:
  - 4 stat cards (total tickets, avg response, avg resolution, CSAT)
  - Period comparison (this week vs last week)
  - Ticket volume bar chart (CSS bars, no charting library)
  - SLA compliance bars (first response + resolution)
  - Source breakdown, priority distribution
  - Agent performance table
  - CSAT trend (horizontal bars)
  - Top tags
  - Date range filter (from/to) with CSV/JSON export buttons

### Analytics API
- **`src/app/api/analytics/route.ts`** (lines 1-48): `GET /api/analytics?from=&to=` -- calls `computeAnalytics()`, auth-gated with `analytics:read` scope + admin role.
- **`src/app/api/analytics/export/route.ts`** (lines 1-56): `GET /api/analytics/export?format=csv|json&from=&to=` -- downloads full analytics as CSV or JSON.

### Analytics Library
- **`src/lib/analytics.ts`** (lines 1-482): `computeAnalytics(dateRange?)` function that:
  - Loads tickets, messages, CSAT ratings, NPS responses, CES responses from JSONL/DB stores
  - Computes: volume per day, by source, by channel, priority distribution, top tags, response/resolution times, SLA compliance (hardcoded 1h/24h), CSAT/NPS/CES trends, agent performance, period comparison
  - `analyticsToCSV()` helper for flat CSV export
  - All computation is in-memory, re-computed on every request
  - No concept of saved reports, custom metrics, or report definitions

### Real-time System
- **`src/lib/realtime/events.ts`** (lines 1-68): In-memory `EventBus` singleton with typed events (`ticket:created`, `ticket:updated`, `presence:viewing`, etc.). Pub/sub pattern.
- **`src/lib/realtime/presence.ts`** (lines 1-106): `PresenceTracker` singleton tracking agent viewing/typing with 60s stale timeout.
- **`src/app/api/events/route.ts`** (lines 1-62): SSE endpoint streaming all events to connected browsers. 30s keepalive. Auth-gated.

### CLI Stats & Export
- **`cli/commands/stats.ts`** (lines 1-154): `cliaas stats` -- shows queue metrics from JSONL (by status, priority, assignee, tags, urgent alerts). Supports `--json` output.
- **`cli/commands/export.ts`** (lines 1-154): `cliaas export csv` and `cliaas export markdown` -- exports ticket data to files. No analytics/report support.

### MCP Tools (Related)
- **`cli/mcp/tools/queue.ts`** (lines 1-161): `queue_stats` (ticket counts by status/priority/assignee), `sla_report` (SLA compliance check per ticket).
- **`cli/mcp/tools/analysis.ts`** (lines 1-321): `triage_ticket`, `triage_batch`, `draft_reply`, `sentiment_analyze`, `detect_duplicates`, `summarize_queue`. All LLM-powered, none produce structured report data.

### Prometheus Metrics
- **`src/lib/metrics.ts`** (lines 1-66): `prom-client` registry with HTTP request duration/count, app errors, queue depth/active gauges. Infrastructure metrics only -- no business analytics.

### Queue Stats
- **`src/lib/queue/stats.ts`** (lines 1-42): BullMQ queue stats (waiting/active/completed/failed/delayed per queue). Infrastructure-level only.

### Database Schema (Relevant Tables)
- **`tickets`** (schema.ts:286-319): id, workspaceId, status, priority, source, assigneeId, requesterId, tags, customFields, createdAt, updatedAt, closedAt
- **`messages`** (schema.ts -- conversations table): ticketId, author, type, body, createdAt
- **`csat_ratings`** (schema.ts:485-498): ticketId, rating (1-5), comment, workspaceId
- **`survey_responses`** (schema.ts:1018-1039): surveyType (csat/nps/ces), rating, ticketId, token
- **`sla_events`** (schema.ts:460-474): ticketId, metric, target, breachedAt, workspaceId
- **`time_entries`** (schema.ts:500-517): ticketId, userId, minutes, billable, customerId, groupId
- **`export_jobs`** (schema.ts:646-660): integrationId, status, startedAt, finishedAt -- used for connector exports, NOT report exports
- **`users`** (schema.ts:157-178): role, status, workspaceId -- agent data
- **`customers`** (schema.ts:198-228): enrichment fields, org, plan

### Feature Gating
- **`src/lib/features/gates.ts`** (lines 1-118): `analytics` feature is available to ALL tiers (including byoc/free). New `custom_reports` and `live_dashboard` features should be added as gated features for pro+ tiers.

### Gaps Summary
1. No report definition storage -- everything is hardcoded in `computeAnalytics()`
2. No custom metric selection or grouping
3. Single visualization type (CSS bars) -- no charting library
4. No dashboard builder / widget canvas
5. No scheduled export / delivery system
6. No real-time metric streaming (SSE exists but only for ticket/presence events)
7. No drill-down from aggregate to underlying records
8. No shareable report links
9. No report CRUD API
10. CLI has basic stats but no custom report execution

---

## 2. Proposed DB Schema Changes

### New Tables (6)

```sql
-- 2a. Report definitions (saved custom reports)
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  created_by      UUID REFERENCES users(id),
  name            TEXT NOT NULL,
  description     TEXT,
  -- Report configuration
  metric          TEXT NOT NULL,           -- e.g. 'ticket_count', 'avg_response_time', 'csat_score', 'sla_compliance'
  group_by        TEXT[],                  -- e.g. ['status', 'priority', 'assignee', 'channel', 'tag', 'day', 'week', 'month']
  filters         JSONB NOT NULL DEFAULT '{}',  -- e.g. {"status": ["open","pending"], "priority": ["urgent","high"], "dateRange": {"from":"...","to":"..."}}
  visualization   TEXT NOT NULL DEFAULT 'table', -- 'line', 'bar', 'pie', 'table', 'number'
  -- Calculated metric support
  formula         JSONB,                  -- optional: {"type":"ratio","numerator":"resolved_count","denominator":"ticket_count"}
  sort_by         TEXT,
  sort_order      TEXT DEFAULT 'desc',
  -- Metadata
  is_template     BOOLEAN NOT NULL DEFAULT false,  -- pre-built report flag
  template_key    TEXT,                    -- e.g. 'ticket_volume', 'agent_performance' for pre-built reports
  is_public       BOOLEAN NOT NULL DEFAULT false,  -- shareable link
  share_token     TEXT,                    -- unique token for public access
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_workspace_idx ON reports(workspace_id);
CREATE UNIQUE INDEX reports_share_token_idx ON reports(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX reports_template_key_idx ON reports(template_key) WHERE is_template = true;

-- 2b. Dashboard definitions (arrangement of report widgets)
CREATE TABLE dashboards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  created_by      UUID REFERENCES users(id),
  name            TEXT NOT NULL,
  description     TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_public       BOOLEAN NOT NULL DEFAULT false,
  share_token     TEXT,
  layout          JSONB NOT NULL DEFAULT '[]',  -- Array of widget positions: [{reportId, x, y, w, h, overrides}]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dashboards_workspace_idx ON dashboards(workspace_id);
CREATE UNIQUE INDEX dashboards_share_token_idx ON dashboards(share_token) WHERE share_token IS NOT NULL;

-- 2c. Dashboard widgets (individual report placements on a dashboard)
CREATE TABLE dashboard_widgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id    UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  report_id       UUID REFERENCES reports(id) ON DELETE SET NULL,
  -- Grid position (12-column grid)
  x               INTEGER NOT NULL DEFAULT 0,
  y               INTEGER NOT NULL DEFAULT 0,
  w               INTEGER NOT NULL DEFAULT 6,    -- width in grid columns (1-12)
  h               INTEGER NOT NULL DEFAULT 4,    -- height in grid rows
  -- Widget-level overrides
  title_override  TEXT,
  viz_override    TEXT,                          -- override report's default visualization
  filter_override JSONB,                        -- additional filters layered on report
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_widgets_dashboard_idx ON dashboard_widgets(dashboard_id);

-- 2d. Scheduled report exports
CREATE TABLE report_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  report_id       UUID REFERENCES reports(id) ON DELETE CASCADE,
  dashboard_id    UUID REFERENCES dashboards(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id),
  -- Schedule config
  frequency       TEXT NOT NULL,           -- 'daily', 'weekly', 'monthly'
  day_of_week     INTEGER,                 -- 0-6 for weekly (0=Sunday)
  day_of_month    INTEGER,                 -- 1-31 for monthly
  hour_utc        INTEGER NOT NULL DEFAULT 8, -- hour to send (UTC)
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  -- Delivery config
  format          TEXT NOT NULL DEFAULT 'pdf',  -- 'pdf', 'csv', 'json'
  recipients      TEXT[] NOT NULL DEFAULT '{}', -- email addresses
  subject_line    TEXT,                    -- custom email subject
  -- State
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_sent_at    TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one of report_id or dashboard_id must be set
  CONSTRAINT schedule_target_check CHECK (
    (report_id IS NOT NULL AND dashboard_id IS NULL) OR
    (report_id IS NULL AND dashboard_id IS NOT NULL)
  )
);
CREATE INDEX report_schedules_workspace_idx ON report_schedules(workspace_id);
CREATE INDEX report_schedules_next_run_idx ON report_schedules(next_run_at) WHERE enabled = true;

-- 2e. Report execution cache (avoid recomputing expensive reports)
CREATE TABLE report_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  filter_hash     TEXT NOT NULL,           -- SHA-256 of serialized filters+dateRange
  result_data     JSONB NOT NULL,          -- cached computation result
  row_count       INTEGER NOT NULL DEFAULT 0,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL     -- TTL (e.g. 5 min for live, 1 hour for historical)
);
CREATE UNIQUE INDEX report_cache_lookup_idx ON report_cache(report_id, filter_hash);
CREATE INDEX report_cache_expires_idx ON report_cache(expires_at);

-- 2f. Metric snapshots for real-time dashboard (periodic aggregation)
CREATE TABLE metric_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  metric_name     TEXT NOT NULL,           -- 'queue_depth', 'agents_online', 'avg_wait_minutes', 'tickets_created_hour'
  metric_value    NUMERIC NOT NULL,
  dimensions      JSONB DEFAULT '{}',      -- e.g. {"status":"open","priority":"urgent"}
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX metric_snapshots_workspace_metric_idx ON metric_snapshots(workspace_id, metric_name, recorded_at DESC);
-- Partition or TTL: retain 30 days of snapshots, purge older via retention scheduler
```

### New Enums

```sql
CREATE TYPE report_metric AS ENUM (
  'ticket_count', 'ticket_created_count', 'ticket_resolved_count', 'ticket_reopened_count',
  'avg_first_response_hours', 'avg_resolution_hours', 'median_first_response_hours', 'median_resolution_hours',
  'sla_compliance_pct', 'sla_breach_count',
  'csat_avg', 'nps_score', 'ces_avg',
  'messages_count', 'replies_count',
  'agent_reply_count', 'agent_avg_handle_time',
  'time_logged_minutes', 'billable_minutes',
  'ai_resolution_count', 'ai_resolution_rate',
  'custom'  -- for formula-based calculated metrics
);

CREATE TYPE report_visualization AS ENUM (
  'line', 'bar', 'pie', 'table', 'number', 'stacked_bar', 'area', 'heatmap'
);

CREATE TYPE schedule_frequency AS ENUM ('daily', 'weekly', 'monthly');
CREATE TYPE export_format AS ENUM ('pdf', 'csv', 'json');
```

### Columns Added to Existing Tables

None -- all new data goes into the new tables above. The existing `tickets`, `messages`, `csat_ratings`, `sla_events`, `time_entries`, `survey_responses`, and `users` tables already contain all the source data needed for report computation.

---

## 3. New API Routes (18)

### Report CRUD (5)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/reports` | List reports for workspace (filterable: `?template=true`, `?createdBy=`) |
| `POST` | `/api/reports` | Create a new report definition |
| `GET` | `/api/reports/[id]` | Get report definition |
| `PUT` | `/api/reports/[id]` | Update report definition |
| `DELETE` | `/api/reports/[id]` | Delete report |

### Report Execution (3)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/reports/[id]/execute` | Execute a report with optional filter overrides; returns data + chart config |
| `GET` | `/api/reports/[id]/export` | Export executed report as CSV/JSON/PDF (`?format=`) |
| `GET` | `/api/reports/share/[token]` | Public report access (no auth, via share_token) |

### Dashboard CRUD (5)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dashboards` | List dashboards for workspace |
| `POST` | `/api/dashboards` | Create dashboard with widget layout |
| `GET` | `/api/dashboards/[id]` | Get dashboard definition + widget configs |
| `PUT` | `/api/dashboards/[id]` | Update dashboard layout/widgets |
| `DELETE` | `/api/dashboards/[id]` | Delete dashboard |

### Scheduled Exports (3)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/report-schedules` | List schedules for workspace |
| `POST` | `/api/report-schedules` | Create a new schedule |
| `PUT` | `/api/report-schedules/[id]` | Update schedule (enable/disable, change recipients, frequency) |
| `DELETE` | `/api/report-schedules/[id]` | Delete schedule |

### Real-Time Dashboard (2)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dashboard/live` | SSE endpoint streaming live metrics (queue depth, agents online, wait times, tickets/hour) |
| `GET` | `/api/dashboard/live/snapshot` | One-shot JSON snapshot of all live metrics |

### Drill-Down (1)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/reports/[id]/drill` | Given a report + clicked data point, return underlying ticket IDs with pagination |

---

## 4. New/Modified UI Pages & Components

### New Pages (4)

#### `/reports` -- Report Builder & List
- List of saved reports (user-created + pre-built templates)
- "New Report" button opens report builder
- **Report Builder UI**:
  - Step 1: Select metric (dropdown: ticket count, avg response time, CSAT, SLA compliance, etc.)
  - Step 2: Group by (multi-select: status, priority, assignee, channel, tag, day/week/month)
  - Step 3: Filters (status, priority, date range, assignee, tags)
  - Step 4: Visualization type (line, bar, pie, table, number card)
  - Live preview panel showing chart as configuration changes
  - Save / Save As / Run buttons
- Feature-gated: `custom_reports` (pro+ tiers)

#### `/reports/[id]` -- Report Detail / View
- Full-screen rendered report with chart
- Date range override controls
- Export buttons (CSV, JSON, PDF)
- Share link toggle
- Schedule button (opens schedule modal)
- Drill-down: click any data point to see underlying tickets in a side panel

#### `/dashboards` -- Dashboard List & Builder
- List of dashboards (default + custom)
- "New Dashboard" button
- **Dashboard Builder UI**:
  - 12-column responsive grid canvas
  - Drag-and-drop widget placement
  - Widget picker panel: select from saved reports
  - Resize handles on widgets
  - Widget configuration: title override, visualization override, filter override
  - Save / Preview toggle
- Feature-gated: `custom_reports`

#### `/dashboards/[id]` -- Dashboard View
- Rendered dashboard with all widgets
- Auto-refresh toggle (30s/1m/5m intervals)
- Fullscreen mode for wall displays
- Share link
- Date range applies across all widgets

#### `/dashboards/live` -- Real-Time Live Dashboard
- Dedicated real-time view (separate from custom dashboards)
- SSE-powered auto-updating metrics:
  - Queue depth by status (open/pending/on_hold) -- number cards
  - Agents online count -- number card
  - Current avg wait time -- number card with trend arrow
  - Tickets created/resolved in last hour -- number cards
  - SLA at-risk count -- number card (red when >0)
  - Ticket creation rate -- sparkline (last 4 hours, 5-min buckets)
  - Agent availability list (from presence tracker)
  - Channel distribution (live) -- horizontal bar
- Feature-gated: `live_dashboard` (pro+ tiers)

### New Components (8)

| Component | Purpose |
|---|---|
| `ReportBuilder.tsx` | Multi-step report configuration form |
| `ChartRenderer.tsx` | Renders a report result as the selected visualization type. Wraps a lightweight charting library (recharts -- already React-native, ~45KB gzipped, MIT). Supports: LineChart, BarChart, PieChart, AreaChart, Table, NumberCard |
| `DashboardGrid.tsx` | 12-column grid layout with drag-and-drop (uses react-grid-layout). Renders widget slots |
| `DashboardWidget.tsx` | Individual widget wrapper: header bar, report-powered chart, loading/error states |
| `LiveMetricCard.tsx` | Number card with SSE-powered live value, trend arrow, and sparkline |
| `DrillDownPanel.tsx` | Slide-over panel listing underlying tickets when a chart point is clicked |
| `ScheduleModal.tsx` | Modal form for creating/editing scheduled report exports |
| `ShareLinkDialog.tsx` | Dialog for generating/copying shareable report/dashboard links |

### Modified Components/Pages (3)

| File | Changes |
|---|---|
| `src/app/analytics/_content.tsx` | Add "Upgrade to Report Builder" CTA linking to `/reports`. Keep existing analytics as the free-tier view. Add links from each section to corresponding pre-built report. |
| `src/app/dashboard/page.tsx` | Add "Live Dashboard" link card in System Modules section |
| `src/lib/features/gates.ts` | Add `custom_reports` and `live_dashboard` features. `custom_reports` = pro+. `live_dashboard` = pro+. |

### Pre-Built Report Templates (6)

Seeded as `is_template=true` reports in the DB:

| Template Key | Metric | Group By | Viz | Description |
|---|---|---|---|---|
| `ticket_volume` | ticket_created_count | day, month | line | Ticket creation volume over time |
| `agent_performance` | agent_reply_count | assignee | table | Agent metrics: tickets handled, avg resolution, CSAT |
| `sla_compliance` | sla_compliance_pct | priority, week | stacked_bar | SLA met/breached by priority over time |
| `csat_trends` | csat_avg | month | line | CSAT score trend with NPS overlay |
| `channel_breakdown` | ticket_count | channel | pie | Ticket distribution by channel |
| `ai_resolution_rate` | ai_resolution_rate | day | area | AI auto-resolution rate over time |

---

## 5. New CLI Commands (5)

### `cliaas reports` Command Group

```
cliaas reports list [--template] [--format json|table]
    List saved reports. --template shows pre-built templates only.

cliaas reports run <reportId|templateKey> [--from <date>] [--to <date>] [--format json|csv|table]
    Execute a report and print results to stdout. Supports pre-built template keys.

cliaas reports create --name <name> --metric <metric> [--group-by <fields>] [--filters <json>] [--viz <type>]
    Create a new report definition interactively or via flags.

cliaas reports export <reportId> --format <csv|json|pdf> [--out <file>] [--from <date>] [--to <date>]
    Export a report to a file.

cliaas reports schedule <reportId> --frequency <daily|weekly|monthly> --recipients <emails> [--format pdf|csv] [--hour <0-23>]
    Create or update a scheduled export for a report.
```

### Modified: `cliaas stats`
Add `--report <templateKey>` flag to run a pre-built report template directly from the existing stats command, bridging the old and new systems.

---

## 6. New MCP Tools (6)

### `cli/mcp/tools/reports.ts`

| Tool | Description | Parameters |
|---|---|---|
| `report_list` | List saved reports and templates for the workspace | `templateOnly?: boolean`, `limit?: number` |
| `report_run` | Execute a report by ID or template key, return structured data | `reportId: string`, `from?: string`, `to?: string`, `filterOverrides?: object` |
| `report_create` | Create a new custom report definition | `name: string`, `metric: string`, `groupBy?: string[]`, `filters?: object`, `visualization?: string` |
| `report_export` | Export a report as CSV or JSON | `reportId: string`, `format: 'csv'\|'json'`, `from?: string`, `to?: string` |
| `dashboard_live` | Get a snapshot of all real-time live dashboard metrics | (none) |
| `report_schedule` | Create or update a scheduled export for a report | `reportId: string`, `frequency: string`, `recipients: string[]`, `format?: string` |

### Modified Existing Tools
- `queue_stats` in `cli/mcp/tools/queue.ts`: Add optional `--report` parameter that routes to the report engine when a template key is provided, providing backward compatibility.

---

## 7. Migration / Rollout Plan

### Phase 1: Schema + Report Engine (Week 1) -- Size: L

1. **Migration `0007_custom_reports.sql`**: Create all 6 new tables + enums
2. **Report engine** (`src/lib/reports/`):
   - `src/lib/reports/engine.ts` -- `executeReport(reportDef, dateRange?, filterOverrides?)` that queries the appropriate source tables (tickets, messages, csat_ratings, sla_events, time_entries, survey_responses) based on the metric + group_by + filters, returns structured result data
   - `src/lib/reports/metrics.ts` -- Registry of available metrics, their source tables, aggregation functions, and valid group-by dimensions
   - `src/lib/reports/cache.ts` -- Report cache read/write with TTL (5 min live, 1 hour historical)
   - `src/lib/reports/templates.ts` -- Pre-built report template definitions, seed function
   - `src/lib/reports/formatters.ts` -- CSV/JSON/PDF export formatters (PDF via `@react-pdf/renderer` or `pdfmake`)
3. **Seed pre-built templates**: Run template seeder in migration or startup
4. **Tests**: Unit tests for engine, metric registry, cache, formatters

### Phase 2: Report CRUD API + CLI (Week 2) -- Size: M

1. **API routes**: All 8 report endpoints (CRUD + execute + export + share + drill-down)
2. **Auth scoping**: `reports:read`, `reports:write`, `reports:export` scopes
3. **CLI commands**: `cliaas reports list|run|create|export`
4. **MCP tools**: `report_list`, `report_run`, `report_create`, `report_export`
5. **Tests**: API integration tests, CLI smoke tests

### Phase 3: Report Builder UI (Week 3) -- Size: L

1. **Install charting library**: `pnpm add recharts react-grid-layout`
2. **Components**: `ReportBuilder`, `ChartRenderer`, `DrillDownPanel`, `ShareLinkDialog`
3. **Pages**: `/reports`, `/reports/[id]`
4. **Feature gate**: Add `custom_reports` to gate matrix
5. **Modify analytics page**: Add CTA links to report builder
6. **Tests**: Component tests for ChartRenderer, integration tests for report builder flow

### Phase 4: Dashboard Builder (Week 4) -- Size: L

1. **API routes**: All 5 dashboard endpoints
2. **Components**: `DashboardGrid`, `DashboardWidget`
3. **Pages**: `/dashboards`, `/dashboards/[id]`
4. **Widget system**: Report-powered widgets with grid positioning
5. **Auto-refresh**: Configurable polling intervals
6. **Tests**: Dashboard CRUD API tests, grid layout tests

### Phase 5: Scheduled Exports (Week 5) -- Size: M

1. **API routes**: Schedule CRUD (4 endpoints)
2. **BullMQ worker**: `report-export` queue + worker (`src/lib/queue/workers/report-export-worker.ts`)
   - Cron-like repeatable job: checks `report_schedules` every hour, fires due exports
   - Executes report, formats as PDF/CSV, sends via email (existing nodemailer infra)
3. **CLI command**: `cliaas reports schedule`
4. **MCP tool**: `report_schedule`
5. **ScheduleModal** component
6. **Tests**: Worker tests, schedule computation tests

### Phase 6: Real-Time Live Dashboard (Week 6) -- Size: M

1. **Metric snapshot system** (`src/lib/reports/live-metrics.ts`):
   - Periodic aggregator (every 30s via BullMQ repeatable or setInterval fallback): computes queue_depth, agents_online, avg_wait, tickets/hour, SLA at-risk count
   - Writes to `metric_snapshots` table
   - Emits via EventBus for SSE delivery
2. **SSE endpoint**: `GET /api/dashboard/live` -- dedicated SSE stream for live metrics
3. **EventBus extension**: Add `metric:updated` event type to `src/lib/realtime/events.ts`
4. **Components**: `LiveMetricCard` with sparklines
5. **Page**: `/dashboards/live`
6. **Feature gate**: Add `live_dashboard` to gate matrix
7. **Retention**: Purge `metric_snapshots` older than 30 days via retention scheduler
8. **Tests**: Live metric computation tests, SSE integration tests

### Post-Launch
- PDF export quality improvements (branded headers, charts as SVG)
- Embed support (iframe-friendly public report/dashboard pages)
- Dashboard cloning / template gallery
- Metric alerting (threshold-based notifications)
- Report versioning / change history

---

## 8. Effort Estimate

| Phase | Scope | Estimate |
|---|---|---|
| Phase 1: Schema + Report Engine | 6 tables, engine, cache, templates, formatters | **L** (5-7 days) |
| Phase 2: Report CRUD API + CLI | 8 API routes, 4 CLI commands, 4 MCP tools | **M** (3-4 days) |
| Phase 3: Report Builder UI | Charting lib, builder form, 3 components, 2 pages | **L** (5-7 days) |
| Phase 4: Dashboard Builder | Grid layout, 5 API routes, drag-drop, 2 pages | **L** (5-7 days) |
| Phase 5: Scheduled Exports | BullMQ worker, email delivery, schedule CRUD | **M** (3-4 days) |
| Phase 6: Real-Time Dashboard | SSE metrics, snapshot system, live page | **M** (3-4 days) |
| **Total** | | **XL** (24-33 days) |

### Dependencies
- **recharts** (~45KB gzipped): React charting library for line/bar/pie/area charts
- **react-grid-layout** (~18KB gzipped): Grid layout with drag-and-drop for dashboard builder
- **@react-pdf/renderer** OR **pdfmake** (~200KB): PDF generation for scheduled exports (could defer to Phase 5)
- No other new dependencies required -- existing infra (BullMQ, nodemailer, SSE, Drizzle) covers all needs

### Risk Areas
1. **Report engine performance**: Complex queries across large ticket datasets could be slow. Mitigation: report_cache table with TTL, indexed queries, EXPLAIN ANALYZE tuning.
2. **PDF export quality**: Generating chart-containing PDFs server-side is non-trivial. Mitigation: start with CSV-only for scheduled exports, add PDF in a follow-up.
3. **Dashboard drag-and-drop complexity**: react-grid-layout integration with the brutalist design system. Mitigation: start with fixed grid positions (no drag), add drag-and-drop as enhancement.
4. **Real-time metric accuracy**: In-memory aggregation may diverge from DB reality. Mitigation: periodic DB reconciliation (every 5 min), snapshot table as ground truth.

---

## Appendix: Metric Registry (Full Catalog)

| Metric Key | Source Table(s) | Aggregation | Valid Group-By Dimensions |
|---|---|---|---|
| `ticket_count` | tickets | COUNT | status, priority, assignee, channel, source, tag, day, week, month, customer, org |
| `ticket_created_count` | tickets | COUNT WHERE created_at in range | day, week, month, channel, source, priority |
| `ticket_resolved_count` | tickets | COUNT WHERE status IN (solved,closed) | day, week, month, assignee, priority |
| `ticket_reopened_count` | tickets | COUNT WHERE status changed from solved->open | day, week, month |
| `avg_first_response_hours` | tickets + messages | AVG(first_agent_reply - created_at) | assignee, priority, channel, day, week, month |
| `median_first_response_hours` | tickets + messages | MEDIAN(first_agent_reply - created_at) | assignee, priority, day, week, month |
| `avg_resolution_hours` | tickets | AVG(closed_at - created_at) | assignee, priority, channel, day, week, month |
| `median_resolution_hours` | tickets | MEDIAN(closed_at - created_at) | assignee, priority, day, week, month |
| `sla_compliance_pct` | sla_events | (met / total) * 100 | priority, metric_type, day, week, month |
| `sla_breach_count` | sla_events | COUNT WHERE breached_at IS NOT NULL | priority, metric_type, day, week, month |
| `csat_avg` | csat_ratings + survey_responses | AVG(rating) | assignee, day, week, month |
| `nps_score` | survey_responses (type=nps) | (promoters - detractors) / total * 100 | day, week, month |
| `ces_avg` | survey_responses (type=ces) | AVG(rating) | day, week, month |
| `messages_count` | messages | COUNT | author_type, ticket_id, day, week, month |
| `replies_count` | messages | COUNT WHERE type=reply | author_type, day, week, month |
| `agent_reply_count` | messages | COUNT WHERE author_type=user AND type=reply | assignee, day, week, month |
| `time_logged_minutes` | time_entries | SUM(minutes) | assignee, ticket, customer, day, week, month |
| `billable_minutes` | time_entries | SUM(minutes) WHERE billable=true | assignee, customer, day, week, month |
| `ai_resolution_count` | tickets | COUNT WHERE resolved by AI (tag or metadata) | day, week, month |
| `ai_resolution_rate` | tickets | ai_resolved / total * 100 | day, week, month |
