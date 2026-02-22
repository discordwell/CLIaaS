# Zendesk Replacement Action Plan (CLIaaS)

Date: February 22, 2026  
Target: Zendesk Support customers that want CLI-first, model-agnostic operations

## Scope and guardrails

This plan is for customer-authorized migration and replacement only.  
Do not use unauthorized access, credential misuse, or bypass platform controls.

## Objective

Replace daily Zendesk UI work with CLIaaS workflows while preserving data fidelity and rollback safety.

Primary outcome:
- A support team can run triage, drafting, routing, and reporting from CLIaaS with Zendesk as optional back-end during transition.

## Research snapshot (what matters for build)

Zendesk provides strong documented interfaces for extraction, sync, and rule migration:

- Incremental exports with cursor-based endpoints for:
  - tickets,
  - users,
  - organizations,
  - ticket events.
- Ticket history APIs (audits/comments) for accurate thread and action reconstruction.
- Business rule APIs for macros, triggers, automations, and SLA policies.
- Published rate-limit behavior with `429` + `Retry-After` handling expectations.

Practical implication:
- You can build a reliable exporter + incremental sync engine without brittle UI scraping.

## Strategic wedge

Positioning:
- "Run support from your terminal and preferred LLM stack, not a closed inbox UI."

Wedge sequence:
1. Land with migration assessment and data parity report.
2. Run dual mode: CLIaaS operations + Zendesk sync.
3. Replace shift loops (triage, first response, queue maintenance) in CLIaaS.
4. Keep rollback path so buyers feel no lock-in risk.
5. Convert from "assistant to Zendesk" into "Zendesk optional."

## Build plan

## Phase 0: Access and schema contract (Day 0)

Goal: establish secure access and freeze a canonical data contract.

Tasks:
- Set up Zendesk sandbox or pilot account.
- Confirm auth mode (OAuth or API token policy as permitted by customer policy).
- Capture source object matrix:
  - Core: tickets, comments, users, organizations, groups, tags.
  - Rules: macros, triggers, automations, SLA policies.
  - Config: ticket fields/forms, schedules, support addresses, brands (if multi-brand).
- Define canonical schema in CLIaaS:
  - `ticket`, `message`, `customer`, `org`, `rule`, `sla_policy`, `field_definition`.

Exit criteria:
- Credentials validated.
- First API calls succeed for each object class.
- Schema mapping document approved.

## Phase 1: Exporter + incremental sync engine (Day 1)

Goal: deterministic full export plus safe ongoing deltas.

Deliverables:
- `cliaas zendesk export --subdomain <x> --out ./exports/zendesk`
- `cliaas zendesk sync --cursor-state ./exports/zendesk/cursors.json`
- Cursor pipeline for:
  - incremental tickets,
  - incremental users,
  - incremental organizations,
  - incremental ticket events.
- Hydration pipeline for ticket comments/audits where event detail is needed.
- Manifest artifacts:
  - entity counts,
  - checksums,
  - cursor checkpoints,
  - error ledger.

Implementation requirements:
- Idempotent writes.
- Retry/backoff on `429` and transient failures.
- Structured logs per endpoint and account.

## Phase 2: CLIaaS operator workflows (Day 1-2)

Goal: replace the daily agent cockpit loop.

Deliverables:
- Retrieval index over imported ticket corpus + business rules.
- Provider abstraction:
  - Claude,
  - Codex/OpenAI,
  - OpenClaw.
- High-value commands:
  - `cliaas tickets triage --queue <name>`
  - `cliaas draft reply --ticket <id> --tone concise`
  - `cliaas risk sla --window 4h`
  - `cliaas summarize shift --team <name>`

Safety gates:
- Human approval before outbound reply in early rollout.
- Source-grounded citations in generated drafts.
- PII redaction policy before sending text to external model APIs.

## Phase 3: Dual-run and cutover (Day 2-3)

Goal: prove production readiness with rollback path.

Deliverables:
- Bidirectional sync for selected actions:
  - comment/reply posting,
  - tag/status/assignee updates,
  - macro-equivalent action execution.
- Daily parity job:
  - compare counts and recent activity windows between Zendesk and CLIaaS.
- Cutover runbook:
  - freeze window,
  - final incremental sync,
  - parity check,
  - team switch announcement,
  - rollback procedure.

Success criteria:
- One support shift completed primarily from CLIaaS.
- No unresolved parity defects for critical entities.

## Phase 4: De-risk lock-in concern (optional but high leverage)

Goal: prove data portability both directions.

Deliverables:
- "Export out of CLIaaS" package in neutral JSONL/CSV.
- Optional Zendesk re-import adapter for rollback/move-back confidence.

Business impact:
- Removes buyer fear around irreversible migration decisions.

## Human-gated blockers

1. Admin access and security policy
- Need approved credentials/scopes and allowed integration method.

2. Data retention/compliance
- Need legal/security sign-off for model provider routing and retention boundaries.

3. Account-specific customization
- Complex custom fields/workflows/apps may require bespoke mapping.

4. Operational rollout
- Team enablement needed to shift habits from GUI-first to CLI-first operations.

## 72-hour execution checklist

1. Connect one Zendesk sandbox and export full baseline.
2. Implement incremental cursor sync for tickets/users/orgs/events.
3. Map macros/triggers/automations/SLA policies into canonical rule model.
4. Ship one production-grade command: `draft reply` with approval gate.
5. Run dual mode for a real queue and generate daily parity report.
6. Record a short demo of "Zendesk UI flow vs CLIaaS flow" with timing delta.

## Risks and mitigations

- Risk: API throttling during large historical pulls.
  - Mitigation: cursor checkpoints, adaptive rate control, background backfill jobs.

- Risk: Incomplete reconstruction of historical context.
  - Mitigation: include ticket audits/comments and event-stream reconciliation.

- Risk: LLM quality variance across providers.
  - Mitigation: provider abstraction + evaluation harness + approval gates.

- Risk: Custom workflows not captured in first pass.
  - Mitigation: start with top 20 macros/rules by usage, then expand.

## Sources

- Zendesk Ticket Import API: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_import/
- Zendesk Incremental Exports API: https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
- Zendesk Incremental Export usage guide: https://developer.zendesk.com/documentation/api-basics/working-with-data/using-the-incremental-export-api/
- Zendesk Rate Limits: https://developer.zendesk.com/api-reference/introduction/rate-limits/
- Zendesk Authentication basics: https://developer.zendesk.com/documentation/api-basics/authentication/
- Zendesk Ticket Audits API: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/
- Zendesk Ticket Comments API: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/
- Zendesk Users API: https://developer.zendesk.com/api-reference/ticketing/users/users/
- Zendesk Organizations API: https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/
- Zendesk Ticket Fields API: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/
- Zendesk Macros API: https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/
- Zendesk Triggers API: https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/
- Zendesk Automations API: https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/
- Zendesk SLA Policies API: https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/
