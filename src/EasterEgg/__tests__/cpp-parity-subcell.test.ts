/**
 * C++ Behavioral Parity: Infantry Sub-Cell Positions (5 per cell)
 *
 * Tests verify infantry sub-cell occupancy matches C++ RA source code.
 *
 * C++ source references:
 * - cell.h:191-203 — Flag.Occupy union: Center, NW, NE, SW, SE, Vehicle, Monolith, Building
 * - cell.h:241 — Is_Spot_Free(spot_index): checks bit flag for sub-cell availability
 * - cell.cpp:1744-1766 — Spot_Index: maps COORDINATE to sub-cell index (0=center, 1-4=corners)
 * - cell.cpp:1795-1865 — Closest_Free_Spot: finds nearest free sub-cell, CENTER preferred
 * - cell.cpp:587-646 — Occupy_Down: sets Vehicle/Monolith/Building flags for non-infantry
 *
 * Observable behavior tested:
 * - Up to 5 infantry can occupy one cell in different sub-cells
 * - 6th infantry is blocked from entering (all sub-cells full)
 * - Vehicle entering a cell blocks all sub-cells
 * - Infantry cannot enter a cell occupied by a vehicle
 * - Sub-cell assignment prefers CENTER (0), then NW(1), NE(2), SW(3), SE(4)
 * - Each infantry gets a unique sub-cell within the same cell
 * - Vehicle always uses CENTER (sub-cell 0)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UnitType, House, CELL_SIZE, MAP_CELLS } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, MoveResult } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create a map with clear terrain in the playable area */
function makeMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, 128, 128);
  return map;
}

// ── C++ cell.h:191-203 — Sub-cell occupancy system ────────────────────────────

describe('Infantry sub-cell positions (C++ cell.h:191-203, cell.cpp:1795-1865)', () => {

  it('up to 5 infantry can occupy one cell via sub-cells', () => {
    const map = makeMap();
    const cx = 10, cy = 10;
    const infantry: Entity[] = [];

    // Place 5 infantry in the same cell
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      const subCell = map.occupySubCell(cx, cy, inf.id);
      expect(subCell, `infantry ${i} should get a valid sub-cell`).toBeGreaterThanOrEqual(0);
      expect(subCell).toBeLessThanOrEqual(4);
      inf.subCell = subCell;
      infantry.push(inf);
    }

    // All 5 should have unique sub-cells
    const subCells = new Set(infantry.map(i => i.subCell));
    expect(subCells.size).toBe(5);
  });

  it('6th infantry is blocked from entering a full cell', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Fill all 5 sub-cells
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      const subCell = map.occupySubCell(cx, cy, inf.id);
      expect(subCell).toBeGreaterThanOrEqual(0);
    }

    // 6th infantry should be blocked
    const sixth = entityAtCell(UnitType.E1, House.Spain, cx, cy);
    const subCell = map.occupySubCell(cx, cy, sixth.id);
    expect(subCell).toBe(-1);
  });

  it('vehicle entering a cell blocks all sub-cells (C++ cell.h:198 Vehicle flag)', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Place a vehicle
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, cx, cy);
    map.setVehicleOccupancy(cx, cy, tank.id);

    // Infantry should not be able to enter
    const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
    const subCell = map.occupySubCell(cx, cy, inf.id);
    expect(subCell).toBe(-1);

    // hasAvailableSubCell should return false
    expect(map.hasAvailableSubCell(cx, cy)).toBe(false);
  });

  it('infantry cannot enter a cell with a vehicle (C++ cell.cpp:1830)', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Place a vehicle first
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, cx, cy);
    map.setVehicleOccupancy(cx, cy, tank.id);

    // canEnterCell for infantry should return OCCUPIED
    const result = map.canEnterCell(cx, cy, false, undefined, true);
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('sub-cell assignment prefers CENTER (0), then corners (C++ cell.cpp:1806-1812)', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Place infantry one by one and check sub-cell order
    const expectedOrder = [0, 1, 2, 3, 4]; // CENTER, NW, NE, SW, SE
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      const subCell = map.occupySubCell(cx, cy, inf.id);
      expect(subCell, `infantry ${i} should get sub-cell ${expectedOrder[i]}`).toBe(expectedOrder[i]);
    }
  });

  it('each infantry gets a unique sub-cell within the same cell', () => {
    const map = makeMap();
    const cx = 10, cy = 10;
    const assigned: number[] = [];

    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      const subCell = map.occupySubCell(cx, cy, inf.id);
      expect(assigned).not.toContain(subCell);
      assigned.push(subCell);
    }

    // All 5 distinct values 0-4
    expect(assigned.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('vehicle always uses CENTER (sub-cell 0)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // Vehicles default to subCell 0 (CENTER) and don't use the sub-cell system
    expect(tank.subCell).toBe(0);
  });
});

// ── canEnterCell integration with sub-cells ────────────────────────────────────

describe('canEnterCell with infantry sub-cell awareness', () => {

  it('infantry can enter a cell with 4 infantry already (1 sub-cell free)', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Fill 4 sub-cells
    for (let i = 0; i < 4; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
    }
    // Set legacy occupancy for backward compat
    map.setOccupancy(cx, cy, 1);

    // Infantry should still be able to enter (1 sub-cell available)
    const result = map.canEnterCell(cx, cy, false, undefined, true);
    expect(result).toBe(MoveResult.OK);
  });

  it('infantry cannot enter a cell with 5 infantry (all sub-cells full)', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Fill all 5 sub-cells
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
    }
    map.setOccupancy(cx, cy, 1);

    // Infantry should be blocked
    const result = map.canEnterCell(cx, cy, false, undefined, true);
    expect(result).toBe(MoveResult.OCCUPIED);
  });

  it('vehicle cannot enter a cell with any occupant', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Place 1 infantry
    const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
    map.occupySubCell(cx, cy, inf.id);
    map.setOccupancy(cx, cy, inf.id);

    // Vehicle (isInfantry=false) should see occupant — C++ MOVE_TEMP for stationary
    const result = map.canEnterCell(cx, cy, false, undefined, false);
    expect(result).toBe(MoveResult.TEMP_BLOCKED);
  });

  it('empty cell is passable for both infantry and vehicles', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    expect(map.canEnterCell(cx, cy, false, undefined, true)).toBe(MoveResult.OK);
    expect(map.canEnterCell(cx, cy, false, undefined, false)).toBe(MoveResult.OK);
  });
});

// ── vacateSubCell and clearSubCellOccupancy ────────────────────────────────────

describe('Sub-cell vacate and clear operations', () => {

  it('vacating a sub-cell makes it available again', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Fill all 5 sub-cells, remembering entity IDs
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
      ids.push(inf.id);
    }

    // All full
    expect(map.hasAvailableSubCell(cx, cy)).toBe(false);

    // Vacate one infantry
    map.vacateSubCell(cx, cy, ids[2]);

    // Now one sub-cell should be available
    expect(map.hasAvailableSubCell(cx, cy)).toBe(true);

    // New infantry can enter
    const newInf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
    const subCell = map.occupySubCell(cx, cy, newInf.id);
    expect(subCell).toBeGreaterThanOrEqual(0);
  });

  it('clearSubCellOccupancy resets all sub-cell data', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Fill sub-cells and vehicle flags
    for (let i = 0; i < 3; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
    }
    map.setVehicleOccupancy(15, 15, 999);

    // Clear all
    map.clearSubCellOccupancy();

    // Everything should be empty
    expect(map.hasAvailableSubCell(cx, cy)).toBe(true);
    expect(map.hasVehicleOccupancy(15, 15)).toBe(false);
    expect(map.getSubCellCount(cx, cy)).toBe(0);
  });
});

// ── getSubCellCount ────────────────────────────────────────────────────────────

describe('getSubCellCount', () => {

  it('returns 0 for empty cell', () => {
    const map = makeMap();
    expect(map.getSubCellCount(10, 10)).toBe(0);
  });

  it('returns correct count as infantry are added', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
      expect(map.getSubCellCount(cx, cy)).toBe(i + 1);
    }
  });

  it('returns 5 for vehicle-occupied cell', () => {
    const map = makeMap();
    const cx = 10, cy = 10;
    map.setVehicleOccupancy(cx, cy, 999);
    expect(map.getSubCellCount(cx, cy)).toBe(5);
  });
});

// ── Infantry in different cells get independent sub-cells ──────────────────────

describe('Independent sub-cell tracking per cell', () => {

  it('infantry in different cells get independent sub-cell assignments', () => {
    const map = makeMap();

    // Cell A: 3 infantry
    const subCellsA: number[] = [];
    for (let i = 0; i < 3; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, 10, 10);
      subCellsA.push(map.occupySubCell(10, 10, inf.id));
    }

    // Cell B: 2 infantry
    const subCellsB: number[] = [];
    for (let i = 0; i < 2; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, 20, 20);
      subCellsB.push(map.occupySubCell(20, 20, inf.id));
    }

    // Cell A should have sub-cells 0,1,2
    expect(subCellsA).toEqual([0, 1, 2]);
    // Cell B should have sub-cells 0,1 (independent from A)
    expect(subCellsB).toEqual([0, 1]);
  });

  it('filling one cell does not affect adjacent cells', () => {
    const map = makeMap();

    // Fill cell (10,10) completely
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, 10, 10);
      map.occupySubCell(10, 10, inf.id);
    }

    // Adjacent cell (11,10) should still be empty
    expect(map.hasAvailableSubCell(11, 10)).toBe(true);
    expect(map.getSubCellCount(11, 10)).toBe(0);
  });
});

// ── Mixed infantry and vehicle scenarios ───────────────────────────────────────

describe('Mixed infantry and vehicle sub-cell interactions', () => {

  it('vehicle placed after infantry blocks the cell', () => {
    const map = makeMap();
    const cx = 10, cy = 10;

    // Place 2 infantry first
    for (let i = 0; i < 2; i++) {
      const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
      map.occupySubCell(cx, cy, inf.id);
    }

    // Then place vehicle (overrides — blocks all sub-cells)
    map.setVehicleOccupancy(cx, cy, 999);

    // No more infantry can enter
    const inf = entityAtCell(UnitType.E1, House.Spain, cx, cy);
    expect(map.occupySubCell(cx, cy, inf.id)).toBe(-1);
    expect(map.hasAvailableSubCell(cx, cy)).toBe(false);
  });

  it('hasVehicleOccupancy correctly identifies vehicle presence', () => {
    const map = makeMap();

    // No vehicle
    expect(map.hasVehicleOccupancy(10, 10)).toBe(false);

    // Infantry only — no vehicle flag
    map.occupySubCell(10, 10, 1);
    expect(map.hasVehicleOccupancy(10, 10)).toBe(false);

    // Vehicle set
    map.setVehicleOccupancy(10, 10, 999);
    expect(map.hasVehicleOccupancy(10, 10)).toBe(true);
  });
});
