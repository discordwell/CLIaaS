# SCG13EA Tick-43 Divergence Investigation (Task #43)

## Task framing vs. reality
Task #43 described the bug as **"MRJ pathfinding tie-breaking"** causing a 22-tick delay
in a Soviet crusher (presumably a 3TNK/4TNK) missing 2 player E1 infantry, with first
divergence at tick 43 of SCG13EA.

After running the per-entity RNG diff and caller trace, the observed divergence is
**not** a pathfinding problem. All RNG seeds produced up through tick 43 match exactly
between WASM and TS. The only divergence is that WASM makes **one additional
`nextInRange` call** on tick 43 that TS does not.

## Observed evidence

Command:
```
SCENARIO=SCG13EA START=42 END=44 npx playwright test scripts/test-rng-entity-diff.ts
```

- Tick 0-42: identical RNG stream (same seeds, same call count).
- Tick 43: WASM 97 calls, TS 96 calls, Δ = 1.
- Calls [0..95] are identical seed-for-seed in both engines. Only the *tag*
  (logic-layer index) differs, and that is a cosmetic labeling difference —
  WASM's `logicIdx` comes from the unified `LayerClass` (spanning units +
  infantry + buildings + ...), while TS's `logicIdx` is per-array.
- Call [96] is WASM-only: `infantry[192]` at cell `(27,46)` consumes seed
  `2927552457 → ...`. TS has no matching entry. This entity is a Soviet E1
  (`E1 (USSR) cell(27,46)` in the Logic-layer dump).

## Caller trace (tick 43)

```
SCENARIO=SCG13EA TICK=43 npx playwright test scripts/test-rng-caller-trace.ts
```

Every RNG call on tick 43 is either:
1. `_runMissionAI → updateGuard → (anonymous 398497/398528/398557) → nextInRange`
2. `_runCombat → _processGroundEntity → updateEntity → nextInRange`

No `findPath`, `basicPath`, `followEdge`, `aStar`, or `pathfinding` frames appear
in the tick-43 TS stack. Whatever is happening at tick 43 is **pure guard/combat
AI scheduling**, not path planning.

The minified offsets `398497 / 398528 / 398557` live inside `updateGuard` and
correspond to the guard-jitter RNG calls driven by:

- `src/EasterEgg/engine/index.ts:3966` — guard-timer jitter
  `entity.missionTimer = armBeforeScan > 0 ? armBeforeScan : guardDelay + ScenarioRandom.nextInRange(0, 2);`
- `src/EasterEgg/engine/missionAI.ts:~863` — guard scan entry (`cellBasedGuardScan`, Tanya skip, etc.)

The `_processGroundEntity → updateEntity → nextInRange` pattern is **scatter on
damage** or **movement jitter** in the per-entity post-update step.

## Most likely root cause

TS and WASM agree on the RNG stream for 96 of 97 calls this tick. The 97th call
in WASM is the **guard-scan jitter call** for the Soviet E1 at cell (27,46).
That entity exists in TS but is not reaching the `nextInRange(0,2)` jitter at
`index.ts:3966` on the same tick.

Plausible causes (in priority order):

1. **Timer desync** — The E1 at (27,46) has `missionTimer > 0` in TS but 0 in
   WASM on tick 43. This would be an off-by-one in timer decrement, likely
   traceable to the `armBeforeScan > 0 ? armBeforeScan : ...` branch: if the
   armBeforeScan path is taken in TS but not WASM, the jitter RNG call is
   skipped.
2. **Mission mismatch** — This E1 might be in `Mission.HUNT` / `ATTACK` in TS
   vs `GUARD` in WASM on tick 43 (HUNT bypasses the guard-jitter RNG).
3. **Early-return in updateGuard** — `missionAI.ts:891-903` (Firing_AI fire
   branch) returns before reaching the scan, and `missionAI.ts:947-986` (hold-
   fire, harvester, spy, cloakable, dog) also early-return. If this E1's target
   state differs, one of those branches fires in TS but not WASM.
4. **Entity ordering** — Unlikely since seeds match through [95], but worth
   ruling out: TS iterates entities in a different order than WASM's
   LayerClass, and an earlier side-effect (damage) kills the entity before its
   guard tick.

## Why the task described this as "MRJ pathfinding"

The "crusher misses 2 player E1s by 22 ticks" summary is consistent with the
**downstream** effect: one guard-scan RNG-skip at tick 43 cascades. The E1's
TarCom/NavCom for the next scan cycle is now chosen from a different RNG
position, which over ~22 ticks reroutes the Soviet 3TNK/4TNK path — the
apparent "pathfinding divergence" is actually a scheduled-jitter divergence.

No change to `pathfinding.ts` is warranted. Basic_Path already implements the
C++ CW/CCW edge-follow tie-break (`findpath.cpp:779-1018`). The
`pathfinding.ts:1-120` header confirms the port, and tick-43 never invokes
pathfinding in the TS stack trace.

## MRJ stats confirmed correct

- `rules.ini:566-578` MRJ: Strength=110, Armor=light, Speed=9, ROT=5, Tracked=yes
- `types.ts:920` MRJ stats match rules.ini exactly (speed: 9, rot: 5, armor: 'light', speedClass: TRACK)

## Recommended follow-up (not done in this task — out of scope)

1. Extend the logic-layer dump in `test-rng-entity-diff.ts` to also emit each
   entity's `mission`, `missionTimer`, `target`, `attackCooldown`, and `path`
   length at tick 42 *end* / tick 43 *start* for both engines, filtered to
   house=USSR.
2. Diff the E1 at cell (27,46) specifically. Expect to see `missionTimer` or
   `mission` differing by 1 tick.
3. If `missionTimer` is the culprit, check Guard-timer seeding at mission-start
   — especially the `armBeforeScan` early-return path in `index.ts:3964-3966`.

## Files reviewed

- `/Users/discordwell/Projects/CLIaaS/public/ra/assets/SCG13EA.ini` (lines 94, 431-433: MRJ TeamType + 3 MRJ units at cells 7188/7191/7444)
- `/Users/discordwell/Projects/CLIaaS/public/ra/assets/rules.ini` (lines 566-578: MRJ section)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/types.ts` (line 920: MRJ stats — match)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/pathfinding.ts` (all — no divergence observed)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/missionAI.ts` (line 863: updateGuard)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/index.ts` (lines 3936-3968: GUARD case + jitter)
- `/Users/discordwell/Projects/CLIaaS/scripts/test-rng-entity-diff.ts`
- `/Users/discordwell/Projects/CLIaaS/scripts/test-rng-caller-trace.ts`

## Confidence

**High** that the divergence is not pathfinding-related (RNG stack trace shows
only `updateGuard` / `_processGroundEntity` frames at tick 43; seeds through
[95] match identically).

**Medium** on the specific root cause being the guard-jitter call for the E1
at (27,46) — the data points clearly to one missed `nextInRange(0,2)` call for
a single entity, but the *reason* that entity doesn't reach the jitter line
needs one more diagnostic step (per-entity mission/timer dump at tick 42).
