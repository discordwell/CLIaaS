# SCG11EA Tick-1 HIND RNG Instrumentation — Investigation Notes

## Problem Recap (Task #53)

SCG11EA tick 1 has two HIND aircraft docked on HPADs:
- HIND 131 at cell(45,39), docked at HPAD (44,39) — consumes **1 RNG** in WASM.
- HIND 149 at cell(53,39), docked at HPAD (52,39) — consumes **3 RNG** in WASM.
- TS consumes **0 RNG** for the same ticks → 4-RNG deficit per tick.

Both HINDs transition `mission = 5 (GUARD)` → `mission = 1 (ATTACK)` at tick 1.
Serialization shows **NO TarCom, NO NavCom** — the mission changes to ATTACK without
a recorded target, indicating the transition occurs via `Assign_Mission` (queued) and
Mission_Attack has not yet picked up TarCom on the same tick.

`500-tick SCG11EA sweep: 478/501 divergent.` Cumulative RNG drift is catastrophic.

## Earlier Ruled Out

- `Target_Legal` (TarCom absent at sample point)
- `Find_Juicy_Target` (deterministic)
- `Greatest_Threat` (pure cell scan)
- `Good_Fire_Location Percent_Chance(50)` (only 1 call per firing, not 3)
- `Scatter` for aircraft (Enter_Idle_Mode path has no RNG before Mission is reassigned)
- `Random_Animate` for aircraft (TechnoClass default returns false)
- `Rotation_AI` / `Movement_AI` (deterministic)

## Tags Added (this commit)

**File: `src/EasterEgg/CnC_and_Red_Alert/RA/aircraft.cpp`**

Tag range **40000–40099** (aircraft-specific RNG call sites). Logged via the
`g_rng_source_tag` mechanism defined in `random.cpp:99`. A per-tick log flush
(`agent_harness.cpp:578-592`) reveals tag + seed for each RNG call.

| Tag    | Site                                                           | Line (approx) |
| ------ | -------------------------------------------------------------- | ------------- |
| 40000  | `AircraftClass::AI` entry (before `Commence()`)                 | 867           |
| 40001  | `AircraftClass::AI` → `FootClass::AI()`                         | 881           |
| 40002  | `AircraftClass::AI` → `Rotation_AI()`                           | 897           |
| 40003  | `AircraftClass::AI` → `Movement_AI()`                           | 902           |
| 40010  | `Mission_Hunt` final `Random_Pick(0,2)`                         | 849           |
| 40020  | `Mission_Unload` final `Random_Pick(0,2)`                       | 1219          |
| 40030  | `Mission_Retreat` final `Random_Pick(0,2)`                      | 1371          |
| 40040  | `Mission_Move` final `Random_Pick(0,2)`                         | 1849          |
| 40050  | `Mission_Attack` final `Random_Pick(0,2)`                       | 2612          |
| 40060  | `Paradrop_Cargo` crew-parachute `Percent_Chance(90)`            | 1588          |
| 40070  | `New_LZ` radius scan `Random_Pick(FACING_N, FACING_NW)`         | 2639          |
| 40080  | `Good_Fire_Location` `Percent_Chance(50)`                       | 3120          |
| 40090  | `Mission_Guard` entry (before attached/juicy/fall-through)      | 3684          |
| 40091  | `Enter_Idle_Mode` entry                                         | 1869          |

**File: `src/EasterEgg/CnC_and_Red_Alert/RA/foot.cpp` — NOT committed (gitignored)**

`foot.cpp` is cloned at build time from `Daft-Freak/CnC_and_Red_Alert` and is
gitignored (see `.gitignore:65`). To instrument it, apply these edits **locally**
before `bash build-wasm.sh`:

```cpp
// Near the top, after `#include "function.h"`:
extern int g_rng_source_tag;

// Inside FootClass::Mission_Guard (foot.cpp:~620):
if (!Target_Something_Nearby(THREAT_RANGE)) {
    if (What_Am_I() == RTTI_AIRCRAFT) g_rng_source_tag = 41001;
    Random_Animate();
}

// At the final return (foot.cpp:~665):
if (What_Am_I() == RTTI_AIRCRAFT && Arm == 0) g_rng_source_tag = 41002;
return((Arm != 0) ? (int)Arm : (dtime+Random_Pick(0, 2)));
```

Tag range **41000–41099** reserved for FootClass fall-through (only tags when
`What_Am_I() == RTTI_AIRCRAFT` to avoid polluting infantry/unit attribution).

| Tag    | Site                                                            |
| ------ | --------------------------------------------------------------- |
| 41001  | `FootClass::Mission_Guard` → `Random_Animate()` (aircraft)       |
| 41002  | `FootClass::Mission_Guard` → `Random_Pick(0,2)` delay (aircraft) |

## Expected C++ Call Site (Analytic Guess)

Given HPAD-docked HIND at `Height=0`, mission queue `GUARD`, and that
`House->IsHuman` early-return at `aircraft.cpp:3726` fires **ONLY** for human houses:

- If the HIND is AI-owned (probable: secondary Soviet faction on SCG11EA such as
  `HOUSE_BAD` or `HOUSE_UKRAINE` garrisoning enemy HPADs), the flow is:
  1. `AircraftClass::Mission_Guard` (tag 40090)
  2. `Height == FLIGHT_LEVEL` false → skip.
  3. `House->IsHuman` false → skip early return.
  4. Not damaged → skip repair-bay branch.
  5. `Ammo != 0` → skip rearm branch.
  6. `Target_Legal(TarCom)` false → skip attack assignment.
  7. `Is_Weapon_Equipped()` true (HIND has weapon) → skip sit-still branch.
  8. `Height==0 && !In_Radio_Contact()` — HIND IS tethered to HPAD → skip Scatter.
  9. `House->State != STATE_ATTACKED` → call `Find_Juicy_Target` (deterministic).
     - HIND 131: no juicy target found → `target` stays TARGET_NONE.
     - HIND 149: finds a juicy target (a player unit outside own base) → sets TarCom.
  10. `return(FootClass::Mission_Guard())`:
      - `Target_Something_Nearby(THREAT_RANGE)`:
         - HIND 149 has TarCom → returns true → skip Random_Animate (no tag 41001).
         - HIND 131 has no TarCom → `Greatest_Threat(THREAT_RANGE)` runs.
           If it finds a threat within range, assigns; else returns false → `Random_Animate()` fires (but TechnoClass::Random_Animate returns false for aircraft — **no RNG**).
      - Final `return (Arm != 0 ? Arm : dtime + Random_Pick(0,2))` — **1 RNG (tag 41002)**.

This explains **HIND 131 = 1 RNG** cleanly.

**HIND 149 = 3 RNG** is harder. Candidates:
- `Assign_Mission(MISSION_ATTACK)` via `MissionClass::AI` then running `Mission_Attack()`
  on the same tick? No — `Commence()` defers until next tick.
- Second helicopter fires `Good_Fire_Location Percent_Chance(50)` inside a weapon-search
  path? No — that's in Can_Fire, not called during Mission_Guard.
- Most likely: the second HIND enters a **different mission path** because it found a
  target in `Find_Juicy_Target`. After `Assign_Target + Assign_Mission(MISSION_ATTACK)`,
  the handler falls through to `FootClass::Mission_Guard` → `Target_Something_Nearby` →
  `In_Range` validation on the new target, then **Random_Pick(0,2)** at return. That's
  still 1 RNG.

**The 3 RNG for HIND 149 is not explained by Mission_Guard alone.** Likely suspects
(to be confirmed by a WASM deploy + sweep with the new tags):

1. **`MissionClass::Commence` → immediate mission AI dispatch** — after Mission_Guard
   returns, if `Status=0` and `Timer=0`, `MissionClass::AI` could re-run and invoke
   `Mission_Attack` same tick. `Mission_Attack` final returns `Random_Pick(0,2)` (tag
   40050) → another RNG.
2. **`Enter_Idle_Mode` → `Find_Docking_Bay` → LZ selection path** — if Mission_Guard
   triggers `Enter_Idle_Mode` (Scatter path), `New_LZ Random_Pick(FACING)` (tag 40070)
   could fire.
3. **Aircraft falling through with passenger attached** — `Is_Something_Attached()` at
   `aircraft.cpp:3683` transitions directly to MISSION_RETREAT. No RNG direct, but
   subsequent handler runs could consume. HIND typically has no passengers.
4. **`Coord_Scatter` when creating effects on combat** — unlikely pre-combat.

## Next Step: Deploy + Sweep

Once WASM is rebuilt (requires `bash build-wasm.sh`; 2-5 min) and deployed, run the
SCG11EA 500-tick sweep again. The RNG log will show tag numbers per call. For HIND 131
expect `[41002]`. For HIND 149 expect 3 tags; if they include `40050` that confirms
same-tick Mission_Attack dispatch.

Alternatively: adapt the agent harness to selectively enable `g_rng_log_enabled` only
for tick 1 (`g_rng_log_count = 0; g_rng_log_enabled = (Frame == 1)`) and inspect the
tag stream printed by the harness buffer dump.

## Proposed TS Fix (Speculative)

Once the real C++ site is pinpointed, the TS fix is one of:

### A. `FootClass::Mission_Guard` fall-through for aircraft (likely covers HIND 131)

In `src/EasterEgg/engine/index.ts` HPAD helicopter block (line 1897-1937):
The existing TS code *does* consume 1 RNG via `ScenarioRandom.nextInRange(0, 2)` at
line 1926 — but only when the helicopter is in GUARD + `landed` state AND no target.
Verify:
- `heli.aircraftState === 'landed'` is true for fresh HPAD HIND at tick 1.
- `heli.missionTimer === 0` at tick 1 (initial value — see `entity.ts:141`).
- `hasTarget` is false (no target) so falls to the scan branch → `nextInRange(0,2)`.

**Claim**: TS already does this. But the problem says "TS consumes 0". Possible cause:
the `GUARD + landed` condition is false for one or both HINDs (e.g., aircraftState is
not yet 'landed' at tick 1 because scenario.ts initializes state before Game.start()
consumed init-time RNG). Or `hasTarget` is true for some reason.

### B. AI-only Mission_Guard fall-through missed in TS

TS `_heliGuardScan` (index.ts:5380) only fires via the HPAD block (human player or AI).
For AI-owned HPADs, the scan happens the same way. Inspect `_heliGuardScan` to ensure:
- `Find_Juicy_Target` equivalent runs (it does, line 5382-5436).
- After scan, `ScenarioRandom.nextInRange(0, 2)` runs ONCE to match foot.cpp:668.

### C. Handle Mission_Attack same-tick dispatch

If WASM shows tag `40050` for HIND 149, the C++ `MissionClass::Commence()` + immediate
`Mission_Attack` re-dispatch is the culprit. In TS, when `_heliGuardScan` assigns an
ATTACK mission, immediately call an attack-path RNG consume:
```ts
if (heli.mission === Mission.ATTACK && prevMission === Mission.GUARD) {
  // C++ aircraft.cpp:2612 Mission_Attack final Random_Pick(0,2)
  ScenarioRandom.nextInRange(0, 2);
}
```

## Commit Scope

This commit adds only **C++ instrumentation tags** — no WASM rebuild, no TS changes,
no deploy. The analyst runs `bash src/EasterEgg/build-wasm.sh` locally, deploys to the
parity server, then re-runs the SCG11EA sweep to read tag IDs per RNG call.

## Files Modified

- `src/EasterEgg/CnC_and_Red_Alert/RA/aircraft.cpp` — 12 tag additions (40000-40091). TRACKED.
- `src/EasterEgg/CnC_and_Red_Alert/RA/foot.cpp` — documented above, **apply locally
  before WASM rebuild**. NOT tracked (gitignored at `.gitignore:65`).

## Verification

- `npx vitest run` — 55070 tests pass (TS behavior unchanged; tags are C++/WASM-only).
- WASM rebuild required to see effect: `cd src/EasterEgg && bash build-wasm.sh`.
