# Additional Helpdesk Targets After Kayako + Zendesk

Date: February 22, 2026  
Product: CLIaaS

## Decision

Do not target every helpdesk at once.  
Pick one niche and run a repeatable migration + replacement motion.

Recommended niche:
- Shopify-centric support teams (roughly 5-75 agents) using legacy or mid-market helpdesk tools.

Why this niche:
- High ticket volume + repetitive workflows make CLI/LLM automation obvious.
- Similar core data model across tools (tickets, conversations, users, orgs, tags, macros, KB).
- Faster buying cycles than large enterprise ITSM replacements.

## Priority Targets (after Kayako/Zendesk)

### Wave 1 (best immediate expansion)

1. Freshdesk
- Strong API and common SMB/mid-market footprint.
- Good fit for migration + dual-run + cutover playbook.

2. Help Scout
- API-oriented data access and straightforward mailbox/conversation model.
- Good for teams wanting simpler tooling and fast migration.

3. Gorgias
- Strong ecommerce concentration.
- Good wedge if you specialize in Shopify support operations.

### Wave 2 (add once wave 1 is stable)

4. Intercom
- Large install base and support inbox usage.
- More product complexity, but high upside once connector is solid.

5. Front
- Common in fast-growing ops/support teams.
- Good candidate for CLI inbox workflows and automation.

6. Zoho Desk
- Price-sensitive segment and broad SMB adoption.
- Useful expansion after core connector architecture is proven.

### Wave 3 (enterprise later)

7. Jira Service Management
- Large market and deep workflows.
- Higher complexity and longer onboarding.

8. HubSpot Service Hub
- Strong bundle-driven buyer base.
- Useful when CRM-linked support is a priority.

9. Salesforce Service Cloud
- Very high-value accounts.
- Heavy enterprise implementation and procurement cycles.

10. ServiceNow CSM
- High ACV but much slower and harder motion.
- Not ideal for first expansion wave.

## Narrow GTM Positioning

Primary message:
- "Run your support operation from CLIaaS with your preferred model provider, and migrate from legacy helpdesk tools without workflow downtime."

Initial ICP:
- DTC/ecommerce brands on Shopify.
- 5-75 support agents.
- Existing tool pain in queue triage, macro quality, SLA handling, and reporting.

## Build Order (focused)

1. Freshdesk connector (export/import + incremental sync)
2. Help Scout connector
3. Gorgias connector
4. Shared canonical schema hardening
5. One "cutover in 48 hours" migration runbook per connector

## Non-goals for this phase

- Do not build enterprise-first ServiceNow/Salesforce depth yet.
- Do not broaden into travel/expense or non-support verticals before Wave 1 traction.

## Compliance Boundary

This strategy assumes customer-authorized migration and integration only.  
No unauthorized access, credential misuse, or bypassing platform controls.
