# CLIaaS

CLIaaS (`cliaas.com`) is a hackathon SaaS skeleton built with Next.js App Router.

Goal: ship a command-line-native SaaS with interoperability, so users can import from existing SaaS and export compatible data back out.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- API routes for health + connector + import/export stubs

## Route Map

- `/` Landing page with value proposition + CTA
- `/sign-in` Auth stub
- `/sign-up` Auth stub
- `/dashboard` Workspace and interop jobs
- `/settings` Connector and token settings
- `/api/health` Deploy/uptime endpoint
- `/api/connectors` Connector catalog endpoint
- `/api/interop/import` Import operation stub (POST)
- `/api/interop/export` Export operation stub (POST)

## Local Development

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm check
```

## Deploy To France VPS (`cliaas.com`)

1. Ensure SSH access to your server.
2. Ensure remote host has Node.js 20+ and `pnpm` (or `corepack`) installed.
3. Set deploy vars and run:

```bash
VPS_HOST=cliaas.com VPS_USER=root bash scripts/deploy_vps.sh
```

Optional overrides:

- `REMOTE_DIR` (default `/opt/cliaas`)
- `SERVICE_NAME` (default `cliaas`)
- `APP_PORT` (default `3101`)
- `SKIP_NGINX=1` to skip nginx config step

Deployment installs:

- `deploy/cliaas.service` -> systemd unit
- `deploy/nginx.cliaas.com.conf` -> nginx reverse proxy

## Hackathon Submission Helpers

Export routes/components:

```bash
pnpm export:routes
```

Create final zip bundle (after you add screenshot + explainer):

```bash
pnpm bundle:submission -- CLIaaS landing_page_CLIaaS.png
```

Files expected by the event:

- `landing_page_<team_name>.png`
- `explainer_<team_name>.md`
- project source/routes in the zip

Template included: `explainer_CLIaaS.md`.

## GitHub

Target public repo: `https://github.com/discordwell/CLIaaS`
