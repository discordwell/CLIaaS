# Plan 17: AutoQA Pipeline, Satisfaction Prediction & Customer Health Scores

**Date:** 2026-03-06
**Status:** Draft
**Effort:** XL (6-8 weeks for full implementation)

---

## 1. What Exists Today

### QA Infrastructure (Manual + Demo Auto-Review)

| Component | File | Lines | What It Does |
|-----------|------|-------|--------------|
| QA Store (JSONL) | `src/lib/qa/qa-store.ts` | 1-299 | In-memory scorecards + reviews backed by JSONL. Scorecard CRUD, review CRUD, dashboard metrics grouped by scorecard. |
| AI QA Scoring | `src/lib/ai/qa.ts` | 1-363 | `scoreResponse()` scores a single agent reply on tone/completeness/accuracy/brandVoice (1-5). LLM-first with heuristic fallback. Stores reports in a global in-memory array (max 100). **Not connected to the QA store or DB.** |
| QA DB Tables | `src/db/schema.ts` | 1367-1403 | `qa_scorecards` (criteria JSONB, enabled flag) and `qa_reviews` (scores JSONB, totalScore, maxPossibleScore, reviewType text, status enum). Both workspace-scoped. |
| QA Dashboard UI | `src/app/qa/_content.tsx` | 1-450 | Client component showing metric cards (total/completed/avgScore/avg%), scorecard list with toggle, per-scorecard breakdown bars, recent reviews list. Feature-gated behind `qa_reviews`. |
| QA API Routes | `src/app/api/qa/` | 5 routes | `GET/POST /scorecards`, `PATCH /scorecards/[id]`, `GET/POST /reviews`, `POST /reviews/auto` (generates **random scores** for demo), `GET /dashboard`. |
| QA CLI | `cli/commands/qa.ts` | 1-132 | `qa review <ticketId>` creates auto-review with **random scores**. `qa dashboard` shows metrics. |
| QA MCP Tools | `cli/mcp/tools/qa.ts` | 1-129 | `qa_review` (list or create with confirmation pattern), `qa_dashboard` (read-only metrics). |
| Event Hooks | `src/lib/events/dispatcher.ts` | 31-32 | `qa.review_created` and `qa.review_completed` canonical events exist but nothing triggers AutoQA on ticket resolution. |

### Related AI Infrastructure

| Component | File | What It Does |
|-----------|------|--------------|
| AI Agent | `src/lib/ai/agent.ts` | Autonomous ticket resolution with confidence scoring. LLM-first (Claude/OpenAI). |
| Sentiment Analysis (CLI) | `cli/commands/sentiment.ts` | LLM-powered per-ticket sentiment analysis. **Not persisted.** |
| Sentiment Analysis (MCP) | `cli/mcp/tools/analysis.ts:122-211` | `sentiment_analyze` tool. Same LLM approach. **Not persisted.** |
| Proactive Intelligence | `src/lib/ai/proactive.ts` | Topic spikes, sentiment trends, anomalies, KB gaps. Keyword-based + LLM. |

### CSAT / Survey Infrastructure

| Component | File | What It Does |
|-----------|------|--------------|
| CSAT Ratings | `src/db/schema.ts:486-499` | `csat_ratings` table (ticketId, rating integer, comment). |
| Survey Responses | `src/db/schema.ts:1019-1040` | `survey_responses` table (surveyType csat/nps/ces, rating, comment, token). |
| Survey Configs | `src/db/schema.ts:1042-1061` | `survey_configs` table (trigger: ticket_solved/ticket_closed/manual, delayMinutes). |

### Customer Infrastructure

| Component | File | What It Does |
|-----------|------|--------------|
| Customers Table | `src/db/schema.ts:199-229` | 10 enrichment columns (plan, lastSeenAt, locale, etc). No health score column. |
| Customer Activities | `src/db/schema.ts:1245-1260` | Activity log per customer. |
| Customer Store (JSONL) | `src/lib/customers/customer-store.ts` | Activities, notes, segments, merge log. No health scoring. |

### Job Queue

| Queue | Worker | Concurrency |
|-------|--------|-------------|
| `webhook-delivery` | webhook-worker.ts | 5 |
| `automation-scheduler` | automation-worker.ts | 1 |
| `ai-resolution` | ai-resolution-worker.ts | 2 |
| `email-send` | email-worker.ts | 3 |

No AutoQA queue exists. The `ticket.resolved` event fires but does not trigger any QA scoring.

### Key Gaps

1. **Auto-review generates random scores** -- the `POST /api/qa/reviews/auto` route and `qa review` CLI command both use `Math.random()`, not LLM analysis.
2. **`src/lib/ai/qa.ts` is disconnected** -- `scoreResponse()` evaluates a single reply but is never called from the QA store, API routes, or event pipeline.
3. **No satisfaction prediction** -- CSAT survey responses are collected but never predicted before the survey.
4. **No customer health score** -- no aggregation of CSAT, ticket volume, sentiment, or resolution quality per customer.
5. **No spotlight/flagging** -- AI flags from `qa.ts` exist in the return type but are not persisted or surfaced.
6. **No coaching workflow** -- no concept of assigning a flagged review to an agent for acknowledgment.
7. **No calibration** -- no mechanism to compare AI scores vs. manual scores on the same conversation.
8. **No per-agent breakdown** -- dashboard shows per-scorecard but not per-agent quality trends.

---

## 2. Proposed DB Schema Changes

### 2a. New Tables

```sql
-- AutoQA configuration per workspace
CREATE TABLE autoqa_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Which scorecard to use for auto-scoring
  scorecard_id UUID REFERENCES qa_scorecards(id),
  -- Trigger conditions
  trigger_on_resolved BOOLEAN NOT NULL DEFAULT true,
  trigger_on_closed BOOLEAN NOT NULL DEFAULT false,
  -- LLM provider config
  provider TEXT NOT NULL DEFAULT 'claude',  -- claude | openai
  model TEXT,                                -- override model
  -- Sampling: score all or a percentage
  sample_rate NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- 1.00 = 100%
  -- Custom prompt additions
  custom_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

-- AI-generated flags on conversations (spotlight)
CREATE TABLE qa_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  review_id UUID NOT NULL REFERENCES qa_reviews(id),
  ticket_id UUID REFERENCES tickets(id),
  category TEXT NOT NULL,       -- tone, completeness, accuracy, brand_voice, policy, custom
  severity TEXT NOT NULL,       -- info, warning, critical
  message TEXT NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_by UUID REFERENCES users(id),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX qa_flags_ws_severity_idx ON qa_flags(workspace_id, severity) WHERE NOT dismissed;
CREATE INDEX qa_flags_review_idx ON qa_flags(review_id);

-- Coaching assignments: manager assigns flagged review to agent
CREATE TABLE qa_coaching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  review_id UUID NOT NULL REFERENCES qa_reviews(id),
  agent_id UUID NOT NULL REFERENCES users(id),
  assigned_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, acknowledged, completed
  notes TEXT,
  agent_response TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX qa_coaching_ws_agent_idx ON qa_coaching_assignments(workspace_id, agent_id, status);

-- Satisfaction predictions per ticket
CREATE TABLE csat_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  predicted_score NUMERIC(3,1) NOT NULL,  -- 1.0-5.0
  confidence NUMERIC(3,2) NOT NULL,       -- 0.00-1.00
  risk_level TEXT NOT NULL,               -- low, medium, high
  factors JSONB NOT NULL DEFAULT '{}',    -- explanation of prediction factors
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Actual outcome (filled when survey comes in)
  actual_score INTEGER,
  actual_received_at TIMESTAMPTZ
);
CREATE INDEX csat_predictions_ws_ticket_idx ON csat_predictions(workspace_id, ticket_id);
CREATE INDEX csat_predictions_ws_risk_idx ON csat_predictions(workspace_id, risk_level);

-- Customer health scores (computed aggregate)
CREATE TABLE customer_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  -- Component scores (0-100)
  overall_score INTEGER NOT NULL,
  csat_score INTEGER,         -- from survey responses
  sentiment_score INTEGER,    -- from sentiment analysis
  effort_score INTEGER,       -- based on ticket volume, reopens, back-and-forth
  resolution_score INTEGER,   -- based on resolution times, first-contact resolution
  engagement_score INTEGER,   -- based on recency, frequency
  -- Trend
  trend TEXT NOT NULL DEFAULT 'stable',  -- improving, declining, stable
  previous_score INTEGER,
  -- Raw signals (for explainability)
  signals JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, customer_id)
);
CREATE INDEX customer_health_ws_score_idx ON customer_health_scores(workspace_id, overall_score);

-- Calibration sessions: compare AI vs. manual scores
CREATE TABLE qa_calibration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open, closed
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE qa_calibration_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES qa_calibration_sessions(id),
  auto_review_id UUID NOT NULL REFERENCES qa_reviews(id),
  manual_review_id UUID REFERENCES qa_reviews(id),  -- NULL until manual review submitted
  score_delta NUMERIC(4,2),  -- auto minus manual overall; computed when manual submitted
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX qa_calibration_entries_session_idx ON qa_calibration_entries(session_id);
```

### 2b. Columns Added to Existing Tables

```sql
-- qa_reviews: add agent reference and AI metadata
ALTER TABLE qa_reviews ADD COLUMN agent_id UUID REFERENCES users(id);
ALTER TABLE qa_reviews ADD COLUMN ai_model TEXT;
ALTER TABLE qa_reviews ADD COLUMN ai_latency_ms INTEGER;
ALTER TABLE qa_reviews ADD COLUMN suggestions JSONB DEFAULT '[]';
CREATE INDEX qa_reviews_ws_agent_idx ON qa_reviews(workspace_id, agent_id);

-- tickets: add predicted CSAT for quick access
ALTER TABLE tickets ADD COLUMN predicted_csat NUMERIC(3,1);
ALTER TABLE tickets ADD COLUMN autoqa_score NUMERIC(3,1);

-- customers: add health score for quick access
ALTER TABLE customers ADD COLUMN health_score INTEGER;
ALTER TABLE customers ADD COLUMN health_trend TEXT;
```

### 2c. JSONL Store Additions (Demo Mode)

New files in `CLIAAS_DATA_DIR`:
- `autoqa-configs.jsonl`
- `qa-flags.jsonl`
- `qa-coaching.jsonl`
- `csat-predictions.jsonl`
- `customer-health-scores.jsonl`

---

## 3. New API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| **AutoQA Config** | | |
| GET | `/api/qa/autoqa/config` | Get AutoQA config for workspace |
| PUT | `/api/qa/autoqa/config` | Create/update AutoQA config |
| POST | `/api/qa/autoqa/trigger` | Manually trigger AutoQA on a ticket (for testing) |
| POST | `/api/qa/autoqa/batch` | Trigger AutoQA on N most recent resolved tickets |
| **QA Flags** | | |
| GET | `/api/qa/flags` | List flags with filters (?severity, ?dismissed, ?ticketId) |
| PATCH | `/api/qa/flags/[id]` | Dismiss a flag |
| **Coaching** | | |
| GET | `/api/qa/coaching` | List coaching assignments (?agentId, ?status) |
| POST | `/api/qa/coaching` | Create coaching assignment |
| PATCH | `/api/qa/coaching/[id]` | Update status (acknowledge, complete, add response) |
| **CSAT Prediction** | | |
| GET | `/api/predictions/csat` | List predictions (?ticketId, ?riskLevel) |
| POST | `/api/predictions/csat/trigger` | Trigger prediction for a specific ticket |
| GET | `/api/predictions/csat/accuracy` | Prediction accuracy report (predicted vs actual) |
| **Customer Health** | | |
| GET | `/api/customers/[id]/health` | Get health score for a customer |
| POST | `/api/customers/health/compute` | Recompute health scores (batch) |
| GET | `/api/customers/health/overview` | Overview: distribution, at-risk list |
| **Calibration** | | |
| GET | `/api/qa/calibration` | List calibration sessions |
| POST | `/api/qa/calibration` | Create calibration session |
| POST | `/api/qa/calibration/[id]/entries` | Add entries to a session |
| GET | `/api/qa/calibration/[id]/report` | Calibration report (drift analysis) |
| **Enhanced Dashboard** | | |
| GET | `/api/qa/dashboard/agents` | Per-agent quality breakdown |
| GET | `/api/qa/dashboard/trends` | QA score trends over time |
| GET | `/api/qa/dashboard/correlation` | QA score vs CSAT correlation |

**Total: 19 new API routes.**

---

## 4. New/Modified UI Pages & Components

### 4a. Modified: `/qa` (QA Dashboard)

Extend `src/app/qa/_content.tsx` with:

1. **AutoQA Status Banner** -- shows whether AutoQA is on/off, last run, coverage %. Link to config.
2. **Per-Agent Quality Table** -- sortable table: agent name, review count, avg score, trend arrow, flags count. Clickable rows drill into agent detail.
3. **Spotlight Panel** -- critical/warning flags needing attention. Quick-dismiss or assign-to-coach actions.
4. **Score Trend Chart** -- line chart of avg QA score over last 30/60/90 days (use a simple canvas or SVG chart, no charting library).
5. **Calibration Summary Card** -- latest calibration session stats: avg drift, correlation.

### 4b. New: `/qa/config` -- AutoQA Configuration

- Toggle AutoQA on/off
- Select active scorecard
- Configure sample rate (slider: 10%-100%)
- Select LLM provider + model
- Custom instructions textarea
- Trigger conditions (on resolved, on closed)
- Test button: runs AutoQA on a single recent ticket and shows results

### 4c. New: `/qa/agent/[id]` -- Agent Quality Detail

- Agent name + avatar
- Score trend chart (per-criterion over time)
- Review list (filterable by scorecard, date range)
- Flags list for this agent
- Coaching assignments (pending, completed)
- Comparison to team average

### 4d. New: `/qa/coaching` -- Coaching Workflow

- List of coaching assignments (filterable by status: pending/acknowledged/completed)
- Create assignment form (select review + agent)
- Agent view: see assigned reviews, acknowledge, write response
- Manager view: see all assignments, mark complete

### 4e. New: `/qa/calibration` -- Calibration Sessions

- Create session (name, select N auto-reviewed tickets)
- Per-entry: show auto scores side-by-side with manual scoring form
- Report view: avg delta per criterion, drift direction, inter-rater reliability

### 4f. Modified: `/customers/[id]` -- Customer Detail

Add a **Health Score** card:
- Overall score gauge (0-100)
- Component breakdowns (CSAT, sentiment, effort, resolution, engagement)
- Trend indicator
- Last computed timestamp

### 4g. Modified: `/tickets` or Ticket Detail

Add:
- **Predicted CSAT** badge on ticket cards/detail (color-coded: green/yellow/red)
- **AutoQA Score** badge (if scored)
- **Flags** indicator (number of unresolved flags)

### 4h. New: `/predictions` -- Satisfaction Prediction Dashboard

- Accuracy metrics (predicted vs actual for tickets where survey was returned)
- Risk distribution chart
- High-risk ticket list (for proactive intervention)
- Prediction trend over time

---

## 5. New CLI Commands

```
cliaas qa autoqa config                    Show AutoQA configuration
cliaas qa autoqa enable                    Enable AutoQA pipeline
cliaas qa autoqa disable                   Disable AutoQA pipeline
cliaas qa autoqa run <ticketId>            Run AutoQA on a single ticket
cliaas qa autoqa batch [--limit N]         Run AutoQA on recent resolved tickets
cliaas qa flags [--severity critical]      List spotlight flags
cliaas qa flags dismiss <flagId>           Dismiss a flag
cliaas qa coaching list [--agent <id>]     List coaching assignments
cliaas qa coaching assign <reviewId> <agentId>  Create coaching assignment
cliaas qa coaching respond <assignmentId>  Mark assignment acknowledged/completed

cliaas predict csat <ticketId>             Predict CSAT for a ticket
cliaas predict csat-batch [--status open]  Predict CSAT for multiple tickets
cliaas predict accuracy                    Show prediction accuracy report

cliaas customers health <customerId>       Show customer health score
cliaas customers health-compute [--all]    Recompute health scores
cliaas customers at-risk [--limit 20]      List customers with declining health

cliaas qa calibrate create <name>          Create calibration session
cliaas qa calibrate review <sessionId>     Interactively review calibration entries
cliaas qa calibrate report <sessionId>     Show calibration drift report
```

---

## 6. New MCP Tools

| Tool Name | Description |
|-----------|-------------|
| `autoqa_config` | Get/set AutoQA configuration (enable, scorecard, sample rate, provider) |
| `autoqa_run` | Run AutoQA on a single ticket. Returns scores, flags, suggestions. |
| `autoqa_batch` | Run AutoQA on a batch of resolved tickets. Returns summary stats. |
| `qa_flags` | List or dismiss QA spotlight flags. Filter by severity, ticket, agent. |
| `qa_coaching` | List, create, or update coaching assignments. |
| `csat_predict` | Predict satisfaction for a ticket before survey is sent. |
| `csat_prediction_accuracy` | Report on prediction accuracy (predicted vs actual). |
| `customer_health` | Get or recompute customer health score. |
| `customer_at_risk` | List customers with declining or low health scores. |
| `qa_calibrate` | Create calibration sessions, add entries, view drift report. |
| `qa_agent_performance` | Per-agent quality metrics: scores, trends, flags, comparisons. |

**Total: 11 new MCP tools (60 -> 71).**

---

## 7. Architecture: AutoQA Pipeline

### 7a. Event-Driven Flow

```
ticket.resolved event
       |
       v
dispatcher.ts --- enqueueAutoQA(ticketId, workspaceId)
       |
       v
[BullMQ: autoqa-scoring queue]   (new queue, concurrency: 2)
       |
       v
autoqa-worker.ts
  1. Load autoqa_config for workspace
  2. Check enabled + sample rate (random < sampleRate?)
  3. Load ticket, conversation messages, assignee
  4. Load active scorecard criteria
  5. Call LLM with structured prompt (scorecard criteria + conversation)
  6. Parse response: scores per criterion, flags, suggestions
  7. Create qa_review (reviewType='auto', agent_id=assignee)
  8. Create qa_flags for any issues found
  9. Compute satisfaction prediction (piggyback on same LLM call)
  10. Create csat_prediction record
  11. Update ticket.autoqa_score, ticket.predicted_csat
  12. Dispatch 'qa.review_completed' event
  13. If critical flags: dispatch 'qa.flag_critical' event
```

### 7b. LLM Prompt Structure

The AutoQA prompt will be built from the scorecard's criteria, making it fully customizable:

```
You are a QA analyst evaluating a customer support conversation.

SCORECARD CRITERIA:
{{for each criterion in scorecard.criteria}}
- {{criterion.name}} (max {{criterion.maxScore}} points): {{criterion.description}}
{{/for}}

{{if autoqa_config.custom_instructions}}
ADDITIONAL INSTRUCTIONS:
{{custom_instructions}}
{{/if}}

TICKET:
Subject: {{ticket.subject}}
Priority: {{ticket.priority}}
Channel: {{conversation.channelType}}
Resolution time: {{computed from ticket timestamps}}

CONVERSATION:
{{last N messages, formatted}}

AGENT BEING EVALUATED: {{assignee name}}

Score each criterion. Also:
1. Flag any issues (category, severity, message)
2. Provide improvement suggestions
3. Predict customer satisfaction (1-5) with confidence (0-1) and risk level

Respond with JSON:
{
  "scores": { "criterion_name": score, ... },
  "overall": weighted_average,
  "flags": [{ "category": "...", "severity": "info|warning|critical", "message": "..." }],
  "suggestions": ["..."],
  "csat_prediction": { "score": N, "confidence": N, "risk": "low|medium|high", "factors": {} }
}
```

### 7c. Customer Health Score Computation

Health score is a **scheduled computation** (not real-time). Runs daily or on-demand:

```
health_score = weighted_average(
  csat_component     * 0.30,   -- avg survey score, normalized to 0-100
  sentiment_component * 0.20,  -- avg sentiment from recent tickets
  effort_component    * 0.20,  -- inverse of: ticket volume, reopens, long threads
  resolution_component * 0.15, -- first-contact resolution rate, avg resolution time
  engagement_component * 0.15  -- recency of last interaction, frequency
)
```

Each component is computed from the last 90 days of data. The `signals` JSONB column stores the raw inputs for explainability.

**Trend** is computed by comparing current score to the score from 30 days ago:
- Delta > +5: "improving"
- Delta < -5: "declining"
- Otherwise: "stable"

### 7d. Satisfaction Prediction (Non-LLM Fallback)

When no LLM is available, use a heuristic model:

```
predicted_csat = base_score
  + (resolution_speed_factor)    -- fast resolution → +
  + (first_contact_resolution)   -- FCR → +1
  + (sentiment_factor)           -- negative sentiment → -
  + (reopen_penalty)             -- reopened tickets → -
  + (priority_alignment)         -- urgent resolved quickly → +
  + (agent_quality_factor)       -- agent's avg QA score → +/-
```

This provides a baseline that works without API keys, with LLM prediction as an upgrade.

---

## 8. Migration / Rollout Plan

### Phase 1: Schema + AutoQA Core (Week 1-2) -- Size: L

1. **Migration `0006_autoqa_predictions.sql`**:
   - Create `autoqa_configs`, `qa_flags`, `qa_coaching_assignments`, `csat_predictions`, `customer_health_scores`, `qa_calibration_sessions`, `qa_calibration_entries`
   - Alter `qa_reviews` (add `agent_id`, `ai_model`, `ai_latency_ms`, `suggestions`)
   - Alter `tickets` (add `predicted_csat`, `autoqa_score`)
   - Alter `customers` (add `health_score`, `health_trend`)

2. **JSONL stores** for demo mode:
   - `src/lib/qa/autoqa-config-store.ts`
   - `src/lib/qa/qa-flags-store.ts`
   - `src/lib/qa/qa-coaching-store.ts`
   - `src/lib/predictions/csat-prediction-store.ts`
   - `src/lib/customers/health-score-store.ts`

3. **Core AutoQA engine** (`src/lib/ai/autoqa.ts`):
   - `runAutoQA(ticketId, workspaceId)` -- the main scoring function
   - Uses existing `scoreResponse()` from `src/lib/ai/qa.ts` as a foundation
   - Enhanced to read scorecard criteria and produce structured output
   - Persists results to qa_reviews + qa_flags

4. **BullMQ queue + worker**:
   - Add `AUTOQA_SCORING` to `QUEUE_NAMES` in `src/lib/queue/types.ts`
   - New `AutoQAScoringJob` type
   - New `src/lib/queue/workers/autoqa-worker.ts`
   - New `enqueueAutoQA()` in `src/lib/queue/dispatch.ts`

5. **Event hook**:
   - In `src/lib/events/dispatcher.ts`, add `enqueueAutoQA()` call on `ticket.resolved`

6. **API routes**: `/api/qa/autoqa/config`, `/api/qa/autoqa/trigger`

7. **Tests**: Unit tests for autoqa engine, worker, config store

### Phase 2: Satisfaction Prediction + Flags UI (Week 3-4) -- Size: L

1. **CSAT prediction engine** (`src/lib/predictions/csat-predictor.ts`):
   - Heuristic model (no LLM required)
   - LLM-enhanced prediction (piggybacks on AutoQA or standalone)
   - Backfill: compare predictions to actual survey responses

2. **QA flags API routes** + spotlight UI:
   - `/api/qa/flags` routes
   - Spotlight panel in QA dashboard
   - Flag dismissal flow

3. **AutoQA configuration page** (`/qa/config`)

4. **Modified ticket detail**: predicted CSAT badge, AutoQA score badge

5. **New API routes**: `/api/predictions/csat/*`

6. **MCP tools**: `autoqa_config`, `autoqa_run`, `autoqa_batch`, `qa_flags`, `csat_predict`

7. **CLI commands**: `qa autoqa *`, `predict csat *`, `qa flags *`

8. **Tests**: Prediction accuracy tests, flags CRUD tests

### Phase 3: Customer Health + Agent Dashboard (Week 5-6) -- Size: L

1. **Health score engine** (`src/lib/customers/health-engine.ts`):
   - Component computation functions
   - Batch recompute (all customers in workspace)
   - Scheduled via automation queue (daily tick)

2. **Customer health API routes**: `/api/customers/[id]/health`, `/api/customers/health/*`

3. **Per-agent quality dashboard**:
   - `/api/qa/dashboard/agents` route
   - `/qa/agent/[id]` page
   - Agent quality table in main QA dashboard

4. **Customer detail enhancement**: Health score card on `/customers/[id]`

5. **MCP tools**: `customer_health`, `customer_at_risk`, `qa_agent_performance`

6. **CLI commands**: `customers health *`, `customers at-risk`

7. **Tests**: Health computation tests, agent dashboard tests

### Phase 4: Coaching + Calibration (Week 7-8) -- Size: M

1. **Coaching workflow**:
   - API routes: `/api/qa/coaching/*`
   - UI page: `/qa/coaching`
   - MCP tool: `qa_coaching`
   - CLI commands: `qa coaching *`

2. **Calibration system**:
   - API routes: `/api/qa/calibration/*`
   - UI page: `/qa/calibration`
   - MCP tool: `qa_calibrate`
   - CLI commands: `qa calibrate *`

3. **Analytics**:
   - `/api/qa/dashboard/trends` route
   - `/api/qa/dashboard/correlation` route (QA vs CSAT)
   - Trend charts in QA dashboard
   - Predictions dashboard page (`/predictions`)

4. **New canonical events**:
   - `qa.flag_critical`
   - `qa.coaching_assigned`
   - `customer.health_changed`

5. **Feature gate update**: Add `autoqa` feature to gate matrix (pro+ tier)

6. **Tests**: Coaching workflow tests, calibration drift tests, E2E tests

### Deployment Steps (Per Phase)

1. Run migration on VPS Postgres
2. Deploy via `VPS_HOST=ovh2 SKIP_NGINX=1 ./scripts/deploy_vps.sh`
3. Verify health check passes
4. Manually trigger AutoQA on a test ticket to validate
5. Enable AutoQA for demo workspace

---

## 9. Effort Estimate

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1: Schema + AutoQA Core | 6 new tables, 1 migration, 1 worker, 1 engine, 5 JSONL stores, 2 API routes, tests | **L** (2 weeks) |
| Phase 2: Predictions + Flags UI | 1 prediction engine, 7 API routes, 1 new page, 2 modified pages, 5 MCP tools, 6 CLI commands, tests | **L** (2 weeks) |
| Phase 3: Health + Agent Dashboard | 1 health engine, 5 API routes, 2 new pages, 1 modified page, 3 MCP tools, 4 CLI commands, tests | **L** (2 weeks) |
| Phase 4: Coaching + Calibration | 7 API routes, 3 new pages, 3 MCP tools, 5 CLI commands, 3 new events, tests | **M** (1-2 weeks) |
| **Total** | 7 new DB tables, 5 altered tables, ~19 API routes, ~6 new pages, ~11 MCP tools, ~15 CLI commands | **XL** (6-8 weeks) |

### What Makes This XL

- **Breadth**: Touches DB schema, JSONL stores, business logic, AI engine, job queue, event pipeline, API routes, UI pages, CLI commands, and MCP tools.
- **LLM integration**: AutoQA and predictions require careful prompt engineering, JSON parsing, error handling, and fallback logic. Each needs both LLM and heuristic paths.
- **New queue worker**: Adding a 5th BullMQ queue for AutoQA scoring.
- **Computation engine**: Customer health scores require aggregating data across 5 different domain tables.
- **UI surface area**: 6 new pages + modifications to 3 existing pages.
- **Testing**: Each phase needs unit tests, and the full pipeline needs integration tests.

### Shortcuts to Reduce Scope

If time-constrained, ship in this order of priority:

1. **Phase 1 alone (L)** -- delivers the core value: AI scores every resolved conversation. Replaces random scores with real LLM analysis.
2. **Add CSAT prediction** from Phase 2 -- high competitive value vs Zendesk.
3. **Add health scores** from Phase 3 -- differentiator for customer success teams.
4. **Coaching + Calibration** can wait -- these are manager-workflow features that matter at scale.

---

## 10. Competitive Positioning

| Feature | Zendesk QA ($35/agent/mo) | Freshdesk Freddy | CLIaaS (after Plan 17) |
|---------|--------------------------|-------------------|------------------------|
| AutoQA 100% coverage | Yes | No | Yes (configurable sample rate) |
| Custom scorecards | Yes | No | Yes (existing + enhanced) |
| Spotlight/flags | Yes (spotlight categories) | No | Yes (qa_flags table) |
| Satisfaction prediction | Yes | Partial | Yes (LLM + heuristic) |
| Customer health | No (separate product) | No | Yes (built-in) |
| Coaching workflow | Yes | No | Yes |
| Calibration | Yes | No | Yes |
| AI model choice | Fixed (Zendesk AI) | Fixed (Freddy) | BYOAI (Claude/OpenAI/custom) |
| Per-agent dashboards | Yes | Limited | Yes |
| MCP/CLI access | No | No | Yes (11 new tools, 15 CLI commands) |
| Pricing | $35/agent/month add-on | Included in higher tiers | Included in all tiers |

**Key differentiator**: CLIaaS AutoQA is **tier-agnostic** and **AI-agnostic**. BYOC users get the same AutoQA capabilities as hosted users. They can use their own API keys with their preferred model. No per-agent add-on fee.
