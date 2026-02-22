# Session Summaries

## 2026-02-22T07:00Z — Session 6: Zendesk live integration, Kayako Classic code review fixes
- Set up Zendesk account: subdomain=discorp, email=cordwell@gmail.com
- Changed Zendesk language from Japanese to English (US), timezone to Pacific
- Enabled API token access, generated token, saved to .env
- Verified Zendesk CLI: `zendesk verify` and `zendesk export` working with real data
- Exported 1 ticket, 3 users, 1 org, 1 KB article, 21 rules from live Zendesk
- Applied 13 code review fixes to Kayako Classic connector (3 HIGH, 5 MEDIUM, 5 LOW)
- Kayako Classic user's domain: classichelp.kayako.com (API key/secret needed from admin panel)

## 2026-02-22T06:00Z — Session 5: Mouse verification, Kayako Classic, commit
- Verified mouse clicks work in browser: Counterstrike and Aftermath buttons respond correctly
- Mouse coordinate mapping confirmed via JS debug interceptor (game coords match source code button positions)
- Fixed pre-existing KN_LCTRL bug in keyboard.cpp (was checking KMOD_SHIFT instead of KMOD_CTRL)
- Added Kayako Classic connector (HMAC-SHA256 auth, XML parsing, full export pipeline)
- Code review passed (sub-agent), committed + pushed to GitHub (eb9f216)

## 2026-02-22T05:25Z — Session 4: Red Alert WASM Easter Egg rendering + mouse fix
- Fixed black screen: Added `LORES=1` to CMake (gamedata only has LORES.MIX, not HIRES.MIX)
- Fixed canvas CSS: Replaced `object-fit: contain` with exact aspect-ratio sizing for SDL mouse mapping
- Fixed mouse coordinates: Added `Window_To_Game_Coords()` in keyboard.cpp to scale to 320x200
- Removed `SDL_WINDOW_ALLOW_HIGHDPI` flag
- Cleaned up all 44 `[RA-DBG]` debug printf statements
- Game renders: title screen, main menu, credits, all working with mouse input

## 2026-02-22T04:30Z — Session 3: Real API integration & write operations
- Fixed Kayako connector based on API research (9 issues):
  - Added X-Session-ID session management
  - Fixed articles endpoint `/api/v1/articles.json` (was wrong `/helpcenter/articles.json`)
  - Posts: replaced `is_requester` with `source` field, switched to cursor pagination (`after_id`)
  - Triggers: `predicate_collections` fallback added
  - Organizations: handle domain resource references
  - Articles: handle `section_id` as integer
  - Notes: separate endpoint `/cases/:id/notes.json` now fetched
  - MFA handling for 403 responses
- Added Zendesk write operations: verify, update, reply (public + internal), create
- Added Kayako write operations: verify, update, reply, note, create
- Exported `zendeskFetch` and `kayakoFetch` with method/body support for PUT/POST
- Updated docs page with all 12 new Zendesk/Kayako commands
- All `pnpm check` passing (lint + typecheck + build)

## 2026-02-22T03:40Z — Session 2: Continued building after compaction
- Verified demo page build, added /demo links to landing and dashboard
- Committed + pushed wave 2 (demo mode, stats, search, export, web terminal, eslint fixes)
- Built API routes: /api/tickets, /api/tickets/stats, /api/tickets/[id]
- Rewrote dashboard as dynamic server component with live stats cards, bar charts, recent tickets table
- Built /tickets browser page with status/priority filter chips
- Built /tickets/[id] detail page with conversation thread
- Built `cliaas pipeline` command (triage → KB suggest → draft, --dry-run)
- Built `cliaas watch` command (live terminal dashboard)
- Committed + pushed wave 3
- Deployed to cliaas.com (VPS_USER=ubuntu)
- Generated 50 demo tickets on VPS at /tmp/cliaas-demo
- Live dashboard shows real data at https://cliaas.com/dashboard
- 14 CLI commands total, 16 web routes

## 2026-02-22T01:00Z — Session 1: Full build plan implementation
- Built all 8 steps of the plan: CLI scaffolding, schema, Zendesk connector, Kayako connector, LLM providers, CLI workflows, web app updates, demo polish
- Fixed TypeScript circular refs, LLM JSON parsing, Zendesk cursor pagination bug, config permissions
- Created 22 CLI files, updated 8 web files
- First commit pushed to main

# Key Findings

- VPS SSH user is `ubuntu`, not `root`: `VPS_USER=ubuntu bash scripts/deploy_vps.sh`
- Demo data on VPS lives at `/tmp/cliaas-demo` (the lib/data.ts checks this path first)
- Demo command is `cliaas demo --tickets 50 --out /tmp/cliaas-demo` (not `demo generate`)
- The `public/ra/` and `src/EasterEgg/` dirs contain vendored code — already in eslint ignores
- Landing page was restyled with zinc-950 borders design between sessions
- Zendesk API: `email/token:apikey` Basic auth confirmed, cursor-based incremental exports, 10 req/min rate limit
- Kayako API: Basic auth + X-Session-ID required after first request, cases at `/api/v1/cases.json`, posts use `after_id` cursor pagination
- Kayako articles endpoint is `/api/v1/articles.json` NOT `/api/v1/helpcenter/articles.json`
- Kayako triggers use `predicate_collections` not `conditions`
- Kayako posts have `source` field (AGENT/API/MAIL/etc) not `is_requester`
- Kayako notes are separate from posts: `/api/v1/cases/:id/notes.json`
- Zendesk credentials: subdomain=discorp, email=cordwell@gmail.com, token in .env
- Kayako Classic domain: classichelp.kayako.com (needs API key + secret from admin REST API settings)
- Kayako Classic API: HMAC-SHA256 auth, XML responses, path-based pagination for tickets, marker-based for users
