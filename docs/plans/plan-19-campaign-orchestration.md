# Plan 19: Multi-Step Campaign Orchestration, Product Tours & Targeted Messages

## Competitive Context

Intercom Series provides a visual multi-step campaign builder spanning email, push, chat, product tours, and mobile carousels with behavior-based branching. Intercom Product Tours ($199/month add-on) delivers step-by-step guided walkthroughs with modals and pointers. Intercom Messages enables targeted in-app messages based on user behavior and attributes.

CLIaaS today has basic campaign create + send, no multi-step orchestration, no visual builder, no product tours, and no targeted in-app messages. This plan closes all three gaps.

---

## 1. Summary of What Exists Today

### Campaign Infrastructure

- **`src/db/schema.ts:1239-1240`** -- Two enums define the campaign domain:
  - `campaignStatusEnum`: `draft`, `scheduled`, `sending`, `sent`, `cancelled`
  - `campaignChannelEnum`: `email`, `sms`, `whatsapp`

- **`src/db/schema.ts:1407-1428`** -- `campaigns` table with: `id`, `workspaceId`, `name`, `channel`, `status`, `subject`, `templateBody`, `templateVariables` (JSONB), `segmentQuery` (JSONB), `scheduledAt`, `sentAt`, `createdBy`, `createdAt`, `updatedAt`. Indexed on `(workspaceId, status)`.

- **`src/db/schema.ts:1430-1449`** -- `campaign_recipients` table with: `id`, `campaignId`, `workspaceId`, `customerId`, `email`, `phone`, `status` (text, not enum), `sentAt`, `deliveredAt`, `openedAt`, `clickedAt`, `error`. Indexed on `campaignId`.

- **`src/lib/campaigns/campaign-store.ts:1-308`** -- JSONL-backed in-memory store. Exports: `getCampaigns()`, `getCampaign()`, `createCampaign()`, `updateCampaign()`, `sendCampaign()`, `getCampaignAnalytics()`. The `sendCampaign()` function creates hardcoded demo recipients and immediately transitions `draft` -> `sending` -> `sent` in a single synchronous call. No real email/SMS delivery. No segment evaluation. No multi-step sequencing.

### Campaign UI

- **`src/app/campaigns/page.tsx:1-10`** -- Server wrapper with `FeatureGate` for `proactive_messaging`.

- **`src/app/campaigns/_content.tsx:1-368`** -- Client component. Flat list of campaigns in a table. Simple create form (name, channel, subject, body). Send button. Analytics panel showing totals (pending/sent/delivered/opened/clicked/failed). No step editor, no visual builder, no branching, no delay controls.

### Campaign API Routes

- **`src/app/api/campaigns/route.ts:1-53`** -- `GET` (list with filters) and `POST` (create). Auth-protected.
- **`src/app/api/campaigns/[id]/send/route.ts:1-27`** -- `POST` to trigger send. Auth-protected.
- **`src/app/api/campaigns/[id]/analytics/route.ts:1-23`** -- `GET` analytics for a campaign. Auth-protected.
- **`src/app/api/campaigns/[id]/route.ts`** -- Single campaign detail.

### Campaign CLI & MCP

- **`cli/commands/campaigns.ts:1-132`** -- Three subcommands: `list`, `create`, `send`. No update, no step management.
- **`cli/mcp/tools/campaigns.ts:1-153`** -- Three tools: `campaign_list`, `campaign_create` (with confirmation), `campaign_send` (with confirmation). No step tools, no tour tools, no message tools.

### Customer Segments (Existing -- Reusable)

- **`src/db/schema.ts:1279-1294`** -- `customer_segments` table with `query` (JSONB), `customerCount`. Already exists but segment evaluation is not implemented (the query JSONB is stored but never executed against the customer table).
- **`src/lib/customers/customer-store.ts:253-272`** -- `getCustomerSegments()`, `createCustomerSegment()`. JSONL-backed. No query evaluation engine.

### Customer Activities (Existing -- Reusable)

- **`src/db/schema.ts:1245-1260`** -- `customer_activities` table with `activityType`, `entityType`, `entityId`, `metadata` (JSONB). Already tracks `ticket_created`, `ticket_resolved`, `page_viewed`, `survey_submitted`.
- **`src/lib/customers/customer-store.ts:205-224`** -- `getCustomerActivities()`, `addCustomerActivity()`.

### Portal (Where Tours/Messages Would Appear)

- **`src/app/portal/layout.tsx:1-68`** -- Portal layout with nav bar. No in-app message container. No tour overlay system.
- **`src/app/portal/page.tsx:1-301`** -- Portal landing (auth check, dashboard, sign-in form). No message injection point.

### Event Pipeline (Existing -- Reusable)

- **`src/lib/events/dispatcher.ts:18-37`** -- Already includes `campaign.created` and `campaign.sent` canonical events. New events like `campaign.step_executed`, `tour.started`, `tour.completed`, `message.displayed`, `message.dismissed` will follow this pattern.

### Job Queue (Existing -- Reusable)

- **`src/lib/queue/types.ts:41-48`** -- Four named queues. Campaign orchestration will need a fifth queue (`campaign-orchestration`) for scheduling delayed steps.

### SDK Channel (Existing -- Reusable for In-App Messages)

- **`sdk/src/index.ts`** -- Embeddable SDK with `init()`, `identify()`, `sendMessage()`, `getMessages()`. Could be extended with `getInAppMessages()`, `dismissMessage()`, `getTour()`, `completeTourStep()`.

### Proactive Intelligence (Adjacent -- Not Directly Reusable)

- **`src/lib/ai/proactive.ts:1-459`** -- Topic spike detection, sentiment analysis, KB gap detection. This is analytics, not orchestration. Could feed into campaign trigger conditions in the future but is not a prerequisite.

### What Is Completely Missing

- No campaign steps / sequence model
- No step types (email, in-app, wait, condition, branch)
- No visual campaign builder (drag-and-drop canvas)
- No campaign execution engine (step-by-step orchestration with delays)
- No segment evaluation engine (the `segmentQuery` JSONB is dead data)
- No product tours table, store, or UI
- No tour builder (define steps targeting DOM elements)
- No in-app message table, store, or UI
- No message types (banner, modal, tooltip, slide-in)
- No frequency controls (rate limiting, deduplication)
- No campaign funnel analytics (per-step conversion)
- No portal/widget integration for tours or messages
- No SDK extensions for in-app messaging
- No CLI commands for tours or messages
- No MCP tools for tours, messages, or campaign steps

---

## 2. Proposed DB Schema Changes

### 2.1 Modify Existing Enums

```sql
-- Extend campaign_channel to support in-app messaging
ALTER TYPE campaign_channel ADD VALUE 'in_app';
ALTER TYPE campaign_channel ADD VALUE 'push';

-- Extend campaign_status for orchestrated sequences
ALTER TYPE campaign_status ADD VALUE 'active';
ALTER TYPE campaign_status ADD VALUE 'paused';
ALTER TYPE campaign_status ADD VALUE 'completed';
```

### 2.2 New Enums

```sql
CREATE TYPE campaign_step_type AS ENUM (
  'send_email',
  'send_sms',
  'send_in_app',
  'send_push',
  'wait_delay',
  'wait_event',
  'condition',
  'branch',
  'update_tag',
  'webhook'
);

CREATE TYPE campaign_step_status AS ENUM (
  'pending',
  'active',
  'completed',
  'skipped',
  'failed'
);

CREATE TYPE in_app_message_type AS ENUM (
  'banner',
  'modal',
  'tooltip',
  'slide_in'
);

CREATE TYPE tour_step_position AS ENUM (
  'top',
  'bottom',
  'left',
  'right',
  'center'
);
```

### 2.3 New Tables

#### `campaign_steps` (Multi-step orchestration)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `campaign_id` | uuid FK -> campaigns | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `step_type` | campaign_step_type | send_email, wait_delay, condition, etc. |
| `position` | integer | Ordering within the sequence |
| `name` | text | Human label, e.g. "Welcome email" |
| `config` | jsonb | Step-type-specific configuration (see below) |
| `delay_seconds` | integer | For wait_delay steps |
| `condition_query` | jsonb | For condition/branch steps |
| `next_step_id` | uuid FK -> campaign_steps (nullable) | Default next step |
| `branch_true_step_id` | uuid FK -> campaign_steps (nullable) | For condition: true branch |
| `branch_false_step_id` | uuid FK -> campaign_steps (nullable) | For condition: false branch |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index: `(campaign_id, position)`

**`config` JSONB structure by step_type:**
- `send_email`: `{ subject, templateBody, templateVariables }`
- `send_sms`: `{ templateBody }`
- `send_in_app`: `{ messageType, title, body, ctaText, ctaUrl, position }`
- `send_push`: `{ title, body, url }`
- `wait_delay`: `{ seconds }` (also in dedicated column for queries)
- `wait_event`: `{ eventType, timeout_seconds }`
- `condition`: `{ field, operator, value }` (e.g. `{ field: "opened_email", operator: "eq", value: true }`)
- `branch`: `{ conditions: [...], defaultStepId }`
- `update_tag`: `{ addTags, removeTags }`
- `webhook`: `{ url, method, headers, body }`

#### `campaign_enrollments` (Per-customer journey state)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `campaign_id` | uuid FK -> campaigns | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `customer_id` | uuid FK -> customers | |
| `current_step_id` | uuid FK -> campaign_steps (nullable) | Where the customer is |
| `status` | text | `active`, `completed`, `exited`, `failed` |
| `enrolled_at` | timestamptz | |
| `completed_at` | timestamptz (nullable) | |
| `next_execution_at` | timestamptz (nullable) | When the next step fires |
| `metadata` | jsonb | Per-enrollment state (e.g. variables resolved) |

Indexes: `(campaign_id, status)`, `(customer_id)`, `(next_execution_at)` (for scheduler polling)

#### `campaign_step_events` (Execution log -- per-step analytics)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enrollment_id` | uuid FK -> campaign_enrollments | |
| `step_id` | uuid FK -> campaign_steps | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `event_type` | text | `executed`, `sent`, `delivered`, `opened`, `clicked`, `bounced`, `skipped`, `failed` |
| `metadata` | jsonb | Error details, delivery receipts, etc. |
| `created_at` | timestamptz | |

Index: `(step_id, event_type)`, `(enrollment_id)`

#### `product_tours` (Tour definitions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `name` | text | |
| `description` | text (nullable) | |
| `target_url_pattern` | text | Glob or regex for which page(s) the tour applies to |
| `segment_query` | jsonb | Which customers see the tour |
| `is_active` | boolean | |
| `priority` | integer | For ordering when multiple tours match |
| `created_by` | uuid FK -> users (nullable) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index: `(workspace_id, is_active)`

#### `product_tour_steps` (Tour step definitions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tour_id` | uuid FK -> product_tours | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `position` | integer | Step order |
| `target_selector` | text | CSS selector for the target element |
| `title` | text | |
| `body` | text | |
| `placement` | tour_step_position | top, bottom, left, right, center |
| `highlight_target` | boolean | Whether to spotlight/dim-around the element |
| `action_label` | text | e.g. "Next", "Got it", "Try it" |
| `created_at` | timestamptz | |

Index: `(tour_id, position)`

#### `product_tour_progress` (Per-customer tour state)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tour_id` | uuid FK -> product_tours | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `customer_id` | uuid FK -> customers | |
| `current_step` | integer | 0-based index |
| `status` | text | `in_progress`, `completed`, `dismissed` |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz (nullable) | |

Unique: `(tour_id, customer_id)`

#### `in_app_messages` (Targeted message definitions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `name` | text | |
| `message_type` | in_app_message_type | banner, modal, tooltip, slide_in |
| `title` | text | |
| `body` | text | Supports markdown |
| `cta_text` | text (nullable) | Call-to-action button label |
| `cta_url` | text (nullable) | |
| `target_url_pattern` | text | Which pages show this message |
| `segment_query` | jsonb | Which customers see this |
| `is_active` | boolean | |
| `priority` | integer | |
| `start_at` | timestamptz (nullable) | Scheduling window start |
| `end_at` | timestamptz (nullable) | Scheduling window end |
| `max_impressions` | integer | Per-customer frequency cap (0 = unlimited) |
| `created_by` | uuid FK -> users (nullable) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index: `(workspace_id, is_active)`

#### `in_app_message_impressions` (Frequency control)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `message_id` | uuid FK -> in_app_messages | |
| `workspace_id` | uuid FK -> workspaces | RLS |
| `customer_id` | uuid FK -> customers | |
| `action` | text | `displayed`, `dismissed`, `clicked`, `cta_clicked` |
| `created_at` | timestamptz | |

Index: `(message_id, customer_id)`, `(customer_id)`
Unique (optional): Could add `(message_id, customer_id)` unique for "show once" messages, but `max_impressions` provides finer control.

**Total new tables: 7**
**Total new enums: 4**
**Modified enums: 2**

### 2.4 JSONL Store Additions (Demo/BYOC Mode)

New JSONL files following existing pattern:
- `campaign-steps.jsonl`
- `campaign-enrollments.jsonl`
- `campaign-step-events.jsonl`
- `product-tours.jsonl`
- `product-tour-steps.jsonl`
- `product-tour-progress.jsonl`
- `in-app-messages.jsonl`
- `in-app-message-impressions.jsonl`

### 2.5 Modifications to Existing Tables

- **`campaigns` table**: Add `entry_step_id` (uuid FK -> campaign_steps, nullable) to designate the first step of a multi-step sequence. Existing single-step campaigns (no entry_step_id) continue to work as-is.
- **`campaigns` table**: The existing `segmentQuery` JSONB becomes the enrollment filter for multi-step campaigns.

---

## 3. New API Routes

### 3.1 Campaign Steps

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/campaigns/[id]/steps` | List steps for a campaign (ordered) |
| POST | `/api/campaigns/[id]/steps` | Create a new step |
| PUT | `/api/campaigns/[id]/steps/[stepId]` | Update a step |
| DELETE | `/api/campaigns/[id]/steps/[stepId]` | Delete a step |
| POST | `/api/campaigns/[id]/steps/reorder` | Reorder steps (accepts `{ stepIds: string[] }`) |

### 3.2 Campaign Orchestration Control

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/campaigns/[id]/activate` | Start the campaign (enroll matching segment) |
| POST | `/api/campaigns/[id]/pause` | Pause (stop executing next steps) |
| POST | `/api/campaigns/[id]/resume` | Resume a paused campaign |
| GET | `/api/campaigns/[id]/enrollments` | List enrollments with status/step info |
| GET | `/api/campaigns/[id]/funnel` | Per-step funnel analytics |

### 3.3 Segment Evaluation

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/segments/evaluate` | Evaluate a segment query, return matching customer count + sample |
| POST | `/api/segments/preview` | Dry-run: show which customers would match |

### 3.4 Product Tours

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/tours` | List all tours |
| POST | `/api/tours` | Create a tour |
| GET | `/api/tours/[id]` | Get tour detail with steps |
| PUT | `/api/tours/[id]` | Update tour metadata |
| DELETE | `/api/tours/[id]` | Delete a tour |
| POST | `/api/tours/[id]/steps` | Add a step to a tour |
| PUT | `/api/tours/[id]/steps/[stepId]` | Update a tour step |
| DELETE | `/api/tours/[id]/steps/[stepId]` | Delete a tour step |
| POST | `/api/tours/[id]/steps/reorder` | Reorder tour steps |
| POST | `/api/tours/[id]/toggle` | Toggle active/inactive |

### 3.5 Portal/SDK Tour & Message Delivery

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/portal/tours/active` | Get active tour for current page + customer |
| POST | `/api/portal/tours/[id]/progress` | Report step completion/dismissal |
| GET | `/api/portal/messages/active` | Get in-app messages for current page + customer |
| POST | `/api/portal/messages/[id]/impression` | Record display/dismiss/click |

### 3.6 In-App Messages

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/messages` | List all targeted messages |
| POST | `/api/messages` | Create a targeted message |
| GET | `/api/messages/[id]` | Get message detail |
| PUT | `/api/messages/[id]` | Update message |
| DELETE | `/api/messages/[id]` | Delete message |
| POST | `/api/messages/[id]/toggle` | Toggle active/inactive |
| GET | `/api/messages/[id]/analytics` | Impression/click/dismiss counts |

### 3.7 Campaign Webhook Tracking

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/campaigns/track/open/[recipientId]` | 1x1 pixel open tracking |
| GET | `/api/campaigns/track/click/[recipientId]` | Click-through redirect tracking |

**Total new routes: ~30**

---

## 4. New/Modified UI Pages & Components

### 4.1 New Pages

| Route | Description |
|-------|-------------|
| `/campaigns/[id]` | Campaign detail with step editor (the visual builder) |
| `/campaigns/[id]/analytics` | Funnel analytics (per-step conversion, enrollment timeline) |
| `/tours` | Product tours management page (list + create) |
| `/tours/[id]` | Tour builder (step editor with preview) |
| `/messages` | Targeted in-app messages management (list + create) |
| `/messages/[id]` | Message detail with analytics |

### 4.2 New Components

| Component | Purpose |
|-----------|---------|
| `src/components/campaigns/StepEditor.tsx` | Visual campaign step builder. Canvas-style layout with step cards connected by arrows. Drag-and-drop reordering. Click to configure each step. |
| `src/components/campaigns/StepCard.tsx` | Individual step card (icon by type, name, config summary, delete button) |
| `src/components/campaigns/StepConfigPanel.tsx` | Side panel that opens when a step is selected. Different form fields per step type. |
| `src/components/campaigns/FunnelChart.tsx` | Horizontal funnel visualization. Per-step bars with counts and conversion percentages. |
| `src/components/campaigns/SegmentPicker.tsx` | Reusable segment query builder. Field + operator + value rows. Preview button. |
| `src/components/campaigns/EnrollmentTable.tsx` | Table of enrolled customers with status, current step, timestamps. |
| `src/components/tours/TourBuilder.tsx` | Tour step editor. List of steps with target selector input, placement picker, title/body editors. |
| `src/components/tours/TourPreview.tsx` | In-editor preview rendering (shows a mock DOM with pointer/overlay). |
| `src/components/tours/TourOverlay.tsx` | Client component rendered in the portal layout. Checks for active tour, renders spotlight + tooltip on the target element. |
| `src/components/messages/MessageEditor.tsx` | Form for creating/editing in-app messages. Type picker, content fields, scheduling, frequency cap. |
| `src/components/messages/MessagePreview.tsx` | Live preview of banner/modal/tooltip/slide-in appearance. |
| `src/components/messages/InAppMessageRenderer.tsx` | Client component rendered in the portal layout. Fetches active messages, renders them with the correct type (banner at top, modal centered, tooltip anchored, slide-in from edge). |

### 4.3 Modified Pages/Components

| File | Change |
|------|--------|
| `src/app/campaigns/_content.tsx` | Add "Edit Steps" button per campaign linking to `/campaigns/[id]`. Add status badges for new statuses (`active`, `paused`, `completed`). Campaign type indicator (simple vs. multi-step). |
| `src/app/campaigns/page.tsx` | No change (FeatureGate wrapper stays). |
| `src/app/portal/layout.tsx` | Add `<TourOverlay />` and `<InAppMessageRenderer />` client components inside the layout, after `{children}`. These fetch and render tours/messages contextually. |
| `src/components/AppNav.tsx` | Add nav items for "Tours" and "Messages" under the Proactive section (gated by `proactive_messaging`). |
| `src/lib/features/gates.ts` | Add `product_tours` and `targeted_messages` features (or keep under `proactive_messaging` umbrella -- recommendation: keep under `proactive_messaging` for simplicity). |

### 4.4 Visual Builder Design

The visual builder is NOT a full-blown drag-and-drop canvas like Intercom's (that would be XL effort alone). Instead, it is a **linear step list with branching indicators**:

```
[Step 1: Send Email] -----> [Step 2: Wait 2 days] -----> [Step 3: Condition]
                                                              |
                                                         Yes -+-> [Step 4a: Send In-App]
                                                         No  -+-> [Step 4b: Send Email]
```

- Steps are rendered as cards in a vertical list
- Branch steps show two outgoing paths
- Drag handles for reordering
- Click a step to open the config panel on the right
- "Add Step" button between steps with a step-type picker dropdown

This is achievable with pure CSS/Tailwind + state management. No external canvas library needed. A future iteration could upgrade to a full node-based graph editor (e.g., ReactFlow), but that is out of scope for v1.

---

## 5. New CLI Commands

### 5.1 Campaign Steps

```
cliaas campaigns steps <campaignId>          # List steps
cliaas campaigns add-step <campaignId>       # Add a step (interactive or with flags)
  --type <step_type>
  --name <name>
  --position <n>
  --config <json>
  --delay <seconds>
cliaas campaigns remove-step <stepId>        # Remove a step
cliaas campaigns activate <campaignId>       # Start campaign orchestration
cliaas campaigns pause <campaignId>          # Pause
cliaas campaigns resume <campaignId>         # Resume
cliaas campaigns funnel <campaignId>         # Show per-step funnel analytics
```

### 5.2 Product Tours

```
cliaas tours list                            # List tours
cliaas tours create                          # Create a tour
  --name <name>
  --url-pattern <pattern>
cliaas tours show <tourId>                   # Show tour with steps
cliaas tours add-step <tourId>               # Add a tour step
  --selector <css>
  --title <title>
  --body <body>
  --placement <position>
cliaas tours toggle <tourId>                 # Toggle active/inactive
```

### 5.3 Targeted Messages

```
cliaas messages list                         # List in-app messages
cliaas messages create                       # Create a message
  --name <name>
  --type <banner|modal|tooltip|slide_in>
  --title <title>
  --body <body>
  --url-pattern <pattern>
  --max-impressions <n>
cliaas messages toggle <messageId>           # Toggle active/inactive
cliaas messages analytics <messageId>        # Show impression/click stats
```

**Total new CLI subcommands: ~16**

---

## 6. New MCP Tools

### 6.1 Campaign Orchestration Tools

| Tool | Description |
|------|-------------|
| `campaign_steps_list` | List steps for a campaign |
| `campaign_step_add` | Add a step to a campaign (with confirmation) |
| `campaign_step_update` | Update step configuration (with confirmation) |
| `campaign_step_remove` | Remove a step (with confirmation) |
| `campaign_activate` | Activate a campaign (enroll segment, with confirmation) |
| `campaign_pause` | Pause a running campaign |
| `campaign_resume` | Resume a paused campaign |
| `campaign_funnel` | Get per-step funnel analytics |
| `campaign_enrollments` | List enrollments with status |

### 6.2 Product Tour Tools

| Tool | Description |
|------|-------------|
| `tour_list` | List product tours |
| `tour_create` | Create a new tour (with confirmation) |
| `tour_update` | Update tour metadata |
| `tour_step_add` | Add a step to a tour (with confirmation) |
| `tour_step_update` | Update a tour step |
| `tour_toggle` | Toggle tour active/inactive |

### 6.3 Targeted Message Tools

| Tool | Description |
|------|-------------|
| `message_list` | List in-app messages |
| `message_create` | Create a targeted message (with confirmation) |
| `message_update` | Update a message |
| `message_toggle` | Toggle message active/inactive |
| `message_analytics` | Get impression/click/dismiss stats |

### 6.4 Segment Tools

| Tool | Description |
|------|-------------|
| `segment_evaluate` | Evaluate a segment query, return matching count |
| `segment_preview` | Preview matching customers |

**Total new MCP tools: ~21**

---

## 7. Business Logic Modules

### 7.1 Campaign Orchestration Engine

**File: `src/lib/campaigns/orchestration.ts`**

Core responsibilities:
- **Enrollment**: Given a campaign with steps and a segment query, evaluate the segment and create `campaign_enrollments` for matching customers, pointing `current_step_id` at the entry step.
- **Step execution**: For each enrollment ready to execute (current time >= `next_execution_at`), run the step:
  - `send_email`: Enqueue via `email-send` queue or inline `sendEmail()`.
  - `send_sms`: Call Twilio `sendSms()`.
  - `send_in_app`: Insert into `in_app_messages` or create a per-customer delivery record.
  - `wait_delay`: Set `next_execution_at` to `now + delay_seconds`.
  - `wait_event`: Set `next_execution_at` to a timeout; if the event fires before then, advance.
  - `condition`: Evaluate the condition against customer data; branch to true/false step.
  - `branch`: Multi-way condition.
  - `update_tag`: Add/remove tags on the customer.
  - `webhook`: POST to URL.
- **Advancement**: After step execution, record a `campaign_step_events` entry, update `current_step_id` to the next step (or mark enrollment `completed` if no next step).
- **Scheduling**: A `processCampaignTick()` function called by the job queue worker (or `setInterval` fallback) every 60 seconds. Queries enrollments where `next_execution_at <= now AND status = 'active'`.

### 7.2 Segment Evaluation Engine

**File: `src/lib/segments/evaluator.ts`**

Evaluates a `segmentQuery` JSONB against the customer table. Supported operators:
- `eq`, `neq`, `gt`, `gte`, `lt`, `lte` (for scalar fields)
- `contains`, `not_contains` (for text/array fields)
- `in`, `not_in` (for enum fields)
- `exists`, `not_exists` (for nullable fields)
- `and`, `or` (logical combinators)

Queryable fields:
- Customer attributes: `email`, `name`, `plan`, `locale`, `timezone`, `signupDate`, `lastSeenAt`
- Custom attributes: `customAttributes.*`
- Tags: `tags`
- Activity-based: `ticketCount`, `lastTicketAt`, `totalSpend`
- Segment membership: `inSegment(segmentId)`

In JSONL mode: iterate all customers and filter in-memory.
In DB mode: build a Drizzle `where()` clause dynamically.

### 7.3 Campaign Orchestration Worker

**File: `src/lib/queue/workers/campaign-worker.ts`**

New BullMQ worker for the `campaign-orchestration` queue. Concurrency: 1 (serialized to prevent race conditions on enrollment state).

### 7.4 Tour/Message Delivery Logic

**File: `src/lib/tours/tour-service.ts`**
**File: `src/lib/messages/message-service.ts`**

- `getActiveTourForCustomer(customerId, currentUrl)`: Find a matching active tour the customer hasn't completed/dismissed, respecting priority ordering.
- `getActiveMessagesForCustomer(customerId, currentUrl)`: Find matching active messages respecting frequency caps (count impressions in `in_app_message_impressions`), time windows, and priority ordering.

### 7.5 New Queue

Add `CAMPAIGN_ORCHESTRATION: 'campaign-orchestration'` to `QUEUE_NAMES` in `src/lib/queue/types.ts`. Add `CampaignOrchestrationJob` interface. Add `getCampaignQueue()` accessor. Add worker.

### 7.6 New Events

Add to `CanonicalEvent` in `src/lib/events/dispatcher.ts`:
- `campaign.activated`
- `campaign.paused`
- `campaign.step_executed`
- `campaign.enrollment_completed`
- `tour.started`
- `tour.completed`
- `tour.dismissed`
- `message.displayed`
- `message.clicked`
- `message.dismissed`

### 7.7 SDK Extensions

Add to `sdk/src/index.ts`:
- `getActiveTour()`: Fetch the active tour for the current page.
- `reportTourProgress(tourId, step, action)`: Report step completion/dismissal.
- `getActiveMessages()`: Fetch in-app messages for the current page.
- `reportMessageImpression(messageId, action)`: Record display/dismiss/click.

---

## 8. Migration/Rollout Plan

### Phase 1: Foundation (Week 1-2) -- Size: L

1. **DB migration**: Create 7 new tables, 4 new enums, extend 2 existing enums. Add `entry_step_id` column to `campaigns`.
2. **JSONL stores**: Create store modules for all new entities following existing pattern.
3. **Segment evaluation engine**: Build `src/lib/segments/evaluator.ts` with in-memory (JSONL) and DB modes.
4. **Campaign steps CRUD**: API routes, CLI commands, MCP tools for campaign step management.
5. **Tests**: Unit tests for segment evaluator, step CRUD, store modules.

### Phase 2: Orchestration Engine (Week 3-4) -- Size: L

1. **Orchestration engine**: `src/lib/campaigns/orchestration.ts` with enrollment, step execution, advancement.
2. **Campaign worker**: BullMQ worker + `setInterval` fallback for `processCampaignTick()`.
3. **Email/SMS step execution**: Wire send_email and send_sms steps to existing email-worker and Twilio.
4. **Activate/pause/resume**: API routes and CLI/MCP tools for campaign lifecycle.
5. **Step event logging**: Record execution events in `campaign_step_events`.
6. **Tests**: Integration tests for orchestration flow (enroll -> execute steps -> complete).

### Phase 3: Campaign UI (Week 5-6) -- Size: L

1. **Campaign detail page** (`/campaigns/[id]`): Step editor UI with linear step list, config panel.
2. **Step type forms**: Different config forms for each step type.
3. **Segment picker**: Reusable component for building segment queries with field/operator/value rows.
4. **Funnel analytics page** (`/campaigns/[id]/analytics`): Per-step conversion chart.
5. **Enrollment table**: Customer enrollment list with status.
6. **Update campaign list**: Add new statuses, type indicator, edit link.

### Phase 4: Product Tours (Week 7-8) -- Size: M

1. **Tour CRUD**: API routes, stores, CLI, MCP tools.
2. **Tour builder page** (`/tours/[id]`): Step editor with selector input, placement picker, preview.
3. **Tour overlay component**: `TourOverlay.tsx` for portal layout.
4. **Portal delivery routes**: `GET /api/portal/tours/active`, `POST /api/portal/tours/[id]/progress`.
5. **Tour progress tracking**: `product_tour_progress` table management.
6. **Tests**: Tour creation, delivery, progress tracking.

### Phase 5: Targeted Messages (Week 8-9) -- Size: M

1. **Message CRUD**: API routes, stores, CLI, MCP tools.
2. **Message editor page** (`/messages/[id]`): Type picker, content fields, scheduling, frequency cap.
3. **In-app message renderer**: `InAppMessageRenderer.tsx` for portal layout with banner/modal/tooltip/slide-in rendering.
4. **Portal delivery routes**: `GET /api/portal/messages/active`, `POST /api/portal/messages/[id]/impression`.
5. **Frequency controls**: Impression counting, `max_impressions` enforcement.
6. **Message analytics**: Impression/click/dismiss aggregation.
7. **Tests**: Message creation, delivery, frequency limiting.

### Phase 6: SDK & Polish (Week 9-10) -- Size: S

1. **SDK extensions**: `getActiveTour()`, `reportTourProgress()`, `getActiveMessages()`, `reportMessageImpression()`.
2. **Open/click tracking**: Pixel tracking for email opens, redirect tracking for clicks.
3. **Event integration**: Wire all new canonical events into the dispatcher.
4. **Nav updates**: Add Tours and Messages to AppNav.
5. **Demo data**: Seed demo tours, messages, and a multi-step campaign for the demo experience.
6. **Documentation**: Update ARCHITECTURE.md with new tables, routes, tools.

### Migration Safety

- All new tables are additive -- no existing table modifications except adding nullable `entry_step_id` to `campaigns`.
- Existing single-step campaigns continue to work unmodified (no `entry_step_id` = legacy behavior).
- The `campaignStatusEnum` additions (`active`, `paused`, `completed`) are backwards-compatible (existing campaigns stay in their current status).
- JSONL mode stores are fully independent -- no migration needed for demo/BYOC mode.
- DB migration file: `drizzle/0005_campaign_orchestration.sql`

---

## 9. Effort Estimate

| Phase | Scope | Size | Estimated Effort |
|-------|-------|------|------------------|
| 1. Foundation | Schema, stores, segment engine, step CRUD | L | 2 weeks |
| 2. Orchestration Engine | Execution engine, worker, lifecycle | L | 2 weeks |
| 3. Campaign UI | Visual builder, funnel analytics, segment picker | L | 2 weeks |
| 4. Product Tours | Tour CRUD, builder, overlay, progress | M | 1.5 weeks |
| 5. Targeted Messages | Message CRUD, renderer, frequency control | M | 1.5 weeks |
| 6. SDK & Polish | SDK extensions, tracking, events, demo data | S | 1 week |
| **Total** | | **XL** | **~10 weeks** |

### Overall: **XL**

This is the largest competitive gap to close. The campaign orchestration engine alone (phases 1-3) is a substantial backend + frontend effort. Product tours and targeted messages (phases 4-5) are each medium features that share the segment evaluation infrastructure built in phase 1.

### Risk Factors

- **Segment evaluator complexity**: Dynamic query building against both JSONL and Drizzle is non-trivial. Keep the operator set small in v1.
- **Campaign worker reliability**: Must handle process restarts gracefully. Enrollments store `next_execution_at` in the DB, so the worker can resume after restart by re-querying.
- **Visual builder scope creep**: The linear step list is deliberately simpler than a full node graph. Resist the urge to build a ReactFlow canvas in v1.
- **Tour overlay cross-browser**: CSS selectors targeting third-party DOM elements can be fragile. Provide a "manual position" fallback.
- **Email deliverability**: Open/click tracking requires a tracking domain and pixel serving. This is infrastructure work beyond code.

### Dependencies

- **Segment evaluator** is a prerequisite for campaigns, tours, and messages. Build it first.
- **Campaign worker** depends on the existing BullMQ infrastructure (already in place).
- **Tour overlay** and **message renderer** depend on the portal layout (already in place).
- **SDK extensions** depend on the portal delivery routes.

### What This Does NOT Include

- Full ReactFlow-style visual canvas builder (v2)
- A/B testing within campaign steps (v2)
- Mobile push notification infrastructure (requires APNS/FCM setup)
- SMS sender ID / short code provisioning
- Email template designer (WYSIWYG HTML editor)
- Multi-language tour/message content
- Webhook-triggered campaign enrollment (v2 -- currently only segment-based)
