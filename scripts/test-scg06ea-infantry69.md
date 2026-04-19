# SCG06EA tick 1 — infantry[69] RNG divergence investigation (Task #50)

## Problem

SCG06EA has 499/501 divergent ticks. First real divergence at engine tick 1,
where WASM infantry[69] (E1 USSR at cell 24,67, AREA_GUARD mission) makes 2 RNG
calls that TS does not.

## C++ call graph at tick 1

`InfantryClass::AI()` (infantry.cpp:1165) runs the following pipeline per tick:

1. `FootClass::AI()` → `TechnoClass::AI()` → `MissionClass::AI()` →
   `ObjectClass::AI()` — the base chain that processes animation stages and,
   critically, dispatches the mission handler when `Timer == 0`.
2. At scenario init, `scenario.cpp:3397-3398` does `Assign_Mission(mission);
   Commence();` which sets `Mission = MISSION_GUARD_AREA; Timer = 0; Status = 0`.
   So on the first AI tick, `Mission_Guard_Area` fires immediately.
3. `Fear_AI`, `Firing_AI`, `Doing_AI`, `Movement_AI` run after.

`FootClass::Mission_Guard_Area` (foot.cpp:995-1048) has three RNG-relevant paths:

| entry state                | RNG |
|----------------------------|-----|
| TarCom legal at entry      | `Approach_Target()` (no RNG) + `Random_Pick(1,5)` = **1** |
| TarCom invalid, scan hit   | returns `1` early, no RNG — **0** |
| TarCom invalid, scan empty | `Random_Animate()` + `Random_Pick(1,5)` = **1-3** |

## Inside `InfantryClass::Random_Animate` (infantry.cpp:1742-1823)

The guard `Is_Ready_To_Random_Animate()` (infantry.cpp:4088-4141) chains:

- `TechnoClass::Is_Ready_To_Random_Animate` — `IdleTimer == 0` (constructor: 0, passes)
- `Height > 0` check (passes for a grounded infantry)
- `!IsDriving`, `!IsProne`, `!IsFiring` (all pass for fresh E1)
- **`Doing != DO_STAND_GUARD && Doing != DO_STAND_READY` → returns false**

`InfantryClass` constructor (infantry.cpp:178) initialises `Doing(DO_NOTHING)`.
Neither `Unlimbo` nor `Commence` modify `Doing`. So naively, on tick 1
`Is_Ready` returns false and `Random_Animate` consumes 0 RNG — Mission_Guard_Area
would only spend 1 RNG (the jitter).

**But WASM evidence shows 2 _additional_ RNG calls on this tick (3 total),** matching the
"Random_Animate succeeds" path:

- `Random_Pick(RandomAnimateTime * 450/2, RandomAnimateTime * 1800)` = **1 RNG** (idle timer)
- `Random_Pick(0, 10)` = **1 RNG** (animation switch)
- plus the Mission_Guard_Area trailing `Random_Pick(1,5)` = 1 RNG

Because the switch result is usually < 6, the facing pick (case 6-10) does not
fire — matching the observed "exactly 2 more" count.

For `Is_Ready_To_Random_Animate` to return true on tick 1, something must have
set `Doing` to `DO_STAND_READY` before the mission AI ran. Candidate hypotheses:

1. `DoControls[DO_NOTHING].Count == 0` — `Doing_AI` short-circuits past the
   stage check (infantry.cpp:3685) and advances Doing to DO_STAND_READY, but
   only if `Doing_AI` runs _before_ Mission AI. In the call order it does NOT
   (FootClass::AI runs first). So this alone doesn't explain tick-1 behaviour.
2. `Commence()` or `Assign_Mission()` during scenario init indirectly triggers
   an animation transition we haven't traced (e.g. via `Mark` + `Graphic_Logic`).
3. Some init code we haven't located calls `Do_Action(DO_STAND_READY)`
   explicitly during placement.

## Instrumentation added

Granular RNG tags have been added locally to the WASM source so that the next
parity test can distinguish which Random_Pick inside Random_Animate fires. Note
the `CnC_and_Red_Alert/RA/` subtree is .gitignored except for a few allow-listed
files, so these edits live only in the local build tree and will be rebuilt on
`bash build-wasm.sh`:

| site id | file:line               | purpose                                 |
|---------|-------------------------|-----------------------------------------|
| 30000   | foot.cpp:1059           | Mission_Guard_Area Random_Pick(1,5)     |
| 30001   | infantry.cpp:1750       | Random_Animate IdleTimer Random_Pick    |
| 30002   | infantry.cpp:1763       | Random_Animate switch Random_Pick(0,10) |
| 30003   | infantry.cpp:1795-1830  | Random_Animate facing Random_Pick (cases 6-10) |

The tags wrap each `Random_Pick` with a save/restore of `g_rng_source_tag`
using the existing `extern int g_rng_source_tag` framework from logic.cpp:288.
A subsequent parity run can dump `rngLog` and grep for tags 30000-30003 on
infantry[69] at tick 1 to confirm the IdleTimer + switch picks are the source.

## Speculative fix applied

`scenario.ts` now sets `entity.doing = 'stand_ready'` for every infantry
immediately after `applyMission()` at scenario load time. This mirrors the
observed C++ runtime state so that `isReadyToRandomAnimate()` returns true on
the first AI tick, enabling Random_Animate to consume its 2 RNGs in parity with
WASM.

Tests added in `cpp-parity-infantry-init-doing.test.ts`:
- Default Entity still defaults to `doing="nothing"` (unchanged).
- Fresh infantry Entity defaults to `doing="nothing"` (constructor parity).
- `isReadyToRandomAnimate()` gates correctly on `doing` state.
- `scenario.ts` source is pinned to contain the seeding line.

## What the TS fix does

Before fix — TS tick 1 flow for AREA_GUARD infantry:
1. `updateAreaGuard` scans, finds no target, calls `isReadyToRandomAnimate()`.
2. Check fails (`doing === 'nothing'`). 0 RNG consumed in Random_Animate.
3. `index.ts:3978` picks jitter: `ScenarioRandom.nextInRange(1, 5)` — 1 RNG.

After fix:
1. `updateAreaGuard` scans, finds no target, calls `isReadyToRandomAnimate()`.
2. Check passes (`doing === 'stand_ready'`). Two RNGs consumed:
   - `idleAnimTimer = nextInRange(44, 176)` — 1 RNG
   - `animPick = nextInRange(0, 10)` — 1 RNG
3. (No facing pick unless animPick ≥ 6.)
4. `index.ts:3978` picks jitter `nextInRange(1, 5)` — 1 RNG.

Total: 3 RNG, matching WASM for infantry[69] on tick 1.

## Verification

- `npx vitest run` — 55,070 passed / 2 pre-existing flaky SCG05EA tests / 55 skipped.
- New test suite `cpp-parity-infantry-init-doing.test.ts` — 4/4 passing.
- Full parity run would require `scripts/deploy_vps.sh` + browser harness;
  skipped per the task instructions (parallel agents constraint).

## Confidence

Medium. The fix is speculative — we have not yet rebuilt-and-rerun the granular
rngLog comparison to confirm tags 30001+30002 are the exact divergent pair.
But the arithmetic aligns (3 RNG WASM vs 1 RNG TS → delta of 2 = IdleTimer pick +
switch pick), and the fix is the minimum change consistent with that delta.
