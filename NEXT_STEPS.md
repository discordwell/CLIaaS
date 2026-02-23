# CLIaaS — What Comes Next

## Current State
- **10 connectors** built: Zendesk, Freshdesk, Groove, HelpCrunch, Kayako, Kayako Classic, Intercom, Help Scout, Zoho Desk, HubSpot
- **Migrate command** working with `--from`, `--to`, `--dry-run`, `--limit`, `--cleanup`
- **Live-tested** against: Zendesk, Freshdesk, Groove, Intercom (all 30/30 tickets)
- **Credentials on file** (.env): Zendesk, Freshdesk, Groove, HelpCrunch, Intercom

---

## High Priority

### 1. Get remaining connector credentials & live-test
- **Help Scout** — needs OAuth2 App ID + App Secret (Developer Hub → My Apps)
- **Zoho Desk** — needs OAuth token + Org ID (Zoho API Console → Self Client)
- **HubSpot** — needs private app access token (Settings → Integrations → Private Apps)
- **Kayako** — user mentioned "Kayako hates me" — may need to revisit
- Run migrate + cleanup against each once credentials are available

### 2. Website integration — migration wizard UI
- The CLI works but the website at cliaas.com could offer a guided migration wizard
- Steps: select source → enter creds → export preview → select target → enter creds → migrate
- Could use the existing Next.js app with server actions calling the same connector functions
- Show real-time progress (SSE or polling) for long-running migrations

### 3. Freshdesk cleanup workaround
- Free plan blocks DELETE via API — two options:
  - a) Use Freshdesk "Trash" feature: update ticket status to deleted/spam first, then purge
  - b) Document that cleanup requires manual deletion on free plans

---

## Medium Priority

### 4. Customer/org migration
- Currently only tickets + messages are migrated
- Add `--include customers,orgs,kb` flag to also create contacts/companies/articles in the target
- Intercom contact resolution already works; extend pattern to other connectors

### 5. Attachment migration
- Currently attachment URLs are preserved in message body text only
- Add download-and-reupload for attachments (requires temp storage)
- Most connectors support multipart file upload on ticket/message creation

### 6. Export → Export round-trip testing
- Export from connector A → migrate to B → export from B → diff against original
- Validates data fidelity end-to-end
- Could be an automated integration test

### 7. Bulk delete for cleanup
- Zendesk supports bulk delete: `DELETE /api/v2/tickets/destroy_many?ids=1,2,3`
- Would significantly speed up cleanup for large migrations
- Add batching to cleanup loop (50-100 at a time)

---

## Low Priority / Nice-to-Have

### 8. Rate limit optimization
- Current approach: sequential per-ticket with retry on 429
- Could add configurable concurrency (e.g., `--concurrency 3`) for faster migration
- Respect per-connector rate limits (Zendesk: 700/min, Freshdesk: 1000/hr, Intercom: 1000/min)

### 9. Field mapping configuration
- Custom field mapping between connectors (e.g., Zendesk priority "urgent" → HubSpot "HIGH")
- Config file or `--field-map` option
- Currently hardcoded in migrate.ts switch statements

### 10. Bidirectional sync (ambitious)
- Webhook listeners for real-time sync between two connectors
- Would require running a persistent server
- Probably out of scope for CLI tool — more of a SaaS feature

### 11. More connectors
- **Front** — modern shared inbox, REST API
- **Jira Service Management** — enterprise, Atlassian REST API
- **Salesforce Service Cloud** — very large market, complex API
- **LiveAgent** — REST API, good for SMBs
- **Gorgias** — e-commerce focused
