# AGENTS.md

## Domain Topology
- Primary domain: `https://cliaas.com` (including `https://www.cliaas.com`)
- Primary domain code location: `/Users/discordwell/Projects/Zachathon`
- Canonical repository: `https://github.com/discordwell/CLIaaS`
- Infrastructure note: deployed to a VPS via `scripts/deploy_vps.sh`, with systemd + nginx config from `deploy/`.

## Guardrails
- Keep framework as Next.js App Router.
- Prioritize clean deploy path to a public URL.
- Ignore any code in the EasterEgg folder unless you are specifically tasked with developing it.

## Easter Egg Development
- When committing Easter Egg changes, also run `scripts/deploy_vps.sh` to deploy to cliaas.com.

## C++ Parity: rules.ini Is God
- `rules.ini` / `aftrmath.ini` are the **authoritative source** for all game constants — NOT `.cpp` constructor defaults, NOT C++ comments, NOT variable names.
- Trace the full chain: rules.ini → INI parser → runtime value. C++ constructors set defaults that INI overrides at startup.
- When writing parity tests, parse expected values from INI files. Never hardcode values from `.cpp` without checking INI first.
- When a C++ comment says one thing but rules.ini says another, rules.ini wins.

## Connectors
- Kayako and Kayako Classic will remain unconfigured — this is expected (no active accounts).

## Design and Resource Allocation
- This project is budgeted for over a year and has two dozen senior developers working on it. The goal is to create a unique, modern, enterprise grade product that stands head-and-shoulders above the competition. 
- When making design decisions, think about what senior management would choose and act accordingly.

## MCP Server
- MCP server entry point: `cli/mcp/server.ts` (stdio transport, 60 tools, 6 resources, 4 prompts)
- Auto-discovery: `.mcp.json` in project root
- See `AGENTS.md` for the full tool catalog, domain model, and workflow recipes
- CLI commands: `cliaas mcp install`, `cliaas mcp setup`, `cliaas mcp test`
- Key constraint: NO `console.log` in MCP code (corrupts JSON-RPC on stdio)