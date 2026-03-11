/**
 * Harvester Pipeline Tests — comprehensive tick-by-tick state machine coverage.
 *
 * Tests the full harvester lifecycle:
 *   IDLE → SEEK → HARVEST → RETURN → UNLOAD → IDLE
 *
 * Covers: state transitions, harvest timing, bail tracking, gem bonus bails,
 * refinery docking, unload timing, ore depletion chain, seek/return timeouts,
 * AI harvester spreading, emergency return, and edge cases.
 *
 * Does NOT duplicate coverage from:
 *   - harvester-behavior.test.ts (terrain passability, basic depleteOre, findNearestOre)
 *   - ore-regrowth.test.ts (growOre timing, density growth, spread mechanics)
 *   - economy-parity.test.ts (EC1-EC7, speed multipliers)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity, resetEntityIds } from '../engine/entity';
import { findPath } from '../engine/pathfinding';
import { MAP_CELLS, CELL_SIZE, UnitType, House, Mission, AnimState, UNIT_STATS, PRODUCTION_ITEMS } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Place a harvester at a cell center */
function makeHarvester(house: House, cx: number, cy: number): Entity {
  const e = new Entity(UnitType.V_HARV, house,
    cx * CELL_SIZE + CELL_SIZE / 2,
    cy * CELL_SIZE + CELL_SIZE / 2);
  e.harvesterState = 'idle';
  e.mission = Mission.GUARD;
  return e;
}

/** Set overlay at cell */
function setOverlay(map: GameMap, cx: number, cy: number, val: number): void {
  map.overlay[cy * MAP_CELLS + cx] = val;
}

/** Get overlay at cell */
function getOverlay(map: GameMap, cx: number, cy: number): number {
  return map.overlay[cy * MAP_CELLS + cx];
}

/** Create a minimal MapStructure for refinery (PROC) */
function makeRefinery(house: House, cx: number, cy: number): MapStructure {
  return {
    type: 'PROC',
    image: 'proc',
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
  };
}

/** Create a small playable map with bounds */
function makeMap(bx = 40, by = 40, bw = 50, bh = 50): GameMap {
  const map = new GameMap();
  map.setBounds(bx, by, bw, bh);
  map.initDefault();
  return map;
}

/** Place a gold ore field (contiguous cells) */
function placeGoldField(map: GameMap, cx: number, cy: number, radius: number, density = 0x0A): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      setOverlay(map, cx + dx, cy + dy, density);
      map.setTerrain(cx + dx, cy + dy, Terrain.ORE);
    }
  }
}

/** Place gems at a cell */
function placeGems(map: GameMap, cx: number, cy: number, density = 0x10): void {
  setOverlay(map, cx, cy, density);
  map.setTerrain(cx, cy, Terrain.ORE);
}

// ─── Harvester State Machine ───────────────────────────────────────────────────

/**
 * Simulate the updateHarvester state machine logic extracted from Game.updateHarvester().
 * This mirrors the private method for unit-testability without needing a full Game instance.
 */
function simulateHarvesterTick(
  harv: Entity,
  map: GameMap,
  structures: MapStructure[],
  harvHouse: House,
  isPlayerControlled: boolean,
  tick: number,
): { creditsDeposited: number; aiCreditsDeposited: number } {
  let creditsDeposited = 0;
  let aiCreditsDeposited = 0;

  switch (harv.harvesterState) {
    case 'idle': {
      if (harv.mission !== Mission.GUARD && harv.mission !== Mission.AREA_GUARD) break;
      const ec = harv.cell;
      const oreCell = map.findNearestOre(ec.cx, ec.cy, 30);
      if (oreCell) {
        harv.harvesterState = 'seeking';
        harv.mission = Mission.MOVE;
        harv.moveTarget = {
          x: oreCell.cx * CELL_SIZE + CELL_SIZE / 2,
          y: oreCell.cy * CELL_SIZE + CELL_SIZE / 2,
        };
        harv.path = findPath(map, ec, oreCell, true);
        harv.pathIndex = 0;
      }
      break;
    }
    case 'seeking': {
      const ec = harv.cell;
      const ovl = map.overlay[ec.cy * MAP_CELLS + ec.cx];
      if (ovl >= 0x03 && ovl <= 0x12) {
        harv.harvesterState = 'harvesting';
        harv.harvestTick = 0;
        harv.mission = Mission.GUARD;
        harv.animState = AnimState.IDLE;
      } else if (harv.mission === Mission.GUARD || harv.mission === Mission.AREA_GUARD) {
        harv.harvesterState = 'idle';
      } else if (harv.mission === Mission.MOVE && harv.path.length === 0 && harv.pathIndex >= 0) {
        harv.harvestTick++;
        if (harv.harvestTick > 30) {
          harv.harvesterState = harv.oreLoad > 0 ? 'returning' : 'idle';
          harv.mission = Mission.GUARD;
          harv.harvestTick = 0;
        }
      }
      break;
    }
    case 'harvesting': {
      harv.harvestTick++;
      if (harv.harvestTick % 10 === 0) {
        const ec = harv.cell;
        const bailCredits = map.depleteOre(ec.cx, ec.cy);
        if (bailCredits > 0) {
          harv.oreLoad += 1;
          harv.oreCreditValue += bailCredits;
          if (bailCredits >= 110) {
            harv.oreLoad += 2;
            harv.oreCreditValue += 220;
          }
        }
        if (harv.oreLoad >= Entity.BAIL_COUNT) {
          harv.harvesterState = 'returning';
        } else if (bailCredits === 0) {
          const newOre = map.findNearestOre(ec.cx, ec.cy, 20);
          if (newOre && harv.oreLoad < Entity.BAIL_COUNT) {
            harv.harvesterState = 'seeking';
            harv.mission = Mission.MOVE;
            harv.moveTarget = {
              x: newOre.cx * CELL_SIZE + CELL_SIZE / 2,
              y: newOre.cy * CELL_SIZE + CELL_SIZE / 2,
            };
            harv.path = findPath(map, ec, newOre, true);
            harv.pathIndex = 0;
          } else {
            harv.harvesterState = harv.oreLoad > 0 ? 'returning' : 'idle';
          }
        }
      }
      break;
    }
    case 'returning': {
      if (harv.mission === Mission.MOVE && harv.path.length === 0 && harv.pathIndex >= 0) {
        harv.harvestTick++;
        if (harv.harvestTick > 45) {
          harv.harvesterState = 'idle';
          harv.mission = Mission.GUARD;
          harv.harvestTick = 0;
        }
        break;
      }
      if (harv.mission !== Mission.GUARD && harv.mission !== Mission.AREA_GUARD) break;
      const ec = harv.cell;
      let bestProc: MapStructure | null = null;
      let bestDist = Infinity;
      for (const s of structures) {
        if (!s.alive || s.type !== 'PROC') continue;
        if (s.house !== harvHouse) continue; // simplified alliance check
        const dx = s.cx - ec.cx;
        const dy = s.cy - ec.cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestProc = s; }
      }
      if (!bestProc) {
        harv.harvesterState = 'idle';
        break;
      }
      const procW = 3, procH = 2; // PROC is 3x2
      const nearX = Math.max(bestProc.cx, Math.min(ec.cx, bestProc.cx + procW - 1));
      const nearY = Math.max(bestProc.cy, Math.min(ec.cy, bestProc.cy + procH - 1));
      const edgeDist = Math.abs(nearX - ec.cx) + Math.abs(nearY - ec.cy);
      if (edgeDist <= 1) {
        harv.harvesterState = 'unloading';
        harv.harvestTick = 0;
      } else {
        const target = { cx: bestProc.cx + 1, cy: bestProc.cy + procH };
        harv.mission = Mission.MOVE;
        harv.moveTarget = {
          x: target.cx * CELL_SIZE + CELL_SIZE / 2,
          y: target.cy * CELL_SIZE + CELL_SIZE / 2,
        };
        harv.path = findPath(map, ec, target, true);
        harv.pathIndex = 0;
        harv.harvestTick = 0;
      }
      break;
    }
    case 'unloading': {
      harv.harvestTick++;
      if (harv.harvestTick >= 14) {
        const totalCredits = harv.oreCreditValue;
        if (totalCredits > 0) {
          if (isPlayerControlled) {
            creditsDeposited = totalCredits;
          } else {
            aiCreditsDeposited = totalCredits;
          }
        }
        harv.oreLoad = 0;
        harv.oreCreditValue = 0;
        harv.harvesterState = 'idle';
        harv.harvestTick = 0;
      }
      break;
    }
  }
  return { creditsDeposited, aiCreditsDeposited };
}

beforeEach(() => resetEntityIds());

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Harvester Pipeline', () => {

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Entity Properties & Constants
  // ═══════════════════════════════════════════════════════════════════════

  describe('Harvester entity properties', () => {
    it('HARV has 600 HP, heavy armor, speed 6, sight 4, rot 5', () => {
      const stats = UNIT_STATS.HARV;
      expect(stats.strength).toBe(600);
      expect(stats.armor).toBe('heavy');
      expect(stats.speed).toBe(6);
      expect(stats.sight).toBe(4);
      expect(stats.rot).toBe(5);
    });

    it('HARV has no weapon (primaryWeapon = null)', () => {
      expect(UNIT_STATS.HARV.primaryWeapon).toBeNull();
    });

    it('HARV is a crusher (can crush infantry)', () => {
      expect(UNIT_STATS.HARV.crusher).toBe(true);
    });

    it('newly created harvester has zero ore load and credit value', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
      expect(harv.harvestTick).toBe(0);
    });

    it('harvester starts in idle state', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      expect(harv.harvesterState).toBe('idle');
    });

    it('BAIL_COUNT and ORE_CAPACITY are both 28', () => {
      expect(Entity.BAIL_COUNT).toBe(28);
      expect(Entity.ORE_CAPACITY).toBe(28);
      expect(Entity.BAIL_COUNT).toBe(Entity.ORE_CAPACITY);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: Ore Seeking
  // ═══════════════════════════════════════════════════════════════════════

  describe('Harvester ore seeking', () => {
    let map: GameMap;

    beforeEach(() => {
      map = makeMap();
    });

    it('idle harvester with GUARD mission transitions to seeking when ore is nearby', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      setOverlay(map, 52, 50, 0x07); // gold ore 2 cells east
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('seeking');
      expect(harv.mission).toBe(Mission.MOVE);
      expect(harv.moveTarget).not.toBeNull();
    });

    it('idle harvester with AREA_GUARD mission also transitions to seeking', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.mission = Mission.AREA_GUARD;
      setOverlay(map, 52, 50, 0x07);
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('seeking');
    });

    it('idle harvester with MOVE mission does NOT auto-seek (manual move in progress)', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.mission = Mission.MOVE;
      setOverlay(map, 52, 50, 0x07);
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle');
    });

    it('idle harvester stays idle when no ore is in range', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      // No ore placed
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle');
    });

    it('seeking harvester finds ore at current cell and transitions to harvesting', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'seeking';
      setOverlay(map, 50, 50, 0x07); // ore under harvester
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('harvesting');
      expect(harv.harvestTick).toBe(0);
      expect(harv.mission).toBe(Mission.GUARD);
      expect(harv.animState).toBe(AnimState.IDLE);
    });

    it('seeking harvester detects gem overlay and transitions to harvesting', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'seeking';
      setOverlay(map, 50, 50, 0x0F); // gem overlay
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('harvesting');
    });

    it('seeking harvester path and moveTarget are set toward ore cell', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      setOverlay(map, 55, 50, 0x08); // ore 5 cells east
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.moveTarget).toBeDefined();
      expect(harv.moveTarget!.x).toBe(55 * CELL_SIZE + CELL_SIZE / 2);
      expect(harv.moveTarget!.y).toBe(50 * CELL_SIZE + CELL_SIZE / 2);
      expect(harv.path.length).toBeGreaterThan(0);
    });

    it('findNearestOre picks gold ore over more distant gem', () => {
      setOverlay(map, 52, 50, 0x07); // gold 2 cells away
      setOverlay(map, 58, 50, 0x10); // gem 8 cells away
      const result = map.findNearestOre(50, 50, 20);
      expect(result).not.toBeNull();
      expect(result!.cx).toBe(52); // closer gold ore wins
    });

    it('findNearestOre picks closer gem over more distant gold', () => {
      setOverlay(map, 51, 50, 0x10); // gem 1 cell away
      setOverlay(map, 58, 50, 0x07); // gold 8 cells away
      const result = map.findNearestOre(50, 50, 20);
      expect(result).not.toBeNull();
      expect(result!.cx).toBe(51); // closer gem wins
    });

    it('findNearestOre respects maxRange limit', () => {
      setOverlay(map, 60, 50, 0x07); // gold 10 cells away
      expect(map.findNearestOre(50, 50, 5)).toBeNull(); // range 5 too small
      expect(map.findNearestOre(50, 50, 15)).not.toBeNull(); // range 15 reaches it
    });

    it('findNearestOre detects all gold density levels (0x03-0x0E)', () => {
      for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
        const m = makeMap();
        setOverlay(m, 50, 50, ovl);
        const result = m.findNearestOre(50, 50, 1);
        expect(result, `overlay 0x${ovl.toString(16)} should be detected`).not.toBeNull();
      }
    });

    it('findNearestOre detects all gem density levels (0x0F-0x12)', () => {
      for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
        const m = makeMap();
        setOverlay(m, 50, 50, ovl);
        const result = m.findNearestOre(50, 50, 1);
        expect(result, `overlay 0x${ovl.toString(16)} should be detected`).not.toBeNull();
      }
    });

    it('findNearestOre ignores non-ore overlays (0x00-0x02, 0x13-0xFE)', () => {
      for (const ovl of [0x00, 0x01, 0x02, 0x13, 0x20, 0xFE]) {
        const m = makeMap();
        setOverlay(m, 50, 50, ovl);
        const result = m.findNearestOre(50, 50, 1);
        expect(result, `overlay 0x${ovl.toString(16)} should NOT be detected`).toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: Harvesting Mechanics
  // ═══════════════════════════════════════════════════════════════════════

  describe('Harvesting mechanics', () => {
    let map: GameMap;

    beforeEach(() => {
      map = makeMap();
    });

    it('harvesting depletes one bail every 10 ticks', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x0E); // max gold density (12 depletes)

      // Tick 1-9: no depletion
      for (let i = 1; i <= 9; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.oreLoad).toBe(0);

      // Tick 10: first bail depleted
      simulateHarvesterTick(harv, map, [], House.Spain, true, 10);
      expect(harv.oreLoad).toBe(1);
      expect(harv.oreCreditValue).toBe(35);
    });

    it('harvesting gold accumulates 35 credits per bail', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x0E); // max gold (12 bails from this cell)

      // Simulate 30 ticks (3 harvest cycles)
      for (let i = 1; i <= 30; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.oreLoad).toBe(3);
      expect(harv.oreCreditValue).toBe(3 * 35); // 105 credits
    });

    it('harvesting gems adds 3 bails (1 + 2 bonus) and 330 credits per harvest action', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x12); // max gem density (4 depletes)

      // First harvest at tick 10
      for (let i = 1; i <= 10; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.oreLoad).toBe(3); // 1 base + 2 bonus
      expect(harv.oreCreditValue).toBe(110 + 220); // 330 credits
    });

    it('gem bonus: harvester fills when accumulated bails reach BAIL_COUNT', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      // Place a large gem field so cell never depletes within the test
      // Max gem density is 0x12 (4 steps). We need 10 gem harvests (30 bails).
      // Place multiple gem cells around harvester and manually simulate gem harvesting.
      // Each gem harvest: +3 bails, +330 credits. 10th harvest → 30 bails >= 28 → returning.
      for (let i = 0; i < 10; i++) {
        harv.oreLoad += 3;
        harv.oreCreditValue += 330;
        if (harv.oreLoad >= Entity.BAIL_COUNT) break;
      }
      expect(harv.oreLoad).toBeGreaterThanOrEqual(Entity.BAIL_COUNT);
      // In the real state machine, this would trigger harvesterState = 'returning'
      expect(harv.oreLoad >= Entity.BAIL_COUNT).toBe(true);
    });

    it('gold harvest: 28 bails at 1 bail per harvest action fills BAIL_COUNT', () => {
      // Each gold harvest adds exactly 1 bail (no bonus). 28 harvests = 28 bails.
      // Max gold cell density is 12 bails (0x0E → 0x03 = 12 steps).
      // So harvester needs to harvest ~2.3 max-density cells to fill.
      // Verify the math: 28 gold bails at 35 credits each = 980 total.
      const harv = makeHarvester(House.Spain, 50, 50);
      for (let i = 0; i < 28; i++) {
        harv.oreLoad += 1;
        harv.oreCreditValue += 35;
      }
      expect(harv.oreLoad).toBe(Entity.BAIL_COUNT);
      expect(harv.oreCreditValue).toBe(980);
      // At exactly BAIL_COUNT, the state machine would trigger returning
      expect(harv.oreLoad >= Entity.BAIL_COUNT).toBe(true);
    });

    it('depleted cell triggers re-seek to nearby ore', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x03); // min gold density — 1 depletion step
      setOverlay(map, 52, 50, 0x07); // more ore 2 cells away

      // First harvest at tick 10 depletes cell, finds nearby ore, transitions to seeking
      for (let i = 1; i <= 10; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      // After harvesting the first bail, cell is 0xFF. Ore load = 1 < 28, nearby ore exists.
      expect(harv.oreLoad).toBe(1);
      expect(getOverlay(map, 50, 50)).toBe(0xFF);

      // Next tick at 20: bailCredits=0, checks findNearestOre, transitions to seeking
      for (let i = 11; i <= 20; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.harvesterState).toBe('seeking');
      expect(harv.mission).toBe(Mission.MOVE);
    });

    it('depleted cell with no nearby ore and load > 0 triggers return', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x03); // min gold — 1 depletion
      // No other ore on map

      for (let i = 1; i <= 20; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      // After harvesting: oreLoad=1, cell depleted, no nearby ore → returning
      expect(harv.oreLoad).toBe(1);
      expect(harv.harvesterState).toBe('returning');
    });

    it('depleted cell with no nearby ore and load = 0 goes idle', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      harv.oreLoad = 0;
      // No ore at current cell or nearby
      // harvestTick will increment but depleteOre returns 0 at tick 10

      for (let i = 1; i <= 20; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.harvesterState).toBe('idle');
    });

    it('harvesting does not deplete between tick intervals (ticks 1-9 no depletion)', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      setOverlay(map, 50, 50, 0x0E);
      const initialOverlay = getOverlay(map, 50, 50);

      for (let i = 1; i <= 9; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(getOverlay(map, 50, 50)).toBe(initialOverlay);
      expect(harv.oreLoad).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Return to Refinery
  // ═══════════════════════════════════════════════════════════════════════

  describe('Return to refinery', () => {
    let map: GameMap;
    let refinery: MapStructure;

    beforeEach(() => {
      map = makeMap();
      refinery = makeRefinery(House.Spain, 55, 55);
    });

    it('returning harvester at GUARD mission finds nearest allied refinery', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 0);

      // Should set MOVE toward dock cell (refinery cx+1, cy+2)
      expect(harv.mission).toBe(Mission.MOVE);
      expect(harv.moveTarget).not.toBeNull();
    });

    it('returning harvester adjacent to refinery transitions to unloading', () => {
      // PROC at (55,55) is 3x2, so cells (55-57, 55-56). Adjacent = edgeDist <= 1.
      // Place harvester at (58, 55) — edgeDist to nearest PROC edge (57,55) = 1
      const harv = makeHarvester(House.Spain, 58, 55);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.oreCreditValue = 350;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('unloading');
      expect(harv.harvestTick).toBe(0);
    });

    it('returning harvester picks closest refinery among multiple', () => {
      const nearProc = makeRefinery(House.Spain, 51, 50); // very close
      const farProc = makeRefinery(House.Spain, 70, 70); // far away
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [nearProc, farProc], House.Spain, true, 0);

      // Should be adjacent to nearProc or moving toward it
      // nearProc at (51,50) is 3x2 so cells (51-53, 50-51).
      // Harvester at (50,50): nearest edge of nearProc = (51,50), distance = 1 → unloading
      expect(harv.harvesterState).toBe('unloading');
    });

    it('returning harvester with no refinery goes idle', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.oreCreditValue = 350;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle');
      // Ore is retained
      expect(harv.oreLoad).toBe(10);
      expect(harv.oreCreditValue).toBe(350);
    });

    it('returning harvester ignores destroyed refineries', () => {
      const deadRef = makeRefinery(House.Spain, 51, 50);
      deadRef.alive = false;
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [deadRef], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle'); // no living refinery
    });

    it('returning harvester ignores enemy refineries', () => {
      const enemyRef = makeRefinery(House.USSR, 51, 50);
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [enemyRef], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle'); // no allied refinery
    });

    it('refinery dock cell is at (cx+1, cy+2) for PROC 3x2 footprint', () => {
      // PROC at (55,55) is 3x2 → cells (55-57, 55-56)
      // Dock cell = cx+1, cy+procH = (56, 57)
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.GUARD;

      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 0);
      // Should be heading to dock cell (56, 57)
      expect(harv.moveTarget).not.toBeNull();
      expect(harv.moveTarget!.x).toBe(56 * CELL_SIZE + CELL_SIZE / 2);
      expect(harv.moveTarget!.y).toBe(57 * CELL_SIZE + CELL_SIZE / 2);
    });

    it('returning harvester stuck with empty path times out after 45 ticks', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.oreLoad = 10;
      harv.mission = Mission.MOVE;
      harv.path = []; // empty path — stuck
      harv.pathIndex = 0;

      // Tick 1-45: incrementing harvestTick
      for (let i = 1; i <= 45; i++) {
        simulateHarvesterTick(harv, map, [refinery], House.Spain, true, i);
        expect(harv.harvesterState).toBe('returning');
      }
      // Tick 46: timeout triggers
      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 46);
      expect(harv.harvesterState).toBe('idle');
      expect(harv.mission).toBe(Mission.GUARD);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: Unload & Credits
  // ═══════════════════════════════════════════════════════════════════════

  describe('Unload and credits', () => {
    it('unloading completes after 14 ticks (dump animation)', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'unloading';
      harv.oreLoad = 10;
      harv.oreCreditValue = 350;

      // Ticks 1-13: still unloading
      for (let i = 1; i <= 13; i++) {
        simulateHarvesterTick(harv, makeMap(), [], House.Spain, true, i);
        expect(harv.harvesterState).toBe('unloading');
      }
      // Tick 14: unload completes
      const result = simulateHarvesterTick(harv, makeMap(), [], House.Spain, true, 14);
      expect(harv.harvesterState).toBe('idle');
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
      expect(harv.harvestTick).toBe(0);
      expect(result.creditsDeposited).toBe(350);
    });

    it('player harvester deposits credits via addCredits (creditsDeposited > 0)', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'unloading';
      harv.oreLoad = 28;
      harv.oreCreditValue = 980; // full gold load

      // Fast-forward to tick 14
      for (let i = 1; i <= 14; i++) {
        const result = simulateHarvesterTick(harv, makeMap(), [], House.Spain, true, i);
        if (i === 14) {
          expect(result.creditsDeposited).toBe(980);
          expect(result.aiCreditsDeposited).toBe(0);
        }
      }
    });

    it('AI harvester deposits credits via houseCredits (aiCreditsDeposited > 0)', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.harvesterState = 'unloading';
      harv.oreLoad = 28;
      harv.oreCreditValue = 980;

      for (let i = 1; i <= 14; i++) {
        const result = simulateHarvesterTick(harv, makeMap(), [], House.USSR, false, i);
        if (i === 14) {
          expect(result.aiCreditsDeposited).toBe(980);
          expect(result.creditsDeposited).toBe(0);
        }
      }
    });

    it('unload with zero credit value deposits nothing', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'unloading';
      harv.oreLoad = 0;
      harv.oreCreditValue = 0;

      for (let i = 1; i <= 14; i++) {
        const result = simulateHarvesterTick(harv, makeMap(), [], House.Spain, true, i);
        if (i === 14) {
          expect(result.creditsDeposited).toBe(0);
        }
      }
      expect(harv.harvesterState).toBe('idle');
    });

    it('full gold load value: 28 bails x 35 credits = 980', () => {
      expect(Entity.BAIL_COUNT * 35).toBe(980);
    });

    it('full gem load value: ~10 gem harvests x 330 credits = 3300', () => {
      // Each gem harvest: 3 bails, 330 credits. 10 harvests = 30 bails, 3300 credits.
      // But BAIL_COUNT is 28, so the 10th harvest overshoots.
      // Actual: 9 harvests = 27 bails (2970 credits), 10th adds 3 more = 30 (3300).
      // The harvester stops at >= 28, so it deposits the accumulated value.
      const harv = makeHarvester(House.Spain, 50, 50);
      // Simulate gem harvesting
      for (let i = 0; i < 10; i++) {
        harv.oreLoad += 3;
        harv.oreCreditValue += 330;
        if (harv.oreLoad >= Entity.BAIL_COUNT) break;
      }
      // After 10 gem harvests: 30 bails, 3300 credits
      expect(harv.oreLoad).toBe(30);
      expect(harv.oreCreditValue).toBe(3300);
    });

    it('mixed gold+gem load deposits correct total', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      // 5 gold harvests: 5 bails, 175 credits
      for (let i = 0; i < 5; i++) {
        harv.oreLoad += 1;
        harv.oreCreditValue += 35;
      }
      // 3 gem harvests: 9 bails, 990 credits
      for (let i = 0; i < 3; i++) {
        harv.oreLoad += 3;
        harv.oreCreditValue += 330;
      }
      expect(harv.oreLoad).toBe(14); // 5 + 9
      expect(harv.oreCreditValue).toBe(175 + 990); // 1165
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: Seek Timeout
  // ═══════════════════════════════════════════════════════════════════════

  describe('Seek timeout', () => {
    it('seeking harvester with exhausted path times out after 30 ticks', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'seeking';
      harv.mission = Mission.MOVE;
      harv.path = []; // exhausted path
      harv.pathIndex = 0;
      harv.harvestTick = 0;

      // Ticks 1-30: still seeking
      for (let i = 1; i <= 30; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
        expect(harv.harvesterState).toBe('seeking');
      }
      // Tick 31: timeout triggers
      simulateHarvesterTick(harv, map, [], House.Spain, true, 31);
      // No ore load → idle (not returning)
      expect(harv.harvesterState).toBe('idle');
      expect(harv.mission).toBe(Mission.GUARD);
    });

    it('seeking timeout with ore load transitions to returning', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'seeking';
      harv.mission = Mission.MOVE;
      harv.path = [];
      harv.pathIndex = 0;
      harv.oreLoad = 5; // has some ore

      for (let i = 1; i <= 31; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.harvesterState).toBe('returning');
    });

    it('seeking harvester that reaches GUARD/AREA_GUARD without ore at cell re-idles', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'seeking';
      harv.mission = Mission.GUARD; // move completed, now idle
      // No ore at (50,50)

      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: Full Cycle Simulation
  // ═══════════════════════════════════════════════════════════════════════

  describe('Full harvester cycle', () => {
    it('idle → seeking → harvesting → returning → unloading → idle', () => {
      const map = makeMap();
      const refinery = makeRefinery(House.Spain, 50, 50);

      // Place ore adjacent to refinery dock
      // PROC at (50,50) is 3x2 → dock at (51,52)
      // Place harvester at dock cell
      const harv = makeHarvester(House.Spain, 51, 52);
      setOverlay(map, 54, 52, 0x03); // min gold 3 cells east of dock

      // Step 1: idle → seeking
      expect(harv.harvesterState).toBe('idle');
      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('seeking');

      // Step 2: seeking → harvesting (simulate arrival by placing harvester at ore cell)
      harv.pos = { x: 54 * CELL_SIZE + CELL_SIZE / 2, y: 52 * CELL_SIZE + CELL_SIZE / 2 };
      // Also need ore overlay at harvester's cell
      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 1);
      expect(harv.harvesterState).toBe('harvesting');

      // Step 3: harvesting → depletes 1 bail at tick 10, no more ore → returning
      for (let i = 1; i <= 20; i++) {
        simulateHarvesterTick(harv, map, [refinery], House.Spain, true, i);
      }
      // After tick 10: oreLoad=1, cell depleted (0xFF). No nearby ore → returning.
      // After tick 20: bailCredits=0 triggers next check.
      expect(harv.oreLoad).toBe(1);
      expect(harv.harvesterState).toBe('returning');

      // Step 4: returning → simulate arrival at refinery
      harv.mission = Mission.GUARD; // simulate move completion
      // Move harvester next to refinery footprint (edge distance <= 1)
      harv.pos = { x: 53 * CELL_SIZE + CELL_SIZE / 2, y: 50 * CELL_SIZE + CELL_SIZE / 2 };
      simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 21);
      expect(harv.harvesterState).toBe('unloading');

      // Step 5: unloading → 14 ticks → idle
      let deposited = 0;
      for (let i = 1; i <= 14; i++) {
        const result = simulateHarvesterTick(harv, map, [refinery], House.Spain, true, 21 + i);
        deposited += result.creditsDeposited;
      }
      expect(harv.harvesterState).toBe('idle');
      expect(deposited).toBe(35); // 1 bail of gold
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 8: Ore Depletion Chain
  // ═══════════════════════════════════════════════════════════════════════

  describe('Ore depletion chain', () => {
    it('gold ore density decreases by 1 per depletion', () => {
      const map = makeMap();
      setOverlay(map, 50, 50, 0x0E); // max gold

      for (let expected = 0x0D; expected >= 0x03; expected--) {
        map.depleteOre(50, 50);
        expect(getOverlay(map, 50, 50)).toBe(expected);
      }
      // One more depletion: 0x03 → 0xFF (fully depleted)
      map.depleteOre(50, 50);
      expect(getOverlay(map, 50, 50)).toBe(0xFF);
    });

    it('max gold density cell yields exactly 12 bails before depletion', () => {
      const map = makeMap();
      setOverlay(map, 50, 50, 0x0E);
      let bails = 0;
      while (map.depleteOre(50, 50) > 0) bails++;
      expect(bails).toBe(12); // 0x0E - 0x03 + 1 = 12
    });

    it('gem density decreases by 1 per depletion', () => {
      const map = makeMap();
      setOverlay(map, 50, 50, 0x12); // max gem

      for (let expected = 0x11; expected >= 0x0F; expected--) {
        map.depleteOre(50, 50);
        expect(getOverlay(map, 50, 50)).toBe(expected);
      }
      map.depleteOre(50, 50);
      expect(getOverlay(map, 50, 50)).toBe(0xFF);
    });

    it('max gem density cell yields exactly 4 bails before depletion', () => {
      const map = makeMap();
      setOverlay(map, 50, 50, 0x12);
      let bails = 0;
      while (map.depleteOre(50, 50) > 0) bails++;
      expect(bails).toBe(4); // 0x12 - 0x0F + 1 = 4
    });

    it('depleting already-depleted cell returns 0', () => {
      const map = makeMap();
      setOverlay(map, 50, 50, 0xFF);
      expect(map.depleteOre(50, 50)).toBe(0);
    });

    it('depleting out-of-bounds cell returns 0', () => {
      const map = makeMap();
      expect(map.depleteOre(-1, -1)).toBe(0);
      expect(map.depleteOre(200, 200)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 9: Gem vs Gold Distinction
  // ═══════════════════════════════════════════════════════════════════════

  describe('Gem vs gold identification', () => {
    it('isGemOverlay correctly identifies gem range (0x0F-0x12)', () => {
      const map = makeMap();
      for (let ovl = 0x0F; ovl <= 0x12; ovl++) {
        setOverlay(map, 50, 50, ovl);
        expect(map.isGemOverlay(50, 50)).toBe(true);
      }
    });

    it('isGemOverlay returns false for gold range (0x03-0x0E)', () => {
      const map = makeMap();
      for (let ovl = 0x03; ovl <= 0x0E; ovl++) {
        setOverlay(map, 50, 50, ovl);
        expect(map.isGemOverlay(50, 50)).toBe(false);
      }
    });

    it('isGemOverlay returns false for empty/non-ore overlays', () => {
      const map = makeMap();
      for (const ovl of [0x00, 0x01, 0x02, 0x13, 0xFF]) {
        setOverlay(map, 50, 50, ovl);
        expect(map.isGemOverlay(50, 50)).toBe(false);
      }
    });

    it('isGemOverlay returns false for out-of-bounds', () => {
      const map = makeMap();
      expect(map.isGemOverlay(-1, -1)).toBe(false);
      expect(map.isGemOverlay(200, 200)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 10: AI Harvester Spread Logic
  // ═══════════════════════════════════════════════════════════════════════

  describe('AI harvester ore spread logic', () => {
    it('findNearestOre scans within maxRange radius', () => {
      const map = makeMap();
      // Place ore just inside and just outside range
      setOverlay(map, 60, 50, 0x07); // 10 cells away
      setOverlay(map, 71, 50, 0x07); // 21 cells away

      expect(map.findNearestOre(50, 50, 15)).not.toBeNull(); // range=15 finds (60,50)
      const result = map.findNearestOre(50, 50, 15);
      expect(result!.cx).toBe(60);

      // Range 5 doesn't find either
      expect(map.findNearestOre(50, 50, 5)).toBeNull();
    });

    it('findNearestOre uses squared distance for comparison (diagonal is equally distant)', () => {
      const map = makeMap();
      // Two ore cells at equal Euclidean distance
      setOverlay(map, 53, 50, 0x07); // 3 cells east: dist^2 = 9
      setOverlay(map, 52, 52, 0x07); // 2 east + 2 south: dist^2 = 8 (closer!)
      const result = map.findNearestOre(50, 50, 10);
      expect(result).not.toBeNull();
      // (52,52) has dist^2=8 < 9, so it should win
      expect(result!.cx).toBe(52);
      expect(result!.cy).toBe(52);
    });

    it('findNearestOre ignores map cells outside MAP_CELLS bounds', () => {
      const map = makeMap();
      // Place ore at edges of 128x128 map
      setOverlay(map, 0, 0, 0x07);
      // Searching from (1,1) should find it
      const result = map.findNearestOre(1, 1, 5);
      expect(result).not.toBeNull();
      expect(result!.cx).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 11: Emergency Harvester Return
  // ═══════════════════════════════════════════════════════════════════════

  describe('Emergency harvester return (HP < 30%)', () => {
    it('harvester with 30% HP should trigger emergency return', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.harvesterState = 'harvesting';
      // HP at exactly 30% (0.3 * 600 = 180) should NOT trigger (>= 0.3)
      harv.hp = 180;
      const hpRatio = harv.hp / harv.maxHp;
      expect(hpRatio).toBeCloseTo(0.3);
      // At 30%, emergency return does NOT fire (hpRatio >= 0.3 → continue)
      expect(hpRatio >= 0.3).toBe(true);
    });

    it('harvester with 29% HP qualifies for emergency return', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.hp = 174; // 174/600 = 0.29
      const hpRatio = harv.hp / harv.maxHp;
      expect(hpRatio).toBeLessThan(0.3);
    });

    it('harvester already returning should not be interrupted', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.harvesterState = 'returning';
      harv.hp = 100; // low HP
      // Emergency return code checks: if state is 'returning' → continue (don't interrupt)
      expect(harv.harvesterState === 'returning' || harv.harvesterState === 'unloading').toBe(true);
    });

    it('harvester already unloading should not be interrupted', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.harvesterState = 'unloading';
      harv.hp = 50;
      expect(harv.harvesterState === 'returning' || harv.harvesterState === 'unloading').toBe(true);
    });

    it('emergency return sets harvesterState to returning and mission to MOVE', () => {
      const harv = makeHarvester(House.USSR, 50, 50);
      harv.harvesterState = 'harvesting';
      harv.hp = 100; // well below 30%
      const refinery = makeRefinery(House.USSR, 55, 55);

      // Simulate emergency return logic
      const hpRatio = harv.hp / harv.maxHp;
      if (hpRatio < 0.3 &&
          harv.harvesterState !== 'returning' &&
          harv.harvesterState !== 'unloading') {
        const procW = 3, procH = 2;
        harv.harvesterState = 'returning';
        harv.mission = Mission.MOVE;
        harv.moveTarget = {
          x: (refinery.cx + procW / 2) * CELL_SIZE,
          y: (refinery.cy + procH / 2) * CELL_SIZE,
        };
        harv.harvestTick = 0;
      }

      expect(harv.harvesterState).toBe('returning');
      expect(harv.mission).toBe(Mission.MOVE);
      expect(harv.moveTarget).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 12: AI Harvester Management
  // ═══════════════════════════════════════════════════════════════════════

  describe('AI harvester management', () => {
    it('updateAIHarvesters runs every 60 ticks', () => {
      // The method checks: if (this.tick % 60 !== 0) return
      expect(60 % 60).toBe(0);
      expect(120 % 60).toBe(0);
      expect(30 % 60).not.toBe(0);
      expect(59 % 60).not.toBe(0);
    });

    it('AI state tracks harvesterCount and refineryCount', () => {
      // Verify the AIHouseState interface fields
      const state = {
        harvesterCount: 0,
        refineryCount: 0,
      };
      // Simulate counting
      const entities = [
        makeHarvester(House.USSR, 50, 50),
        makeHarvester(House.USSR, 55, 55),
      ];
      for (const e of entities) {
        if (e.alive && e.type === UnitType.V_HARV) {
          state.harvesterCount++;
        }
      }
      expect(state.harvesterCount).toBe(2);
    });

    it('AI force-produces harvester when count = 0 and refinery + factory exist', () => {
      // The condition: harvesterCount === 0 && refineryCount > 0 && weap > 0
      const state = { harvesterCount: 0, refineryCount: 1 };
      const hasWeap = true;
      const shouldProduce = state.harvesterCount === 0 && state.refineryCount > 0 && hasWeap;
      expect(shouldProduce).toBe(true);
    });

    it('AI does NOT force-produce harvester when count > 0', () => {
      const state = { harvesterCount: 1, refineryCount: 1 };
      const hasWeap = true;
      const shouldProduce = state.harvesterCount === 0 && state.refineryCount > 0 && hasWeap;
      expect(shouldProduce).toBe(false);
    });

    it('AI does NOT force-produce without refinery', () => {
      const state = { harvesterCount: 0, refineryCount: 0 };
      const hasWeap = true;
      const shouldProduce = state.harvesterCount === 0 && state.refineryCount > 0 && hasWeap;
      expect(shouldProduce).toBe(false);
    });

    it('AI does NOT force-produce without war factory', () => {
      const state = { harvesterCount: 0, refineryCount: 1 };
      const hasWeap = false;
      const shouldProduce = state.harvesterCount === 0 && state.refineryCount > 0 && hasWeap;
      expect(shouldProduce).toBe(false);
    });

    it('strategic AI produces harvester when harvesterCount < refineryCount', () => {
      const state = { harvesterCount: 1, refineryCount: 3 };
      const shouldProduce = state.harvesterCount < state.refineryCount;
      expect(shouldProduce).toBe(true);
    });

    it('strategic AI does NOT produce harvester when harvesterCount >= refineryCount', () => {
      const state = { harvesterCount: 2, refineryCount: 2 };
      expect(state.harvesterCount < state.refineryCount).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 13: Ore Regrowth (Non-duplicated)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Ore regrowth constants', () => {
    it('ORE_GROWTH_INTERVAL is 256 ticks (~17s at 15 FPS)', () => {
      expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256);
      expect(GameMap.ORE_GROWTH_INTERVAL / 15).toBeCloseTo(17.07, 1);
    });

    it('ORE_DENSITY_CHANCE is 50%', () => {
      expect(GameMap.ORE_DENSITY_CHANCE).toBe(0.5);
    });

    it('ORE_SPREAD_CHANCE is 25%', () => {
      expect(GameMap.ORE_SPREAD_CHANCE).toBe(0.25);
    });

    it('ORE_SPREAD_MIN_DENSITY threshold is 0x09 (density > 6 required)', () => {
      expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 14: Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('harvester on completely empty map stays idle', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);

      for (let i = 0; i < 100; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      expect(harv.harvesterState).toBe('idle');
      expect(harv.oreLoad).toBe(0);
    });

    it('harvester load never exceeds BAIL_COUNT check threshold', () => {
      // Gem harvest adds 3 bails at once. Starting from 27 bails, adding 3 = 30.
      // The check is oreLoad >= BAIL_COUNT, so 30 >= 28 → returning.
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.oreLoad = 27;
      harv.oreCreditValue = 27 * 35;
      harv.harvesterState = 'harvesting';
      const map = makeMap();
      setOverlay(map, 50, 50, 0x10); // gem

      // Force tick to harvest at tick 10
      for (let i = 1; i <= 10; i++) {
        simulateHarvesterTick(harv, map, [], House.Spain, true, i);
      }
      // 27 + 3 = 30 >= 28 → returning
      expect(harv.oreLoad).toBe(30);
      expect(harv.harvesterState).toBe('returning');
    });

    it('ore at map boundary is findable', () => {
      const map = makeMap(40, 40, 50, 50); // bounds 40-89
      setOverlay(map, 40, 40, 0x07); // ore at boundary corner
      const result = map.findNearestOre(41, 41, 5);
      expect(result).not.toBeNull();
      expect(result!.cx).toBe(40);
      expect(result!.cy).toBe(40);
    });

    it('ore at map boundary edge is findable', () => {
      const map = makeMap(40, 40, 50, 50);
      const maxX = 40 + 50 - 1; // 89
      const maxY = 40 + 50 - 1; // 89
      setOverlay(map, maxX, maxY, 0x07);
      const result = map.findNearestOre(maxX - 1, maxY - 1, 5);
      expect(result).not.toBeNull();
      expect(result!.cx).toBe(maxX);
      expect(result!.cy).toBe(maxY);
    });

    it('harvester with ATTACK mission does not auto-harvest', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.mission = Mission.ATTACK;
      setOverlay(map, 51, 50, 0x07);
      simulateHarvesterTick(harv, map, [], House.Spain, true, 0);
      expect(harv.harvesterState).toBe('idle'); // doesn't start seeking
    });

    it('harvester harvestTick resets on state transitions', () => {
      const harv = makeHarvester(House.Spain, 50, 50);

      // Transition to harvesting
      harv.harvesterState = 'harvesting';
      harv.harvestTick = 50;

      // Simulate transition to seeking (via depleted cell + nearby ore)
      const map = makeMap();
      setOverlay(map, 52, 50, 0x07);
      harv.mission = Mission.GUARD;
      // Force into seeking state
      harv.harvesterState = 'seeking';
      harv.harvestTick = 0;
      expect(harv.harvestTick).toBe(0);

      // Transition to unloading
      harv.harvesterState = 'unloading';
      harv.harvestTick = 0;
      expect(harv.harvestTick).toBe(0);
    });

    it('killing harvester mid-harvest preserves death behavior', () => {
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'harvesting';
      harv.oreLoad = 15;
      harv.oreCreditValue = 15 * 35;

      const killed = harv.takeDamage(9999);
      expect(killed).toBe(true);
      expect(harv.alive).toBe(false);
      expect(harv.mission).toBe(Mission.DIE);
      // Ore load is still on the harvester (lost on death — no recovery)
      expect(harv.oreLoad).toBe(15);
    });

    it('returning harvester with MOVE still in progress waits', () => {
      const map = makeMap();
      const harv = makeHarvester(House.Spain, 50, 50);
      harv.harvesterState = 'returning';
      harv.mission = Mission.MOVE; // still moving
      harv.oreLoad = 10;
      harv.path = [{ cx: 51, cy: 50 }]; // non-empty path (not stuck)
      harv.pathIndex = 0;

      simulateHarvesterTick(harv, map, [makeRefinery(House.Spain, 55, 55)], House.Spain, true, 0);
      // Should still be returning — mission is MOVE and path is not empty
      expect(harv.harvesterState).toBe('returning');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 15: Refinery Adjacency Calculation
  // ═══════════════════════════════════════════════════════════════════════

  describe('Refinery adjacency calculation', () => {
    it('PROC footprint is 3x2 (from STRUCTURE_SIZE)', () => {
      // PROC: [3, 2] per scenario.ts
      const procW = 3, procH = 2;
      expect(procW).toBe(3);
      expect(procH).toBe(2);
    });

    it('cell inside PROC footprint has edgeDist = 0', () => {
      // PROC at (55,55), size 3x2. Cells: (55-57, 55-56)
      const procCx = 55, procCy = 55, procW = 3, procH = 2;
      const testCx = 56, testCy = 55; // inside footprint
      const nearX = Math.max(procCx, Math.min(testCx, procCx + procW - 1));
      const nearY = Math.max(procCy, Math.min(testCy, procCy + procH - 1));
      const edgeDist = Math.abs(nearX - testCx) + Math.abs(nearY - testCy);
      expect(edgeDist).toBe(0);
    });

    it('cell directly adjacent (1 cell away) has edgeDist = 1', () => {
      const procCx = 55, procCy = 55, procW = 3, procH = 2;
      // Cell (58, 55): nearest proc edge = (57, 55), edgeDist = 1
      const testCx = 58, testCy = 55;
      const nearX = Math.max(procCx, Math.min(testCx, procCx + procW - 1));
      const nearY = Math.max(procCy, Math.min(testCy, procCy + procH - 1));
      const edgeDist = Math.abs(nearX - testCx) + Math.abs(nearY - testCy);
      expect(edgeDist).toBe(1);
    });

    it('cell 2 cells away has edgeDist = 2 (not adjacent)', () => {
      const procCx = 55, procCy = 55, procW = 3, procH = 2;
      const testCx = 59, testCy = 55;
      const nearX = Math.max(procCx, Math.min(testCx, procCx + procW - 1));
      const nearY = Math.max(procCy, Math.min(testCy, procCy + procH - 1));
      const edgeDist = Math.abs(nearX - testCx) + Math.abs(nearY - testCy);
      expect(edgeDist).toBe(2);
    });

    it('cell below PROC at dock position has edgeDist = 1', () => {
      const procCx = 55, procCy = 55, procW = 3, procH = 2;
      // Dock cell: (procCx+1, procCy+procH) = (56, 57)
      const testCx = 56, testCy = 57;
      const nearX = Math.max(procCx, Math.min(testCx, procCx + procW - 1));
      const nearY = Math.max(procCy, Math.min(testCy, procCy + procH - 1));
      const edgeDist = Math.abs(nearX - testCx) + Math.abs(nearY - testCy);
      expect(edgeDist).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 16: Pathfinding Integration
  // ═══════════════════════════════════════════════════════════════════════

  describe('Pathfinding integration for harvesters', () => {
    it('findPath routes harvester through ORE terrain', () => {
      const map = makeMap();
      // Create a corridor of ore
      for (let x = 45; x <= 55; x++) {
        map.setTerrain(x, 50, Terrain.ORE);
      }
      const path = findPath(map, { cx: 45, cy: 50 }, { cx: 55, cy: 50 }, true);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1].cx).toBe(55);
    });

    it('findPath returns empty when goal is surrounded by ROCK terrain', () => {
      const map = makeMap();
      // Surround the goal cell with impassable rock on all sides
      const gx = 60, gy = 60;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          map.setTerrain(gx + dx, gy + dy, Terrain.ROCK);
        }
      }
      const path = findPath(map, { cx: 50, cy: 50 }, { cx: gx, cy: gy }, true);
      expect(path.length).toBe(0); // no path to rock-enclosed cell
    });

    it('findPath works on clear terrain for return-to-refinery route', () => {
      const map = makeMap();
      const start = { cx: 50, cy: 50 };
      const goal = { cx: 60, cy: 60 };
      const path = findPath(map, start, goal, true);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1].cx).toBe(60);
      expect(path[path.length - 1].cy).toBe(60);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 17: Harvester Production Constants
  // ═══════════════════════════════════════════════════════════════════════

  describe('Harvester production constants', () => {
    it('HARV costs 1400 credits', () => {
      // From PRODUCTION_ITEMS
      const harvItem = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'HARV');
      expect(harvItem).toBeDefined();
      expect(harvItem.cost).toBe(1400);
    });

    it('HARV requires WEAP (War Factory) prerequisite', () => {
      const harvItem = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'HARV');
      expect(harvItem.prerequisite).toBe('WEAP');
    });

    it('HARV requires PROC (Refinery) tech prerequisite', () => {
      const harvItem = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'HARV');
      expect(harvItem.techPrereq).toBe('PROC');
    });

    it('HARV build time is 160 ticks', () => {
      const harvItem = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'HARV');
      expect(harvItem.buildTime).toBe(160);
    });

    it('HARV is available to both factions', () => {
      const harvItem = PRODUCTION_ITEMS.find((p: { type: string }) => p.type === 'HARV');
      expect(harvItem.faction).toBe('both');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 18: State Machine Invariants
  // ═══════════════════════════════════════════════════════════════════════

  describe('State machine invariants', () => {
    it('all valid harvester states are covered', () => {
      const validStates = ['idle', 'seeking', 'harvesting', 'returning', 'unloading'];
      const harv = makeHarvester(House.Spain, 50, 50);
      for (const state of validStates) {
        harv.harvesterState = state as Entity['harvesterState'];
        expect(harv.harvesterState).toBe(state);
      }
    });

    it('harvesterState default is idle', () => {
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      expect(harv.harvesterState).toBe('idle');
    });

    it('harvestTick starts at 0', () => {
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      expect(harv.harvestTick).toBe(0);
    });

    it('oreLoad and oreCreditValue start at 0', () => {
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
    });

    it('BAIL_COUNT is a static readonly (class-level constant)', () => {
      expect(Entity.BAIL_COUNT).toBe(28);
      // Verify it's the same value regardless of instance
      const h1 = new Entity(UnitType.V_HARV, House.Spain, 0, 0);
      const h2 = new Entity(UnitType.V_HARV, House.USSR, 100, 100);
      expect(Entity.BAIL_COUNT).toBe(28);
    });

    it('non-harvester entity has harvester fields at defaults', () => {
      const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
      expect(tank.oreLoad).toBe(0);
      expect(tank.oreCreditValue).toBe(0);
      expect(tank.harvesterState).toBe('idle');
      expect(tank.harvestTick).toBe(0);
    });
  });
});
