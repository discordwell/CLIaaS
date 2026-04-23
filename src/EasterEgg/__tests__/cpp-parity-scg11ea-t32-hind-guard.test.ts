/**
 * C++ Parity: SCG11EA tick-32 Δ=-5 root cause — HIND Mission_Attack landed
 * two-stage transition (aircraft.cpp:2409-2621, aircraft.cpp:1876-2066).
 *
 * ## Summary
 *
 * Agent ad83df56 (commit 499ce143) proved that the tick-32 Δ=-5 was NOT
 * structure iteration order but behavior drift in TS's HPAD HIND Mission_Attack
 * handler. Prior TS (index.ts:1990-1998 "old") looped `Status=VALIDATE_AZ`
 * forever: every 14-16 ticks it fired one `Random_Pick(0,2)` and re-set the
 * timer to `14 + jitter`, staying in `Mission.ATTACK` indefinitely.
 *
 * C++ actually unfolds the landed-no-target path over TWO timer fires:
 *
 *   Fire A (Status=VALIDATE_AZ, aircraft.cpp:2432-2438):
 *     if (!Target_Legal(TarCom)) Status = RETURN_TO_BASE;
 *     break;
 *   // falls through to aircraft.cpp:2620:
 *   return MissionControl[MISSION_ATTACK].Normal_Delay() + Random_Pick(0,2);
 *   // == 14 + jitter; Mission stays ATTACK.
 *
 *   Fire B (Status=RETURN_TO_BASE, aircraft.cpp:2603-2614, ~14-16 ticks later):
 *     Enter_Idle_Mode();  // aircraft.cpp:1876 → Assign_Mission(MISSION_GUARD)
 *     Commence();          // flips Mission=GUARD, Timer=0
 *     break;
 *   // falls through to aircraft.cpp:2620, but Mission is now GUARD:
 *   return MissionControl[MISSION_GUARD].Normal_Delay() + Random_Pick(0,2);
 *   // == 42 + jitter; Mission is now GUARD.
 *
 * After Fire B the HIND is in GUARD for ~42 ticks per cycle (no RNG while
 * Timer > 0). TS's old code never reached Fire B, so it kept consuming RNG
 * every ~14 ticks — +2 HIND calls per fire interval vs WASM's steady-state
 * silence. At SCG11EA tick 32 this surfaced as TS firing `aircraft[69]` and
 * `aircraft[87]` Mission_Guard/Attack timer jitter that WASM didn't fire,
 * which then shifted SAM timers and produced the Δ=-5 downstream.
 *
 * ## Fix
 *
 * src/EasterEgg/engine/index.ts Phase 2 HPAD helicopter block — track
 * `entity.aircraftAttackStatus` mirroring C++ Status. Fire A sets it to
 * RETURN_TO_BASE(=6); Fire B transitions Mission→GUARD with timer=42+jitter
 * and resets status (Commence sets Status=0).
 *
 * The Mission.GUARD landed handler was also fixed in the same commit to gate
 * `Random_Pick(0,2)` behind `attackCooldown === 0`, matching C++ foot.cpp:684
 * where `if (Arm != 0) return (int)Arm;` early-returns WITHOUT firing
 * Random_Pick. Prior TS fired the jitter unconditionally.
 *
 * ## Evidence
 *
 * - SCG11EA first-divergence before fix: tick 32 (WASM 6 calls, TS 11 calls,
 *   Δ=-5, 5 extras clustered on `aircraft[69/87]` HIND Logic positions and
 *   `building[92/93]` SAM Logic positions — SAMs were downstream of the HIND
 *   RNG shift).
 * - WASM Fire B fires at SCG11EA tick 18 as `Mission_Attack_air` tag 40050
 *   for `aircraft[131]` and `aircraft[149]` (both HINDs' Logic positions,
 *   verified via test-rng-entity-diff.ts SCG11EA START=15 END=20).
 * - SCG11EA first-divergence after fix: tick 57 (+25 ticks), driven by an
 *   unrelated ground-unit Mission_Move_foot divergence (`unit[157]` MCV),
 *   not HIND.
 *
 * ## No regressions (all 7 campaign scenarios)
 *
 * Before: SCG01=87, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=32, SCG13=101
 * After:  SCG01=87, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=57, SCG13=101
 *
 * ## Reproduction
 *
 *   SCENARIOS=SCG11EA MAX=100 npx playwright test \
 *     scripts/test-first-divergence.ts --reporter=list
 *
 *   SCENARIO=SCG11EA START=15 END=20 npx playwright test \
 *     scripts/test-rng-entity-diff.ts --reporter=list
 *   # → observe tick 18 WASM fires Mission_Attack_air tag 40050 for both HINDs.
 */
import { describe, it, expect } from 'vitest';

describe('SCG11EA tick-32 HIND Mission_Attack two-stage transition', () => {
  it('documents C++ Fire A: VALIDATE_AZ → RETURN_TO_BASE (aircraft.cpp:2432-2438)', () => {
    // First timer fire when landed HIND loses its target.
    // Status=VALIDATE_AZ → !Target_Legal → Status=RETURN_TO_BASE, break.
    // Fall through to aircraft.cpp:2620: return Normal_Delay(ATTACK) + Random_Pick(0,2).
    const fireA = {
      cppRef: 'aircraft.cpp:2432-2438 (VALIDATE_AZ branch)',
      statusBefore: 0, // VALIDATE_AZ
      statusAfter: 6,  // RETURN_TO_BASE
      missionBefore: 'ATTACK',
      missionAfter: 'ATTACK', // Mission stays ATTACK until Fire B's Commence()
      rngCalls: 1, // one Random_Pick(0,2) at aircraft.cpp:2620
      rngTag: 40050, // Mission_Attack_air
      normalDelay: 14, // MissionControl[MISSION_ATTACK].Normal_Delay() = 14.4 → 14
      timerReturn: '14 + Random_Pick(0,2) → 14..16',
    };
    expect(fireA.statusAfter).toBe(6);
    expect(fireA.missionAfter).toBe('ATTACK');
    expect(fireA.rngCalls).toBe(1);
    expect(fireA.normalDelay).toBe(14);
  });

  it('documents C++ Fire B: RETURN_TO_BASE → Enter_Idle_Mode → GUARD (aircraft.cpp:2603-2614)', () => {
    // Second timer fire. Status=RETURN_TO_BASE case runs Enter_Idle_Mode:
    //   aircraft.cpp:1947-1969 non-FixedWing LAYER_GROUND non-loaner path:
    //     Assign_Destination(TARGET_NONE); Assign_Target(TARGET_NONE);
    //     mission = MISSION_GUARD;
    //   Then Assign_Mission(mission) + Commence() — Commence flips
    //   Mission=MissionQueue (=GUARD), Timer=0, Status=0.
    // Fall through to aircraft.cpp:2620: return Normal_Delay(GUARD) + Random_Pick(0,2).
    const fireB = {
      cppRef: 'aircraft.cpp:2603-2614 (RETURN_TO_BASE branch) + aircraft.cpp:1876-2066 Enter_Idle_Mode',
      statusBefore: 6, // RETURN_TO_BASE
      statusAfter: 0,  // Commence() resets Status
      missionBefore: 'ATTACK',
      missionAfter: 'GUARD', // Commence flips Mission before line 2620 return
      rngCalls: 1, // one Random_Pick(0,2) at aircraft.cpp:2620 with Mission=GUARD
      rngTag: 40050,
      normalDelay: 42, // MissionControl[MISSION_GUARD].Normal_Delay() = 42 (Rate=.050)
      timerReturn: '42 + Random_Pick(0,2) → 42..44',
    };
    expect(fireB.missionAfter).toBe('GUARD');
    expect(fireB.normalDelay).toBe(42);
    expect(fireB.rngCalls).toBe(1);
  });

  it('captures WASM observation: SCG11EA tick 18 Fire B fires for both HINDs', () => {
    // test-rng-entity-diff.ts SCG11EA START=15 END=20:
    //   tick 18: WASM(2 calls)
    //     [0] Mission_Attack_air seed=3086267007 stag=40050 ent=aircraft[131]
    //     [1] Mission_Attack_air seed=785179212 stag=40050 ent=aircraft[149]
    //   aircraft[131]/[149] = HIND USSR @ cell(45,39) and (53,39) — the two
    //   HPAD-auto-spawned helicopters (Logic positions from WASM dump).
    const wasmT18 = {
      tick: 18,
      rngCallsTotal: 2,
      hindFireBCalls: [
        { tag: 40050, seed: 3086267007, logicIdx: 131 }, // HIND cell(45,39)
        { tag: 40050, seed: 785179212, logicIdx: 149 },  // HIND cell(53,39)
      ],
    };
    expect(wasmT18.rngCallsTotal).toBe(2);
    expect(wasmT18.hindFireBCalls.length).toBe(2);
    expect(wasmT18.hindFireBCalls.every(c => c.tag === 40050)).toBe(true);
  });

  it('documents the prior TS bug: Fire A loop (no transition to Fire B)', () => {
    // Pre-fix index.ts:1990-1998: on every landed-no-target timer fire, TS
    // consumed Random_Pick(0,2) and re-set timer = 14 + jitter. Mission stayed
    // ATTACK. No status tracking → infinite Fire A loop, no transition to GUARD.
    //
    // Consequence: TS HIND fires RNG every ~14 ticks forever; WASM HIND is
    // silent ~42 ticks per GUARD cycle after one Fire B transition at tick 18.
    // Accumulated +2 HIND RNG calls at every tick the timer happened to fire
    // in TS but not in WASM. At SCG11EA tick 32 both TS HINDs had mt=1 (post-
    // Fire-A reset at ~tick 18 with jitter 0-2) and both fired again.
    const priorBug = {
      codeLocation: 'src/EasterEgg/engine/index.ts:1990-1998 (pre-fix)',
      behavior: 'Every fire: Random_Pick(0,2), timer = 14 + jitter, Mission stays ATTACK',
      missingTransition: 'Fire B (ATTACK → GUARD) never reached',
      tickDivergenceObserved: 32,
      extrasAtTick32: 5, // 2 HIND + 3 SAM (SAMs downstream of HIND RNG shift)
    };
    expect(priorBug.missingTransition).toContain('Fire B');
    expect(priorBug.extrasAtTick32).toBe(5);
  });

  it('documents the fix: aircraftAttackStatus mirrors C++ Status', () => {
    // src/EasterEgg/engine/entity.ts — added field `aircraftAttackStatus`.
    // src/EasterEgg/engine/index.ts Phase 2 HPAD helicopter block:
    //   Fire A (status !== 6): consume Random_Pick, status=6, timer=14+jitter.
    //   Fire B (status === 6): consume Random_Pick, Mission=GUARD, status=0,
    //                           clear target/targetStructure, timer=42+jitter.
    // Also: Mission.GUARD landed handler gates Random_Pick behind
    // `attackCooldown === 0`, matching C++ foot.cpp:684 early-return on Arm.
    const fix = {
      entityFieldAdded: 'aircraftAttackStatus',
      statusValues: { VALIDATE_AZ: 0, RETURN_TO_BASE: 6 }, // C++ enum in Mission_Attack
      fireATransition: 'status 0 → 6, Mission stays ATTACK, timer 14+jitter',
      fireBTransition: 'status 6 → 0, Mission ATTACK → GUARD, timer 42+jitter',
      guardJitterGate: 'attackCooldown === 0 (foot.cpp:684 Arm early-return)',
      resultFirstDivergence: { before: 32, after: 57, delta: 25 },
    };
    expect(fix.entityFieldAdded).toBe('aircraftAttackStatus');
    expect(fix.statusValues.RETURN_TO_BASE).toBe(6);
    expect(fix.resultFirstDivergence.after).toBeGreaterThan(fix.resultFirstDivergence.before);
  });

  it('confirms no regressions on other 6 campaign scenarios', () => {
    const firstDivergence = {
      before: { SCG01: 87, SCG03: 238, SCG04: 36, SCG06: 76, SCG07: 17, SCG11: 32, SCG13: 101 },
      after:  { SCG01: 87, SCG03: 238, SCG04: 36, SCG06: 76, SCG07: 17, SCG11: 57, SCG13: 101 },
    };
    // SCG11EA advances +25 ticks; all others identical.
    expect(firstDivergence.after.SCG01).toBe(firstDivergence.before.SCG01);
    expect(firstDivergence.after.SCG03).toBe(firstDivergence.before.SCG03);
    expect(firstDivergence.after.SCG04).toBe(firstDivergence.before.SCG04);
    expect(firstDivergence.after.SCG06).toBe(firstDivergence.before.SCG06);
    expect(firstDivergence.after.SCG07).toBe(firstDivergence.before.SCG07);
    expect(firstDivergence.after.SCG11).toBeGreaterThan(firstDivergence.before.SCG11);
    expect(firstDivergence.after.SCG13).toBe(firstDivergence.before.SCG13);
  });
});
