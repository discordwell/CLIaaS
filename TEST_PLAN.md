# CLIaaS Comprehensive Test Plan

> Post-20-Plan Implementation Verification
> Created: 2026-03-06

## Scope

592 files changed across 20 feature plans, 27 migrations, 86 DB tables, 191 API routes, 110 MCP tools. This plan covers unit, integration, security, and wet tests to validate the entire surface area.

---

## Phase 1: Schema & Migration Integrity

### 1.1 Migration Sequence Validation
- [ ] All 27 migrations apply cleanly in sequence on a fresh database
- [ ] Duplicate migration numbers (0014, 0022) don't conflict
- [ ] `IF NOT EXISTS` guards make all migrations idempotent (re-run without error)
- [ ] Foreign key references resolve (no dangling `REFERENCES` to missing tables)
- [ ] All `uniqueIndex` definitions in Drizzle schema match SQL migration indexes

### 1.2 Schema-Migration Parity
- [ ] Every table in `src/db/schema.ts` has a corresponding migration
- [ ] Column types in Drizzle match SQL (boolean defaults, timestamp timezone, UUID generation)
- [ ] All 86 tables exportable from schema without TypeScript errors
- [ ] Drizzle `push` dry-run produces zero diff against migrated DB

### 1.3 RLS Coverage
- [ ] All workspace-scoped tables have RLS policies in `0026_rls_big_bang.sql`
- [ ] `FORCE ROW LEVEL SECURITY` set on every RLS-enabled table
- [ ] `connector_capabilities` (0027) included in RLS policies
- [ ] No table with `workspace_id` column is missing an RLS policy

---

## Phase 2: Data Layer (Dual-Mode Stores)

### 2.1 JSONL Store Correctness
For each dual-mode store (tickets, messages, customers, canned, macros, chatbots, forums, tours, views, signatures):
- [ ] Create → read-back returns identical data
- [ ] Update merges fields correctly (partial update, not full replace)
- [ ] Delete removes from JSONL file
- [ ] List with workspace filtering returns only matching records
- [ ] File corruption recovery (truncated line, invalid JSON)

### 2.2 DB Store Correctness (withRls paths)
For each store with `withRls()`:
- [ ] CRUD operations work within RLS transaction scope
- [ ] Operations fail gracefully when `workspaceId` is missing
- [ ] Cross-workspace reads return empty (not error)
- [ ] Concurrent writes don't corrupt data (optimistic locking where applicable)

### 2.3 Dual-Mode Fallback
- [ ] When `DATABASE_URL` is unset, all stores fall back to JSONL
- [ ] When `DATABASE_URL` is set, DB path is preferred
- [ ] Hybrid mode: local writes queue for upstream sync
- [ ] Store singleton pattern survives Next.js HMR (`global.__cliaa*`)

---

## Phase 3: API Route Tests (by Feature Area)

### 3.1 AI & Resolution (Plan 1)
- [ ] `POST /api/ai/resolve` — triggers resolution pipeline, returns resolution ID
- [ ] `GET /api/ai/resolutions` — lists pending/approved/rejected resolutions
- [ ] `POST /api/ai/resolutions/[id]/approve` — marks approved, triggers reply send
- [ ] `POST /api/ai/resolutions/[id]/reject` — marks rejected with reason
- [ ] `GET /api/ai/resolutions/stats` — returns accurate counts by status
- [ ] `GET /api/ai/config` — returns provider config
- [ ] `PUT /api/ai/config` — updates provider, validates API key format
- [ ] `POST /api/ai/procedures/[id]` — executes procedure against ticket
- [ ] Resolution pipeline: AI agent → draft → approval queue → reply dispatch
- [ ] ROI tracker persists stats across requests

### 3.2 Routing (Plan 2)
- [ ] `POST /api/routing/route-ticket` — assigns agent based on strategy
- [ ] Round-robin strategy distributes evenly
- [ ] Skill-based strategy matches required skills
- [ ] Least-load strategy picks agent with fewest open tickets
- [ ] `GET /api/routing/queues` — returns queue depths
- [ ] `GET /api/routing/config` — returns routing rules
- [ ] Agent availability toggle affects routing decisions
- [ ] Capacity limits respected (agent at max → skipped)

### 3.3 Workflow & Automation (Plan 3)
- [ ] `POST /api/rules` — creates rule with conditions and actions
- [ ] `POST /api/rules/dry-run` — evaluates conditions without side effects
- [ ] `GET /api/rules/[id]/versions` — returns version history
- [ ] `GET /api/rules/[id]/executions` — returns execution log
- [ ] Rule triggers fire on matching events (ticket.created, message.created, etc.)
- [ ] Actions execute: assign, update status, add tag, send reply, webhook
- [ ] Workflow node types: trigger, condition, action, delay, webhook, notification, loop, end
- [ ] Workflow decomposer converts workflow → rules correctly
- [ ] Workflow optimizer eliminates dead code

### 3.4 Marketplace & Plugins (Plan 4)
- [ ] `POST /api/marketplace/[pluginId]/install` — installs plugin
- [ ] `DELETE /api/plugins/[id]` — uninstalls cleanly
- [ ] `POST /api/plugins/[id]/execute` — runs sandboxed code
- [ ] `GET /api/plugins/[id]/logs` — returns execution history
- [ ] `POST /api/plugins/[id]/credentials` — stores encrypted credentials
- [ ] Plugin SDK context provides correct permissions based on manifest
- [ ] Sandbox timeout enforced at 5 seconds
- [ ] Sandbox blocks: require, process, global, setTimeout
- [ ] Webhook execution timeout at 10 seconds

### 3.5 WFM (Plan 5)
- [ ] `POST /api/wfm/schedules` — creates agent schedule
- [ ] `GET /api/wfm/adherence` — returns real-time adherence data
- [ ] `GET /api/wfm/forecast` — returns staffing forecast
- [ ] `POST /api/wfm/time-off` — submits time-off request
- [ ] `PUT /api/wfm/time-off/[id]` — approve/deny with reason
- [ ] `GET /api/wfm/utilization` — returns agent utilization metrics
- [ ] `POST /api/wfm/volume/collect` — collects volume snapshot
- [ ] Schedule template → schedule generation works
- [ ] SSE alerts for adherence violations

### 3.6 Connector Write-Depth (Plan 6)
- [ ] `GET /api/connectors/capabilities` — returns capability matrix per connector
- [ ] `POST /api/connectors/[name]/verify` — tests connection
- [ ] `GET /api/connectors/health` — returns sync health for all connectors
- [ ] Upstream outbox: changes queue and flush to external system
- [ ] Zendesk adapter: read, update, reply, note all functional
- [ ] Freshdesk adapter: same write operations
- [ ] Connector capabilities table matches actual adapter capabilities

### 3.7 Canned Responses & Macros (Plan 7)
- [ ] `POST /api/canned-responses` — creates template with merge variables
- [ ] `POST /api/canned-responses/[id]/resolve` — resolves variables against ticket
- [ ] `GET /api/canned-responses` — lists with search/filter
- [ ] `POST /api/macros` — creates macro with action sequence
- [ ] `POST /api/macros/[id]/apply` — applies macro to ticket (status, tags, reply)
- [ ] MacroButton component renders in TicketActions
- [ ] Merge variable engine handles: `{{ticket.subject}}`, `{{customer.name}}`, etc.
- [ ] Merge variable engine rejects prototype pollution (`__proto__`, `constructor`)

### 3.8 Collision Detection (Plan 8)
- [ ] `GET /api/tickets/[id]/collision-check?since=` — detects new replies
- [ ] `POST /api/presence` — broadcasts typing/viewing activity
- [ ] SSE `/api/events` — streams events scoped to workspace
- [ ] TicketActions shows warning banner when SSE reports new reply
- [ ] CollisionWarningModal offers discard/send-anyway/review options
- [ ] Presence tracker cleans up stale viewers (TTL expiry)
- [ ] Typing indicator broadcasts throttled to 3-second intervals

### 3.9 Internal Notes & Side Conversations (Plan 9)
- [ ] `POST /api/tickets/[id]/notes` — creates internal note (not visible to customer)
- [ ] Notes support @mentions with user ID extraction
- [ ] Mention creates notification for mentioned user
- [ ] `POST /api/tickets/[id]/side-conversations` — creates side thread
- [ ] `POST /api/tickets/[id]/side-conversations/[scId]/reply` — replies to thread
- [ ] Side conversation email inbound routes to correct thread
- [ ] Note visibility: internal notes hidden from portal API

### 3.10 Ticket Merge & Split (Plan 10)
- [ ] `POST /api/tickets/merge` — merges tickets, preserves message history
- [ ] `POST /api/tickets/merge/undo` — restores original tickets
- [ ] `POST /api/tickets/[id]/split` — splits ticket into new ticket
- [ ] Merge log tracks source/target with timestamp
- [ ] Split log tracks parent/child relationship
- [ ] Merged ticket messages appear in chronological order
- [ ] Automation events fire on merge/split (ticket.merged, ticket.split)

### 3.11 Views, Filters & Tags (Plan 11)
- [ ] `POST /api/views` — creates saved view with filter conditions
- [ ] `GET /api/views/[id]/tickets` — executes view query, returns matching tickets
- [ ] `GET /api/views/[id]/count` — returns count without loading tickets
- [ ] `GET /api/views/preview-count` — previews count before saving
- [ ] `POST /api/tags` — creates tag with optional color
- [ ] `POST /api/tickets/bulk/tags` — bulk add/remove tags
- [ ] Tag autocomplete returns matching tags
- [ ] View filters: status, priority, assignee, tag, date range, custom field

### 3.12 Business Hours (Plan 12)
- [ ] `POST /api/business-hours` — creates schedule (timezone, day/hour ranges)
- [ ] `GET /api/business-hours/[id]/check` — checks if given time is within hours
- [ ] `POST /api/holidays` — creates holiday calendar
- [ ] `POST /api/holidays/[id]/entries` — adds holiday dates
- [ ] Holiday presets available (US, UK, etc.)
- [ ] SLA calculation respects business hours (pause outside hours)
- [ ] Business hours linked to holiday calendars

### 3.13 Custom Reports (Plan 13)
- [ ] `POST /api/reports` — creates report definition
- [ ] `POST /api/reports/[id]/execute` — runs report, returns data
- [ ] `POST /api/reports/[id]/export` — exports as CSV/JSON
- [ ] `GET /api/reports/share/[token]` — public report access via token
- [ ] `POST /api/report-schedules` — schedules recurring delivery
- [ ] Dashboard widgets aggregate metrics correctly
- [ ] Live metrics endpoint returns real-time data
- [ ] Drill-down returns filtered subset

### 3.14 KB Enhancements (Plan 14)
- [ ] `POST /api/kb/[id]/translations` — creates article translation
- [ ] `GET /api/kb/content-gaps` — identifies topics without articles
- [ ] `POST /api/portal/kb/[id]/feedback` — submits helpful/not-helpful
- [ ] `POST /api/portal/kb/deflection` — tracks if article solved problem
- [ ] `GET /api/portal/kb/suggest` — suggests articles for query
- [ ] KB feedback analytics aggregate trends
- [ ] Portal locale detection returns correct language

### 3.15 RBAC (Plan 15)
- [ ] Role hierarchy enforced: owner > admin > agent > light_agent > collaborator > viewer
- [ ] `requireRole()` blocks lower roles from admin endpoints
- [ ] Permission bitfield encodes/decodes correctly (60+ permissions)
- [ ] Custom roles with subset permissions work
- [ ] `GET /api/users/[id]/effective-permissions` — returns computed permissions
- [ ] API key scopes restrict operations (e.g., `tickets:read` blocks writes)
- [ ] Light agent can view but not reply
- [ ] Collaborator sees only assigned tickets

### 3.16 PII & HIPAA (Plan 16)
- [ ] `POST /api/compliance/pii/scan` — detects SSN, CC, email, phone, DOB, medical ID
- [ ] SSN regex excludes invalid area codes (000, 666, 9xx)
- [ ] Credit card detection includes Luhn validation
- [ ] `POST /api/compliance/pii/redact` — redacts with correct masking style
- [ ] Masking styles: full (`[REDACTED-SSN]`), partial (`***1234`), hash
- [ ] `GET /api/messages/[id]/unmasked` — admin-only access to original
- [ ] PII access log records who viewed what
- [ ] Custom sensitivity rules (max 200 char pattern — ReDoS guard)
- [ ] HIPAA BAA record tracking
- [ ] Redaction handles offset drift from concurrent edits

### 3.17 AutoQA & Predictions (Plan 17)
- [ ] `POST /api/qa/reviews/auto` — generates quality score
- [ ] `GET /api/predictions/csat` — returns predicted CSAT
- [ ] `GET /api/predictions/csat/accuracy` — prediction accuracy report
- [ ] `GET /api/customers/health` — returns health scores
- [ ] QA flags identify quality issues
- [ ] Coaching assignments link QA findings to agents
- [ ] AutoQA scoring dimensions: tone, accuracy, completeness, empathy

### 3.18 Visual Chatbot Builder (Plan 18)
- [ ] `POST /api/chatbots` — creates chatbot with flow definition
- [ ] `POST /api/chatbots/[id]/publish` — publishes version
- [ ] `POST /api/chatbots/[id]/rollback` — reverts to prior version
- [ ] `POST /api/chatbots/[id]/test` — starts test session
- [ ] `GET /api/chatbots/[id]/versions` — lists version history
- [ ] `GET /api/chatbots/[id]/analytics` — engagement metrics
- [ ] Node types: text, condition, action, API call, handoff, delay, carousel, form, image, video
- [ ] Chatbot engine traverses flow graph correctly
- [ ] Condition nodes branch based on user input

### 3.19 Campaign Orchestration (Plan 19)
- [ ] `POST /api/campaigns` — creates multi-step campaign
- [ ] `POST /api/campaigns/[id]/steps` — adds step to sequence
- [ ] `POST /api/campaigns/[id]/activate` — starts enrollment
- [ ] `POST /api/campaigns/[id]/pause` / `resume` — lifecycle controls
- [ ] `GET /api/campaigns/[id]/enrollments` — shows enrolled customers
- [ ] `GET /api/campaigns/[id]/funnel` — funnel analytics
- [ ] Step types: email, in-app message, delay, condition
- [ ] Product tours: step sequencing, progress tracking
- [ ] In-app messages: display rules, impression tracking

### 3.20 CRM & Custom Objects (Plan 20)
- [ ] `POST /api/tickets/[id]/external-links` — links ticket to Jira/Linear issue
- [ ] `POST /api/tickets/[id]/external-links/[linkId]/sync` — syncs status
- [ ] `POST /api/customers/[id]/crm-links` — links to Salesforce/HubSpot
- [ ] `POST /api/custom-objects/types` — creates custom object type
- [ ] `POST /api/custom-objects/types/[typeId]/records` — creates record
- [ ] `GET /api/custom-objects/relationships` — traverses relationships
- [ ] Jira webhook handler processes issue updates
- [ ] Linear webhook handler processes issue updates
- [ ] CRM data enriches customer profile

---

## Phase 4: Security Tests

### 4.1 Authentication Boundaries
- [ ] Unauthenticated requests to protected routes return 401
- [ ] Expired JWT returns 401 (not stale data)
- [ ] MFA intermediate token expires after 5 minutes
- [ ] MFA token single-use (replay blocked via JTI tracking)
- [ ] Session cookie: httpOnly, secure (prod), sameSite=lax
- [ ] API key validation rejects malformed tokens
- [ ] Demo mode (`DATABASE_URL` unset) returns demo user with owner role

### 4.2 Authorization & RBAC
- [ ] Viewer role cannot create/update tickets
- [ ] Agent cannot access admin-only routes (billing, roles, security)
- [ ] Light agent cannot send public replies
- [ ] Collaborator restricted to assigned tickets only
- [ ] Permission bitfield cannot be spoofed via request headers
- [ ] `x-user-id`, `x-workspace-id`, `x-user-role` stripped by middleware
- [ ] Custom role with no permissions blocks all operations

### 4.3 Workspace Isolation (RLS)
- [ ] Tenant A cannot read Tenant B's tickets via API
- [ ] Tenant A cannot read Tenant B's tickets via direct DB query (RLS enforced)
- [ ] Shared report tokens don't leak cross-workspace data
- [ ] SSE events scoped to workspace (no cross-workspace leakage)
- [ ] SCIM provisioning scoped to workspace
- [ ] API keys scoped to workspace

### 4.4 Input Validation & Injection
- [ ] XSS: HTML in ticket subject/body sanitized before rendering
- [ ] XSS: Widget innerHTML uses safe rendering (no raw HTML injection)
- [ ] SQL injection: ticket search parameters escaped
- [ ] Command injection: connector config values sanitized
- [ ] SSRF: webhook URLs block private IPs (sync check)
- [ ] SSRF: webhook URLs block private IPs (async DNS resolution check)
- [ ] SSRF: redirect following blocked (prevents DNS rebinding)
- [ ] ReDoS: custom PII patterns capped at 200 chars
- [ ] Prototype pollution: merge variable engine blocks `__proto__`/`constructor`
- [ ] JSON body size limit enforced (10MB max via middleware)

### 4.5 Plugin Sandbox Security
- [ ] Plugin cannot access `process.env` (secrets leakage)
- [ ] Plugin cannot `require()` Node modules
- [ ] Plugin infinite loop killed at 5-second timeout
- [ ] Plugin cannot access `global` or `globalThis`
- [ ] Plugin webhook callback blocks private IPs
- [ ] Plugin execution errors isolated (one plugin failure doesn't affect others)
- [ ] Plugin credentials encrypted at rest

### 4.6 Rate Limiting
- [ ] API key routes limited to 120 req/min
- [ ] Rate limit headers present: X-RateLimit-Limit, Remaining, Reset
- [ ] Exceeded rate limit returns 429 with Retry-After

### 4.7 Compliance
- [ ] GDPR deletion removes all customer data
- [ ] Data export includes all customer-related records
- [ ] Retention scheduler enforces configured policies
- [ ] Audit trail tamper detection (WAL integrity verification)
- [ ] PII access log cannot be modified after creation

---

## Phase 5: Integration Tests (Cross-Feature)

### 5.1 Ticket Lifecycle
- [ ] Create ticket → routing assigns agent → agent replies → customer rates CSAT → ticket solved
- [ ] Ticket with SLA → SLA timer starts → approaches breach → notification fires
- [ ] Ticket created → automation rule matches → tags added → webhook fires
- [ ] Ticket created → AI resolution triggered → draft generated → approved → reply sent

### 5.2 Event Fan-Out
- [ ] Single `ticket.created` event dispatches to: webhooks, plugins, SSE, automation, AI queue
- [ ] Error in one fan-out channel doesn't block others (fire-and-forget isolation)
- [ ] Events include correct workspace context

### 5.3 Connector Sync Round-Trip
- [ ] Import ticket from Zendesk → modify in CLIaaS → push update back → verify in outbox
- [ ] Sync health tracking records success/failure per connector
- [ ] Sync conflict detection flags divergent records

### 5.4 Campaign → Messaging → Analytics
- [ ] Campaign activated → customers enrolled → step 1 fires → delay → step 2 fires
- [ ] In-app message displayed → impression tracked → click tracked
- [ ] Product tour started → steps completed → progress recorded
- [ ] Campaign analytics reflect actual enrollment/completion counts

### 5.5 PII → Compliance → Audit
- [ ] Message with SSN → PII scan detects → reviewer confirms → redaction applied
- [ ] Redacted message shows masked value in API response
- [ ] Admin views unmasked → access logged
- [ ] HIPAA status reflects BAA + PII scan coverage

### 5.6 Plugin → Automation → Ticket
- [ ] Plugin installed → hook registered for `ticket.created`
- [ ] Ticket created → hook fires → plugin code executes in sandbox
- [ ] Plugin modifies ticket via SDK → change persists

### 5.7 KB → AI → Deflection
- [ ] Customer searches portal KB → articles suggested
- [ ] Customer marks "this solved my problem" → deflection tracked
- [ ] AI resolution uses KB articles as RAG context
- [ ] Content gap detection identifies topics with tickets but no articles

---

## Phase 6: MCP Tool Verification

### 6.1 Core Tool Smoke Tests
For each of the 110 MCP tools, verify:
- [ ] Tool executes without error given valid input
- [ ] Tool returns structured data (not error/empty)
- [ ] Tool respects workspace isolation
- [ ] Tool validates required parameters

### 6.2 Critical Tool Deep Tests
- [ ] `ticket_create` → `ticket_update` → `ticket_reply` → `ticket_merge` → `ticket_split`
- [ ] `ai_resolve` triggers actual resolution (not no-op)
- [ ] `rule_create` persists to DB (not just in-memory)
- [ ] `qa_review` generates meaningful scores (not random)
- [ ] `pii_scan` detects known PII patterns
- [ ] `campaign_send` executes multi-step sequence
- [ ] `chatbot_test` processes user input through flow

---

## Phase 7: Wet Tests (Browser Automation)

### 7.1 Happy Path Flows
- [ ] Sign up → create workspace → seed demo data → view dashboard
- [ ] Navigate to ticket list → click ticket → view details → send reply
- [ ] Create canned response → insert into reply via picker → send
- [ ] Apply macro to ticket → verify status/tags changed
- [ ] Create automation rule → trigger it → verify execution
- [ ] Create KB article → view in portal → submit feedback
- [ ] Install plugin from marketplace → configure → verify hook fires

### 7.2 Collision Detection Wet Test
- [ ] Open ticket in tab A → open same ticket in tab B
- [ ] Type reply in tab A → send reply from tab B
- [ ] Tab A should show "someone just replied" banner
- [ ] Tab A submits → collision warning modal appears
- [ ] Test discard, send-anyway, and review flows

### 7.3 Campaign Builder Wet Test
- [ ] Create campaign → add steps → activate
- [ ] View enrollment list → verify customers enrolled
- [ ] Check funnel analytics → verify step completion rates

### 7.4 Chatbot Builder Wet Test
- [ ] Create chatbot → add nodes in visual builder → connect edges
- [ ] Publish → test via chat widget → verify flow traversal
- [ ] Rollback to prior version → verify restored

### 7.5 Settings Pages Wet Test
- [ ] Navigate each settings page: canned responses, macros, signatures, tags, views, roles, routing
- [ ] Create, edit, delete an item on each page
- [ ] Verify changes persist after page reload

### 7.6 Portal Wet Test
- [ ] Customer logs into portal → views tickets → creates ticket
- [ ] Customer searches KB → reads article → submits feedback
- [ ] Customer receives CSAT survey → submits rating
- [ ] Customer views product tour → completes steps

---

## Phase 8: Hard Wet Tests (Adversarial)

### 8.1 Boundary Abuse
- [ ] Submit ticket with 100KB subject line → verify truncation/rejection
- [ ] Create 1000 tags → verify autocomplete still performs
- [ ] Deeply nested chatbot flow (100 nodes) → verify no stack overflow
- [ ] Campaign with 10,000 enrollees → verify memory doesn't spike

### 8.2 Concurrent Access
- [ ] Two agents update same ticket simultaneously → verify no data loss
- [ ] Bulk tag operation during individual tag edit → verify consistency
- [ ] Merge ticket while someone is replying to it → graceful handling

### 8.3 Permission Escalation Attempts
- [ ] Viewer modifies request to PATCH ticket → verify 403
- [ ] Agent crafts request with admin workspace ID header → verify stripped
- [ ] API key with `tickets:read` tries `tickets:write` operation → verify blocked
- [ ] Manipulate JWT payload without re-signing → verify rejected

### 8.4 Injection via UI
- [ ] Ticket subject: `<script>alert(1)</script>` → verify escaped in list and detail views
- [ ] Canned response with `{{constructor.constructor('return this')()}}` → verify blocked
- [ ] Customer name with Unicode RTL override → verify no layout corruption
- [ ] KB article slug with path traversal (`../../etc/passwd`) → verify sanitized

### 8.5 State Corruption
- [ ] Kill server mid-JSONL-write → verify file recoverable on restart
- [ ] SSE client disconnects uncleanly → verify server cleans up listener
- [ ] Plugin execution timeout during DB write → verify no partial state

---

## Execution Priority

| Priority | Phase | Estimated Tests | Rationale |
|----------|-------|----------------|-----------|
| P0 | 4.1-4.4 (Security) | ~30 | Auth/authz/injection — ship blockers |
| P0 | 1.1-1.3 (Schema) | ~15 | DB integrity — foundation for everything |
| P1 | 3.7-3.10 (Core Features) | ~30 | Canned, collision, notes, merge — daily agent workflow |
| P1 | 5.1-5.2 (Integration) | ~10 | Ticket lifecycle + event fan-out — system correctness |
| P1 | 2.1-2.3 (Data Layer) | ~25 | Dual-mode stores — data integrity |
| P2 | 3.1-3.6 (Platform Features) | ~40 | AI, routing, WFM, plugins — feature completeness |
| P2 | 7.1-7.6 (Wet Tests) | ~25 | Browser flows — user experience |
| P2 | 4.5-4.7 (Security Advanced) | ~15 | Sandbox, rate limit, compliance |
| P3 | 3.11-3.20 (Extended Features) | ~50 | Views, reports, campaigns, CRM — breadth |
| P3 | 6.1-6.2 (MCP) | ~20 | MCP tools — AI agent integration |
| P3 | 8.1-8.5 (Hard Wet) | ~20 | Adversarial testing — robustness |
| P3 | 5.3-5.7 (Integration Advanced) | ~15 | Cross-feature flows — system resilience |

**Total: ~295 test scenarios across 8 phases**

---

## Test Infrastructure Notes

- **Framework:** Vitest (existing)
- **HTTP mocking:** NextRequest/NextResponse (existing pattern)
- **DB testing:** JSONL fallback for unit tests; real Postgres for integration tests
- **Browser automation:** Claude-in-Chrome MCP tools for wet tests
- **Test helpers:** `src/__tests__/helpers.ts` — `createTestToken()`, `buildPostRequest()`, `TEST_USER`
- **Existing coverage:** 95 test files, ~9,200 LOC, 4637/4638 passing (1 pre-existing Easter Egg failure)
- **CI:** Tests must complete in under 60 seconds (current: ~15s)
