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

## Required Deliverables
- `landing_page_<team_name>.png` (public landing screenshot, >=1280px width)
- `explainer_<team_name>.md` (problem, solution, team, links)
- Next.js routes/components included in single zip submission