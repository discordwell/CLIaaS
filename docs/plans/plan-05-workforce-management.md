# Plan 05: Workforce Management (WFM)

## 1. Summary of What Exists Today

### Routing & Load (Static/In-Memory)
- **`src/lib/ai/router.ts`**: Skills-based routing with round-robin, capacity limits, and priority weighting. All configuration is hardcoded (`DEFAULT_ROUTING_CONFIG` at line 47 with 4 demo agents). Agent load is tracked in-memory via `global.__cliaasAgentLoad` (line 106). No persistence, no schedules, no real-time availability.

### Presence (Ticket-Level Only)
- **`src/lib/realtime/presence.ts`**: Tracks which agents are viewing/typing on which tickets. In-memory `Map<string, PresenceEntry>` with 60s stale cleanup. No concept of agent availability status (online/away/offline), shift awareness, or scheduled activity tracking.

### Time Tracking (Basic)
- **`src/lib/time-tracking.ts`**: In-memory + JSONL store for time entries. Supports start/stop timers, manual logging, and reporting by agent/ticket/day/customer/group. No concept of scheduled time, shift compliance, or adherence tracking.
- **DB table** (`src/db/schema.ts:500`): `time_entries` with ticketId, userId, minutes, note, billable, customerId, groupId.
- **CLI** (`cli/commands/time.ts`): `cliaas time log` and `cliaas time report`.
- **MCP tools** (`cli/mcp/tools/time.ts`): `time_log` and `time_report`.

### SLA (Calendar Time Only)
- **`src/lib/sla.ts`**: SLA policies with first-response/resolution targets in minutes. Elapsed time calculated against calendar time — no business hours awareness. Escalation rules exist but are notify/escalate/reassign stubs.

### Users & Groups
- **`src/db/schema.ts:157`**: `users` table with role enum (`owner`, `admin`, `agent` + others), status enum (`active`, `inactive`, `invited`). No timezone, skills, capacity, or schedule columns.
- **`src/db/schema.ts:230`**: `groups` table with just name + timestamps. No business hours association.

### Analytics
- **`src/app/analytics/_content.tsx`**: Shows ticket volume, CSAT, SLA compliance, agent performance (tickets handled, avg resolution, CSAT). No WFM metrics (occupancy, adherence, utilization, forecast).

### Queue Stats
- **`src/lib/queue/stats.ts`**: BullMQ queue depth counters only. No historical volume data or forecasting.

### What's Missing (Everything WFM-Specific)
- No agent schedules, shifts, or break tracking
- No schedule templates or business hours integration
- No volume forecasting
- No staffing recommendations
- No real-time adherence tracking
- No time-off/PTO management
- No schedule conflict detection
- No WFM dashboard
- No agent utilization/occupancy metrics

---

## 2. Proposed DB Schema Changes

### New Tables

```sql
-- Agent schedules: defines work shifts per agent
CREATE TABLE agent_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  template_id UUID REFERENCES schedule_templates(id),
  effective_from DATE NOT NULL,
  effective_to DATE,  -- NULL = indefinite
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedule shifts: individual shift blocks within a schedule
CREATE TABLE schedule_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  start_time TIME NOT NULL,  -- e.g. '09:00'
  end_time TIME NOT NULL,    -- e.g. '17:00'
  activity TEXT NOT NULL DEFAULT 'work', -- work, break, training, meeting
  label TEXT  -- optional human label like "Lunch" or "Morning shift"
);
CREATE INDEX schedule_shifts_schedule_idx ON schedule_shifts(schedule_id);

-- Reusable weekly schedule templates
CREATE TABLE schedule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  shifts JSONB NOT NULL DEFAULT '[]', -- array of {dayOfWeek, startTime, endTime, activity, label}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX schedule_templates_workspace_name_idx ON schedule_templates(workspace_id, name);

-- Time-off requests and approvals
CREATE TABLE time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX time_off_workspace_user_idx ON time_off_requests(workspace_id, user_id);

-- Agent availability status (online/away/offline + current activity)
CREATE TABLE agent_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('online', 'away', 'offline', 'on_break')),
  reason TEXT,  -- e.g. "lunch break", "meeting"
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_status_log_user_idx ON agent_status_log(user_id, started_at DESC);

-- Historical volume snapshots for forecasting
CREATE TABLE volume_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  snapshot_hour TIMESTAMPTZ NOT NULL,  -- truncated to hour
  channel TEXT,  -- email, chat, phone, etc. NULL = all
  tickets_created INT NOT NULL DEFAULT 0,
  tickets_resolved INT NOT NULL DEFAULT 0,
  avg_handle_minutes NUMERIC(8,2),
  UNIQUE(workspace_id, snapshot_hour, channel)
);
CREATE INDEX volume_snapshots_workspace_hour_idx ON volume_snapshots(workspace_id, snapshot_hour);

-- Business hours schedules (shared with Agent 12, but foundational for WFM)
CREATE TABLE business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  schedule JSONB NOT NULL DEFAULT '{}', -- {0: [{start: "09:00", end: "17:00"}], ...}
  holidays JSONB NOT NULL DEFAULT '[]', -- [{date: "2026-12-25", name: "Christmas"}]
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX business_hours_workspace_name_idx ON business_hours(workspace_id, name);
```

### Modified Tables

```sql
-- Add to users table
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE users ADD COLUMN max_capacity JSONB DEFAULT '{}';  -- {"email": 5, "chat": 3, "phone": 1}
ALTER TABLE users ADD COLUMN skills TEXT[] DEFAULT '{}';

-- Add to groups table
ALTER TABLE groups ADD COLUMN business_hours_id UUID REFERENCES business_hours(id);
```

---

## 3. New API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/wfm/schedules` | List schedules (filter by user, date range) |
| POST | `/api/wfm/schedules` | Create agent schedule |
| PATCH | `/api/wfm/schedules/[id]` | Update schedule |
| DELETE | `/api/wfm/schedules/[id]` | Delete schedule |
| GET | `/api/wfm/templates` | List schedule templates |
| POST | `/api/wfm/templates` | Create template |
| PATCH | `/api/wfm/templates/[id]` | Update template |
| DELETE | `/api/wfm/templates/[id]` | Delete template |
| GET | `/api/wfm/time-off` | List time-off requests |
| POST | `/api/wfm/time-off` | Submit time-off request |
| PATCH | `/api/wfm/time-off/[id]` | Approve/deny request |
| GET | `/api/wfm/agent-status` | Current status of all agents |
| POST | `/api/wfm/agent-status` | Set agent status (online/away/offline/on_break) |
| GET | `/api/wfm/adherence` | Real-time adherence: scheduled vs actual activity |
| GET | `/api/wfm/forecast` | Volume forecast for given date range |
| GET | `/api/wfm/staffing` | Staffing recommendations based on forecast |
| GET | `/api/wfm/utilization` | Agent utilization metrics |
| GET | `/api/wfm/dashboard` | Aggregated WFM dashboard data |
| GET | `/api/wfm/business-hours` | List business hour configs |
| POST | `/api/wfm/business-hours` | Create business hours |
| PATCH | `/api/wfm/business-hours/[id]` | Update business hours |

---

## 4. New/Modified UI Pages/Components

### New Page: `/wfm` (WFM Dashboard)
- **Route**: `src/app/wfm/page.tsx` (feature-gated behind `advanced_automation` or new `workforce_management` gate)
- **Tabs**: Schedule, Adherence, Forecast, Time Off, Settings
- **Schedule tab**:
  - Weekly calendar grid per agent (drag to create/resize shifts)
  - Apply template to agent
  - Conflict indicator (overlapping shifts, time-off overlap)
  - Filter by group/team
- **Adherence tab**:
  - Real-time table: Agent | Scheduled Activity | Actual Activity | Status (In/Out of adherence)
  - Adherence percentage per agent, per team
  - Timeline view: color-coded bars showing scheduled vs actual
- **Forecast tab**:
  - Line chart: predicted vs actual ticket volume by hour/day
  - Channel breakdown
  - Staffing recommendation cards: "Need 2 more agents 2-4 PM on Tuesdays"
- **Time Off tab**:
  - List of pending/approved/denied requests
  - Approve/deny buttons for managers
  - Calendar overlay showing team coverage impact
- **Settings tab**:
  - Business hours configuration (weekly grid editor)
  - Holiday calendar management
  - Default capacity limits per channel

### Modified: Agent Status Indicator
- **`src/components/AppNav.tsx`** or new `AgentStatusBadge.tsx`: Show current agent status dot (green/yellow/red) in nav bar with dropdown to change status.

### Modified: Ticket Detail Sidebar
- **`src/app/tickets/[id]/page.tsx`**: Optionally show assigned agent's current status and schedule info.

---

## 5. New CLI Commands

```
cliaas wfm schedule list [--user <userId>] [--from <date>] [--to <date>]
cliaas wfm schedule create --user <userId> --template <templateId> --from <date> [--to <date>] [--timezone <tz>]
cliaas wfm schedule delete <scheduleId>

cliaas wfm template list
cliaas wfm template create --name <name> --shifts <json>
cliaas wfm template delete <templateId>

cliaas wfm status [--user <userId>]           # show current agent statuses
cliaas wfm status set <status> [--reason <r>]  # set own status

cliaas wfm time-off request --from <date> --to <date> [--reason <r>]
cliaas wfm time-off list [--status pending|approved|denied]
cliaas wfm time-off approve <requestId>
cliaas wfm time-off deny <requestId>

cliaas wfm forecast [--from <date>] [--to <date>] [--channel <ch>]
cliaas wfm adherence [--user <userId>]
cliaas wfm utilization [--from <date>] [--to <date>]
```

---

## 6. New MCP Tools

| Tool | Description |
|------|-------------|
| `wfm_schedule_list` | List agent schedules with filters |
| `wfm_schedule_create` | Create a schedule for an agent |
| `wfm_template_list` | List schedule templates |
| `wfm_template_create` | Create a reusable schedule template |
| `wfm_agent_status` | Get current agent availability statuses |
| `wfm_agent_status_set` | Set an agent's status |
| `wfm_time_off_list` | List time-off requests |
| `wfm_time_off_request` | Submit a time-off request |
| `wfm_time_off_decide` | Approve or deny a time-off request |
| `wfm_forecast` | Get ticket volume forecast |
| `wfm_staffing` | Get staffing recommendations |
| `wfm_adherence` | Get real-time adherence data |
| `wfm_utilization` | Get agent utilization metrics |

---

## 7. Implementation Plan

### Phase 1: Foundation (Schema + Business Hours + Agent Status)
1. **Migration**: Create new tables (`agent_schedules`, `schedule_shifts`, `schedule_templates`, `time_off_requests`, `agent_status_log`, `volume_snapshots`, `business_hours`). Alter `users` (add `timezone`, `max_capacity`, `skills`) and `groups` (add `business_hours_id`).
2. **Business logic module**: `src/lib/wfm/` directory:
   - `schedules.ts` — CRUD for schedules + shifts, template application, conflict detection
   - `agent-status.ts` — Status transitions with logging, current-status query
   - `business-hours.ts` — CRUD, `isWithinBusinessHours(scheduleId, timestamp)`, `nextBusinessHour(scheduleId, timestamp)`
   - `time-off.ts` — Request/approve/deny workflow, coverage impact calculation
3. **JSONL fallback**: `src/lib/wfm/wfm-store.ts` for demo mode (in-memory + JSONL, matching existing pattern).
4. **Tests**: Unit tests for schedule conflict detection, business hours calculation, status transitions.

### Phase 2: Volume Tracking + Forecasting
5. **Volume snapshot worker**: Add a BullMQ repeatable job (hourly) OR scheduler tick that aggregates `tickets` table into `volume_snapshots`. Fallback: in-memory counters updated on `ticket.created` / `ticket.resolved` events.
6. **Forecast engine**: `src/lib/wfm/forecast.ts` — Simple moving average + day-of-week seasonal decomposition using 4-8 weeks of historical snapshots. Returns predicted volume per hour for a given future date range.
7. **Staffing calculator**: `src/lib/wfm/staffing.ts` — Given forecast + average handle time + target occupancy (configurable, default 80%), calculate required agents per hour. Compare against scheduled agents to produce gap/surplus recommendations.
8. **Tests**: Forecast accuracy tests with synthetic data, staffing calculator edge cases.

### Phase 3: Adherence + Utilization
9. **Adherence engine**: `src/lib/wfm/adherence.ts`:
   - Compare `agent_status_log` (actual) against `schedule_shifts` (expected) for each agent at current time.
   - Calculate adherence percentage: `(time in correct status / total scheduled time) × 100`.
   - Integrate with existing `presence.ts` — if agent has presence entries on tickets, they're "working" even if they didn't explicitly set status.
10. **Utilization metrics**: `src/lib/wfm/utilization.ts`:
    - **Occupancy**: (handle time / available time) — uses `time_entries` for handle time, `agent_status_log` for available time.
    - **Handle time**: Average from `time_entries` per agent.
    - **Idle time**: Available time minus handle time.
11. **SSE events**: Add `wfm:status_changed`, `wfm:adherence_alert` to `EventType` in `src/lib/realtime/events.ts`.
12. **Tests**: Adherence calculation with various schedule/status combinations.

### Phase 4: API + CLI + MCP
13. **API routes**: Implement all 21 routes in `src/app/api/wfm/`.
14. **CLI commands**: `cli/commands/wfm.ts` — Register under `cliaas wfm` command group.
15. **MCP tools**: `cli/mcp/tools/wfm.ts` — 13 tools as listed above.
16. **Integration tests**: API endpoint tests.

### Phase 5: UI Dashboard
17. **WFM page**: `src/app/wfm/page.tsx` + `_content.tsx` with FeatureGate.
18. **Schedule view**: Weekly grid component (pure CSS grid, no external lib for drag — use click-to-create for V1).
19. **Adherence view**: Real-time table with SSE updates.
20. **Forecast view**: Simple bar chart (CSS-based or lightweight chart, matching existing analytics pattern).
21. **Time-off view**: List + approve/deny actions.
22. **Agent status component**: Nav bar status indicator with dropdown.

### Phase 6: Router Integration
23. **Connect to routing**: Modify `src/lib/ai/router.ts` to:
    - Read agent skills from DB `users.skills` column instead of hardcoded config.
    - Check agent status (only route to `online` agents).
    - Check capacity from `users.max_capacity` instead of hardcoded limits.
    - Check business hours: prefer agents whose schedule is currently active.
    - Load from DB on each routing call (with reasonable caching).
24. **SLA business hours**: Modify `src/lib/sla.ts` to optionally calculate elapsed time using business hours (subtract non-business time from elapsed).

### Rollout Order
1. Migration + schema (blocks everything)
2. Phase 1 (foundation) — independent, can ship alone
3. Phase 4 (API/CLI/MCP) — immediately useful for AI agents
4. Phase 2 (forecasting) — valuable standalone
5. Phase 3 (adherence) — builds on Phase 1
6. Phase 5 (UI) — polish layer
7. Phase 6 (router integration) — ties it all together

---

## 8. Effort Estimate

**Size: L (Large)**

| Phase | Effort |
|-------|--------|
| Phase 1: Foundation | M (3-4 days) |
| Phase 2: Forecasting | S-M (2-3 days) |
| Phase 3: Adherence + Utilization | M (2-3 days) |
| Phase 4: API + CLI + MCP | M (3-4 days) |
| Phase 5: UI Dashboard | M-L (4-5 days) |
| Phase 6: Router Integration | S (1-2 days) |
| **Total** | **~15-21 days** |

### Key Risks
- **Forecast accuracy**: Simple moving average may not be sufficient; may need to revisit with more sophisticated time-series methods.
- **Business hours overlap with Agent 12**: The `business_hours` table is needed by both WFM and business hours features. Coordinate to avoid duplicate schemas.
- **Real-time adherence performance**: Polling agent statuses every few seconds at scale could be expensive. SSE-based push from status changes is preferred.
- **Schedule UI complexity**: A proper drag-and-drop schedule grid is a significant frontend effort. V1 should use a simpler click-to-create approach.

### Dependencies
- **Agent 2 (Omnichannel Routing)**: WFM routing integration depends on the routing engine being refactored to be DB-driven. Coordinate on shared schema for agent skills/capacity.
- **Agent 12 (Business Hours)**: Shared `business_hours` table. Whoever implements first defines the schema.
- **Agent 3 (Workflow Engine)**: WFM adherence alerts could fire automation rules (e.g., "if agent out of adherence for 15 min, notify manager").
