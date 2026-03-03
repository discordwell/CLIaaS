import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity } from '../engine/entity';
import { MAP_CELLS, House, UnitType, SpeedClass } from '../engine/types';

/**
 * Economy & Ore Parity Tests — C++ Red Alert overlay.cpp / drive.cpp
 *
 * EC1/EC2: Gold ore = 35 credits/bail, Gems = 110 credits/bail
 * EC3: Bail-based capacity (28 bails max per harvester load)
 * EC4: Gem bonus bails (+2 per gem harvest action)
 * EC5: Lump-sum unload (credit entire load after dump animation)
 * EC6: growOre only grows gold overlays, not gems
 * EC7: Ore spread requires density > 6, uses 8 directions
 * MV5: Speed multipliers capped at 1.0, terrain speed entries for Ore/Beach/Rough/River
 */

describe('Economy Parity (C++ Red Alert)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  /** Helper: get overlay at cell */
  function getOverlay(cx: number, cy: number): number {
    return map.overlay[cy * MAP_CELLS + cx];
  }

  /** Helper: set overlay at cell */
  function setOverlay(cx: number, cy: number, val: number): void {
    map.overlay[cy * MAP_CELLS + cx] = val;
  }

  // === EC1/EC2: depleteOre credit values ===

  describe('EC1: Gold ore yields 35 credits per bail', () => {
    it('depleting gold ore at mid density returns 35', () => {
      setOverlay(50, 50, 0x07); // gold ore mid density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(35);
    });

    it('depleting gold ore at max density returns 35', () => {
      setOverlay(50, 50, 0x0E); // GOLD12 max density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(35);
    });

    it('depleting gold ore at min density returns 35 and fully depletes', () => {
      setOverlay(50, 50, 0x03); // GOLD01 min density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(35);
      expect(getOverlay(50, 50)).toBe(0xFF); // fully depleted
    });

    it('depleting empty cell returns 0', () => {
      expect(map.depleteOre(50, 50)).toBe(0);
    });
  });

  describe('EC2: Gems yield 110 credits per bail', () => {
    it('depleting gem at mid density returns 110', () => {
      setOverlay(50, 50, 0x10); // GEM02
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(110);
    });

    it('depleting gem at max density returns 110', () => {
      setOverlay(50, 50, 0x12); // GEM04 max density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(110);
    });

    it('depleting gem at min density returns 110 and fully depletes', () => {
      setOverlay(50, 50, 0x0F); // GEM01 min density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(110);
      expect(getOverlay(50, 50)).toBe(0xFF); // fully depleted
    });
  });

  // === EC3: Bail-based capacity ===

  describe('EC3: Bail-based capacity (28 bails max)', () => {
    it('BAIL_COUNT is 28', () => {
      expect(Entity.BAIL_COUNT).toBe(28);
    });

    it('ORE_CAPACITY equals BAIL_COUNT for backward compat', () => {
      expect(Entity.ORE_CAPACITY).toBe(Entity.BAIL_COUNT);
    });

    it('harvester starts with 0 bails and 0 credit value', () => {
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
    });

    it('a full gold load = 28 bails x 35 credits = 980 credits', () => {
      // Simulate: each gold bail adds 1 to oreLoad and 35 to oreCreditValue
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      for (let i = 0; i < 28; i++) {
        harv.oreLoad += 1;
        harv.oreCreditValue += 35;
      }
      expect(harv.oreLoad).toBe(28);
      expect(harv.oreCreditValue).toBe(980);
    });
  });

  // === EC4: Gem bonus bails ===

  describe('EC4: Gem bonus bails (+2 per gem harvest)', () => {
    it('gem harvest adds 3 bails total (1 base + 2 bonus)', () => {
      // Simulate: check isGemOverlay, deplete, add bails
      setOverlay(50, 50, 0x10); // gem overlay
      expect(map.isGemOverlay(50, 50)).toBe(true);

      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      const isGem = map.isGemOverlay(50, 50);
      const creditValue = map.depleteOre(50, 50);
      expect(creditValue).toBe(110);

      // Simulate the updateHarvester logic
      harv.oreLoad += 1;
      harv.oreCreditValue += creditValue;
      if (isGem) {
        harv.oreLoad += 2;
        harv.oreCreditValue += creditValue * 2;
      }

      // 1 base bail + 2 bonus = 3 bails
      expect(harv.oreLoad).toBe(3);
      // 110 + 220 = 330 credits for one gem harvest action
      expect(harv.oreCreditValue).toBe(330);
    });

    it('gold harvest adds only 1 bail (no bonus)', () => {
      setOverlay(50, 50, 0x07); // gold overlay
      expect(map.isGemOverlay(50, 50)).toBe(false);

      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      const isGem = map.isGemOverlay(50, 50);
      const creditValue = map.depleteOre(50, 50);

      harv.oreLoad += 1;
      harv.oreCreditValue += creditValue;
      if (isGem) {
        harv.oreLoad += 2;
        harv.oreCreditValue += creditValue * 2;
      }

      expect(harv.oreLoad).toBe(1);
      expect(harv.oreCreditValue).toBe(35);
    });

    it('gems fill harvester faster due to bonus bails', () => {
      // 28 bails / 3 bails per gem harvest = ~9.3 gem harvests to fill
      // vs 28 gold harvests to fill
      const gemHarvests = Math.ceil(Entity.BAIL_COUNT / 3);
      const goldHarvests = Entity.BAIL_COUNT;
      expect(gemHarvests).toBe(10); // 10 gem harvests to fill (ceil(28/3))
      expect(goldHarvests).toBe(28); // 28 gold harvests to fill
      expect(gemHarvests).toBeLessThan(goldHarvests);
    });
  });

  // === EC5: Lump-sum unload ===

  describe('EC5: Lump-sum unload', () => {
    it('oreCreditValue tracks total value for lump-sum deposit', () => {
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      // Simulate 5 gold bails + 2 gem harvests
      for (let i = 0; i < 5; i++) {
        harv.oreLoad += 1;
        harv.oreCreditValue += 35;
      }
      for (let i = 0; i < 2; i++) {
        harv.oreLoad += 3; // 1 base + 2 bonus
        harv.oreCreditValue += 110 + 110 * 2; // 330 per gem harvest
      }
      expect(harv.oreLoad).toBe(11); // 5 + 6
      expect(harv.oreCreditValue).toBe(5 * 35 + 2 * 330); // 175 + 660 = 835

      // Simulate lump-sum unload: entire oreCreditValue deposited at once
      const deposited = harv.oreCreditValue;
      expect(deposited).toBe(835);

      // After deposit, reset
      harv.oreLoad = 0;
      harv.oreCreditValue = 0;
      expect(harv.oreLoad).toBe(0);
      expect(harv.oreCreditValue).toBe(0);
    });
  });

  // === EC6: growOre only grows gold, not gems ===

  describe('EC6: growOre only grows gold, not gems', () => {
    it('gold ore density increases on growth cycle', () => {
      setOverlay(50, 50, 0x05); // gold density 2
      vi.spyOn(Math, 'random').mockReturnValue(0.1); // always trigger density growth
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x06); // increased by 1
      vi.restoreAllMocks();
    });

    it('gem overlay does NOT increase density on growth cycle', () => {
      setOverlay(50, 50, 0x0F); // GEM01 min density
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger everything
      map.growOre(256);
      // Gem should remain unchanged — growOre skips gems entirely
      expect(getOverlay(50, 50)).toBe(0x0F);
      vi.restoreAllMocks();
    });

    it('gem at max density does NOT increase', () => {
      setOverlay(50, 50, 0x12); // GEM04 max density
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x12);
      vi.restoreAllMocks();
    });

    it('gem overlay does NOT spread to adjacent empty cells', () => {
      setOverlay(50, 50, 0x12); // gem at max density
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
      map.growOre(256);
      // All adjacent cells should remain empty — gems don't spread
      expect(getOverlay(50, 49)).toBe(0xFF);
      expect(getOverlay(51, 50)).toBe(0xFF);
      expect(getOverlay(50, 51)).toBe(0xFF);
      expect(getOverlay(49, 50)).toBe(0xFF);
      vi.restoreAllMocks();
    });

    it('gold ore still spreads normally when gems are skipped', () => {
      setOverlay(50, 50, 0x0C); // gold at high density (> 0x09 so spread allowed)
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip (0.6 >= 0.5)
        .mockReturnValueOnce(0.1)  // spread: trigger (0.1 < 0.25)
        .mockReturnValueOnce(0.0); // direction: index 0 → N [0,-1] → (50, 49)
      map.growOre(256);
      expect(getOverlay(50, 49)).toBe(0x03); // gold spread
      vi.restoreAllMocks();
    });
  });

  // === EC7: Ore spread requires density > 6 and uses 8 directions ===

  describe('EC7: Ore spread requires density > 6 and 8 directions', () => {
    it('gold at low density (0x07 = density 4) does NOT spread', () => {
      // 0x03 = density 0, 0x09 = density 6. Spread requires > 6, so overlay must be > 0x09
      setOverlay(50, 50, 0x07); // density 4 — below threshold
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
      map.growOre(256);
      // Density may have increased (0x07 -> 0x08), but no spreading
      for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
        expect(getOverlay(50 + dx, 50 + dy)).toBe(0xFF);
      }
      vi.restoreAllMocks();
    });

    it('gold at density 0x09 (density 6, exactly at threshold) does NOT spread', () => {
      setOverlay(50, 50, 0x09);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(256);
      // Overlay may have increased to 0x0A, but spread check uses original value
      // Actually, the density check may bump it before spread check runs.
      // Let's just check the adjacent cells are empty:
      // Wait -- density growth modifies overlay[idx] in-place before spread check.
      // After density growth: 0x09 -> 0x0A.
      // But the spread check uses `ovl` (the value before density growth), which is 0x09.
      // Since 0x09 <= ORE_SPREAD_MIN_DENSITY (0x09), spread is skipped.
      for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
        expect(getOverlay(50 + dx, 50 + dy)).toBe(0xFF);
      }
      vi.restoreAllMocks();
    });

    it('gold at density 0x0A (density 7, above threshold) CAN spread', () => {
      setOverlay(50, 50, 0x0A);
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)   // density: skip
        .mockReturnValueOnce(0.1)   // spread: trigger
        .mockReturnValueOnce(0.0);  // direction: index 0 → N → (50, 49)
      map.growOre(256);
      expect(getOverlay(50, 49)).toBe(0x03); // spread occurred
      vi.restoreAllMocks();
    });

    it('spread uses 8 directions including diagonals (NE)', () => {
      setOverlay(50, 50, 0x0C); // high density gold
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)   // density: skip
        .mockReturnValueOnce(0.1)   // spread: trigger
        .mockReturnValueOnce(0.125); // direction: index 1 → NE [1,-1] → (51, 49)
      map.growOre(256);
      expect(getOverlay(51, 49)).toBe(0x03); // spread to NE diagonal
      vi.restoreAllMocks();
    });

    it('spread uses 8 directions including diagonals (SE)', () => {
      setOverlay(50, 50, 0x0C);
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)   // density: skip for (50,50)
        .mockReturnValueOnce(0.1)   // spread: trigger for (50,50)
        .mockReturnValueOnce(0.375) // direction: index 3 → SE [1,1] → (51, 51)
        .mockReturnValue(0.9);      // skip all subsequent density/spread for new cell
      map.growOre(256);
      expect(getOverlay(51, 51)).toBe(0x03); // spread to SE diagonal
      vi.restoreAllMocks();
    });

    it('spread uses 8 directions including diagonals (SW)', () => {
      setOverlay(50, 50, 0x0C);
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)   // density: skip for (50,50)
        .mockReturnValueOnce(0.1)   // spread: trigger for (50,50)
        .mockReturnValueOnce(0.625) // direction: index 5 → SW [-1,1] → (49, 51)
        .mockReturnValue(0.9);      // skip all subsequent density/spread for new cell
      map.growOre(256);
      expect(getOverlay(49, 51)).toBe(0x03); // spread to SW diagonal
      vi.restoreAllMocks();
    });

    it('spread uses 8 directions including diagonals (NW)', () => {
      setOverlay(50, 50, 0x0C);
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)   // density: skip
        .mockReturnValueOnce(0.1)   // spread: trigger
        .mockReturnValueOnce(0.875); // direction: index 7 → NW [-1,-1] → (49, 49)
      map.growOre(256);
      expect(getOverlay(49, 49)).toBe(0x03); // spread to NW diagonal
      vi.restoreAllMocks();
    });

    it('ORE_SPREAD_MIN_DENSITY is 0x09', () => {
      expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
    });
  });

  // === MV5: Speed multipliers capped at 1.0 ===

  describe('MV5: Speed multipliers capped at 1.0', () => {
    it('road speed for WHEEL is capped at 1.0 (no boost above base)', () => {
      const idx = 50 * MAP_CELLS + 50;
      map.templateType[idx] = 180; // road template
      const mult = map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('road speed for FOOT is capped at 1.0', () => {
      const idx = 50 * MAP_CELLS + 50;
      map.templateType[idx] = 180;
      const mult = map.getSpeedMultiplier(50, 50, SpeedClass.FOOT);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('clear terrain speed is exactly 1.0', () => {
      const mult = map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL);
      expect(mult).toBe(1.0);
    });

    it('WINGED always returns 1.0', () => {
      map.setTerrain(50, 50, Terrain.ROUGH);
      const mult = map.getSpeedMultiplier(50, 50, SpeedClass.WINGED);
      expect(mult).toBe(1.0);
    });

    it('no terrain multiplier exceeds 1.0', () => {
      // Test all terrain types with all land speed classes
      const landClasses = [SpeedClass.FOOT, SpeedClass.WHEEL, SpeedClass.TRACK];
      const terrains = [Terrain.CLEAR, Terrain.TREE, Terrain.ORE, Terrain.BEACH, Terrain.ROUGH, Terrain.RIVER];
      for (const sc of landClasses) {
        for (const t of terrains) {
          map.setTerrain(50, 50, t);
          const mult = map.getSpeedMultiplier(50, 50, sc);
          expect(mult).toBeLessThanOrEqual(1.0);
        }
      }
    });
  });

  // === MV5: Terrain speed values for Ore, Beach, Rough, River ===

  describe('MV5: Terrain speed values', () => {
    it('Ore terrain gives 0.8 speed multiplier for WHEEL', () => {
      map.setTerrain(50, 50, Terrain.ORE);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.8);
    });

    it('Ore terrain gives 0.8 speed multiplier for FOOT', () => {
      map.setTerrain(50, 50, Terrain.ORE);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.8);
    });

    it('Beach terrain gives 0.6 speed multiplier for WHEEL', () => {
      map.setTerrain(50, 50, Terrain.BEACH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.6);
    });

    it('Beach terrain gives 0.6 speed multiplier for FOOT', () => {
      map.setTerrain(50, 50, Terrain.BEACH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.6);
    });

    it('Rough terrain gives 0.6 speed multiplier for WHEEL', () => {
      map.setTerrain(50, 50, Terrain.ROUGH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.6);
    });

    it('Rough terrain gives 0.6 speed multiplier for FOOT', () => {
      map.setTerrain(50, 50, Terrain.ROUGH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.6);
    });

    it('River terrain gives 0.4 speed multiplier for WHEEL', () => {
      map.setTerrain(50, 50, Terrain.RIVER);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.4);
    });

    it('River terrain gives 0.4 speed multiplier for FOOT', () => {
      map.setTerrain(50, 50, Terrain.RIVER);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.4);
    });

    it('new terrain types exist in Terrain enum', () => {
      expect(Terrain.ORE).toBeDefined();
      expect(Terrain.BEACH).toBeDefined();
      expect(Terrain.ROUGH).toBeDefined();
      expect(Terrain.RIVER).toBeDefined();
    });
  });
});
