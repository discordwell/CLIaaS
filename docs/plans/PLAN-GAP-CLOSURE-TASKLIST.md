# Gap Closure Plan: Features 1-15 — Task List

## Phase 0: RBAC Enforcement Sweep
- [x] 0.1: Create requirePerm() convenience wrapper
- [x] 0.2: Migrate ticket routes (~19 files)
- [x] 0.3: Migrate customer routes (~9 files)
- [x] 0.4: Migrate KB, reports, automation, admin routes (~224 files)
- [x] 0.5: Enforce collaborator ticket scoping
- [x] 0.6: JWT permission bitfield (already existed)
- [x] 0.7: Missing UI components (RoleBadge, PermissionGate, CollaboratorPanel)

## Phase 1: AI Resolution Gaps
- [x] 1.1: AI Procedures engine (procedures.ts + procedure-engine.ts)
- [x] 1.2: Hallucination guard enforcement
- [x] 1.3: AI dashboard approval queue UI
- [x] 1.4: Procedure API routes

## Phase 2: Omnichannel Routing Gaps
- [x] 2.1: Upgrade routing store to dual-mode (5 async DB functions)
- [x] 2.2: Deprecated hardcoded demo agents
- [x] 2.3: Business hours awareness in routing (group-level schedules)
- [x] 2.4: Groups membership route (requirePerm)

## Phase 3: Workflow Automation Gaps
- [x] 3.1: Rule versioning (versioning.ts + API route)
- [x] 3.2: Merge/split automation events (engine + dispatcher)

## Phase 4: Marketplace/Plugins Gaps
- [x] 4.1: Plugin credentials (AES-256-GCM)
- [x] 4.2: Missing API routes (execute + credentials)
- [x] 4.3: Reference plugins (hello-world, slack-notifier, auto-tagger)
- [x] 4.4: Plugin SDK docs

## Phase 5: WFM Gaps
- [x] 5.1: Upgrade WFM store to dual-mode (8 async DB functions)
- [x] 5.2: Real volume snapshot collection
- [x] 5.3: Real-time adherence via SSE
- [x] 5.4: Router-WFM integration (off-schedule exclusion)

## Phase 6: Connector Write-Depth Gaps
- [x] 6.1: Incremental sync for 6 connectors
- [x] 6.2: Sync health monitoring (store + API route)

## Phase 7: Canned Responses UI Gap
- [x] 7.1: MacroButton component
- [x] 7.2: Wire cannedResponseId into ticket_reply MCP tool

## Phase 8: Collision Detection Gaps
- [x] 8.1: Upgrade CollisionDetector to SSE
- [x] 8.2: Typing broadcast
- [x] 8.3: Collision warning modal

## Phase 9: Mentions Dispatch
- [x] 9.1: Wire MentionInput into reply/note forms
- [x] 9.2: Server-side mention processing
- [x] 9.3: Verify NotificationBell in layout

## Phase 10: Remaining Small Gaps
- [x] 10.1: Views management settings page
- [x] 10.2: Holiday calendar UI polish
- [x] 10.3: Reports smoke verification (already existed)
- [x] 10.4: KB MCP tools (already existed)
- [x] 10.5: Help center portal branding

## Migration & Schema
- [x] Create 0025_gap_closure.sql migration
- [x] Add Drizzle table definitions to schema.ts

## Final
- [x] Run tests (4623 pass, 0 fail)
- [ ] Code review
- [ ] Update ARCHITECTURE.md
- [ ] Update claudepad.md
- [ ] Commit & push
- [ ] Deploy
