/**
 * C++ Parity: Cell Occupier Iteration Order
 *
 * When multiple enemies share a cell (e.g., 5 infantry in sub-cell positions),
 * C++ and TS must pick the SAME entity per cell for the guard scan cellMap.
 *
 * C++ Evaluate_Cell (techno.cpp:1831-1843):
 *   - Traverses Cell_Occupier() linked list, takes FIRST non-allied techno (break).
 *   - The occupier list is LIFO — Occupy_Up (cell.cpp:1189) prepends:
 *       object->Next = OccupierPtr; OccupierPtr = object;
 *   - So FIRST in the LIFO chain = MOST RECENTLY unlimboed entity in that cell.
 *
 * TS ctx.entities is in INI/unlimbo order (oldest first, matching C++ Logic array).
 * To match C++'s "most recently unlimboed wins", the cellMap must keep the LAST
 * entity per cell when iterating ctx.entities forward — i.e., always overwrite.
 *
 * The old code used `if (!cellMap.has(key))` which kept the FIRST (oldest) entity
 * per cell — the opposite of C++.
 *
 * Key C++ references:
 *   - cell.cpp:1189       — Occupy_Up: LIFO prepend (object->Next = OccupierPtr)
 *   - techno.cpp:1831-1843 — Evaluate_Cell: first non-allied in occupier chain wins
 *   - techno.cpp:2108-2209 — Greatest_Threat cell scan: bestval bug = last cell wins
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { updateGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission,
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
    ...overrides,
  };
}

describe('Cell occupier LIFO order — C++ cell.cpp:1189 Occupy_Up + techno.cpp:1831', () => {
  it('picks the LAST entity per cell (most recently unlimboed = LIFO head)', () => {
    // C++ Occupy_Up prepends to the occupier chain (LIFO). Evaluate_Cell picks
    // the first non-allied techno in the chain = the most recently unlimboed.
    //
    // Two enemy infantry in the same cell (different sub-cells), both in range.
    // ctx.entities order = INI/unlimbo order: [older, newer].
    // C++ should pick "newer" (LIFO head). TS must match.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Both enemies in the same cell — sub-cell offsets keep them at same cell coords.
    // Place them 1 cell away from scanner so they're in range.
    const cellX = 200 + 1 * CELL_SIZE;
    const cellY = 200;

    // "older" entity — unlimboed first in C++, appears first in ctx.entities
    const older = makeEntity(UnitType.I_E1, House.Greece, cellX - 5, cellY - 5);
    older.mission = Mission.GUARD;

    // "newer" entity — unlimboed second, appears second in ctx.entities.
    // Same cell (sub-cell offset differs but cell coords are identical).
    const newer = makeEntity(UnitType.I_E1, House.Greece, cellX + 5, cellY + 5);
    newer.mission = Mission.GUARD;

    // Verify both entities are in the same cell
    expect(older.cell.cx).toBe(newer.cell.cx);
    expect(older.cell.cy).toBe(newer.cell.cy);

    const ctx = makeCtx({
      entities: [scanner, older, newer], // INI order: older first
    });
    updateGuard(ctx, scanner);

    // C++ LIFO: "newer" is at the head of the occupier chain, so Evaluate_Cell
    // picks it. The guard scan should select "newer", not "older".
    expect(scanner.target).toBe(newer);
  });

  it('picks newest among 3+ infantry sharing a cell', () => {
    // Stress test: 3 infantry sharing a cell. C++ LIFO picks the last unlimboed.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    const cellX = 200 + 1 * CELL_SIZE;
    const cellY = 200;

    // 3 infantry in the same cell — sub-cell offsets within +-7px
    const first = makeEntity(UnitType.I_E1, House.Greece, cellX - 7, cellY - 7);
    first.mission = Mission.GUARD;
    const second = makeEntity(UnitType.I_E1, House.Greece, cellX + 7, cellY - 7);
    second.mission = Mission.GUARD;
    const third = makeEntity(UnitType.I_E1, House.Greece, cellX - 7, cellY + 7);
    third.mission = Mission.GUARD;

    // All same cell
    expect(first.cell.cx).toBe(second.cell.cx);
    expect(second.cell.cx).toBe(third.cell.cx);
    expect(first.cell.cy).toBe(third.cell.cy);

    const ctx = makeCtx({
      entities: [scanner, first, second, third], // INI order
    });
    updateGuard(ctx, scanner);

    // C++ LIFO: "third" (last unlimboed) is at the head → picked by Evaluate_Cell
    expect(scanner.target).toBe(third);
  });

  it('LIFO order applies per-cell independently', () => {
    // Two cells each with 2 enemies. The guard scan picks one entity per cell,
    // then the bestval bug makes the last cell in scan order win overall.
    // Within each cell, the newest (last in entity array) should be picked.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Cell A: 1 cell to the right (ring 1, right column — scanned last in ring 1)
    const cellAx = 200 + 1 * CELL_SIZE;
    const cellAy = 200;
    const oldA = makeEntity(UnitType.I_E1, House.Greece, cellAx - 5, cellAy);
    oldA.mission = Mission.GUARD;
    const newA = makeEntity(UnitType.I_E1, House.Greece, cellAx + 5, cellAy);
    newA.mission = Mission.GUARD;

    // Cell B: 1 cell above (ring 1, top row — scanned first in ring 1)
    const cellBx = 200;
    const cellBy = 200 - 1 * CELL_SIZE;
    const oldB = makeEntity(UnitType.I_E1, House.Greece, cellBx - 5, cellBy);
    oldB.mission = Mission.GUARD;
    const newB = makeEntity(UnitType.I_E1, House.Greece, cellBx + 5, cellBy);
    newB.mission = Mission.GUARD;

    // Verify cells are distinct
    expect(oldA.cell.cx).not.toBe(oldB.cell.cx); // different columns
    // or different rows
    expect(oldA.cell.cy).not.toBe(oldB.cell.cy);

    const ctx = makeCtx({
      entities: [scanner, oldA, newA, oldB, newB],
    });
    updateGuard(ctx, scanner);

    // Cell A is at right column of ring 1, scanned AFTER cell B (top row).
    // bestval bug: last scanned cell wins → cell A wins.
    // LIFO within cell A: newA (last in array) is picked.
    expect(scanner.target).toBe(newA);
  });
});
