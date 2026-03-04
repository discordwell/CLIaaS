# CLIaaS

**One-line description:** AI-first helpdesk SaaS with full interoperability via MCP

**Team:** Robert Cordwell (cordwell@gmail.com)

**Live URL:** https://cliaas.com

**GitHub:** https://github.com/discordwell/CLIaaS

**Easter Egg:** Visit https://cliaas.com and type the Konami Code (up up down down left right left right B A) to unlock a hidden Red Alert-inspired ant game built with a custom TypeScript/Canvas 2D engine.

## Problem Statement

Legacy helpdesk platforms lock teams into proprietary UIs where AI is an afterthought and data portability is nonexistent. CLIaaS solves this by delivering a full-featured helpdesk that's CLI-native and AI-first — with 30 MCP tools that let any AI agent triage tickets, draft replies, and manage queues through the same interface humans use.

## What It Does

- **CLI + Web + MCP:** Three equal-citizen interfaces — a 32-command CLI, a Next.js web dashboard, and a 30-tool MCP server — all sharing the same business logic
- **10 Helpdesk Connectors:** Import from Zendesk, Kayako, Freshdesk, Intercom, HelpCrunch, Groove, Help Scout, Zoho Desk, HubSpot, and Kayako Classic
- **AI-Powered Triage:** LLM-driven ticket categorization, sentiment analysis, duplicate detection, and auto-resolution
- **RAG Knowledge Base:** Vector-search over support articles for context-aware reply drafting
- **Multi-Tenant Architecture:** Row-level security, org-based isolation, SSO (SAML + OIDC), MFA (TOTP), and SOC 2-ready audit logging
- **Flexible Deployment:** BYOC (free, self-hosted), Hosted (managed), or Hybrid (local+cloud sync)

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes, Drizzle ORM, PostgreSQL (59 tables, RLS)
- **CLI:** TypeScript, Commander.js, 32 command groups
- **AI/MCP:** Model Context Protocol server (stdio), 30 tools / 6 resources / 4 prompts
- **Infrastructure:** VPS (Ubuntu), nginx, systemd, Docker (Postgres)

---

## Judge Path: End-to-End Demo

### Quick Start (live site)
1. Go to **https://cliaas.com** → click **Get Started**
2. Sign up with any email (no verification required)
3. Create a workspace name → you'll land on `/setup`
4. On setup, enter the database URL or skip to use demo mode
5. The onboarding auto-seeds 25 sample tickets into your workspace

### Core Flow
1. **Dashboard** (`/dashboard`) — overview of ticket counts, SLA status, queue health
2. **Tickets** (`/tickets`) — browse all tickets, click any ticket to see full thread
3. **Ticket Detail** (`/tickets/[id]`) — view conversation, reply, change status/priority/assignee
4. **AI Triage** (`/ai`) — run LLM-powered categorization, sentiment analysis, auto-resolution
5. **Knowledge Base** (`/kb`) — manage support articles, RAG-powered search
6. **Automations** (`/rules`) — create triggers, macros, and SLA policies
7. **Analytics** (`/analytics`) — ticket volume, response times, CSAT scores
8. **Settings** (`/settings`) — workspace config, team management, API keys, connectors

### Customer Portal (separate auth)
- `/portal` — customers can submit tickets, check status, browse KB articles
- `/portal/tickets/new` — submit a new support request
- `/portal/csat/[ticketId]` — rate support experience

---

## Route Architecture

### Public Pages (no auth)
```
/                          Landing page (hero, demo, pricing, features)
/pricing → (section on /)  Pricing tiers (BYOC, Hosted, Enterprise)
/docs                      API documentation (auto-generated OpenAPI)
/enterprise                Enterprise features page
/security                  Security & compliance overview
/sign-in                   Authentication
/sign-up                   Registration
/sign-up/workspace         Workspace creation
/offline                   PWA offline fallback
```

### Protected App Pages (require auth + workspace)
```
/dashboard                 Main dashboard — ticket stats, SLA, queue health
/tickets                   Ticket list with filters, search, bulk actions
/tickets/[id]              Ticket detail — conversation thread, reply, metadata
/customers                 Customer directory
/kb                        Knowledge base article management
/chat                      Live chat console
/chat/embed                Embeddable chat widget (standalone layout)
/ai                        AI triage, sentiment, auto-resolution controls
/analytics                 Reporting — volume, response time, CSAT
/channels                  Omnichannel config (email, SMS, voice, social)
/integrations              Third-party integrations (Slack, Teams, connectors)
/rules                     Automation rules — triggers, macros, SLA policies
/sla                       SLA policy management
/billing                   Stripe subscription management
/sandbox                   Environment sandboxing (clone, diff, promote)
/settings                  Workspace settings, team, API keys
/setup                     First-run setup wizard
/onboarding                Guided onboarding flow
/demo                      Interactive product demo
```

### Customer Portal (separate auth context)
```
/portal                    Portal home
/portal/tickets            Customer's ticket list
/portal/tickets/new        Submit new ticket
/portal/tickets/[id]       View ticket conversation
/portal/kb                 Public knowledge base
/portal/csat/[ticketId]    CSAT rating form
```

### API Routes (137 endpoints)

**Auth & Identity**
```
POST   /api/auth/signup                    Create account
POST   /api/auth/signin                    Sign in (JWT)
POST   /api/auth/signout                   Sign out
GET    /api/auth/me                        Current user profile
PUT    /api/auth/me/password               Change password
POST   /api/auth/mfa/setup                 Initialize TOTP MFA
POST   /api/auth/mfa/verify                Verify MFA code
POST   /api/auth/mfa/disable               Disable MFA
GET    /api/auth/sso/saml/metadata          SAML SP metadata
POST   /api/auth/sso/saml/login            SAML SSO initiation
POST   /api/auth/sso/saml/callback         SAML assertion consumer
GET    /api/auth/sso/oidc/login            OIDC authorization redirect
GET    /api/auth/sso/oidc/callback         OIDC token exchange
CRUD   /api/auth/sso/providers             SSO provider management
GET    /api/auth/google/login              Google OAuth initiation
GET    /api/auth/google/callback           Google OAuth callback
POST   /api/auth/google/complete           Complete Google signup
```

**Tickets (core CRUD + messaging)**
```
GET    /api/tickets                        List tickets (filtered, paginated)
POST   /api/tickets/create                 Create ticket
GET    /api/tickets/stats                  Ticket statistics
GET    /api/tickets/[id]                   Get ticket detail
PUT    /api/tickets/[id]                   Update ticket
DELETE /api/tickets/[id]                   Delete ticket
GET    /api/tickets/[id]/messages          Get conversation thread
POST   /api/tickets/[id]/reply             Add reply to ticket
```

**AI & Triage**
```
POST   /api/ai/route                       AI triage (categorize, prioritize)
POST   /api/ai/resolve                     AI auto-resolution
POST   /api/ai/agent                       AI agent conversation
GET    /api/ai/insights                    AI-generated insights
GET    /api/ai/stats                       AI usage statistics
POST   /api/ai/qa                          AI quality assurance checks
GET    /api/ai/queue                       AI processing queue
GET    /api/ai/queue/[id]                  Queue item status
```

**Channels (omnichannel)**
```
POST   /api/channels/sms/send              Send SMS (Twilio)
POST   /api/channels/sms/inbound           SMS webhook receiver
CRUD   /api/channels/sms                   SMS channel config
POST   /api/channels/voice/inbound         Voice call webhook
GET    /api/channels/voice/calls           Call history
POST   /api/channels/voice/status          Call status callback
POST   /api/channels/facebook/webhook      Facebook Messenger webhook
POST   /api/channels/instagram/webhook     Instagram DM webhook
POST   /api/channels/twitter/webhook       Twitter DM webhook
```

**Knowledge Base, Webhooks, Automations, CSAT, etc.**
```
CRUD   /api/kb                             Knowledge base articles
CRUD   /api/webhooks                       Outbound webhook management
GET    /api/webhooks/[id]/logs             Webhook delivery logs
CRUD   /api/automations                    Automation rules
POST   /api/automations/[id]/test          Test automation
GET    /api/automations/history            Execution history
CRUD   /api/rules                          Trigger/macro/SLA rules
GET    /api/csat/ratings                   CSAT scores
CRUD   /api/custom-fields                  Custom ticket fields
CRUD   /api/custom-forms                   Custom intake forms
```

**Connectors & Sync**
```
GET    /api/connectors                     List configured connectors
GET    /api/connectors/status              Sync status for all connectors
POST   /api/connectors/[name]/export       Trigger connector export/sync
POST   /api/connectors/[name]/verify       Verify connector credentials
POST   /api/zendesk/sync/outbound          Push changes to Zendesk
POST   /api/zendesk/webhook                Zendesk webhook receiver
```

**Enterprise & Compliance**
```
GET    /api/compliance                     Compliance dashboard
POST   /api/compliance/export              GDPR data export
POST   /api/compliance/delete              GDPR right-to-erasure
CRUD   /api/compliance/retention           Data retention policies
POST   /api/compliance/retention/enforce   Run retention enforcement
GET    /api/compliance/audit-export        Audit log export
GET    /api/security/controls              Security control status
GET    /api/security/evidence              Compliance evidence collection
GET    /api/security/audit                 Security audit log
POST   /api/security/audit/verify          Verify audit log integrity
GET    /api/security/access-review         User access review
CRUD   /api/scim/v2/Users                  SCIM user provisioning
CRUD   /api/scim/v2/Groups                 SCIM group provisioning
CRUD   /api/sandbox                        Environment sandboxing
POST   /api/sandbox/[id]/clone             Clone sandbox
GET    /api/sandbox/[id]/diff              Diff sandbox vs production
POST   /api/sandbox/[id]/promote           Promote sandbox to production
```

**Admin & Infrastructure**
```
CRUD   /api/users                          User management
POST   /api/users/invite                   Invite team member
CRUD   /api/api-keys                       API key management
CRUD   /api/brands                         Brand/subdomain management
GET    /api/analytics                      Analytics data
POST   /api/analytics/export               Export analytics
GET    /api/audit                          Audit log
POST   /api/audit/export                   Export audit log
GET    /api/events                         SSE event stream
POST   /api/onboarding/seed               Seed sample data
GET    /api/setup                          Setup status
GET    /api/health                         Health check
GET    /api/metrics                        Prometheus metrics
GET    /api/docs                           OpenAPI spec
POST   /api/billing/checkout               Stripe checkout session
POST   /api/billing/portal                 Stripe customer portal
GET    /api/billing                        Billing status
POST   /api/stripe/webhook                 Stripe webhook handler
GET    /api/presence                       User presence (online/away)
POST   /api/push                           Push notification registration
POST   /api/push/send                      Send push notification
POST   /api/interop/export                 Data export (JSON/CSV)
POST   /api/interop/import                 Data import
POST   /api/email/inbound                  Inbound email webhook
GET    /api/chat/sessions                  Chat sessions
GET    /api/chat/widget.js                 Embeddable chat widget JS
GET    /api/integrations/slack             Slack integration
GET    /api/integrations/teams             Teams integration
CRUD   /api/plugins                        Plugin management
CRUD   /api/customers                      Customer management
CRUD   /api/time                           Time tracking
POST   /api/time/timer                     Start/stop timer
GET    /api/time/report                    Time report
```

### Portal API (customer-facing, separate auth)
```
POST   /api/portal/auth                    Portal login
POST   /api/portal/auth/verify             Verify portal token
GET    /api/portal/tickets                 Customer's tickets
POST   /api/portal/tickets                 Submit ticket
GET    /api/portal/tickets/[id]            View ticket
GET    /api/portal/kb                      Browse knowledge base
```

---

## Technical Implementation Pointers

### Database & Schema
- **Drizzle schema:** `src/db/schema.ts` — 59 tables with pgEnums for status, priority, provider, rule type
- **RLS implementation:** `src/db/rls.ts` — `withTenantContext()` sets PostgreSQL session variables (`app.current_workspace_id`, `app.current_tenant_id`) via `SET LOCAL` for transaction-scoped row isolation
- **Dual database:** Main DB (Drizzle/Postgres) + RAG DB (pgvector for semantic search)

### Auth Strategy
- **Custom JWT auth** — `src/lib/auth/` with session tokens signed via `AUTH_SECRET`
- **SSO:** SAML (`src/lib/auth/saml.ts`) + OIDC (`src/lib/auth/oidc.ts`)
- **MFA:** TOTP (`src/lib/auth/totp.ts`) with setup/verify/disable flow
- **Domain matching:** `src/lib/auth/domain-matching.ts` auto-assigns users to orgs by email domain
- **SCIM provisioning:** `/api/scim/v2/Users` and `/api/scim/v2/Groups` for enterprise directory sync
- **Tenant enforcement:** Every API route calls `withTenantContext()` before DB queries; RLS policies on all tenant-scoped tables

### Background Jobs & Webhooks
- **Queue system:** `src/lib/queue/` with typed dispatch
- **Workers:** `src/lib/queue/workers/` — webhook-processor, automation-worker, ai-resolution-worker, email-worker
- **Webhook delivery:** HMAC-SHA256 signed payloads, retry policy with configurable `maxAttempts` and `delaysMs`
- **Idempotency:** Webhook logs track delivery attempts at `/api/webhooks/[id]/logs`

### Key Patterns
- **All routes use API handlers** (no server actions) — consistent REST API consumed by both web UI and CLI
- **Shared business logic:** `src/lib/` modules imported by both Next.js API routes and CLI commands
- **Error boundary:** `src/app/error.tsx` + `src/app/not-found.tsx` for App Router error handling
- **PWA:** Service worker at `public/sw.js`, offline page at `/offline`
- **Real-time:** SSE event stream at `/api/events`, presence at `/api/presence`

### Seed & Local Development
- **Seed script:** `scripts/db-seed.ts` — loads demo data from `fixtures/demo-data/`
- **Usage:** `DATABASE_URL=... pnpm db:seed`
- **Env template:** `.env.example` covers all required and optional vars
