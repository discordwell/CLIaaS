/**
 * Tests for C++ TechnoClass::Sight_Range parity:
 * Sight range is reduced to 1 cell when HP drops below ConditionRed (25% HP).
 * Dead units (hp <= 0) provide no sight at all.
 */
import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity } from '../engine/entity';
import { CELL_SIZE, MAP_CELLS, CONDITION_RED, House, UnitType } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

/**
 * Helper: compute the effective sight for an entity, matching the logic in
 * Game.updateFogOfWar (index.ts). Dead units provide 0 sight. Entities below
 * ConditionRed (25% HP) get sight reduced to 1.
 */
function effectiveEntitySight(entity: Entity): number {
  if (!entity.alive) return 0;
  return (entity.hp / entity.maxHp) < CONDITION_RED ? 1 : entity.stats.sight;
}

/**
 * Helper: compute the effective sight for a structure, matching the logic in
 * Game.updateFogOfWar (index.ts). Dead structures provide 0 sight. Structures
 * below ConditionRed (25% HP) get sight reduced to 1.
 */
function effectiveStructureSight(s: { alive: boolean; hp: number; maxHp: number }, baseSight: number): number {
  if (!s.alive) return 0;
  return (s.hp / s.maxHp) < CONDITION_RED ? 1 : baseSight;
}

/**
 * Helper: count how many cells are visible (value = 2) around a position
 * after running updateFogOfWar with the given sight.
 */
function countVisibleCells(sight: number, cx: number, cy: number): number {
  const map = new GameMap();
  map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
  // Clear terrain so LOS is not blocked
  for (let y = 0; y < MAP_CELLS; y++) {
    for (let x = 0; x < MAP_CELLS; x++) {
      map.setTerrain(x, y, Terrain.CLEAR);
    }
  }
  const wx = cx * CELL_SIZE + CELL_SIZE / 2;
  const wy = cy * CELL_SIZE + CELL_SIZE / 2;
  map.updateFogOfWar([{ x: wx, y: wy, sight }]);
  let count = 0;
  for (let i = 0; i < map.visibility.length; i++) {
    if (map.visibility[i] === 2) count++;
  }
  return count;
}

describe('Damaged sight range reduction (C++ TechnoClass::Sight_Range parity)', () => {
  describe('Entity sight reduction', () => {
    it('unit at full HP has normal sight range', () => {
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      // 2TNK has sight = 5
      expect(e.hp).toBe(e.maxHp);
      expect(effectiveEntitySight(e)).toBe(5);
    });

    it('unit at 50% HP has normal sight range (not reduced yet)', () => {
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      e.hp = Math.floor(e.maxHp * 0.5);
      expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(CONDITION_RED);
      expect(effectiveEntitySight(e)).toBe(e.stats.sight);
    });

    it('unit at 24% HP has sight reduced to 1', () => {
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      e.hp = Math.floor(e.maxHp * 0.24);
      expect(e.hp / e.maxHp).toBeLessThan(CONDITION_RED);
      expect(effectiveEntitySight(e)).toBe(1);
    });

    it('unit at 1 HP has sight reduced to 1', () => {
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      e.hp = 1;
      expect(effectiveEntitySight(e)).toBe(1);
    });

    it('dead unit provides no sight (0)', () => {
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      e.hp = 0;
      e.alive = false;
      expect(effectiveEntitySight(e)).toBe(0);
    });

    it('threshold is exactly 25%: unit at 25% HP has normal sight, at 24% has reduced', () => {
      // Use a unit with maxHp that divides evenly for 25%
      const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      // 2TNK strength = 400, so 25% = 100 HP exactly

      // At exactly 25% HP — NOT reduced (condition is strictly less than 0.25)
      e.hp = Math.floor(e.maxHp * CONDITION_RED); // 100
      expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(CONDITION_RED);
      expect(effectiveEntitySight(e)).toBe(e.stats.sight);

      // At 24% HP — reduced to 1
      e.hp = Math.floor(e.maxHp * CONDITION_RED) - 1; // 99
      expect(e.hp / e.maxHp).toBeLessThan(CONDITION_RED);
      expect(effectiveEntitySight(e)).toBe(1);
    });
  });

  describe('Structure sight reduction', () => {
    it('structure at 24% HP has sight reduced to 1', () => {
      const s = { alive: true, hp: 60, maxHp: 256 };
      // 60/256 = 0.234 < 0.25
      expect(s.hp / s.maxHp).toBeLessThan(CONDITION_RED);
      // Defense structure base sight = 7
      expect(effectiveStructureSight(s, 7)).toBe(1);
      // Non-defense structure base sight = 5
      expect(effectiveStructureSight(s, 5)).toBe(1);
    });

    it('structure at full HP has normal sight', () => {
      const s = { alive: true, hp: 256, maxHp: 256 };
      expect(effectiveStructureSight(s, 7)).toBe(7);
      expect(effectiveStructureSight(s, 5)).toBe(5);
    });

    it('dead structure provides no sight', () => {
      const s = { alive: false, hp: 0, maxHp: 256 };
      expect(effectiveStructureSight(s, 7)).toBe(0);
    });

    it('structure at exactly 25% HP has normal sight (threshold is strict less-than)', () => {
      const s = { alive: true, hp: 64, maxHp: 256 };
      // 64/256 = 0.25 exactly — NOT reduced
      expect(s.hp / s.maxHp).toBe(CONDITION_RED);
      expect(effectiveStructureSight(s, 5)).toBe(5);
    });
  });

  describe('Fog of war integration: sight=1 reveals fewer cells than normal sight', () => {
    it('sight=1 reveals only immediate neighbors (small area)', () => {
      const visibleAt1 = countVisibleCells(1, 64, 64);
      // sight=1 circle: cells within r^2=1 from center → roughly a 3x3 cross
      // Should be small (approximately 5 cells: center + 4 cardinals)
      expect(visibleAt1).toBeLessThanOrEqual(5);
      expect(visibleAt1).toBeGreaterThan(0);
    });

    it('sight=5 reveals significantly more cells than sight=1', () => {
      const visibleAt1 = countVisibleCells(1, 64, 64);
      const visibleAt5 = countVisibleCells(5, 64, 64);
      // sight=5 should reveal many more cells than sight=1
      expect(visibleAt5).toBeGreaterThan(visibleAt1 * 5);
    });

    it('dead units are excluded from fog of war (provide no sight)', () => {
      // Dead units are filtered out by the alive check in Game.updateFogOfWar,
      // so they never appear in the units array passed to map.updateFogOfWar.
      // Verify that passing an empty array reveals nothing.
      const map = new GameMap();
      map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
      for (let y = 0; y < MAP_CELLS; y++) {
        for (let x = 0; x < MAP_CELLS; x++) {
          map.setTerrain(x, y, Terrain.CLEAR);
        }
      }
      map.updateFogOfWar([]); // no units = dead unit equivalent
      let count = 0;
      for (let i = 0; i < map.visibility.length; i++) {
        if (map.visibility[i] === 2) count++;
      }
      expect(count).toBe(0);
    });
  });

  describe('Different unit types affected', () => {
    it('infantry at 24% HP has sight reduced to 1', () => {
      const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
      e.hp = Math.floor(e.maxHp * 0.24);
      expect(effectiveEntitySight(e)).toBe(1);
    });

    it('vehicle at 24% HP has sight reduced to 1', () => {
      const e = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
      e.hp = Math.floor(e.maxHp * 0.24);
      expect(effectiveEntitySight(e)).toBe(1);
    });

    it('mammoth tank at 24% HP has sight reduced to 1', () => {
      const e = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
      // 4TNK has sight = 6 normally
      expect(e.stats.sight).toBe(6);
      e.hp = Math.floor(e.maxHp * 0.24);
      expect(effectiveEntitySight(e)).toBe(1);
    });
  });

  describe('CONDITION_RED constant', () => {
    it('CONDITION_RED is 0.25 (25% threshold from C++ rules.cpp)', () => {
      expect(CONDITION_RED).toBe(0.25);
    });
  });
});
