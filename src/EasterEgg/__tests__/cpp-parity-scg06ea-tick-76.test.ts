/**
 * C++ Behavioral Parity: Mission_Guard_Area Approach_Target (SCG06EA tick 76)
 *
 * SCG06EA USSR reinforcement E1[69] (WASM logic idx; TS entity id 24) spawns at
 * cell (24,67) with AREA_GUARD mission. Greek E1[72] at (20,64) is assigned as
 * its initial TarCom during scenario init (both positions outside of weapon
 * range 3 cells — straight-line distance ~5 cells).
 *
 * Expected C++ behavior (foot.cpp:1082-1084 else-branch of Mission_Guard_Area):
 *   When TarCom is legal at entry, Mission_Guard_Area calls Approach_Target().
 *   Approach_Target selects a passable cell within weapon range of the target
 *   and sets it as NavCom. The unit then walks toward NavCom each tick via
 *   Movement_AI, gradually closing the distance until the target is in range.
 *
 * Observed WASM trace (SCG06EA tick 1→76):
 *   tick 1:  (24,67) - initial spawn
 *   tick 18: (23,67) - first cell change (walked 1 cell west in ~17 ticks)
 *   tick 25: (23,66) - cell change north
 *   tick 65: (22,65) - now within octagonal distance = 608 leptons < 768 range
 *   tick 76: (22,65) - stable, fires invisible bullet[115] → tag 50002 scatter
 *
 * Pre-fix TS behavior: USSR E1[24] stayed static at (24,67) for 76+ ticks.
 * updateAreaGuard's `if (bestTarget)` branch set entity.target but never
 * invoked Approach_Target, so the out-of-range TarCom was preserved forever
 * without any movement. Since the unit never reached firing range, WASM's
 * tick-76 bullet[115] AI (Percent_Chance(50) via Is_Allowed_To_Retaliate +
 * Coord_Scatter in Bullet_Explodes) never occurred in TS → Δcalls = +2.
 *
 * TS port: in updateAreaGuard, when scan confirms (or hadTargetAtEntry) a
 * legal target and the unit is out of range with no existing moveTarget,
 * invoke ctx.approachTarget(entity) to mirror C++ Approach_Target. The
 * index.ts Mission.AREA_GUARD case also runs the Start_Driver → Coord_Move →
 * Stop_Driver infantry movement state machine each tick while out of range
 * (mirrors Mission.HUNT's post-scan walk, itself a port of
 * infantry.cpp:3765 Movement_AI).
 *
 * C++ refs:
 *   - foot.cpp:1037-1098 FootClass::Mission_Guard_Area (Approach_Target branch)
 *   - foot.cpp:856-946 FootClass::Approach_Target (sweep angles + NavCom)
 *   - infantry.cpp:3765 InfantryClass::Movement_AI (walk along path)
 *   - bullet.cpp:1012-1014 Bullet_Explodes invisible Coord_Scatter (tag 50002)
 *   - techno.cpp:5027 Is_Allowed_To_Retaliate Percent_Chance(50) (tag 15xxx)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, LEPTON_SIZE,
  Mission,
  COUNTRY_BONUSES,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import { runFiringAI, updateAreaGuard, type MissionAIContext } from '../engine/missionAI';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, cx: number, cy: number): Entity {
  const px = cx * CELL_SIZE + CELL_SIZE / 2;
  const py = cy * CELL_SIZE + CELL_SIZE / 2;
  return new Entity(type, house, px, py);
}

function makeMockCtx(overrides: Partial<MissionAIContext> = {}): MissionAIContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    effects: [] as Effect[],
    map,
    tick: 1,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Greece) ?? false,
    movementSpeed: () => 1,
    infantryStartDriver: () => ({ lx: 0, ly: 0 }),
    infantryValidatePath: () => {},
    approachTarget: () => {},
    playSoundAt: () => {},
    playEva: () => {},
    playSound: () => {},
    weaponSound: (n: string) => n,
    damageEntity: () => false,
    damageStructure: () => false,
    handleUnitDeath: () => {},
    launchProjectile: () => {},
    deferInvisibleScatter: () => {},
    applySplashDamage: () => {},
    getFirepowerBias: (h: House) => COUNTRY_BONUSES[h]?.firepowerMult ?? 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    getWarheadMult: () => 1.0,
    getWarheadMeta: () => ({ spreadFactor: 0 }),
    getWarheadProps: () => undefined,
    warheadMuzzleColor: () => '#fff',
    weaponProjectileStyle: () => 'bullet',
    idleMission: () => Mission.GUARD,
    retreatFromTarget: () => {},
    threatScore: (_s: Entity, _t: Entity, dist: number) => 100 - dist,
    updateDemoTruck: () => {},
    updateMedic: () => {},
    updateMechanicUnit: () => {},
    updateTanyaC4: () => {},
    updateThief: () => {},
    spyDisguise: () => {},
    spyInfiltrate: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    ...overrides,
  } as unknown as MissionAIContext;
}

describe('SCG06EA tick 76 — Mission_Guard_Area Approach_Target (C++ foot.cpp:1082-1084)', () => {
  it('calls ctx.approachTarget when TarCom is legal and out of range', () => {
    // Reproduces the SCG06EA init state: USSR E1 spawns at (24,67) with Greek
    // E1 at (20,64) as initial TarCom — distance > weapon range (3 cells).
    const guard = makeEntity(UnitType.I_E1, House.USSR, 24, 67);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    // hadTargetAtEntry path — target already assigned at scenario init.
    guard.target = greek;

    let approachCalled = false;
    const ctx = makeMockCtx({
      entities: [guard, greek],
      approachTarget: (e: Entity) => { if (e === guard) approachCalled = true; },
    });

    updateAreaGuard(ctx, guard, /* timerFired */ true);

    expect(approachCalled).toBe(true);
  });

  it('newly-acquired out-of-range target returns immediately and approaches on the next timer fire', () => {
    // !hadTargetAtEntry path — scan finds Greek for the first time. C++ returns
    // 1 immediately at foot.cpp:1077-1079; Approach_Target runs only on the
    // next timer fire, when TarCom is legal at entry.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 24, 67);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };
    guard.target = null; // !hadTargetAtEntry

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);

    let approachCalled = false;
    const ctx = makeMockCtx({
      entities: [guard, greek],
      approachTarget: (e: Entity) => { if (e === guard) approachCalled = true; },
    });

    updateAreaGuard(ctx, guard, /* timerFired */ true);

    // Scan should have picked up Greek as bestTarget.
    expect(guard.target).toBe(greek);
    expect(guard.missionTimer).toBe(1);
    expect(approachCalled).toBe(false);

    updateAreaGuard(ctx, guard, /* timerFired */ true);
    expect(approachCalled).toBe(true);
  });

  it('does NOT call approachTarget when target is already in range', () => {
    // Unit at (21,64) with Greek target at (20,64) — distance 1 cell, well
    // within weapon range 3 cells. C++ still calls Approach_Target; the C++
    // implementation's In_Range check at line 943 short-circuits the NavCom
    // assignment. TS's approachTarget is gated externally to skip when
    // inRange (matches net effect: no movement needed).
    const guard = makeEntity(UnitType.I_E1, House.USSR, 21, 64);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    guard.target = greek;

    let approachCalled = false;
    const ctx = makeMockCtx({
      entities: [guard, greek],
      approachTarget: (e: Entity) => { if (e === guard) approachCalled = true; },
    });

    updateAreaGuard(ctx, guard, /* timerFired */ true);

    expect(approachCalled).toBe(false);
  });

  it('does NOT call approachTarget when moveTarget is already set', () => {
    // Mid-approach (previous timer-fire already invoked Approach_Target).
    // C++ foot.cpp:943 `!Target_Legal(NavCom)` — NavCom empty is a precondition
    // for fresh path assignment. Don't overwrite an in-progress approach.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 24, 67);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    guard.target = greek;
    // moveTarget set from a prior Approach_Target call.
    guard.moveTarget = { lx: 5248, ly: 17024 };

    let approachCalled = false;
    const ctx = makeMockCtx({
      entities: [guard, greek],
      approachTarget: (e: Entity) => { if (e === guard) approachCalled = true; },
    });

    updateAreaGuard(ctx, guard, /* timerFired */ true);

    expect(approachCalled).toBe(false);
  });

  it('caller Firing_AI runs every tick on AREA_GUARD when target is in range (C++ infantry.cpp:1237)', () => {
    // SCG06EA tick 76 residual fix: C++ InfantryClass::AI calls Firing_AI()
    // unconditionally each tick (infantry.cpp:1237) before MissionClass::AI
    // dispatches to the per-mission handler. updateAreaGuard previously had
    // no Firing_AI hook, so a Mission_Guard_Area unit that path-shorten'd
    // into firing range sat idle for ~70 ticks until the next timer fire.
    //
    // After the fix: when target is alive + in range + Arm==0,
    // updateAreaGuard temporarily switches mission to ATTACK to dispatch
    // updateAttack's Fire_At path, then restores AREA_GUARD. The pattern
    // mirrors updateGuard (missionAI.ts:1164-1176) for parity.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 22, 65);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 24 * CELL_SIZE + CELL_SIZE/2, y: 67 * CELL_SIZE + CELL_SIZE/2 };
    guard.attackCooldown = 0; // Arm == 0 — weapon ready

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    guard.target = greek;

    const ctx = makeMockCtx({
      entities: [guard, greek],
    });

    // Confirm target is in range before invocation.
    expect(guard.inRange(greek)).toBe(true);

    updateAreaGuard(ctx, guard, /* timerFired */ false);
    expect(guard.mission).toBe(Mission.AREA_GUARD);

    runFiringAI(ctx, guard);

    // After the caller's Firing_AI runs, the entity should have started the pre-fire
    // animation (firePrepActive=true) OR fired immediately, depending on
    // the FireLaunch stage progression.
    expect(guard.mission).toBe(Mission.AREA_GUARD);
    // updateAttack sets firePrepActive when starting the fire animation OR
    // launches an immediate bullet. Verify SOME fire-related state changed.
    const fireState = guard.firePrepActive || guard.firePrepStage > 0 || guard.attackCooldown > 0;
    expect(fireState, 'Firing_AI should have triggered fire prep or fire').toBe(true);
  });

  it('does NOT trigger Firing_AI when target is out of range', () => {
    // Sanity check: the Firing_AI gate's `entity.inRange(target)` clause
    // must short-circuit when the target is too far away. Otherwise the
    // unit would attempt to fire from outside weapon range.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 24, 67);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };
    guard.attackCooldown = 0;

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    guard.target = greek;

    expect(guard.inRange(greek)).toBe(false);

    const before = { fp: guard.firePrepActive, stage: guard.firePrepStage, cd: guard.attackCooldown };
    updateAreaGuard(makeMockCtx({ entities: [guard, greek] }), guard, /* timerFired */ false);
    // No fire state change.
    expect(guard.firePrepActive).toBe(before.fp);
    expect(guard.firePrepStage).toBe(before.stage);
    expect(guard.attackCooldown).toBe(before.cd);
  });

  it('does NOT trigger Firing_AI when attackCooldown > 0 (Arm not yet ready)', () => {
    // C++ Firing_AI gates on Arm == 0. An entity that just fired has Arm
    // counting down; Firing_AI must wait until Arm==0 to fire again.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 22, 65);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 24 * CELL_SIZE + CELL_SIZE/2, y: 67 * CELL_SIZE + CELL_SIZE/2 };
    guard.attackCooldown = 5; // weapon on cooldown

    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);
    guard.target = greek;

    expect(guard.inRange(greek)).toBe(true);

    const beforeCd = guard.attackCooldown;
    const beforeFp = guard.firePrepActive;
    updateAreaGuard(makeMockCtx({ entities: [guard, greek] }), guard, /* timerFired */ false);
    // attackCooldown unchanged (Firing_AI didn't fire and reset it; the
    // engine's per-tick decrement happens in updateEntity, not here).
    expect(guard.attackCooldown).toBe(beforeCd);
    expect(guard.firePrepActive).toBe(beforeFp);
  });

  it('initial position (24,67) → target (20,64) is out of weapon range (3 cells)', () => {
    // Precondition: confirm the SCG06EA init geometry requires an approach.
    // C++ octagonal distance (coord.cpp:124-136): max(|dx|,|dy|) + min/2
    //   (24,67)→(20,64): |dx|=4*256=1024 leptons, |dy|=3*256=768 leptons
    //   octagonal = 1024 + 768/2 = 1408 leptons
    //   weapon range 3 cells = 768 leptons
    //   1408 > 768 → OUT OF RANGE → Approach_Target must fire.
    const guard = makeEntity(UnitType.I_E1, House.USSR, 24, 67);
    const greek = makeEntity(UnitType.I_E1, House.Greece, 20, 64);

    expect(guard.weapon!.range).toBe(3);

    const dxL = Math.abs(guard.leptonX - greek.leptonX);
    const dyL = Math.abs(guard.leptonY - greek.leptonY);
    const octagonal = Math.max(dxL, dyL) + Math.min(dxL, dyL) / 2;
    expect(octagonal).toBeGreaterThan(guard.weapon!.range * LEPTON_SIZE);
  });
});
