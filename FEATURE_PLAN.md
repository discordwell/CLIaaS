# CLIaaS Competitive Feature Plan

## Competitive Landscape Summary

### What CLIaaS Already Has (Strong Position)
- **10 connector integrations** — more than most competitors offer for import/export
- **LLM-powered AI workflows** — triage, draft reply, KB suggest, summarize, sentiment, SLA monitoring
- **Multi-LLM provider support** — Claude, OpenAI, any OpenAI-compatible endpoint
- **CLI-first interface** — unique in the market, no competitor does this well
- **Cross-platform migration** — move tickets between any 10 platforms with `--cleanup` reversal
- **Self-hosted VPS deployment** — full data sovereignty, no per-seat SaaS pricing
- **Real-time watch mode** — live ticket dashboard in the terminal
- **Batch operations** — bulk assign, tag, close
- **Duplicate detection** — subject similarity matching
- **Pipeline automation** — chained triage → draft workflows
- **Multi-tenancy schema** — Tenant/Workspace hierarchy ready
- **Export formats** — JSON, JSONL, CSV, Markdown

### CLIaaS Unique Advantages (Our Moat)
1. **CLI-native** — engineers and DevOps teams live in terminals; no competitor serves them
2. **Self-hosted** — enterprises with data sovereignty requirements have no good option
3. **Multi-platform connectors** — acts as a universal adapter, not a walled garden
4. **Multi-LLM** — not locked to one AI vendor; bring your own model
5. **Open architecture** — extend with scripts, pipe output, compose with unix tools
6. **Migration tool** — built-in escape hatch from any competitor to any other
7. **No per-seat pricing** — self-hosted means unlimited agents at infrastructure cost

---

## Gap Analysis: What Competitors Have That We Don't

### CRITICAL GAPS (Every major competitor has these)

| Gap | Zendesk | Freshdesk | Intercom | Help Scout | Impact |
|-----|---------|-----------|----------|------------|--------|
| Real authentication & user management | ✅ | ✅ | ✅ | ✅ | **Blocking** — can't go to production without it |
| Automation engine (triggers, macros, rules) | ✅ | ✅ | ✅ | ✅ | **High** — core workflow automation |
| Customer-facing portal / self-service | ✅ | ✅ | ✅ | ✅ | **High** — reduces ticket volume 20-40% |
| CSAT / NPS surveys | ✅ | ✅ | ✅ | ✅ | **High** — table stakes for any support platform |
| Reporting & analytics dashboards | ✅ | ✅ | ✅ | ✅ | **High** — managers need this to buy |
| Agent collision detection | ✅ | ✅ | — | ✅ | **Medium** — prevents duplicate work |
| Email channel (receive & send) | ✅ | ✅ | ✅ | ✅ | **High** — primary support channel |

### IMPORTANT GAPS (Most competitors have these)

| Gap | Who Has It | Impact |
|-----|-----------|--------|
| Live chat widget | Zendesk, Freshdesk, Intercom, Help Scout | **High** — second most common channel |
| Omnichannel routing (skills, round-robin) | Zendesk, Freshdesk, Jira SM | **Medium** — needed for teams >5 |
| Time tracking | Freshdesk, Zendesk, Jira SM | **Medium** — billing & performance |
| Custom ticket forms & fields (GUI) | All except Linear | **Medium** — per-client customization |
| Knowledge base CRUD (GUI authoring) | All except Linear | **Medium** — currently read-only browser |
| Internal notes & side conversations | Zendesk, Freshdesk, Help Scout | **Medium** — team collaboration |
| Webhook receivers for all connectors | Zendesk only currently | **Medium** — real-time sync |
| SLA policy engine (enforcement, not just monitoring) | Zendesk, Freshdesk, Jira SM | **Medium** — enterprise requirement |

### DIFFERENTIATOR GAPS (Would set us apart)

| Gap | Who Has It | Impact |
|-----|-----------|--------|
| AI agents (autonomous resolution) | Zendesk (80%), Intercom (65%), Freshdesk | **Very High** — industry direction |
| Conversational/proactive messaging | Intercom, Zendesk | **High** — reduces inbound volume |
| QA / quality assurance scoring | Zendesk ($25/agent add-on) | **Medium** — enterprise upsell |
| Workforce management / scheduling | Zendesk (add-on) | **Low** — enterprise only |
| Voice/phone support | Zendesk Talk, Freshdesk | **Low** — complex, niche |
| Community forums | Zendesk, Freshdesk | **Low** — nice-to-have |

---

## Feature Plan: 6 Phases

### Phase 1: Production Foundation (Make It Real)
> Goal: Go from demo to deployable product

**1.1 Authentication & User Management**
- NextAuth.js integration (email/password + OAuth providers)
- Role-based access: owner, admin, agent, viewer
- Workspace invitation flow (email invites with role assignment)
- Session management, password reset
- API key generation for CLI authentication
- CLI `cliaas login` command (stores token in `~/.cliaas/config.json`)

**1.2 Email Channel (Inbound & Outbound)**
- Inbound email processing (receive via webhook or IMAP polling)
- Outbound email sending (SMTP or API: SendGrid, Postmark, SES)
- Email-to-ticket creation with threading (In-Reply-To / References headers)
- Reply-from-GUI sends email to customer
- Reply-from-CLI sends email to customer
- Email signature management per agent
- Attachment handling (upload to S3-compatible storage)

**1.3 Automation Engine**
- **Triggers**: event-driven rules (on ticket create, update, reply, SLA breach)
  - Conditions: status, priority, tags, assignee, requester, custom fields, time-based
  - Actions: assign, set priority/status, add tag, send notification, webhook
- **Macros**: one-click agent actions (set status + add reply + assign in one click)
- **Automations**: time-based rules (escalate after X hours, close after Y days idle)
- GUI rule builder (condition → action visual editor)
- CLI `cliaas rules list|create|test` commands
- Rule execution engine with audit logging

**1.4 Real-time Collaboration**
- Agent collision detection (show "Agent X is viewing/typing" on tickets)
- WebSocket infrastructure (ticket updates, assignments, new tickets)
- Internal notes on tickets (visible to agents only, not customers)
- @mention notifications for agents
- Activity feed per ticket (audit trail of all changes)

---

### Phase 2: Customer Experience (The Other Side)
> Goal: Give end-customers a self-service experience

**2.1 Customer Portal**
- Branded, embeddable portal (standalone URL or iframe)
- Customer login (email link, no password required)
- Submit new ticket with custom form fields
- View own ticket history and status
- Reply to tickets from portal
- Search knowledge base articles
- Customizable branding (logo, colors, CSS)
- Multi-brand support (different portals per workspace)

**2.2 Knowledge Base Authoring**
- Full CRUD for KB articles in GUI (rich text editor)
- Article categories and hierarchy
- Draft / published / archived status workflow
- Version history with diff view
- CLI `cliaas kb create|edit|publish` commands
- AI-assisted article generation from ticket conversations
- Search with relevance scoring
- Public API for headless KB consumption

**2.3 CSAT & Feedback**
- Post-resolution satisfaction survey (configurable trigger)
- Rating options: emoji scale, 1-5 stars, or thumbs up/down
- Optional comment field
- CSAT score tracking per agent, team, time period
- NPS survey support (0-10 scale + follow-up)
- CLI `cliaas csat report` for satisfaction metrics
- Survey customization (questions, timing, channels)

**2.4 Live Chat Widget**
- Embeddable JavaScript widget for customer websites
- Real-time messaging via WebSocket
- Chat-to-ticket escalation (seamless handoff)
- Pre-chat form (name, email, topic)
- Typing indicators both directions
- Chat history persistence
- Offline mode → creates ticket instead
- CLI `cliaas chat monitor` for watching live chats

---

### Phase 3: Intelligence & AI (Our Edge)
> Goal: Leverage multi-LLM advantage to beat single-vendor AI

**3.1 AI Agent (Autonomous Resolution)**
- Configurable AI agent that handles tickets end-to-end
- Knowledge base + conversation history as context
- Escalation rules (confidence threshold, topic exclusions)
- Human-in-the-loop review queue for uncertain responses
- Resolution rate tracking and reporting
- CLI `cliaas ai-agent enable|disable|config|stats`
- Multi-LLM: try Claude first, fall back to OpenAI, or use cheapest model
- Per-category AI routing (billing → GPT-4, technical → Claude)

**3.2 Smart Routing & Assignment**
- Skills-based routing (agent skills matrix, ticket category matching)
- Round-robin with capacity limits
- Load-balanced assignment (fewest open tickets)
- Priority-weighted queue (urgent tickets assigned first)
- Time-zone-aware routing
- CLI `cliaas routing config` for rule management
- Auto-learning: AI suggests routing rules based on historical assignments

**3.3 Proactive Support**
- AI scans incoming tickets for patterns → alerts team
- Anomaly detection (sudden spike in topic X)
- Predictive escalation (flag tickets likely to escalate based on sentiment trajectory)
- Suggested KB article creation when AI detects repeated novel questions
- CLI `cliaas insights` for proactive intelligence dashboard

**3.4 AI QA & Coaching**
- Auto-score agent responses (tone, completeness, accuracy)
- Flag responses that deviate from brand voice
- Suggest improvements before send
- Weekly agent quality reports
- CLI `cliaas qa report --agent <name> --period 7d`

---

### Phase 4: Analytics & Reporting (Manager Buy-In)
> Goal: Provide the dashboards and metrics managers need to justify the tool

**4.1 Analytics Dashboard (GUI)**
- Real-time queue overview (open, pending, solved by hour/day/week)
- Agent performance (response time, resolution time, CSAT, volume)
- SLA compliance rates with breach alerts
- Channel breakdown (email, chat, portal, API)
- Trend analysis (week-over-week, month-over-month)
- Custom date ranges and filters
- Export to PDF / CSV

**4.2 Custom Reports**
- Report builder (pick metrics, dimensions, filters, chart type)
- Saved reports with sharing
- Scheduled delivery (email daily/weekly digest)
- Compare periods (this week vs last week)

**4.3 CLI Analytics**
- `cliaas stats --detailed` expanded metrics
- `cliaas report generate --type weekly|monthly|custom`
- `cliaas report schedule --cron "0 9 * * MON" --email team@company.com`
- Pipe-friendly output (`cliaas stats --json | jq`)

**4.4 SLA Policy Engine**
- Define SLA policies per priority, customer tier, or tag
- Response time + resolution time targets
- Escalation chains (warn → escalate → alert manager)
- SLA breach notifications (email, Slack webhook, CLI alert)
- SLA compliance reporting in analytics
- CLI `cliaas sla define|list|report`

---

### Phase 5: Integrations & Ecosystem (Network Effect)
> Goal: Make CLIaaS the hub that connects everything

**5.1 Webhook Platform**
- Inbound webhooks for all 10 connectors (not just Zendesk)
- Outbound webhooks on any ticket event
- Webhook management GUI + CLI
- Retry logic with exponential backoff
- Webhook logs with payload inspection
- Signature verification (HMAC)

**5.2 Slack / Teams Integration**
- Create tickets from Slack messages
- Ticket notifications in channels
- Reply to tickets from Slack threads
- `/cliaas` slash command in Slack
- Microsoft Teams equivalent

**5.3 Plugin / Extension System**
- Plugin API for custom actions, triggers, and UI components
- Plugin manifest format (JSON)
- CLI `cliaas plugin install|list|remove`
- Example plugins: GitHub issue sync, PagerDuty alerts, Stripe billing context

**5.4 REST API Completeness**
- Full CRUD API for all entities (tickets, customers, KB, rules, reports)
- API documentation (OpenAPI/Swagger auto-generated)
- Rate limiting per API key
- Pagination, filtering, sorting on all list endpoints
- Webhook subscriptions API

**5.5 Bidirectional Real-Time Sync**
- Live sync with connected platforms (not just export/import)
- Conflict resolution strategy (last-write-wins or manual merge)
- Sync status dashboard
- CLI `cliaas sync status|start|stop|history`

---

### Phase 6: Enterprise & Scale (Premium Features)
> Goal: Features that justify enterprise pricing

**6.1 Multi-Brand / Multi-Portal**
- Multiple customer portals with distinct branding
- Per-brand routing rules and SLA policies
- Brand-specific KB and chat widget
- Consolidated reporting across brands

**6.2 Audit & Compliance**
- Complete audit log of all actions (who, what, when)
- GDPR data export and deletion tools
- Data retention policies (auto-purge after N days)
- IP allowlisting
- SSO (SAML 2.0 + OIDC)

**6.3 Sandbox Environment**
- Staging workspace for testing automations and AI config
- Clone production data (anonymized)
- Promote changes to production after review

**6.4 Custom Fields & Forms**
- GUI builder for custom ticket forms
- Conditional fields (show field X when field Y = Z)
- Required fields per ticket type
- Custom field reporting and filtering

**6.5 Time Tracking**
- Start/stop timer on tickets
- Manual time entry
- Time reports per agent, customer, tag
- Billable vs. non-billable classification
- CLI `cliaas time start|stop|log|report`

---

## Priority Matrix

```
                        HIGH IMPACT
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         │  Phase 1: Auth   │  Phase 3: AI     │
         │  Email Channel   │  Agent           │
         │  Automation      │  Smart Routing   │
         │  Collaboration   │  Proactive       │
   LOW   │                  │                  │   HIGH
  EFFORT ├──────────────────┼──────────────────┤  EFFORT
         │                  │                  │
         │  Phase 2: CSAT   │  Phase 5: Sync   │
         │  KB Authoring    │  Plugin System   │
         │  Chat Widget     │  Phase 6: Audit  │
         │                  │  Enterprise      │
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                        LOW IMPACT
```

## Recommended Build Order

1. **Phase 1.1** — Auth (everything else depends on it)
2. **Phase 1.3** — Automation engine (core workflow value)
3. **Phase 1.2** — Email channel (primary support channel)
4. **Phase 1.4** — Real-time collaboration
5. **Phase 2.1** — Customer portal
6. **Phase 3.1** — AI agent (our biggest differentiator)
7. **Phase 2.3** — CSAT surveys
8. **Phase 4.1** — Analytics dashboard
9. **Phase 2.2** — KB authoring
10. **Phase 2.4** — Live chat widget
11. **Phase 3.2-3.4** — Smart routing, proactive, QA
12. **Phase 4.2-4.4** — Custom reports, CLI analytics, SLA engine
13. **Phase 5.1-5.5** — Integrations & ecosystem
14. **Phase 6.1-6.5** — Enterprise features

## Competitive Positioning

### vs. Zendesk ($69-169/agent/month + add-ons)
**Our pitch**: "Everything Zendesk does, in your terminal and on your server. No per-seat fees. No vendor lock-in. Your data stays yours."

### vs. Freshdesk ($15-79/agent/month)
**Our pitch**: "Freshdesk's features with CLI power. Script your support workflows. Pipe ticket data to any tool. Self-host for compliance."

### vs. Intercom ($29/user/month + $0.99/resolution)
**Our pitch**: "Conversational AI without the resolution tax. Bring your own LLM. Pay infrastructure costs, not per-conversation fees."

### vs. Help Scout ($50-75/month flat)
**Our pitch**: "Help Scout's simplicity with power-user depth. Same unlimited agents model, plus CLI automation, cross-platform migration, and AI that works with any LLM."

### vs. Jira Service Management ($19-85/agent/month)
**Our pitch**: "ITSM without the Atlassian tax. Built for support teams, not IT departments. Lighter, faster, AI-native."
