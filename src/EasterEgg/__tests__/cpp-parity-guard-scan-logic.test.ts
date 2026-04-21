/**
 * C++ Parity: Guard Scan Logic — Target_Something_Nearby
 *
 * Verifies the TS guard scan in updateGuard() matches C++ Target_Something_Nearby
 * from techno.cpp:5251-5281 → Greatest_Threat → Evaluate_Object.
 *
 * Key C++ references:
 *   - foot.cpp:589-634      — Mission_Guard: calls Target_Something_Nearby(THREAT_RANGE)
 *   - techno.cpp:5251-5281  — Target_Something_Nearby: delegates to Greatest_Threat
 *   - techno.cpp:1449-1763  — Evaluate_Object: all target filtering logic
 *   - techno.cpp:1278-1294  — In_Range: Distance(Fire_Coord, target) <= Weapon_Range
 *   - techno.cpp:4543-4582  — Threat_Range(0) returns 0 for guard, Threat_Range(1) for area guard
 *
 * C++ parity differences fixed:
 *   1. Range check uses > (not >=) to match C++ In_Range <= boundary (inclusive)
 *   2. No terrain LOS check — C++ Evaluate_Object has no hasLineOfSight filter
 *   3. Area guard leash = min(weaponRange, 5), not min(weaponRange/2, 5)
 *   4. Area guard scan range = 2*weaponRange (Threat_Range(1)), not max(leash, sight)
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { updateGuard, updateAreaGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission, Stance, AnimState,
  UNIT_STATS, WEAPON_STATS, worldDist,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';

// Helper to create entity
function makeEntity(type: UnitType | string, house: House, x: number, y: number): Entity {
  return new Entity(type as UnitType, house, x, y);
}

// Minimal MissionAIContext
function makeCtx(overrides: Partial<MissionAIContext> & { entities?: Entity[]; tick?: number }): MissionAIContext {
  return {
    entities: overrides.entities ?? [],
    structures: [],
    effects: [],
    map: {
      width: 128, height: 128,
      boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      getTerrain: () => 0,
      setTerrain: () => {},
      hasLineOfSight: () => true,
      isPassable: () => true,
      isTerrainPassable: () => true,
      isWaterPassable: () => false,
      canEnterCell: () => true,
      inBounds: () => true,
      getWallType: () => undefined,
      setWallType: () => {},
      getOreCell: () => null,
    } as any,
    tick: overrides.tick ?? 100,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Greece,
    movementSpeed: () => 1,
    playSoundAt: () => {},
    playEva: () => {},
    playSound: () => {},
    weaponSound: (n) => n,
    damageEntity: () => false,
    damageStructure: () => false,
    triggerRetaliation: () => {},
    handleUnitDeath: () => {},
    launchProjectile: () => {},
    deferInvisibleScatter: () => {},
    applySplashDamage: () => {},
    getFirepowerBias: () => 1,
    getArmorBias: () => 1,
    getROFBias: () => 1,
    getWarheadMult: () => 1,
    getWarheadMeta: () => ({ spread: 0, flames: false, explosive: false, death: 0, wall: false }),
    getWarheadProps: () => undefined,
    warheadMuzzleColor: () => '#fff',
    weaponProjectileStyle: () => 'bullet',
    idleMission: () => Mission.GUARD,
    retreatFromTarget: () => {},
    threatScore: (_scanner, _target, dist) => 100 - dist,
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
  };
}

describe('Guard scan range boundary — C++ techno.cpp:1517-1523 In_Range uses <=', () => {
  // C++ parity note: FootClass::Mission_Guard calls Target_Something_Nearby(THREAT_RANGE)
  // → Greatest_Threat(THREAT_RANGE). Per techno.cpp:2013-2026, only DOGS / MEDICS / MECHANICS
  // get type bits added to the scan mask; regular infantry and vehicles get mask=0, which
  // makes Evaluate_Object (techno.cpp:1539) reject every candidate — the scan is a no-op.
  // These tests therefore use a DOG scanner, which gets THREAT_INFANTRY bits added and
  // can actually acquire infantry targets via Mission_Guard's cell-based scan.

  it('target at EXACTLY guard scan range is included (C++ Distance <= scanRange)', () => {
    // C++ In_Range: ::Distance(Fire_Coord, target->Center_Coord()) <= scanRange
    // Dog guardRange = 7 cells. Target at exactly 7.0 should be in range.
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const dogScanRange = scanner.stats.guardRange!; // 7 cells
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + dogScanRange * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // C++ would include this target (<=), so TS should too
    expect(scanner.target).toBe(target);
  });

  it('target just beyond guard scan range is excluded (C++ Distance > scanRange)', () => {
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const dogScanRange = scanner.stats.guardRange!; // 7 cells
    // Place target just outside guardRange
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + (dogScanRange + 0.1) * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // Should NOT find this target — beyond guard scan range
    expect(scanner.target).toBeNull();
  });

  it('regular infantry Mission_Guard DOES auto-acquire in-range targets (weapon Allowed_Threats)', () => {
    // C++ InfantryClass::Greatest_Threat (infantry.cpp:2314-2319) ORs PrimaryWeapon->
    // Allowed_Threats into the threat mask before delegating to FootClass/TechnoClass::
    // Greatest_Threat. M1Carbine is anti-ground (weapon.cpp:317-327) → adds THREAT_
    // INFANTRY|VEHICLES|BOATS|BUILDINGS → mask includes RTTI_INFANTRY → Evaluate_Object
    // accepts an in-range E1 candidate. Empirical confirmation: SCG06EA tick 62.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    // Target in-range
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 2.0 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(target);
  });
});

describe('Guard scan has no terrain LOS check — C++ Evaluate_Object parity', () => {
  it('dog target behind wall is still valid (C++ has no hasLineOfSight in Evaluate_Object)', () => {
    // Use DOG as scanner: C++ adds THREAT_INFANTRY bits so Mission_Guard actually scans.
    // Regular infantry Mission_Guard is a no-op scan (mask=0).
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 1 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    // LOS blocked by terrain, but C++ doesn't check LOS in guard scan
    const ctx = makeCtx({
      entities: [scanner, target],
      map: {
        width: 128, height: 128,
        boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
        getTerrain: () => 0,
        setTerrain: () => {},
        hasLineOfSight: () => false, // terrain blocks LOS
        isPassable: () => true,
        getWallType: () => undefined,
        setWallType: () => {},
        getOreCell: () => null,
      } as any,
    });
    updateGuard(ctx, scanner);

    // C++ parity: target should be found even with LOS blocked
    expect(scanner.target).toBe(target);
  });
});

describe('Area guard leash and scan range — C++ Threat_Range(1)/2', () => {
  it('leash = min(weaponRange, 5), not min(weaponRange/2, 5)', () => {
    // C++ foot.cpp:996: leash = Threat_Range(1)/2
    // Threat_Range(1) = min(2*weaponRange, 0x0A00=10cells)
    // leash = min(2*weaponRange, 10)/2 = min(weaponRange, 5)
    //
    // For E1 M1Carbine (range=3.0): leash = min(3.0, 5) = 3.0
    const guard = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    guard.guardOrigin = { x: 200, y: 200 };
    guard.mission = Mission.AREA_GUARD;

    // Place 3.5 cells from origin — within correct leash (3.0 < 3.5 — triggers retreat)
    guard.setPosition(200 + 3.5 * CELL_SIZE, 200);

    const ctx = makeCtx({ entities: [guard] });
    updateAreaGuard(ctx, guard);

    // With leash = 3.0, entity at 3.5 cells is BEYOND leash → should retreat
    expect(guard.moveTarget).not.toBeNull();
  });

  it('scan range = 2 * weaponRange (C++ Threat_Range(1))', () => {
    // C++ Greatest_Threat with THREAT_AREA uses Threat_Range(1) = min(2*weaponRange, 10)
    // For E1 M1Carbine (range=3.0): scan range = min(6.0, 10) = 6.0
    const guard = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    guard.guardOrigin = { x: 200, y: 200 };
    guard.mission = Mission.AREA_GUARD;

    // Place enemy at 5.5 cells from origin — within C++ scan range (6.0), beyond old TS range (4.0)
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 200 + 5.5 * CELL_SIZE, 200);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [guard, enemy] });
    updateAreaGuard(ctx, guard);

    // With scanRange = 6.0, enemy at 5.5 should be found
    expect(guard.target).toBe(enemy);
  });
});

describe('Player SPY Mission_Guard — C++ foot.cpp:594 Random_Animate fall-through', () => {
  // C++ FootClass::Mission_Guard (foot.cpp:589-634) always reaches Random_Animate
  // when Target_Something_Nearby returns no target — regardless of unit type or ownership.
  // TS previously early-returned for player-owned spies to prevent auto-infiltrate, which
  // also skipped Random_Animate. That caused SCG13EA tick 43 RNG divergence: WASM's Greek
  // SPY at (9,53) fired Random_Animate (advancing RNG), TS's SPY skipped it entirely.

  it('player-owned SPY runs Random_Animate when idle and no target (fall-through)', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 100, 100);
    spy.mission = Mission.GUARD;
    spy.missionTimer = 0; // timer fires this tick
    spy.idleAnimTimer = 0;
    spy.doing = 'stand_ready';

    // Seed RNG deterministically so we can observe consumption
    ScenarioRandom.seed = 0x12345678;
    const seedBefore = ScenarioRandom.seed;

    const ctx = makeCtx({ entities: [spy] });
    updateGuard(ctx, spy);

    // C++ Random_Animate consumes at least the idle-timer roll (Random_Pick(44, 176))
    // and the animation selection roll (Random_Pick(0, 10)).
    const seedAfter = ScenarioRandom.seed;
    expect(seedAfter).not.toBe(seedBefore);
    // idleAnimTimer must be set by Random_Animate (range 44-176 per C++ infantry.cpp:1748)
    expect(spy.idleAnimTimer).toBeGreaterThanOrEqual(44);
    expect(spy.idleAnimTimer).toBeLessThanOrEqual(176);
  });

  it('player-owned SPY does NOT auto-target enemies on GUARD (no infiltrate chain)', () => {
    // Prevents TS-specific bug: SPY auto-infiltrates nearest enemy on disembark.
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 100, 100);
    spy.mission = Mission.GUARD;
    spy.missionTimer = 0;
    spy.idleAnimTimer = 0;
    spy.doing = 'stand_ready';

    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [spy, enemy] });
    updateGuard(ctx, spy);

    // Must NOT have auto-acquired a target
    expect(spy.target).toBeNull();
    expect(spy.mission).toBe(Mission.GUARD);
  });

  it('enemy-owned SPY also runs Mission_Guard normally (not gated by player check)', () => {
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 100, 100);
    spy.mission = Mission.GUARD;
    spy.missionTimer = 0;
    spy.idleAnimTimer = 0;
    spy.doing = 'stand_ready';

    ScenarioRandom.seed = 0xabcdef01;
    const seedBefore = ScenarioRandom.seed;

    const ctx = makeCtx({ entities: [spy] });
    updateGuard(ctx, spy);

    // Enemy SPY also advances through Random_Animate
    expect(ScenarioRandom.seed).not.toBe(seedBefore);
  });
});

describe('Player-allied civilian Mission_Guard — C++ foot.cpp:594 Random_Animate fall-through', () => {
  // C++ FootClass::Mission_Guard (foot.cpp:589-634) calls Random_Animate when
  // Target_Something_Nearby returns no target. Civilians are infantry like any
  // other — they hit the Is_Ready_To_Random_Animate path (infantry.cpp:1748)
  // which fires IdleTimer + switch Random_Picks.
  //
  // TS previously short-circuited for ALL player-allied civilians (even with no
  // ants nearby) via SCA02EA's auto-flee block, skipping Random_Animate entirely.
  // SCG01EA tick 44 regression: C8 England (Greek ally per SCG01EA.ini
  // Allies=England) skipped 4 RNG calls that WASM fired, desyncing the stream.

  it('player-allied civilian with no ant threat runs Random_Animate', () => {
    const civ = makeEntity(UnitType.I_C8, House.Greece, 100, 100);
    civ.mission = Mission.GUARD;
    civ.missionTimer = 0;
    civ.idleAnimTimer = 0;
    civ.doing = 'stand_ready';

    ScenarioRandom.seed = 0x12345678;
    const seedBefore = ScenarioRandom.seed;

    const ctx = makeCtx({ entities: [civ] });
    updateGuard(ctx, civ);

    expect(ScenarioRandom.seed).not.toBe(seedBefore);
    expect(civ.idleAnimTimer).toBeGreaterThanOrEqual(44);
    expect(civ.idleAnimTimer).toBeLessThanOrEqual(176);
  });

  it('player-allied civilian does NOT auto-target enemies (no weapon)', () => {
    const civ = makeEntity(UnitType.I_C8, House.Greece, 100, 100);
    civ.mission = Mission.GUARD;
    civ.missionTimer = 0;
    civ.idleAnimTimer = 0;
    civ.doing = 'stand_ready';

    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [civ, enemy] });
    updateGuard(ctx, civ);

    expect(civ.target).toBeNull();
    expect(civ.mission).toBe(Mission.GUARD);
  });

  it('player-allied civilian with nearby ant flees via Mission.MOVE', () => {
    const civ = makeEntity(UnitType.I_C8, House.Greece, 100, 100);
    civ.mission = Mission.GUARD;
    civ.missionTimer = 0;
    civ.doing = 'stand_ready';

    const ant = makeEntity(UnitType.ANT1, House.BadGuy, 100 + 2 * CELL_SIZE, 100);

    const ctx = makeCtx({ entities: [civ, ant] });
    updateGuard(ctx, civ);

    expect(civ.mission).toBe(Mission.MOVE);
    expect(civ.moveTarget).not.toBeNull();
  });
});
