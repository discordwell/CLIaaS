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
    ...overrides,
  };
}

describe('Guard scan range boundary — C++ techno.cpp:1517-1523 In_Range uses <=', () => {
  it('target at EXACTLY weapon range is included (C++ Distance <= Weapon_Range)', () => {
    // C++ In_Range: ::Distance(Fire_Coord, target->Center_Coord()) <= Weapon_Range
    // M1Carbine range = 3.0 cells. Target at exactly 3.0 should be in range.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    // Place target at exactly 3 cells away (horizontal)
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 3.0 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // C++ would include this target (<=), so TS should too
    expect(scanner.target).toBe(target);
  });

  it('target just beyond weapon range is excluded (C++ Distance > Weapon_Range)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    // Place target at 3.1 cells (just outside M1Carbine range=3.0)
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 3.1 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    // Should NOT find this target — beyond weapon range
    expect(scanner.target).toBeNull();
  });
});

describe('Guard scan has no terrain LOS check — C++ Evaluate_Object parity', () => {
  it('target behind wall is still valid (C++ has no hasLineOfSight in Evaluate_Object)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
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
