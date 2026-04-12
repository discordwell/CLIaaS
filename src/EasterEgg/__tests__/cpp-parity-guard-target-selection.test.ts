/**
 * C++ Parity: Guard Target Selection — Cell-Based Scan & Existing Target Retention
 *
 * Tests the two key C++ parity fixes in updateGuard():
 *
 * 1. EXISTING TARGET RETENTION (techno.cpp:5260-5266)
 *    C++ Target_Something_Nearby checks if the existing TarCom is still legal and
 *    in range BEFORE calling Greatest_Threat. If the existing target is valid, it
 *    stays — no rescan occurs. This prevents guard units from switching targets
 *    every scan cycle when the current target is still valid.
 *
 * 2. CELL-BASED SCAN ORDER (techno.cpp:2108-2209)
 *    C++ Greatest_Threat with THREAT_RANGE scans cells in a radial outward pattern
 *    from the scanner's Fire_Coord cell. A bug in the C++ code means bestval is
 *    never updated during the cell scan, so the LAST valid target in scan order
 *    wins (not the highest-scoring one). Early bailout at crange/4 and crange/2.
 *
 * Key C++ references:
 *   - foot.cpp:589-634      — Mission_Guard: calls Target_Something_Nearby(THREAT_RANGE)
 *   - techno.cpp:5251-5281  — Target_Something_Nearby: existing target check, then Greatest_Threat
 *   - techno.cpp:2108-2209  — Cell-based radial scan with bestval bug
 *   - techno.cpp:2198-2205  — Early bailout at crange/4 and crange/2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { updateGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission, Stance,
  worldDist,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType | string, house: House, x: number, y: number): Entity {
  return new Entity(type as UnitType, house, x, y);
}

function makeCtx(overrides: Partial<MissionAIContext> & { entities?: Entity[] }): MissionAIContext {
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
      getWallType: () => undefined,
      setWallType: () => {},
      getOreCell: () => null,
    } as any,
    tick: 100,
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
    threatScore: (_scanner, _target, dist) => 100 - Math.floor(dist),
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

describe('Existing target retention — C++ techno.cpp:5260-5266', () => {
  it('keeps existing target when still alive and in range (no rescan)', () => {
    // C++ Target_Something_Nearby: if Target_Legal(TarCom) && In_Range(TarCom, primary),
    // keep existing target — Greatest_Threat is NOT called.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    const existingTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    existingTarget.mission = Mission.GUARD;

    // A closer (higher-scoring) target exists
    const closerTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 1 * CELL_SIZE, 200);
    closerTarget.mission = Mission.GUARD;

    // Pre-set the existing target
    scanner.target = existingTarget;

    const ctx = makeCtx({ entities: [scanner, existingTarget, closerTarget] });
    updateGuard(ctx, scanner); // timer fired

    // C++ would keep the existing target because it's still valid and in range.
    // The closer target is NOT selected — Greatest_Threat is never called.
    expect(scanner.target).toBe(existingTarget);
  });

  it('clears existing target when out of range and rescans', () => {
    // C++ Target_Something_Nearby: if Target_Legal(TarCom) && !(In_Range(TarCom, primary)),
    // Assign_Target(TARGET_NONE), then call Greatest_Threat.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    // Place existing target well out of range (M1Carbine range = 3.0 cells)
    const farTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 10 * CELL_SIZE, 200);
    farTarget.mission = Mission.GUARD;

    // A new target in range
    const nearTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    nearTarget.mission = Mission.GUARD;

    scanner.target = farTarget;

    const ctx = makeCtx({ entities: [scanner, farTarget, nearTarget] });
    updateGuard(ctx, scanner);

    // Existing target out of range → cleared → rescan finds near target
    expect(scanner.target).toBe(nearTarget);
  });

  it('clears existing target when dead and rescans', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    const deadTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    deadTarget.alive = false; // dead

    const aliveTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 1.5 * CELL_SIZE, 200);
    aliveTarget.mission = Mission.GUARD;

    scanner.target = deadTarget;

    const ctx = makeCtx({ entities: [scanner, deadTarget, aliveTarget] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(aliveTarget);
  });
});

describe('Cell-based scan order — C++ techno.cpp:2108-2209', () => {
  it('cell scan order matches C++ radial pattern (last valid in order wins)', () => {
    // C++ bug: bestval is never updated in cell scan, so every valid target overwrites.
    // The last cell scanned with a valid target becomes the selection.
    // Scan order per ring: top row L→R, bottom row L→R, left col T→B, right col T→B.
    //
    // With two targets in the same ring, the one scanned LAST should win,
    // not the one with the higher threat score.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Both targets at ring 1, same distance — different scan order positions
    // Place one on the top row (scanned first) and one on the right column (scanned last)
    const topRowTarget = makeEntity(UnitType.I_E1, House.Greece,
      200, 200 - 1 * CELL_SIZE); // top of ring 1
    topRowTarget.mission = Mission.GUARD;

    const rightColTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 1 * CELL_SIZE, 200); // right of ring 1
    rightColTarget.mission = Mission.GUARD;

    // Use a threatScore that makes topRowTarget higher — old code would pick it,
    // but C++ cell scan order should pick rightColTarget (last in scan order).
    const ctx = makeCtx({
      entities: [scanner, topRowTarget, rightColTarget],
      threatScore: (_scanner, target, _dist) => {
        // Give top row target a MUCH higher score
        return target === topRowTarget ? 1000 : 1;
      },
    });
    updateGuard(ctx, scanner);

    // C++ cell scan: ring 1 scans top row, then bottom row, then left col, then right col.
    // rightColTarget is in the right column, scanned AFTER topRowTarget (top row).
    // Since bestval is never updated, rightColTarget overwrites topRowTarget.
    expect(scanner.target).toBe(rightColTarget);
  });

  it('early bailout at crange/4 prevents scanning outer rings', () => {
    // C++ techno.cpp:2198-2205: if bestobject != NULL at radius == crange/4, return early.
    // For E1 M1Carbine (range=3.0), crange = floor(3.0)+1 = 4, crange/4 = 1.
    // So if a target is found at ring 0 or 1, it returns at ring 1 without checking ring 2/3.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Inner target at ring 1
    const innerTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 1 * CELL_SIZE, 200);
    innerTarget.mission = Mission.GUARD;

    // Outer target at ring 2 — would have higher score if scanned,
    // but early bailout prevents it
    const outerTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 2 * CELL_SIZE, 200);
    outerTarget.mission = Mission.GUARD;

    const ctx = makeCtx({
      entities: [scanner, innerTarget, outerTarget],
      threatScore: (_scanner, target, _dist) => {
        // Outer target scores MUCH higher
        return target === outerTarget ? 9999 : 1;
      },
    });
    updateGuard(ctx, scanner);

    // Early bailout at crange/4=1 means innerTarget (found at ring 1) is returned
    // before outerTarget (ring 2) is ever checked.
    expect(scanner.target).toBe(innerTarget);
  });
});
