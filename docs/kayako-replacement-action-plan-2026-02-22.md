# Kayako Replacement Action Plan (CLIaaS)

Date: February 22, 2026
Target: Kayako customers who want LLM-first support operations

## Scope and guardrails

This plan is for **customer-authorized migration and replacement**.  
Do not use unauthorized access, credential abuse, or non-consensual data extraction.

Why this matters:
- Kayako terms prohibit account/password misuse and reverse engineering/decompilation in SaaS use.
- You can still build a strong wedge through authorized API exports, reporting exports, and customer-approved automation.

## Research snapshot (what is true today)

### Product and buyer signal
- Kayako positions itself as AI-powered customer service with omnichannel support and workflows.
- Current pricing shown publicly is sales-led (`$39 per user/month`) and pushes prospects to “Book a Strategy Session.”
- External review summaries repeatedly mention UI/performance pain, customization limits, and support responsiveness concerns. Even with mixed sentiment, this is enough wedge material for a faster CLI-centric operator experience.

### Data access and migration surface

Kayako gives you multiple extraction/import paths:

- Public REST API (v1 docs):
  - Cases, Users, Organizations, Help Center Articles, Triggers, Monitors, Automations.
  - Authentication, pagination, and rate-limiting docs are published.
  - Bulk endpoints exist for some entities (for example, help center article bulk add/update; case bulk add).
- Reporting export:
  - Insights reports can be exported as CSV.
- Backup/data dump request:
  - Customers can request a backup/data dump by contacting support with account details.
- Manual migration assistance:
  - Kayako has support content on importing and migration workflows.

Practical implication:
- You can assemble a reliable exporter/importer without UI scraping for most core objects.
- For objects not covered cleanly by API/reporting, use customer-provided backup export and controlled browser automation as fallback.

### Legal/compliance constraints to respect

- SaaS and trial terms include restrictions you should treat as hard boundaries (no unauthorized account usage, no prohibited reverse engineering/decompilation activity).
- Build your migration path around explicit customer authorization and documented interfaces first.

## Strategic wedge (how to beat Kayako fast)

### Positioning statement

“Keep your support data and workflow logic in a local, portable CLI-first system. Use Claude/Codex/OpenClaw for operations and automations, not a closed UI.”

### Wedge sequence

1. Land with migration: “Move from Kayako in 1 day.”
2. Immediate wow: natural-language CLI ops over tickets/users/KB.
3. Replace daily usage: triage, routing, drafts, macros, reporting from terminal/agent.
4. Expand: plug in other systems (CRM/issue tracker/chat) and make Kayako optional.
5. Convert: if team runs 80% of support from CLIaaS, Kayako renewal becomes hard to justify.

## Build plan (compressed for hackathon speed)

## Phase 0: Setup and proof account (February 22, 2026)

Goal: establish a real Kayako workspace and API credential for testing.

Tasks:
- Create trial/demo environment (or partner with a real customer sandbox).
- Enable at least one mailbox/channel and seed sample tickets.
- Generate API credentials and test auth/pagination/rate behavior.
- Capture “object inventory” matrix:
  - Must-migrate: cases, posts/replies, users, organizations, tags, KB.
  - Nice-to-have: triggers/monitors history, SLA metadata, custom fields.

Human-gated items:
- Trial/demo signup approval path.
- Admin access for API key.
- Channel configuration done in UI before data is meaningful.

## Phase 1: Exporter CLI (February 22-23, 2026)

Goal: one command to pull all authorized Kayako data into a local canonical schema.

Deliverables:
- `cliaas kayako export --since <date> --out ./exports/kayako`
- Entity pullers:
  - cases (with posts/activities where available),
  - users,
  - organizations,
  - articles/categories,
  - automations/triggers/monitors metadata.
- Retry + cursor pagination + rate-limit handling.
- Deterministic JSONL output + manifest file (`manifest.json`) with counts/checksums.

Implementation notes:
- API-first pipeline.
- CSV Insights importer module for reporting datasets.
- Optional backup dump parser if customer provides support-generated archive.
- Browser automation fallback only for customer-authenticated screens with no API equivalent.

## Phase 2: Canonical model + OpenClaw layer (February 23, 2026)

Goal: make imported data operable by LLM agents.

Deliverables:
- Canonical schema (`ticket`, `message`, `customer`, `org`, `kb_article`, `rule`).
- Embedding/index step for retrieval over ticket and KB corpus.
- CLI commands:
  - `cliaas tickets find "refund delayed + vip"`
  - `cliaas draft reply --ticket <id> --style concise`
  - `cliaas kb suggest --ticket <id>`
- Provider abstraction:
  - Claude, Codex/OpenAI, OpenClaw-selectable by config.

Human-gated items:
- Policy decision on model provider and data residency.
- Approval of redaction policy before sending text to external LLM APIs.

## Phase 3: Day-1 replacement workflows (February 23-24, 2026)

Goal: replace the daily “agent cockpit” loop.

Deliverables:
- Queue triage command with suggested priority/owner.
- Draft generation + approve/send flow.
- “Macro from natural language” compiler into reusable CLI recipes.
- Daily ops summary command (backlog, SLA risk, CSAT proxy signals).

Success criteria:
- A user can complete ticket triage + first response from CLIaaS faster than Kayako UI.
- At least one team can run a support shift with Kayako open only for cross-check.

## Human-gated and potentially blocking steps

1. Trial/demo path
- Kayako currently emphasizes strategy-session onboarding on pricing pages; trial flow may be sales-assisted.

2. Access level
- Need admin-level access for API and settings export.

3. Data completeness
- Some historical or account-level artifacts may require support-assisted backup/data dump requests.

4. Contract/legal
- For real customer migrations, ensure MSA/SOW language allows migration automation and data processing by your LLM stack.

5. Security review
- Need customer sign-off on secrets handling, PII masking, and model-provider boundary.

## Reverse engineering plan (safe and practical)

Use this escalation ladder:

1. API docs and endpoints first.
2. Official exports (CSV/backup) second.
3. Customer-authenticated browser automation third (only for uncovered fields, with explicit authorization).
4. Never bypass auth controls or attempt unauthorized system access.

Instrumentation checklist:
- Record endpoint coverage report by entity.
- Save raw payload samples and transform fixtures.
- Build parity tests: source count vs imported count by entity/date.

## GTM motion (post-hackathon)

ICP:
- 10-200 seat support teams on older helpdesk stacks.
- Engineering-enabled support leaders who already script operations.

Offer:
- “Kayako-to-CLIaaS migration sprint” fixed-price onboarding.
- Promise: run first shift from CLI within 48 hours of data access.

Proof assets:
- Before/after workflow timings.
- Import parity report.
- Demo showing same ticket handled in CLIaaS vs Kayako UI.

## Near-term execution checklist (next 48 hours)

1. Acquire a working Kayako account (trial/demo/customer sandbox).
2. Implement exporter skeleton with auth + pagination + retries.
3. Export cases/users/orgs/articles into canonical JSONL.
4. Add one LLM workflow: `draft reply` with retrieval grounding from historical tickets.
5. Run parity checks and produce a migration report artifact.
6. Record a 2-3 minute demo proving “faster than UI” for one shift loop.

## Risks and mitigations

- Risk: API coverage gaps.
  - Mitigation: backup export + controlled browser fallback.
- Risk: legal pushback on migration methods.
  - Mitigation: explicit customer authorization and documented interfaces only.
- Risk: LLM hallucination in outbound replies.
  - Mitigation: approval gates + citation snippets from source thread/KB.
- Risk: switching friction for agents.
  - Mitigation: mimic existing queue concepts and hotkeys in CLI UX.

## Sources

- Kayako homepage: https://kayako.com/
- Kayako pricing: https://kayako.com/pricing
- Kayako “Why Kayako”: https://kayako.com/why-kayako
- Kayako developer docs (API intro): https://developer.kayako.com/
- Kayako API auth: https://developer.kayako.com/api/v1/authentication/
- Kayako API rate limiting: https://developer.kayako.com/api/v1/rate-limiting/
- Kayako API cases: https://developer.kayako.com/api/v1/cases/cases/
- Kayako API users: https://developer.kayako.com/api/v1/users/users/
- Kayako API organizations: https://developer.kayako.com/api/v1/users/organizations/
- Kayako API automations: https://developer.kayako.com/api/v1/cases/automations/
- Kayako API triggers: https://developer.kayako.com/api/v1/cases/triggers/
- Kayako API monitors: https://developer.kayako.com/api/v1/cases/monitors/
- Kayako API help center articles: https://developer.kayako.com/api/v1/help-center/articles/
- Kayako support: export report data to CSV: https://help.kayako.com/en/article/62082-exporting-report-data
- Kayako support: request account backup/data dump: https://help.kayako.com/en/article/69069-how-do-i-get-a-backup-or-data-dump-of-my-account
- Kayako support: importing tickets/users/KB: https://help.kayako.com/en/article/69077-importing-and-migrating-your-data-into-kayako-classic
- Kayako terms (site/legal pages): https://www.kayako.com/terms and https://kayako.com/legal
- Third-party review references (market signal only):
  - G2: https://www.g2.com/products/kayako/reviews
  - Capterra: https://www.capterra.com/p/130511/Kayako/
  - Gartner Peer Insights: https://www.gartner.com/reviews/market/crm-customer-engagement-center/vendor/kayako/product/kayako
