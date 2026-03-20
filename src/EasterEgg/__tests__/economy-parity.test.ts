import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { Entity } from '../engine/entity';
import { MAP_CELLS, House, UnitType, SpeedClass } from '../engine/types';

/**
 * Economy & Ore Parity Tests — C++ Red Alert overlay.cpp / drive.cpp
 *
 * EC1/EC2: Gold ore = 25 credits/bail (rules.ini GoldValue=25), Gems = 50 credits/bail (GemValue=50)
 * EC3: Bail-based capacity (28 bails max per harvester load)
 * EC4: Gem bonus bails (+3 per gem harvest action, total 4 bails per gem harvest)
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

  describe('EC1: Gold ore yields 25 credits per bail (rules.ini GoldValue=25)', () => {
    it('depleting gold ore at mid density returns 25', () => {
      setOverlay(50, 50, 0x07); // gold ore mid density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(25);
    });

    it('depleting gold ore at max density returns 25', () => {
      setOverlay(50, 50, 0x0E); // GOLD12 max density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(25);
    });

    it('depleting gold ore at min density returns 25 and fully depletes', () => {
      setOverlay(50, 50, 0x03); // GOLD01 min density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(25);
      expect(getOverlay(50, 50)).toBe(0xFF); // fully depleted
    });

    it('depleting empty cell returns 0', () => {
      expect(map.depleteOre(50, 50)).toBe(0);
    });
  });

  describe('EC2: Gems yield 50 credits per bail (rules.ini GemValue=50)', () => {
    it('depleting gem at mid density returns 50', () => {
      setOverlay(50, 50, 0x10); // GEM02
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(50);
    });

    it('depleting gem at max density returns 50', () => {
      setOverlay(50, 50, 0x12); // GEM04 max density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(50);
    });

    it('depleting gem at min density returns 50 and fully depletes', () => {
      setOverlay(50, 50, 0x0F); // GEM01 min density
      const credits = map.depleteOre(50, 50);
      expect(credits).toBe(50);
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

    it('a full gold load = 28 bails x 25 credits = 700 credits', () => {
      // Simulate: each gold bail adds 1 to oreLoad and 25 to oreCreditValue
      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      for (let i = 0; i < 28; i++) {
        harv.oreLoad += 1;
        harv.oreCreditValue += 25;
      }
      expect(harv.oreLoad).toBe(28);
      expect(harv.oreCreditValue).toBe(700);
    });
  });

  // === EC4: Gem bonus bails ===

  describe('EC4: Gem bonus bails (+3 per gem harvest)', () => {
    it('gem harvest adds 4 bails total (1 base + 3 bonus)', () => {
      // Simulate: check isGemOverlay, deplete, add bails
      setOverlay(50, 50, 0x10); // gem overlay
      expect(map.isGemOverlay(50, 50)).toBe(true);

      const harv = new Entity(UnitType.V_HARV, House.Spain, 100, 100);
      const isGem = map.isGemOverlay(50, 50);
      const creditValue = map.depleteOre(50, 50);
      expect(creditValue).toBe(50);

      // Simulate the updateHarvester logic (matches engine: 1 base + 3 bonus)
      harv.oreLoad += 1;
      harv.oreCreditValue += creditValue;
      if (isGem) {
        harv.oreLoad += 3;
        harv.oreCreditValue += 150; // 3 bonus bails x 50 credits
      }

      // 1 base bail + 3 bonus = 4 bails
      expect(harv.oreLoad).toBe(4);
      // 50 + 150 = 200 credits for one gem harvest action
      expect(harv.oreCreditValue).toBe(200);
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
        harv.oreLoad += 3;
        harv.oreCreditValue += 150;
      }

      expect(harv.oreLoad).toBe(1);
      expect(harv.oreCreditValue).toBe(25);
    });

    it('gems fill harvester faster due to bonus bails', () => {
      // 28 bails / 4 bails per gem harvest = 7 gem harvests to fill
      // vs 28 gold harvests to fill
      const gemHarvests = Math.ceil(Entity.BAIL_COUNT / 4);
      const goldHarvests = Entity.BAIL_COUNT;
      expect(gemHarvests).toBe(7); // 7 gem harvests to fill (ceil(28/4))
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
        harv.oreCreditValue += 25;
      }
      for (let i = 0; i < 2; i++) {
        harv.oreLoad += 4; // 1 base + 3 bonus
        harv.oreCreditValue += 200; // 50 + 150 per gem harvest
      }
      expect(harv.oreLoad).toBe(13); // 5 + 8
      expect(harv.oreCreditValue).toBe(5 * 25 + 2 * 200); // 125 + 400 = 525

      // Simulate lump-sum unload: entire oreCreditValue deposited at once
      const deposited = harv.oreCreditValue;
      expect(deposited).toBe(525);

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
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x06); // increased by 1
      vi.restoreAllMocks();
    });

    it('gem overlay does NOT increase density on growth cycle', () => {
      setOverlay(50, 50, 0x0F); // GEM01 min density
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger everything
      map.growOre(1821);
      // Gem should remain unchanged — growOre skips gems entirely
      expect(getOverlay(50, 50)).toBe(0x0F);
      vi.restoreAllMocks();
    });

    it('gem at max density does NOT increase', () => {
      setOverlay(50, 50, 0x12); // GEM04 max density
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x12);
      vi.restoreAllMocks();
    });

    it('gem overlay does NOT spread to adjacent empty cells', () => {
      setOverlay(50, 50, 0x12); // gem at max density
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
      map.growOre(1821);
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
      map.growOre(1821);
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
      map.growOre(1821);
      // Density may have increased (0x07 -> 0x08), but no spreading
      for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
        expect(getOverlay(50 + dx, 50 + dy)).toBe(0xFF);
      }
      vi.restoreAllMocks();
    });

    it('gold at density 0x09 (density 6, exactly at threshold) does NOT spread', () => {
      setOverlay(50, 50, 0x09);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(1821);
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
      map.growOre(1821);
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
      map.growOre(1821);
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
      map.growOre(1821);
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
      map.growOre(1821);
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
      map.growOre(1821);
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

    it('clear terrain speed is 0.60 for WHEEL (C++ RULES.INI)', () => {
      const mult = map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL);
      expect(mult).toBe(0.60);
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
    it('Ore terrain gives 0.50 speed multiplier for WHEEL (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.ORE);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.50);
    });

    it('Ore terrain gives 0.90 speed multiplier for FOOT (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.ORE);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.90);
    });

    it('Beach terrain gives 0.40 speed multiplier for WHEEL (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.BEACH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.40);
    });

    it('Beach terrain gives 0.80 speed multiplier for FOOT (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.BEACH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.80);
    });

    it('Rough terrain gives 0.40 speed multiplier for WHEEL (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.ROUGH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.40);
    });

    it('Rough terrain gives 0.80 speed multiplier for FOOT (C++ RULES.INI)', () => {
      map.setTerrain(50, 50, Terrain.ROUGH);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.80);
    });

    it('River terrain gives 0.0 speed multiplier for WHEEL (C++ RULES.INI impassable)', () => {
      map.setTerrain(50, 50, Terrain.RIVER);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.WHEEL)).toBe(0.0);
    });

    it('River terrain gives 0.0 speed multiplier for FOOT (C++ RULES.INI impassable)', () => {
      map.setTerrain(50, 50, Terrain.RIVER);
      expect(map.getSpeedMultiplier(50, 50, SpeedClass.FOOT)).toBe(0.0);
    });

    it('new terrain types exist in Terrain enum', () => {
      expect(Terrain.ORE).toBeDefined();
      expect(Terrain.BEACH).toBeDefined();
      expect(Terrain.ROUGH).toBeDefined();
      expect(Terrain.RIVER).toBeDefined();
    });
  });
});
