# CLIaaS - Explainer

## Product Name
CLIaaS

## One-line Description
An LLM-powered CLI that replaces legacy helpdesk UIs (Zendesk, Kayako) with scriptable export, triage, drafting, and KB workflows.

## Team Members
- Name:
- Email:

## Live Deployment URL
- https://cliaas.com

## GitHub Repository URL
- https://github.com/discordwell/CLIaaS

## Problem We Solved (2-3 sentences)
Support teams are trapped in legacy helpdesk UIs that charge per-seat and resist automation. CLIaaS exfiltrates your entire helpdesk — tickets, users, KB articles, macros, triggers, SLA policies — from Zendesk and Kayako via their real APIs, normalizes it into a canonical schema, then runs LLM-powered triage, reply drafting, KB suggestions, and shift summaries from the terminal. No browser tabs, no per-seat licensing — just your data and an LLM.

## How It Works

1. **Export**: `cliaas zendesk export` or `cliaas kayako export` pulls all data via real APIs into local JSONL files with cursor-based incremental sync
2. **Triage**: `cliaas triage` sends open tickets to your LLM (Claude, GPT-4o, or any OpenAI-compatible endpoint) for priority/category/assignment suggestions
3. **Draft**: `cliaas draft reply --ticket <id>` generates context-aware reply drafts using ticket history and KB articles
4. **Suggest**: `cliaas kb suggest --ticket <id>` surfaces the most relevant knowledge base articles for a given ticket
5. **Summarize**: `cliaas summarize --period today` produces a shift/queue summary of current ticket state

## Architecture

- **CLI**: Node.js + Commander.js with real API connectors and LLM provider abstraction
- **Connectors**: Zendesk (node-zendesk + cursor pagination) and Kayako (custom HTTP client + offset pagination)
- **LLM Providers**: Claude (Anthropic SDK), OpenAI, OpenClaw-compatible (Ollama, Together, LM Studio, etc.)
- **Web**: Next.js App Router landing page, dashboard, and settings — deployed to cliaas.com
- **Schema**: Canonical types (Ticket, Message, Customer, Organization, KBArticle, Rule) shared across connectors

## Tech Stack
- Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- TypeScript (strict mode)
- Commander.js, chalk, ora (CLI)
- @anthropic-ai/sdk, openai (LLM providers)
- Deployed via systemd + nginx on VPS
