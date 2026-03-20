/**
 * C++ Behavioral Parity: Map Cell System — Sub-Cell Occupancy & Vehicle Blocking
 *
 * Tests the infantry sub-cell occupancy system and vehicle/infantry blocking
 * behavior that matches C++ Red Alert cell.cpp and cell.h.
 *
 * C++ source of truth:
 *   - cell.h:Flag.Occupy          — sub-cell positions (CENTER, NW, NE, SW, SE)
 *   - cell.h:Flag.Occupy.Vehicle  — vehicle occupies entire cell (blocks all sub-cells)
 *   - cell.cpp:Closest_Free_Spot  — sub-cell assignment order: CENTER first, then corners
 *   - cell.cpp:Can_Enter_Cell     — infantry sub-cell passability vs vehicle full-cell blocking
 *   - findpath.cpp                — MoveResult enum values for pathfinding
 *   - overlay.cpp                 — wall overlay types (SBAG, FENC, BARB, BRIK, WOOD, CYCL)
 *
 * Complements cpp-parity-map.test.ts which covers terrain, bounds, visibility,
 * ore/gems, speed multipliers, LOS, decals, bridges, and gap generators.
 * This file focuses on the sub-cell infantry system and vehicle blocking
 * that was not covered there.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';

let map: GameMap;

beforeEach(() => {
  map = new GameMap();
  map.setBounds(0, 0, 50, 50);
});

// =============================================================================
//  1. Sub-Cell Positions — C++ cell.h Flag.Occupy
// =============================================================================

describe('Sub-cell positions match C++ cell.h Flag.Occupy', () => {

  it('5 sub-cell slots per cell: CENTER(0), NW(1), NE(2), SW(3), SE(4)', () => {
    // occupySubCell returns the assigned sub-cell index
    const s0 = map.occupySubCell(10, 10, 101);
    expect(s0).toBe(0); // CENTER first

    const s1 = map.occupySubCell(10, 10, 102);
    expect(s1).toBe(1); // NW

    const s2 = map.occupySubCell(10, 10, 103);
    expect(s2).toBe(2); // NE

    const s3 = map.occupySubCell(10, 10, 104);
    expect(s3).toBe(3); // SW

    const s4 = map.occupySubCell(10, 10, 105);
    expect(s4).toBe(4); // SE
  });

  it('sub-cell order matches C++ Closest_Free_Spot: CENTER, NW, NE, SW, SE', () => {
    // C++ cell.cpp Closest_Free_Spot prefers CENTER (0) first, then corners in order
    const order: number[] = [];
    for (let i = 0; i < 5; i++) {
      order.push(map.occupySubCell(10, 10, 200 + i));
    }
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

// =============================================================================
//  2. Infantry Sub-Cell Occupancy — occupySubCell (cell.cpp Closest_Free_Spot)
// =============================================================================

describe('occupySubCell — C++ cell.cpp Closest_Free_Spot', () => {

  it('first infantry gets CENTER (sub-cell 0)', () => {
    expect(map.occupySubCell(10, 10, 1)).toBe(0);
  });

  it('second infantry gets NW (sub-cell 1)', () => {
    map.occupySubCell(10, 10, 1);
    expect(map.occupySubCell(10, 10, 2)).toBe(1);
  });

  it('all 5 infantry fill sub-cells 0 through 4', () => {
    for (let i = 1; i <= 5; i++) {
      const slot = map.occupySubCell(10, 10, i);
      expect(slot).toBe(i - 1);
    }
  });

  it('6th infantry returns -1 (all 5 sub-cells full)', () => {
    for (let i = 1; i <= 5; i++) {
      map.occupySubCell(10, 10, i);
    }
    expect(map.occupySubCell(10, 10, 6)).toBe(-1);
  });

  it('sets legacy occupancy to first infantry ID for backward compat', () => {
    map.occupySubCell(10, 10, 42);
    expect(map.getOccupancy(10, 10)).toBe(42);

    // Second infantry does not overwrite legacy occupancy
    map.occupySubCell(10, 10, 43);
    expect(map.getOccupancy(10, 10)).toBe(42);
  });

  it('out-of-bounds returns -1', () => {
    expect(map.occupySubCell(-1, 0, 1)).toBe(-1);
    expect(map.occupySubCell(0, -1, 1)).toBe(-1);
    expect(map.occupySubCell(128, 0, 1)).toBe(-1);
    expect(map.occupySubCell(0, 128, 1)).toBe(-1);
  });
});

// =============================================================================
//  3. vacateSubCell — infantry leaving a cell (cell.cpp)
// =============================================================================

describe('vacateSubCell — infantry leaving a cell', () => {

  it('clears the sub-cell slot matching the entity ID', () => {
    map.occupySubCell(10, 10, 42);
    map.occupySubCell(10, 10, 43);
    map.vacateSubCell(10, 10, 42);
    // Sub-cell 0 (CENTER) should now be free; sub-cell 1 (NW) still has 43
    expect(map.getSubCellCount(10, 10)).toBe(1);
  });

  it('frees a slot so new infantry can take it', () => {
    // Fill CENTER
    map.occupySubCell(10, 10, 42);
    // Vacate CENTER
    map.vacateSubCell(10, 10, 42);
    // New infantry should get CENTER again (slot 0 is free)
    const slot = map.occupySubCell(10, 10, 99);
    expect(slot).toBe(0);
  });

  it('only clears the first matching slot (not duplicates)', () => {
    map.occupySubCell(10, 10, 42);
    map.occupySubCell(10, 10, 43);
    map.occupySubCell(10, 10, 44);
    map.vacateSubCell(10, 10, 43);
    // Should have 2 remaining
    expect(map.getSubCellCount(10, 10)).toBe(2);
  });

  it('vacating non-existent entity is a no-op', () => {
    map.occupySubCell(10, 10, 42);
    map.vacateSubCell(10, 10, 999); // not present
    expect(map.getSubCellCount(10, 10)).toBe(1);
  });

  it('vacating from empty cell is safe', () => {
    // No sub-cell data exists at all
    map.vacateSubCell(10, 10, 42); // should not throw
  });

  it('out-of-bounds vacate is safe', () => {
    map.vacateSubCell(-1, 0, 42); // should not throw
    map.vacateSubCell(128, 0, 42);
  });
});

// =============================================================================
//  4. getSubCellCount — number of occupied sub-cells (cell.h)
// =============================================================================

describe('getSubCellCount — occupied sub-cell count', () => {

  it('empty cell returns 0', () => {
    expect(map.getSubCellCount(10, 10)).toBe(0);
  });

  it('one infantry returns 1', () => {
    map.occupySubCell(10, 10, 42);
    expect(map.getSubCellCount(10, 10)).toBe(1);
  });

  it('three infantry returns 3', () => {
    map.occupySubCell(10, 10, 1);
    map.occupySubCell(10, 10, 2);
    map.occupySubCell(10, 10, 3);
    expect(map.getSubCellCount(10, 10)).toBe(3);
  });

  it('all 5 infantry returns 5', () => {
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.getSubCellCount(10, 10)).toBe(5);
  });

  it('vehicle-occupied cell returns 5 (all blocked)', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.getSubCellCount(10, 10)).toBe(5);
  });

  it('out-of-bounds returns 5 (fully blocked)', () => {
    expect(map.getSubCellCount(-1, 0)).toBe(5);
    expect(map.getSubCellCount(128, 0)).toBe(5);
  });
});

// =============================================================================
//  5. hasAvailableSubCell — infantry can enter check (cell.h)
// =============================================================================

describe('hasAvailableSubCell — infantry cell entry check', () => {

  it('empty cell has available sub-cells', () => {
    expect(map.hasAvailableSubCell(10, 10)).toBe(true);
  });

  it('cell with 1 infantry still has available sub-cells', () => {
    map.occupySubCell(10, 10, 42);
    expect(map.hasAvailableSubCell(10, 10)).toBe(true);
  });

  it('cell with 4 infantry still has 1 available', () => {
    for (let i = 1; i <= 4; i++) map.occupySubCell(10, 10, i);
    expect(map.hasAvailableSubCell(10, 10)).toBe(true);
  });

  it('cell with 5 infantry has NO available sub-cells', () => {
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.hasAvailableSubCell(10, 10)).toBe(false);
  });

  it('vehicle-occupied cell has NO available sub-cells', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.hasAvailableSubCell(10, 10)).toBe(false);
  });

  it('out-of-bounds returns false', () => {
    expect(map.hasAvailableSubCell(-1, 0)).toBe(false);
    expect(map.hasAvailableSubCell(128, 0)).toBe(false);
  });
});

// =============================================================================
//  6. Vehicle Occupancy — C++ cell.h Flag.Occupy.Vehicle
// =============================================================================

describe('Vehicle occupancy — C++ cell.h Flag.Occupy.Vehicle', () => {

  it('setVehicleOccupancy marks cell as vehicle-occupied', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.hasVehicleOccupancy(10, 10)).toBe(true);
  });

  it('setVehicleOccupancy sets legacy occupancy ID', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.getOccupancy(10, 10)).toBe(42);
  });

  it('vehicle blocks all 5 sub-cells for infantry', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.occupySubCell(10, 10, 99)).toBe(-1);
  });

  it('hasVehicleOccupancy defaults to false', () => {
    expect(map.hasVehicleOccupancy(10, 10)).toBe(false);
  });

  it('hasVehicleOccupancy returns false for out-of-bounds', () => {
    expect(map.hasVehicleOccupancy(-1, 0)).toBe(false);
    expect(map.hasVehicleOccupancy(128, 0)).toBe(false);
  });

  it('setVehicleOccupancy silently ignores out-of-bounds', () => {
    map.setVehicleOccupancy(-1, 0, 42); // should not throw
    map.setVehicleOccupancy(128, 0, 42);
    expect(map.hasVehicleOccupancy(0, 0)).toBe(false);
  });
});

// =============================================================================
//  7. clearSubCellOccupancy — tick rebuild reset (cell.cpp)
// =============================================================================

describe('clearSubCellOccupancy — tick rebuild reset', () => {

  it('clears all sub-cell data', () => {
    map.occupySubCell(10, 10, 1);
    map.occupySubCell(10, 10, 2);
    map.occupySubCell(11, 11, 3);
    map.clearSubCellOccupancy();
    expect(map.getSubCellCount(10, 10)).toBe(0);
    expect(map.getSubCellCount(11, 11)).toBe(0);
  });

  it('clears all vehicle occupancy flags', () => {
    map.setVehicleOccupancy(10, 10, 42);
    map.setVehicleOccupancy(20, 20, 43);
    map.clearSubCellOccupancy();
    expect(map.hasVehicleOccupancy(10, 10)).toBe(false);
    expect(map.hasVehicleOccupancy(20, 20)).toBe(false);
  });

  it('after clear, infantry can re-occupy cells', () => {
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.hasAvailableSubCell(10, 10)).toBe(false);
    map.clearSubCellOccupancy();
    expect(map.hasAvailableSubCell(10, 10)).toBe(true);
    expect(map.occupySubCell(10, 10, 99)).toBe(0); // CENTER again
  });

  it('after clear, vehicles can re-mark cells', () => {
    map.setVehicleOccupancy(10, 10, 42);
    map.clearSubCellOccupancy();
    expect(map.hasVehicleOccupancy(10, 10)).toBe(false);
    map.setVehicleOccupancy(10, 10, 43);
    expect(map.hasVehicleOccupancy(10, 10)).toBe(true);
  });
});

// =============================================================================
//  8. isOnlyInfantryOccupied — cell has infantry but no vehicles (cell.cpp)
// =============================================================================

describe('isOnlyInfantryOccupied — infantry-only check (cell.cpp)', () => {

  it('empty cell returns false', () => {
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(false);
  });

  it('cell with one infantry returns true', () => {
    map.occupySubCell(10, 10, 42);
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(true);
  });

  it('cell with 5 infantry returns true', () => {
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(true);
  });

  it('vehicle-occupied cell returns false', () => {
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(false);
  });

  it('vehicle overrides infantry — returns false', () => {
    map.occupySubCell(10, 10, 42);
    map.setVehicleOccupancy(10, 10, 99);
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(false);
  });

  it('out-of-bounds returns false', () => {
    expect(map.isOnlyInfantryOccupied(-1, 0)).toBe(false);
    expect(map.isOnlyInfantryOccupied(128, 0)).toBe(false);
  });

  it('cell with sub-cell data but all slots vacant returns false', () => {
    // Occupy then vacate — sub-cell array exists but all zeros
    map.occupySubCell(10, 10, 42);
    map.vacateSubCell(10, 10, 42);
    expect(map.isOnlyInfantryOccupied(10, 10)).toBe(false);
  });
});

// =============================================================================
//  9. canEnterCell with isInfantry — C++ Can_Enter_Cell infantry sub-cell mode
// =============================================================================

describe('canEnterCell isInfantry — C++ Can_Enter_Cell infantry mode (cell.cpp)', () => {

  it('empty passable cell with isInfantry=true returns OK', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('cell with 1 infantry and isInfantry=true returns OK (sub-cells available)', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.occupySubCell(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('cell with 4 infantry and isInfantry=true returns OK (1 sub-cell left)', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    for (let i = 1; i <= 4; i++) map.occupySubCell(10, 10, i);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('cell with 5 infantry and isInfantry=true returns OCCUPIED', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OCCUPIED);
  });

  it('vehicle-occupied cell with isInfantry=true returns OCCUPIED', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OCCUPIED);
  });

  it('impassable terrain with isInfantry=true returns IMPASSABLE', () => {
    map.setTerrain(10, 10, Terrain.ROCK);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('out-of-bounds with isInfantry=true returns IMPASSABLE', () => {
    map.setBounds(20, 20, 10, 10);
    expect(map.canEnterCell(5, 5, false, undefined, true)).toBe(MoveResult.IMPASSABLE);
  });
});

// =============================================================================
// 10. Vehicle vs Infantry Blocking — C++ cell.h full-cell vs sub-cell
// =============================================================================

describe('Vehicle vs infantry blocking — C++ cell.h full-cell vs sub-cell', () => {

  it('vehicle occupancy fully blocks cell for non-infantry (OCCUPIED)', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setVehicleOccupancy(10, 10, 42);
    // Non-infantry (default isInfantry=false) checks legacy occupancy
    expect(map.canEnterCell(10, 10)).toBe(MoveResult.OCCUPIED);
  });

  it('vehicle occupancy fully blocks cell for infantry (OCCUPIED)', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OCCUPIED);
  });

  it('infantry occupancy blocks only specific sub-cells, not whole cell for other infantry', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    // Place 3 infantry — 2 sub-cells still free
    map.occupySubCell(10, 10, 1);
    map.occupySubCell(10, 10, 2);
    map.occupySubCell(10, 10, 3);
    // Another infantry can still enter (isInfantry=true)
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('infantry occupancy blocks cell for vehicles (legacy occupancy set)', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.occupySubCell(10, 10, 42);
    // Non-infantry sees legacy occupancy > 0 → OCCUPIED
    expect(map.canEnterCell(10, 10, false)).toBe(MoveResult.OCCUPIED);
  });

  it('moving infantry in cell returns TEMP_BLOCKED for vehicles', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.occupySubCell(10, 10, 42);
    const isMoving = (id: number) => id === 42;
    // Non-infantry with isMoving callback
    expect(map.canEnterCell(10, 10, false, isMoving)).toBe(MoveResult.TEMP_BLOCKED);
  });
});

// =============================================================================
// 11. Wall Type Tracking — WOOD and CYCL (overlay.cpp)
// =============================================================================

describe('Wall type tracking — WOOD and CYCL wall types (overlay.cpp)', () => {

  it('setWallType / getWallType round-trip for WOOD', () => {
    map.setWallType(10, 10, 'WOOD');
    expect(map.getWallType(10, 10)).toBe('WOOD');
  });

  it('setWallType / getWallType round-trip for CYCL', () => {
    map.setWallType(10, 10, 'CYCL');
    expect(map.getWallType(10, 10)).toBe('CYCL');
  });

  it('clearWallType removes WOOD wall', () => {
    map.setWallType(10, 10, 'WOOD');
    map.clearWallType(10, 10);
    expect(map.getWallType(10, 10)).toBe('');
  });

  it('clearWallType removes CYCL wall', () => {
    map.setWallType(10, 10, 'CYCL');
    map.clearWallType(10, 10);
    expect(map.getWallType(10, 10)).toBe('');
  });

  it('all 6 C++ wall types: SBAG, FENC, BARB, BRIK, WOOD, CYCL', () => {
    const wallTypes = ['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'];
    wallTypes.forEach((wt, i) => {
      map.setWallType(10 + i, 10, wt);
      expect(map.getWallType(10 + i, 10)).toBe(wt);
    });
  });

  it('overwriting WOOD with BRIK replaces the type', () => {
    map.setWallType(10, 10, 'WOOD');
    map.setWallType(10, 10, 'BRIK');
    expect(map.getWallType(10, 10)).toBe('BRIK');
  });
});

// =============================================================================
// 12. Overlay Increment/Decrement — ore/gem density (overlay.cpp)
// =============================================================================

describe('Overlay increment/decrement — ore/gem density (overlay.cpp)', () => {

  it('gold ore density decrements from 0x08 to 0x07 on depletion', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x08;
    map.depleteOre(10, 10);
    expect(map.overlay[idx]).toBe(0x07);
  });

  it('gold ore density decrements from 0x0E (max) to 0x0D', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x0E;
    map.depleteOre(10, 10);
    expect(map.overlay[idx]).toBe(0x0D);
  });

  it('gold ore at min (0x03) depletes to 0xFF (empty)', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x03;
    map.depleteOre(10, 10);
    expect(map.overlay[idx]).toBe(0xFF);
  });

  it('gem density decrements from 0x12 (max) to 0x11', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x12;
    map.depleteOre(10, 10);
    expect(map.overlay[idx]).toBe(0x11);
  });

  it('gem at min (0x0F) depletes to 0xFF (empty)', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x0F;
    map.depleteOre(10, 10);
    expect(map.overlay[idx]).toBe(0xFF);
  });

  it('successive depletions walk gold down from max to empty', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x0E; // max gold (12 density levels: 0x03..0x0E)
    // Deplete 12 times: 0x0E → 0x0D → ... → 0x03 → 0xFF
    for (let i = 0; i < 12; i++) {
      expect(map.depleteOre(10, 10)).toBe(35);
    }
    expect(map.overlay[idx]).toBe(0xFF);
    // 13th depletion yields 0 (empty)
    expect(map.depleteOre(10, 10)).toBe(0);
  });

  it('successive depletions walk gem down from max to empty', () => {
    const idx = 10 * MAP_CELLS + 10;
    map.overlay[idx] = 0x12; // max gem (4 density levels: 0x0F..0x12)
    for (let i = 0; i < 4; i++) {
      expect(map.depleteOre(10, 10)).toBe(110);
    }
    expect(map.overlay[idx]).toBe(0xFF);
    expect(map.depleteOre(10, 10)).toBe(0);
  });
});

// =============================================================================
// 13. Sub-Cell Occupancy Edge Cases
// =============================================================================

describe('Sub-cell occupancy edge cases', () => {

  it('vacating an infantry frees its slot for re-assignment', () => {
    // Fill CENTER (0) and NW (1)
    map.occupySubCell(10, 10, 42);
    map.occupySubCell(10, 10, 43);
    // Vacate CENTER
    map.vacateSubCell(10, 10, 42);
    // Next infantry should get CENTER (0) again — it is the first free in order
    const slot = map.occupySubCell(10, 10, 99);
    expect(slot).toBe(0);
  });

  it('vacating middle slot keeps other slots intact', () => {
    map.occupySubCell(10, 10, 1); // CENTER
    map.occupySubCell(10, 10, 2); // NW
    map.occupySubCell(10, 10, 3); // NE
    map.vacateSubCell(10, 10, 2); // remove NW
    expect(map.getSubCellCount(10, 10)).toBe(2);
    // Remaining: CENTER (1) and NE (3)
    // Next infantry gets NW (slot 1, now free)
    expect(map.occupySubCell(10, 10, 99)).toBe(1);
  });

  it('multiple cells maintain independent sub-cell state', () => {
    map.occupySubCell(10, 10, 1);
    map.occupySubCell(10, 10, 2);
    map.occupySubCell(11, 11, 3);

    expect(map.getSubCellCount(10, 10)).toBe(2);
    expect(map.getSubCellCount(11, 11)).toBe(1);
    expect(map.getSubCellCount(12, 12)).toBe(0);
  });

  it('vehicle placed after infantry blocks further infantry', () => {
    map.occupySubCell(10, 10, 42);
    map.setVehicleOccupancy(10, 10, 99);
    // Vehicle now blocks all sub-cells
    expect(map.occupySubCell(10, 10, 100)).toBe(-1);
    expect(map.hasAvailableSubCell(10, 10)).toBe(false);
  });
});

// =============================================================================
// 14. canEnterCell Integration — infantry vs vehicle comprehensive
// =============================================================================

describe('canEnterCell integration — infantry vs vehicle (findpath.cpp)', () => {

  it('empty cell: both infantry and vehicle can enter', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    expect(map.canEnterCell(10, 10, false, undefined, false)).toBe(MoveResult.OK);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });

  it('1 infantry: another infantry OK, vehicle OCCUPIED', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.occupySubCell(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
    expect(map.canEnterCell(10, 10, false, undefined, false)).toBe(MoveResult.OCCUPIED);
  });

  it('5 infantry: another infantry OCCUPIED, vehicle OCCUPIED', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    for (let i = 1; i <= 5; i++) map.occupySubCell(10, 10, i);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OCCUPIED);
    expect(map.canEnterCell(10, 10, false, undefined, false)).toBe(MoveResult.OCCUPIED);
  });

  it('vehicle: both infantry and vehicle OCCUPIED', () => {
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setVehicleOccupancy(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OCCUPIED);
    expect(map.canEnterCell(10, 10, false, undefined, false)).toBe(MoveResult.OCCUPIED);
  });

  it('terrain IMPASSABLE takes priority over occupancy for infantry', () => {
    map.setTerrain(10, 10, Terrain.ROCK);
    map.occupySubCell(10, 10, 42);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('ORE terrain passable for infantry with available sub-cells', () => {
    map.setTerrain(10, 10, Terrain.ORE);
    expect(map.canEnterCell(10, 10, false, undefined, true)).toBe(MoveResult.OK);
  });
});
