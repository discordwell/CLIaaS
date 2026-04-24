# Parity Sweep Operations Guide

Tooling reference for `docs/parity/commit-protocol.md`. All commands assume
you're in the repo root with a recent deploy on `https://cliaas.com`.

## Per-commit regression battery

Run in this order. Each must pass before committing a parity change:

```bash
# 1. Full vitest (~2 min)
npx vitest run src/EasterEgg --exclude "**/dual-runtime-*.test.ts"

# 2. SCG05 spy smoke (~5 sec) — MANDATORY for vessel/combat changes
bash scripts/smoke-scg05.sh

# 3. First-divergence on critical scenarios (~2 min)
pnpm test:parity:fast              # SCG04, SCG07, SCG11 to tick 30

# 4. Golden divergence catalog (~7 min) — rebuild + diff against baseline
pnpm test:parity:catalog           # rebuild artifacts/divergence-catalog.json
pnpm test:parity:golden            # exit 0 iff no change from baseline
```

## Inspecting divergences

```bash
# Per-cell entity state diff (cell-keyed — replaces index-based matching)
SCENARIO=SCG04EA MAX=25 TYPES=3TNK \
  BASE_URL=https://cliaas.com \
  OUT=artifacts/scg04-percell.json \
  npx playwright test scripts/test-per-cell-diff.ts

# Per-tick RNG call diff (which entities fire WHEN)
SCENARIO=SCG04EA START=23 END=30 DUMP_ALL=1 \
  BASE_URL=https://cliaas.com \
  npx playwright test scripts/test-rng-entity-diff.ts

# Full divergence catalog (all 7 scenarios)
MAX=300 BASE_URL=https://cliaas.com \
  OUT=artifacts/divergence-catalog-investigation.json \
  npx playwright test scripts/test-build-divergence-catalog.ts
```

## Intentional divergence change (e.g. landing a fix)

```bash
# 1. Land the code change, run all regression battery.
# 2. Rebuild catalog:
pnpm test:parity:catalog

# 3. Review the diff:
pnpm test:parity:golden
# ... observe changes ...

# 4. If the change is intended and acceptable per commit-protocol:
UPDATE_GOLDEN=1 pnpm test:parity:golden
# This copies current catalog over the baseline.

# 5. Commit both the code change AND the updated baseline in the same commit.
#    Commit message must cite the baseline change per commit-protocol.md.
```

## WASM instrumentation (Phase 3)

```bash
# Edit src/EasterEgg/CnC_and_Red_Alert/RA/<file>.cpp
# Add: agent_debug_log(tag, a, b, c, d, e, f, g); under the gate you want.
# Tag convention: 3xxxxxx = Start_Driver, 4xxxxxx = logic phase markers,
#                 5xxxxxx = PCP_END Commence, 6xxxxxx = PCP entry.

# Rebuild (takes ~1 min):
cd src/EasterEgg/CnC_and_Red_Alert/build-wasm
emmake cmake --build . --target rasdl -j$(sysctl -n hw.ncpu)
cp RA/rasdl.wasm ../../../../public/ra/

# Deploy and run trace:
cd /Users/discordwell/Projects/CLIaaS
bash scripts/deploy_vps.sh
SCENARIO=SCG04EA MAX=10 BASE_URL=https://cliaas.com \
  npx playwright test scripts/test-scg04-stage-a-trace.ts
```

The WASM ring buffer is 64 entries (see `agent_harness.cpp:g_debug_moves`).
Narrow `if (Frame < N)` windows to stay under the cap.

## Scenarios reference

| Scenario | Family | First-div | Notes |
|---|---|---|---|
| SCG01EA | combat-cascade | 87 | TS fires extra Coord_Scatter |
| SCG03EA | deep | 238 | Late cascade |
| SCG04EA | mission-timing | 24 | PCP chain over-fire + drive-in-GUARD |
| SCG06EA | combat-cascade | 76 | WASM bullet[115] extras |
| SCG07EA | vessel | 4 | IsDoorClosed gate |
| SCG11EA | mission-timing | 19 | Same class as SCG04 |
| SCG13EA | combat-cascade | 101 | Deep infantry guard divergence |
