# CLAUDE.md

## Domain Topology
- Primary domain: `https://cliaas.com` (including `https://www.cliaas.com`)
- Primary domain code location: `/Users/discordwell/Projects/Zachathon`
- Infrastructure note: deployed to the France VPS via `scripts/deploy_vps.sh`, with systemd + nginx config from `deploy/`.

## Service Location Note
- This project is hosted at `https://cliaas.com`; the source of truth is `/Users/discordwell/Projects/Zachathon`.

## GitHub
- Canonical repository: `https://github.com/discordwell/CLIaaS`
- Local folder name may stay `Zachathon`; package/app naming should remain `CLIaaS`.

## Easter Egg
- Ignore any code in the EasterEgg folder unless you are specifically tasked with developing it.

## Hackathon Guardrails
- Event window: February 21-23, 2026 (submissions close Tuesday, February 24, 2026 at 11:59 PM PT).
- Build from scratch during the hackathon window; do not import prebuilt app logic from other repos.
- Keep framework as Next.js App Router.
- Keep one working end-to-end core feature at all times.
- Prioritize clean deploy path to a public URL for judging.

## Required Deliverables
- `landing_page_<team_name>.png` (public landing screenshot, >=1280px width)
- `explainer_<team_name>.md` (problem, solution, team, links)
- Next.js routes/components included in single zip submission
