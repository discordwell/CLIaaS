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

## MCP Server
- MCP server entry point: `cli/mcp/server.ts` (stdio transport, 18 tools, 6 resources, 4 prompts)
- Auto-discovery: `.mcp.json` in project root
- See `AGENTS.md` for the full tool catalog, domain model, and workflow recipes
- CLI commands: `cliaas mcp install`, `cliaas mcp setup`, `cliaas mcp test`
- Key constraint: NO `console.log` in MCP code (corrupts JSON-RPC on stdio)