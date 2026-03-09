/**
 * Tests for True C++ Parity — features beyond raw data values.
 * Data parity (unit speeds, structure HPs, weapon stats, etc.) is now
 * verified programmatically by ini-parity.test.ts which reads the actual
 * C++ INI files. This file tests behavioral features: ParaBomb weapon,
 * MoveResult enum, LOS pathfinding fallback.
 */

import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';
import { GameMap, MoveResult } from '../engine/map';
import { findPathLOS } from '../engine/pathfinding';

// NOTE: Unit speeds and structure HPs are verified programmatically
// by ini-parity.test.ts (reads actual rules.ini + aftrmath.ini).
// No hardcoded speed/HP tests here — see ini-parity.test.ts.

// === ParaBomb weapon defined in WEAPON_STATS ===

describe('ParaBomb weapon stats match C++ RULES.INI', () => {
  it('ParaBomb exists in WEAPON_STATS', () => {
    expect(WEAPON_STATS.ParaBomb).toBeDefined();
  });

  it('ParaBomb damage = 300 (C++ RULES.INI)', () => {
    expect(WEAPON_STATS.ParaBomb.damage).toBe(300);
  });

  it('ParaBomb warhead = HE', () => {
    expect(WEAPON_STATS.ParaBomb.warhead).toBe('HE');
  });

  it('ParaBomb has isDropping and isParachuted flags', () => {
    expect(WEAPON_STATS.ParaBomb.isDropping).toBe(true);
    expect(WEAPON_STATS.ParaBomb.isParachuted).toBe(true);
  });
});

// === Phase 6: MoveResult enum and canEnterCell ===

describe('Phase 6: MoveResult passability nuance', () => {
  it('MoveResult enum has correct values', () => {
    expect(MoveResult.OK).toBe(0);
    expect(MoveResult.IMPASSABLE).toBe(-1);
    expect(MoveResult.OCCUPIED).toBe(1);
    expect(MoveResult.TEMP_BLOCKED).toBe(2);
  });

  it('canEnterCell returns IMPASSABLE for out-of-bounds', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    expect(map.canEnterCell(0, 0)).toBe(MoveResult.IMPASSABLE);
  });

  it('canEnterCell returns OK for passable empty cell', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    expect(map.canEnterCell(50, 50)).toBe(MoveResult.OK);
  });

  it('canEnterCell returns OCCUPIED for stationary unit', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    map.setOccupancy(50, 50, 42); // entity ID 42
    expect(map.canEnterCell(50, 50)).toBe(MoveResult.OCCUPIED);
  });

  it('canEnterCell returns TEMP_BLOCKED when isMoving callback says true', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    map.setOccupancy(50, 50, 42);
    const isMoving = (id: number) => id === 42;
    expect(map.canEnterCell(50, 50, false, isMoving)).toBe(MoveResult.TEMP_BLOCKED);
  });
});

// === Phase 7: findPathLOS exists as fallback ===

describe('Phase 7: LOS pathfinding fallback', () => {
  it('findPathLOS is exported and callable', () => {
    expect(typeof findPathLOS).toBe('function');
  });

  it('findPathLOS finds direct path on clear map', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    const path = findPathLOS(map, { cx: 45, cy: 45 }, { cx: 48, cy: 45 });
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ cx: 48, cy: 45 });
  });

  it('findPathLOS navigates around obstacles', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    // Block a column
    for (let y = 43; y <= 47; y++) {
      map.setTerrain(46, y, 2); // ROCK
    }
    const path = findPathLOS(map, { cx: 45, cy: 45 }, { cx: 48, cy: 45 });
    expect(path.length).toBeGreaterThan(0);
    // Path should reach destination (or get close — LOS is a heuristic)
    const last = path[path.length - 1];
    const dist = Math.abs(last.cx - 48) + Math.abs(last.cy - 45);
    expect(dist).toBeLessThanOrEqual(2);
    // All cells in path should be passable (not ROCK)
    for (const cell of path) {
      expect(map.isTerrainPassable(cell.cx, cell.cy)).toBe(true);
    }
  });
});
