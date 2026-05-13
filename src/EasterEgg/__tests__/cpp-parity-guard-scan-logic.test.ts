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
 *   1. THREAT_RANGE candidate checks use the selected weapon's In_Range <= boundary
 *   2. No terrain LOS check — C++ Evaluate_Object has no hasLineOfSight filter
 *   3. Area guard leash = min(weaponRange, 5), not min(weaponRange/2, 5)
 *   4. Area guard scan range = 2*weaponRange (Threat_Range(1)), not max(leash, sight)
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { updateGuard, updateAreaGuard, updateHunt, updateAttack, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, LEPTON_SIZE, House, UnitType, Mission, Stance, AnimState, Dir,
  UNIT_STATS, WEAPON_STATS, worldDist, leptonDist,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';
import { MoveResult } from '../engine/map';

// Helper to create entity
function makeEntity(type: UnitType | string, house: House, x: number, y: number): Entity {
  return new Entity(type as UnitType, house, x, y);
}

function setLeptonPos(entity: Entity, lx: number, ly: number): void {
  entity.leptonX = lx;
  entity.leptonY = ly;
  entity.pos.x = lx * CELL_SIZE / LEPTON_SIZE;
  entity.pos.y = ly * CELL_SIZE / LEPTON_SIZE;
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

describe('Mission_Hunt no-threat Random_Animate fall-through — C++ foot.cpp:721-775', () => {
  it('unarmed HUNT infantry still runs Random_Animate when Target_Something_Nearby has no legal mask', () => {
    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      tagLogging: ScenarioRandom._tagLogging,
      sourceTag: ScenarioRandom._sourceTag,
      entityTag: ScenarioRandom._entityTag,
      seedLog: ScenarioRandom._seedLog,
    };

    try {
      ScenarioRandom.seed = 0x12345678;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._sourceTag = 10026;
      ScenarioRandom._entityTag = 10026;
      ScenarioRandom._seedLog = [];

      const engineer = makeEntity(UnitType.I_E6, House.GoodGuy, 9 * CELL_SIZE, 55 * CELL_SIZE);
      engineer.mission = Mission.HUNT;
      engineer.missionTimer = 0;
      engineer.doing = 'stand_ready';
      engineer.idleAnimTimer = 0;
      engineer.isDriving = false;

      updateHunt(makeCtx({ entities: [engineer], playerHouse: House.Greece, tick: 1152 }), engineer);

      const tags = ScenarioRandom._seedLog.map(([, tag]) => tag);
      expect(tags).toContain(30001);
      expect(tags).toContain(30002);
      expect(engineer.idleAnimTimer).toBeGreaterThan(0);
      expect(engineer.target).toBeNull();
      expect(engineer.targetStructure).toBeNull();
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._entityTag = saved.entityTag;
      ScenarioRandom._seedLog = saved.seedLog;
    }
  });
});

describe('Guard scan weapon range boundary — C++ techno.cpp:1539-1544 In_Range uses selected weapon', () => {
  // C++ parity note: FootClass::Mission_Guard calls Target_Something_Nearby(THREAT_RANGE)
  // → Greatest_Threat(THREAT_RANGE). Per techno.cpp:2013-2026, only DOGS / MEDICS / MECHANICS
  // get type bits added to the scan mask; regular infantry and vehicles get mask=0, which
  // makes Evaluate_Object (techno.cpp:1539) reject every candidate — the scan is a no-op.
  it('target at EXACTLY selected weapon range is included (C++ In_Range <= weapon range)', () => {
    // C++ Greatest_Threat's cell ring may scan farther than the weapon, but
    // Evaluate_Object(range==0) accepts only if In_Range(object, selectedWeapon)
    // is true. Place the target exactly one M1Carbine range from Fire_Coord.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const weaponRange = scanner.weapon!.range;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + weaponRange * CELL_SIZE, 100);
    const fireCoord = scanner.fireCoordForWeapon(scanner.weapon);
    setLeptonPos(target, fireCoord.lx + weaponRange * LEPTON_SIZE, fireCoord.ly);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // C++ would include this target (<=), so TS should too.
    expect(scanner.target).toBe(target);
  });

  it('target just beyond selected weapon range is excluded (C++ In_Range > weapon range)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const weaponRangeLeptons = scanner.weapon!.range * LEPTON_SIZE;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100, 100);
    const fireCoord = scanner.fireCoordForWeapon(scanner.weapon);
    setLeptonPos(target, fireCoord.lx + Math.floor(weaponRangeLeptons) + 1, fireCoord.ly);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // Should NOT find this target: it is inside the scan ring but outside M1Carbine.
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

  it('existing TarCom validation uses the C++ selected weapon range, not any weapon range', () => {
    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      tagLogging: ScenarioRandom._tagLogging,
      sourceTag: ScenarioRandom._sourceTag,
      entityTag: ScenarioRandom._entityTag,
      seedLog: ScenarioRandom._seedLog,
    };

    try {
      ScenarioRandom.seed = 0x2468ace0;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._sourceTag = 10073;
      ScenarioRandom._entityTag = 10073;
      ScenarioRandom._seedLog = [];

      const rocket = makeEntity(UnitType.I_E3, House.Greece, 0, 0);
      const target = makeEntity(UnitType.I_E1, House.USSR, 0, 0);
      setLeptonPos(rocket, 4160, 16576);
      setLeptonPos(target, 4928, 17878);
      rocket.mission = Mission.GUARD;
      rocket.target = target;
      rocket.doing = 'stand_ready';
      rocket.idleAnimTimer = 0;
      rocket.bodyFacing256 = Dir.S * 32;
      rocket.bodyFacing32 = Dir.S * 4;
      target.mission = Mission.HUNT;

      expect(rocket.weapon?.name).toBe('RedEye');
      expect(rocket.weapon2?.name).toBe('Dragon');
      expect(rocket.inRangeWith(target, rocket.weapon!)).toBe(true);
      expect(rocket.inRangeWith(target, rocket.weapon2!)).toBe(false);

      updateGuard(makeCtx({ entities: [rocket, target], playerHouse: House.Greece }), rocket);

      const tags = ScenarioRandom._seedLog.map(([, tag]) => tag);
      expect(rocket.target).toBeNull();
      expect(tags).toContain(30001);
      expect(tags).toContain(30002);
      expect(rocket.idleAnimTimer).toBeGreaterThan(0);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._entityTag = saved.entityTag;
      ScenarioRandom._seedLog = saved.seedLog;
    }
  });

  it('guard scan uses target center, but Firing_AI range uses falling Target_Coord', () => {
    // SCG08EA tick 694 C++ fixture:
    //   Greece E1[9] at (63,104), PrimaryFacing=64, Fire_Coord=(16335,26636)
    //   USSR E1[13] at (63,101), Center_Coord=(16320,25920), Height=130
    //
    // TechnoClass::Evaluate_Object uses In_Range(Object*) against Center_Coord,
    // so Mission_Guard acquires the falling target. InfantryClass::Firing_AI then
    // calls Can_Fire(TARGET), whose In_Range(TARGET) uses As_Coord/Target_Coord
    // = (16320,25790), outside M1Carbine's 768-lepton range. C++ therefore
    // keeps TarCom but does not start DO_FIRE_WEAPON or launch a bullet.
    const scanner = makeEntity(UnitType.I_E1, House.Greece, 0, 0);
    setLeptonPos(scanner, 16320, 26688);
    scanner.mission = Mission.GUARD;
    scanner.missionTimer = 0;
    scanner.facing = Dir.E;
    scanner.desiredFacing = Dir.E;
    scanner.bodyFacing256 = 64;
    scanner.desiredFacing256 = 64;
    scanner.bodyFacing32 = 8;
    scanner.doing = 'stand_ready';

    const target = makeEntity(UnitType.I_E1, House.USSR, 0, 0);
    setLeptonPos(target, 16320, 25920);
    target.mission = Mission.GUARD;
    target.isFalling = true;
    target.fallHeightLeptons = 130;
    target.flightAltitude = 12;

    expect(scanner.inRangeCoord(target.leptonX, target.leptonY),
      'Object* center overload used by Evaluate_Object is in range').toBe(true);
    expect(scanner.inRange(target),
      'TARGET overload used by Can_Fire is out of range because Target_Coord subtracts Height').toBe(false);

    const ctx = makeCtx({ entities: [scanner, target], tick: 694 });
    updateGuard(ctx, scanner);

    expect(scanner.target, 'Mission_Guard still assigns TarCom from center-based Evaluate_Object').toBe(target);

    updateAttack(ctx, scanner);

    expect(scanner.firePrepActive,
      'Firing_AI must not start DO_FIRE_WEAPON while TARGET-coordinate range is false').toBe(false);
    expect(scanner.attackCooldown).toBe(0);
  });

  it('infantry Firing_AI checks range before snapping PrimaryFacing to the target', () => {
    // C++ infantry.cpp:3589-3635 calls Can_Fire(TarCom) before
    // PrimaryFacing.Set(Direction8(...)). At this SCG06EA-shaped boundary,
    // the old SE rifle muzzle is in range by one lepton, while the snapped S
    // muzzle would be out of range by one lepton. C++ therefore starts
    // DO_FIRE_WEAPON this tick, then snaps PrimaryFacing for the later launch.
    const scanner = makeEntity(UnitType.I_E1, House.Greece, 0, 0);
    setLeptonPos(scanner, 5312, 16448);
    scanner.mission = Mission.GUARD;
    scanner.missionTimer = 0;
    scanner.facing = Dir.SE;
    scanner.desiredFacing = Dir.SE;
    scanner.bodyFacing256 = 96;
    scanner.desiredFacing256 = 96;
    scanner.bodyFacing32 = 12;
    scanner.doing = 'stand_ready';
    scanner.attackCooldown = 0;

    const target = makeEntity(UnitType.I_E1, House.USSR, 0, 0);
    setLeptonPos(target, 5382, 17146);
    scanner.target = target;

    const oldFire = scanner.fireCoordForWeapon(scanner.weapon!);
    expect(leptonDist(oldFire.lx, oldFire.ly, target.leptonX, target.leptonY)).toBe(767);
    scanner.bodyFacing256 = 128;
    scanner.facing = Dir.S;
    const snappedFire = scanner.fireCoordForWeapon(scanner.weapon!);
    expect(leptonDist(snappedFire.lx, snappedFire.ly, target.leptonX, target.leptonY)).toBe(769);
    scanner.bodyFacing256 = 96;
    scanner.facing = Dir.SE;

    updateAttack(makeCtx({ entities: [scanner, target], tick: 1724 }), scanner);

    expect(scanner.firePrepActive).toBe(true);
    expect(scanner.doing).toBe('fire');
    expect(scanner.bodyFacing256).toBe(128);
    expect(scanner.firePrepFacing256).toBe(128);
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

describe('Guard scan cell occupiers — C++ top-layer falling infantry exclusion', () => {
  it('ignores parachuting infantry while they are still in the top layer', () => {
    // C++ path:
    //   ObjectClass::In_Which_Layer: Height >= FLIGHT_LEVEL - FLIGHT_LEVEL/3 => LAYER_TOP
    //   FootClass::Mark: MARK_DOWN becomes MARK_CHANGE outside LAYER_GROUND
    //   TechnoClass::Evaluate_Cell: reads Map[cell].Cell_Occupier(), so top-layer
    //   falling infantry are not visible to Mission_Guard's ground cell scan.
    const scanner = makeEntity(UnitType.I_E1, House.Greece, 57 * CELL_SIZE + CELL_SIZE / 2, 101 * CELL_SIZE + CELL_SIZE / 2);
    scanner.mission = Mission.GUARD;
    scanner.missionTimer = 0;
    scanner.idleAnimTimer = 0;
    scanner.doing = 'stand_ready';
    scanner.isDriving = false;

    const falling = makeEntity(UnitType.I_E1, House.USSR, 59 * CELL_SIZE + CELL_SIZE / 2, 100 * CELL_SIZE + CELL_SIZE / 2);
    falling.mission = Mission.GUARD;
    falling.isFalling = true;
    falling.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
    falling.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      tagLogging: ScenarioRandom._tagLogging,
      sourceTag: ScenarioRandom._sourceTag,
      entityTag: ScenarioRandom._entityTag,
      seedLog: ScenarioRandom._seedLog,
    };

    try {
      ScenarioRandom.seed = 0x12345678;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._entityTag = scanner.id;
      ScenarioRandom._seedLog = [];

      updateGuard(makeCtx({ entities: [scanner, falling], playerHouse: House.Greece, tick: 612 }), scanner);

      const tags = ScenarioRandom._seedLog.map(([, tag]) => tag);
      expect(scanner.target).toBeNull();
      expect(tags).toContain(30001);
      expect(tags).toContain(30002);
      expect(scanner.idleAnimTimer).toBeGreaterThan(0);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._entityTag = saved.entityTag;
      ScenarioRandom._seedLog = saved.seedLog;
    }
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

  it('AI fraidy-cat civilian wander roll queues Scatter MOVE on Random_Animate case 8', () => {
    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      sourceTag: ScenarioRandom._sourceTag,
      tagLogging: ScenarioRandom._tagLogging,
      seedLog: ScenarioRandom._seedLog,
    };

    try {
      const civ = makeEntity(UnitType.I_C7, House.England, 76 * CELL_SIZE + 12, 48 * CELL_SIZE + 12);
      civ.mission = Mission.GUARD;
      civ.missionTimer = 0;
      civ.idleAnimTimer = 0;
      civ.doing = 'stand_ready';
      civ.fear = 0;

      // Seed 27 makes Random_Animate pick case 8 after the idle-timer roll.
      ScenarioRandom.seed = 27;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._seedLog = [];

      const ctx = makeCtx({
        entities: [civ],
        playerHouse: House.Greece,
        // Game.isPlayerControlled treats player allies as controlled for UI and
        // target selection. C++ Random_Animate checks House->IsHuman instead,
        // so an allied non-player house like SCG01EA England must still scatter.
        isPlayerControlled: () => true,
        infantryCanEnterCell: () => MoveResult.OK,
      });
      updateGuard(ctx, civ);

      expect(civ.mission).toBe(Mission.GUARD);
      expect(civ.missionQueue).toBe(Mission.MOVE);
      expect(civ.moveTarget).not.toBeNull();
      expect(ScenarioRandom._seedLog.map(([, tag]) => tag)).toContain(53003);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._seedLog = saved.seedLog;
    }
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
