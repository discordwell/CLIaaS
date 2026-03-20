# M8 Dual-Runtime Comparison Design

## Goal

Run Mission 8 (SCG08EA, "Chronoshift") to completion on both the TypeScript engine and the C++ WASM build, capturing paired screenshots and state snapshots at regular intervals. Produce a structured report identifying systemic differences between the two engines — wrong stats, broken animations, visual mismatches, behavioral divergences — while ignoring RNG-driven noise.

## Approach

**Independent Oracle runs.** The Oracle drives each runtime independently, reading each runtime's state and making its own tactical decisions. Both play M8 with the same strategy logic (defense-only, ATEK garrison, rally at y=95) but adapt to their own game state. This avoids the fragility of command replay on a divergent state.

## Architecture

### Test File

`src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts`

Uses existing infrastructure:
- `TsAgentAdapter` — controls TS runtime via Playwright
- `WasmAdapter` — controls C++ WASM build via Playwright
- `SharedTsOracleStrategy` (from `SharedOracleBridge.ts`) — wraps OracleStrategy for the TS runtime, handling state normalization (`normalizeTsState()`) and command translation (`translateOracleDecisionToTs()`)
- `OracleStrategy` — used directly for the WASM runtime (native `RAGameState` format)
- `dual-runtime-test-utils.ts` — server management, adapter setup

### Execution Flow

1. Launch both runtimes via adapters (Playwright headless browsers)
2. Load SCG08EA on both
3. Run main loop:
   - **TS side:** `SharedTsOracleStrategy.decide(agentState)` produces translated `AgentCommand[]`
   - **WASM side:** `OracleStrategy.decide(raGameState)` produces native commands
   - Step each runtime by 10 ticks with its commands
   - Every 100 ticks: capture screenshot + full state JSON from both
   - Track combat events by diffing state between steps (HP changes, unit deaths)
4. Continue until mission ends or 2700 ticks reached
5. Run divergence analysis on collected data
6. Generate report

### Mission End Detection

- **TS:** `state.state === 'won' | 'lost'`
- **WASM:** `state.winPending | state.losePending`
- Also: `oracle.checkResult(state)` returns `'victory' | 'defeat' | 'playing'`
- If either runtime ends before 2700 ticks, capture final state and note the tick difference in the report

### Error Handling

Wrap the main loop in try/catch. On Playwright crash or WASM abort, generate a partial report from whatever data has been collected so far, noting the crash tick and error.

### Output Directory

```
docs/m8-comparison/
  screenshots/
    ts-0000.png, cpp-0000.png
    ts-0100.png, cpp-0100.png
    ...
    ts-2700.png, cpp-2700.png
  states/
    ts-0000.json, cpp-0000.json
    ...
  REPORT.md
```

The `screenshots/` and `states/` directories should be gitignored (large generated files). `REPORT.md` is the primary artifact and can be committed.

## Snapshot Strategy

**Regular interval:** Every 100 ticks (~27 paired snapshots over full mission).

Each snapshot includes:
- Screenshot (PNG) from the runtime's browser viewport
- Full serialized game state (JSON): units, structures, production, credits, triggers, tick count

## Divergence Detection

### Domains

| Domain | What to Compare | Systemic Signal |
|--------|----------------|-----------------|
| **Combat** | HP deltas per step, death counts by unit type | Same unit type consistently takes more/less damage |
| **Visuals** | Screenshot pairs at same tick + pixel-diff percentage | Buildings/units/terrain look different |
| **Production** | Build times, costs, queue behavior | Factory produces faster/slower |
| **Movement** | Unit speed per tick, cells traversed per step | Units move at wrong speed |
| **Triggers** | Mission events, reinforcements, timer | Events fire at different ticks |
| **Stats** | Max HP values at mission start | Fundamental stat mismatch |

### Analysis Method

For each domain, compare aggregate statistics rather than individual ticks:

- **Combat:** Average HP loss per step by unit type. Flag if TS and C++ differ by >15%.
- **Production:** Compare average build time per unit type. Flag if TS differs by >10%.
- **Movement:** Compare distance-per-tick for same unit type. Flag if TS differs by >5%.
- **Stats:** Compare max HP values at mission start. Flag any difference. Note: weapon stats (damage, range, fire rate) are available in TS `AgentState` but NOT in WASM `RAEntity`. Comparison is limited to HP-based observables unless the C++ harness is extended.
- **Triggers:** Compare tick numbers for key events (reinforcement waves, timer milestones). Flag if >50 ticks apart.
- **Visuals:** Save paired screenshots with pixel-diff percentage. Flag pairs with >5% pixel difference (excluding expected RNG variation like unit positions).

All divergence analysis operates on **normalized** state (via `normalizeTsState()` for TS, native for WASM). This matters for production progress: TS reports 0.0-1.0, WASM reports 0-100; normalization converts TS to 0-100 to match.

### What It Won't Flag

- Exact unit positions (RNG drift)
- Exact kill counts (stochastic combat outcomes)
- Minor timing differences (less than 50 ticks on production, less than 5 ticks on combat)

## Oracle Integration

### WASM Side (native)

`OracleStrategy` operates directly on `RAGameState` (the WASM adapter's native format):
1. `WasmAdapter.getState()` returns `RAGameState`
2. `OracleStrategy.decide(raGameState)` returns commands in `{ cmd, ids, cx, cy, target }` format
3. Commands passed directly to `WasmAdapter.step(ticks, commands)`

### TS Side (via SharedOracleBridge)

`SharedTsOracleStrategy` wraps the Oracle and handles format translation:
1. `TsAgentAdapter.getState()` returns `AgentState`
2. `SharedTsOracleStrategy.decide(agentState)` internally:
   - Normalizes `AgentState` → `RAGameState` via `normalizeTsState()`
   - Calls `OracleStrategy.decide(normalizedState)`
   - Translates output commands to TS format via `translateOracleDecisionToTs()`
3. Translated `AgentCommand[]` passed to `TsAgentAdapter.step(ticks, commands)`

### Production Command Gap

`translateOracleDecisionToTs()` currently handles: `move`, `attack_move`, `attack`, `stop`, `enter`, `deploy`. It does NOT handle production commands (`produce`, `place`, `build`, `sell`, `repair`). The Oracle's `decideBaseBuilding()` generates these.

**Resolution:** Extend `translateOracleDecisionToTs()` to handle production commands before implementing this test. The TS harness accepts `{ cmd: 'build', type: 'HTNK' }` format; the Oracle generates `{ cmd: 'produce', rtti: N, type_id: N }` format. A mapping from RTTI+type_id to TS type names is needed.

Note: `place` commands are also more complex than unit commands. The Oracle generates `{ cmd: 'place', rtti: RTTI_BUILDINGTYPE, cx, cy }` for buildings and `{ cmd: 'place', rtti: RTTI_UNITTYPE }` for unit exit (no coordinates). The TS harness `place` is `{ cmd: 'place', cx, cy }` (places pending building). The translation must handle both RTTI variants.

## Test Configuration

- **Timeout:** 20 minutes (vitest timeout) — accounts for two browser startups, WASM initialization (43MB gamedata), 540+ Oracle decision cycles, and 27 screenshot captures per runtime
- **Stepping:** Both runtimes step in parallel via `Promise.all` (matching the existing `stepBoth()` pattern). Each processes its own 10-tick step independently. This is safe because each engine is deterministic within its own state and the Oracle decisions are computed independently before stepping.
- **Failure mode:** On crash, generate partial report from collected data

## Success Criteria

The test itself always passes — it's a comparison tool, not an assertion suite. The output is the REPORT.md file with categorized divergences and paired screenshots for the user to review.
