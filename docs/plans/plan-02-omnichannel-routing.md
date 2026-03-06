# Plan 02: Real-time Omnichannel Routing Engine

## 1. What Exists Today

### Routing Logic — `src/lib/ai/router.ts`
- **Skill profiles are hardcoded** in `DEFAULT_ROUTING_CONFIG` (lines 47-83): four fake agents (Alice, Bob, Carol, Dan) with static skill arrays.
- **Round-robin state is in-memory** via `global.__cliaasRRIndex` (line 91). Resets on server restart.
- **Agent load tracking is in-memory simulation** via `global.__cliaasAgentLoad` (lines 104-112). Never reads from actual ticket counts — just increments on assignment.
- **Capacity limits are static per-agent** (lines 75-80), not per-channel.
- **No real-time availability/presence** — timezone field exists on `AgentSkillProfile` but `timezoneAware` defaults to `false` (line 82) and is never evaluated in scoring.
- **LLM-enhanced routing** exists (lines 157-221) as an optional path for category extraction.
- **`routeTicket()`** (lines 261-340) scores agents by skill match + capacity penalty + priority bonus, applies round-robin among top-tier, checks hard capacity limit. Returns `RoutingResult` with suggested agent and alternates.

### Presence — `src/lib/realtime/presence.ts`
- In-memory `PresenceTracker` singleton tracks viewing/typing per ticket (lines 16-98).
- Emits `presence:viewing`, `presence:typing`, `presence:left` events via eventBus.
- 60s stale cleanup. **No concept of agent online/away/offline status** — only per-ticket collision detection.

### Event Bus — `src/lib/realtime/events.ts`
- In-memory `EventBus` singleton with typed events (lines 6-16): `ticket:created`, `ticket:updated`, `ticket:reply`, `ticket:assigned`, `ticket:status_changed`, `presence:*`, `rule:executed`, `notification`.
- No `routing:*` or `agent:status_changed` events.

### SSE Endpoint — `src/app/api/events/route.ts`
- Working SSE endpoint that subscribes to `eventBus.onAny()` and streams all events to connected clients.
- Auth-gated via `requireAuth`.

### DB Schema — `src/db/schema.ts`
- **`users` table** (line 157): has `role` (owner/admin/agent), `status` (active/inactive/invited), `email`, `name`. **No skills, timezone, capacity, or availability columns.**
- **`groups` table** (line 230): only `name` + `workspaceId`. **No group_memberships join table.**
- **`tickets` table** (line 286): has `assigneeId` (FK → users), `groupId` (FK → groups), `inboxId`, `status`, `priority`, `tags`, `source`. Supports assignment but no routing metadata.
- **`inboxes` table** (line 238): has `channelType` enum (email, chat, api, sms, phone, web, whatsapp, facebook).
- **No routing_queues, agent_skills, agent_capacity, or routing_rules tables.**

### Automation Actions — `src/lib/automation/actions.ts`
- `set_assignee`/`assign_to`/`unassign` actions exist (lines 36-43). Assignment is simple value-set, no routing logic invoked.

### Sync Worker — `cli/sync/worker.ts`
- Simple `setInterval` polling (5-minute default). No event-driven triggers.

### MCP Tools
- `triage_ticket` and `triage_batch` in `cli/mcp/tools/analysis.ts` — LLM triage that suggests priority/category/assignee.
- `ticket_update` in `cli/mcp/tools/actions.ts` — can set assignee, but no routing awareness.
- No dedicated routing MCP tools.

### Slack — `src/app/api/channels/slack/commands/route.ts`
- Demo-only: `/cliaas ticket <subject>` returns a text response saying "this is a demo response" (line 47). Does not create a ticket or invoke routing.

---

## 2. Proposed DB Schema Changes

### New Tables

```sql
-- Agent skills (many-to-many: user has multiple skills)
CREATE TABLE agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  skill_name TEXT NOT NULL,          -- e.g. 'billing', 'technical', 'spanish'
  proficiency INT DEFAULT 100,       -- 0-100 weight for scoring
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_name)
);

-- Agent capacity rules (per-agent, per-channel limits)
CREATE TABLE agent_capacity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  channel_type channel_type NOT NULL DEFAULT 'email',
  max_concurrent INT NOT NULL DEFAULT 20,  -- max simultaneous tickets on this channel
  UNIQUE(user_id, channel_type)
);

-- Group memberships (users ↔ groups)
CREATE TABLE group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  group_id UUID NOT NULL REFERENCES groups(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, group_id)
);

-- Routing queues (custom prioritized queues)
CREATE TABLE routing_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  priority INT DEFAULT 0,           -- higher = processed first
  conditions JSONB DEFAULT '{}',    -- filter conditions (status, priority, tags, channel, etc.)
  strategy TEXT DEFAULT 'round_robin', -- round_robin | load_balanced | skill_match | priority_weighted
  group_id UUID REFERENCES groups(id),  -- optional: restrict to a group
  overflow_queue_id UUID REFERENCES routing_queues(id), -- fallback queue
  overflow_timeout_secs INT DEFAULT 300, -- seconds before overflow
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routing rules (conditions → queue/agent assignment)
CREATE TABLE routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  priority INT DEFAULT 0,            -- evaluation order (higher first)
  conditions JSONB NOT NULL,         -- AND/OR compound conditions
  target_type TEXT NOT NULL,         -- 'queue' | 'group' | 'agent'
  target_id UUID,                    -- FK to routing_queues, groups, or users
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routing log (audit trail for every routing decision)
CREATE TABLE routing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  queue_id UUID REFERENCES routing_queues(id),
  rule_id UUID REFERENCES routing_rules(id),
  assigned_user_id UUID REFERENCES users(id),
  strategy TEXT,
  matched_skills TEXT[],
  scores JSONB,                      -- agent scoring breakdown
  reasoning TEXT,
  duration_ms INT,                   -- time to compute routing
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Modified Tables

```sql
-- users: add timezone and availability columns
ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN availability TEXT DEFAULT 'offline'
  CHECK (availability IN ('online', 'away', 'offline'));
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;

-- groups: add routing-relevant metadata
ALTER TABLE groups ADD COLUMN default_strategy TEXT DEFAULT 'round_robin';
ALTER TABLE groups ADD COLUMN business_hours_id UUID; -- FK for future business hours feature

-- tickets: add routing metadata
ALTER TABLE tickets ADD COLUMN routed_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN routed_via TEXT; -- 'auto' | 'manual' | 'rule' | 'overflow'
ALTER TABLE tickets ADD COLUMN queue_id UUID REFERENCES routing_queues(id);
```

---

## 3. New API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/routing/config` | Get workspace routing configuration |
| PUT | `/api/routing/config` | Update routing strategy, defaults |
| GET | `/api/routing/queues` | List routing queues |
| POST | `/api/routing/queues` | Create routing queue |
| PUT | `/api/routing/queues/[id]` | Update queue |
| DELETE | `/api/routing/queues/[id]` | Delete queue |
| GET | `/api/routing/rules` | List routing rules |
| POST | `/api/routing/rules` | Create routing rule |
| PUT | `/api/routing/rules/[id]` | Update rule |
| DELETE | `/api/routing/rules/[id]` | Delete rule |
| POST | `/api/routing/route` | Manually route a ticket (invoke engine) |
| GET | `/api/routing/log` | Query routing decision history |
| GET | `/api/routing/analytics` | Routing metrics (assignment time, utilization, queue depth) |
| GET | `/api/agents/skills` | List all agent skills in workspace |
| POST | `/api/agents/[id]/skills` | Set skills for an agent |
| GET | `/api/agents/[id]/capacity` | Get agent capacity rules |
| PUT | `/api/agents/[id]/capacity` | Set agent capacity rules |
| PUT | `/api/agents/[id]/availability` | Set agent availability (online/away/offline) |
| GET | `/api/agents/availability` | List all agents with current availability |
| GET | `/api/groups/[id]/members` | List group members |
| POST | `/api/groups/[id]/members` | Add member to group |
| DELETE | `/api/groups/[id]/members/[userId]` | Remove member from group |

---

## 4. New/Modified UI Pages & Components

### New Pages
- **`/settings/routing`** — Routing configuration page: default strategy, queue management, routing rules editor.
- **`/settings/routing/queues/[id]`** — Queue detail: conditions builder, strategy picker, overflow config.
- **`/analytics/routing`** — Routing analytics dashboard: assignment time distribution, agent utilization heatmap, queue depth over time.

### New Components
- **`AgentAvailabilityIndicator`** — Green/yellow/grey dot showing online/away/offline. Used in sidebar, ticket list, and agent selector.
- **`AgentSkillBadges`** — Pill-style skill tags shown on agent profiles and in routing config.
- **`RoutingQueueCard`** — Card showing queue name, depth, strategy, and linked group.
- **`RoutingRuleEditor`** — Compound condition builder (AND/OR groups) + target selector.
- **`AgentCapacityBar`** — Visual bar showing current load vs. capacity per channel.

### Modified Pages
- **`/dashboard`** — Add agent availability overview panel; show queue depths.
- **`/tickets/[id]`** — Show routing metadata (routed_via, queue name, matched skills) in sidebar. Add "Re-route" button.
- **`/settings` (agents section)** — Add skills, capacity, timezone, and availability management per agent.

---

## 5. New CLI Commands

```
cliaas routing status          # Show routing engine status, queue depths, agent availability
cliaas routing route <ticketId> # Manually route a single ticket
cliaas routing queues           # List routing queues
cliaas routing queues create    # Create a routing queue (interactive)
cliaas routing rules            # List routing rules
cliaas routing rules create     # Create a routing rule (interactive)
cliaas routing log [--ticket-id] [--agent-id] [--since]  # Query routing history
cliaas routing analytics        # Print routing metrics summary

cliaas agents skills <userId>                # List agent skills
cliaas agents skills set <userId> <skills>   # Set skills (comma-separated)
cliaas agents capacity <userId>              # Show capacity rules
cliaas agents capacity set <userId> --email 15 --chat 5  # Set per-channel limits
cliaas agents availability <userId> <status> # Set online/away/offline
cliaas agents list --with-availability       # List agents with current status
```

---

## 6. New MCP Tools

| Tool | Description |
|------|-------------|
| `route_ticket` | Route a ticket through the routing engine — returns assigned agent with reasoning |
| `routing_status` | Show routing engine status: queue depths, agent availability, recent decisions |
| `agent_availability` | Get or set agent availability (online/away/offline) |
| `agent_skills` | Get or set skills for an agent |
| `queue_depth` | Get real-time queue depth for all queues or a specific queue |

---

## 7. Migration / Rollout Plan

### Phase 1: Schema & Core Engine (M)
1. Write Drizzle migration for all new tables + column additions.
2. Refactor `src/lib/ai/router.ts` to `src/lib/routing/engine.ts`:
   - Read skills, capacity, group memberships from DB instead of hardcoded config.
   - Read actual open-ticket counts from DB instead of in-memory simulation.
   - Implement four strategies: `round_robin`, `load_balanced`, `skill_match`, `priority_weighted`.
   - Add queue-based routing: evaluate routing rules → assign to queue → pick agent from queue.
   - Add overflow logic: if no agent in queue under capacity within timeout, widen to overflow queue.
3. Add `availability` column to users; extend presence system to track online/away/offline (distinct from per-ticket viewing/typing).
4. Add new event types to eventBus: `agent:availability_changed`, `ticket:routed`, `routing:overflow`.
5. Write routing log entries for every decision.
6. Tests: unit tests for each strategy, capacity enforcement, overflow, skill matching.

### Phase 2: API & CLI (S)
1. Build all API routes listed above.
2. Build CLI commands.
3. Build MCP tools.
4. Integration tests: route ticket via API, verify log entry and assignment.

### Phase 3: Auto-routing on Ticket Creation (S)
1. Hook into `ticket:created` event in eventBus → invoke routing engine.
2. Hook into Slack command handler → actually create ticket + invoke routing.
3. Hook into sync worker → route newly imported tickets.
4. Respect routing rules: evaluate conditions against ticket attributes, assign to matching queue.

### Phase 4: UI (M)
1. Build routing settings page with queue and rule editors.
2. Build agent availability indicator + skill management in settings.
3. Build routing analytics dashboard.
4. Add routing metadata to ticket detail sidebar.
5. Add real-time queue depth updates via SSE.

### Phase 5: Advanced Features (S)
1. Business hours awareness: skip offline-timezone agents (prep for Agent 12's business hours system).
2. Routing analytics: assignment latency, agent utilization, queue wait times.
3. Re-route button in ticket detail.

---

## 8. Effort Estimate

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1 | **L** | Core engine rewrite + DB schema + strategies + tests |
| Phase 2 | **S** | API routes + CLI + MCP (mostly CRUD plumbing) |
| Phase 3 | **S** | Event hooks for auto-routing |
| Phase 4 | **M** | Settings UI, analytics dashboard, availability indicators |
| Phase 5 | **S** | Business hours integration, analytics, re-route UX |
| **Total** | **L** | ~3-4 weeks of focused work |

### Key Dependencies
- **Agent 5 (WFM)**: Business hours and scheduling integration will enhance routing but is not a blocker.
- **Agent 3 (Workflow Automation)**: Routing rules overlap with automation rules — share the compound condition evaluator.
- **Agent 12 (Business Hours)**: Timezone-aware routing depends on business hours schedules.

### Key Risks
- **In-memory → DB migration**: Current round-robin index and load tracking are in-memory globals. Moving to DB adds latency; mitigate with a write-through cache (DB is source of truth, in-memory cache for hot path).
- **Multi-instance consistency**: With multiple Next.js instances, in-memory eventBus won't propagate across processes. Phase 5 should add optional Redis pubsub for presence/availability sync. The routing engine itself reads from DB, so it's already multi-instance safe.
- **Routing latency**: LLM-enhanced routing adds 1-3s per ticket. Make LLM routing optional (off by default) and ensure keyword-based routing is sub-100ms.
