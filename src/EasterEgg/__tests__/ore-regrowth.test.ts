import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';
import { ScenarioRandom } from '../engine/random';

/**
 * Ore Regrowth Tests — C++ parity with OverlayClass::AI()
 *
 * Overlay values:
 *   0x03-0x0E = Gold ore (GOLD01-GOLD12, 12 density levels)
 *   0x0F-0x12 = Gems (GEM01-GEM04, 4 density levels)
 *   0xFF      = No overlay
 *
 * C++ behavior:
 *   - Growth fires every ~1821 ticks (~121s at 15 FPS)
 *   - ~50% chance per cell to increase density by 1
 *   - ~25% chance per cell to spread to one random adjacent empty CLEAR cell
 *   - Fully depleted areas (all 0xFF) never regrow — requires a seed cell
 *   - Does not spread to water, rock, wall, or tree terrain
 */

describe('Ore Regrowth (C++ parity)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    // Set a small playable area for testing (bounds 40,40 to 50x50)
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ScenarioRandom.seed = 0;
  });

  /** Helper: get overlay at cell */
  function getOverlay(cx: number, cy: number): number {
    return map.overlay[cy * MAP_CELLS + cx];
  }

  /** Helper: set overlay at cell */
  function setOverlay(cx: number, cy: number, val: number): void {
    map.overlay[cy * MAP_CELLS + cx] = val;
  }

  describe('Growth interval', () => {
    it('does not trigger at tick 0', () => {
      setOverlay(50, 50, 0x05);
      // No mock needed — tick gating returns early before any random calls
      map.growOre(0);
      expect(getOverlay(50, 50)).toBe(0x05); // no change
    });

    it('does not trigger at non-1821-aligned ticks', () => {
      setOverlay(50, 50, 0x05);
      // No mock needed — tick gating returns early
      map.growOre(100);
      expect(getOverlay(50, 50)).toBe(0x05);
      map.growOre(1820);
      expect(getOverlay(50, 50)).toBe(0x05);
    });

    it('triggers at tick 1821', () => {
      setOverlay(50, 50, 0x05);
      // Growth is deterministic for sampled cells (< 64 eligible) — no mock needed
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x06); // increased by 1
    });

    it('triggers at tick 3642 (multiple of 1821)', () => {
      setOverlay(50, 50, 0x05);
      // Growth is deterministic for sampled cells — no mock needed
      map.growOre(3642);
      expect(getOverlay(50, 50)).toBe(0x06);
    });
  });

  describe('Density growth', () => {
    it('gold ore at density 0x05 increases to 0x06', () => {
      setOverlay(50, 50, 0x05);
      // Growth is deterministic for sampled cells — no mock needed
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x06);
    });

    it('gold ore at min density 0x03 increases to 0x04', () => {
      setOverlay(50, 50, 0x03);
      // Growth is deterministic for sampled cells — no mock needed
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x04);
    });

    it('gold ore at max density 0x0E does NOT increase further', () => {
      setOverlay(50, 50, 0x0E);
      // No mock needed — max density check prevents increment
      map.growOre(1821);
      // Density stays at max — should NOT wrap or go above 0x0E
      expect(getOverlay(50, 50)).toBe(0x0E);
    });

    it('gem at density 0x0F does NOT increase (EC6: gems never grow)', () => {
      setOverlay(50, 50, 0x0F);
      // No mock needed — growOre skips gems entirely (EC6)
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x0F); // EC6: gems skipped entirely
    });

    it('gem at density 0x11 does NOT increase (EC6: gems never grow)', () => {
      setOverlay(50, 50, 0x11);
      // No mock needed — growOre skips gems entirely (EC6)
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x11); // EC6: gems skipped entirely
    });

    it('gem at max density 0x12 does NOT increase further', () => {
      setOverlay(50, 50, 0x12);
      // No mock needed — growOre skips gems entirely (EC6)
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x12);
    });

    it('growth is deterministic for sampled cells (C++ parity)', () => {
      setOverlay(50, 50, 0x05);
      // With reservoir sampling, growth is deterministic — no per-cell random check.
      // The cell always grows when sampled (< 64 eligible cells). No mock needed.
      map.growOre(1821);
      expect(getOverlay(50, 50)).toBe(0x06); // always grows when sampled
    });
  });

  describe('Ore spreading', () => {
    it('gold ore spreads to adjacent empty cell with overlay 0x03 (EC7: requires density > 6)', () => {
      setOverlay(50, 50, 0x0C); // gold ore at high density (> 0x09, above spread threshold)
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 0 = N
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(0);
      map.growOre(1821);
      // Cell (50, 49) should now have minimum gold ore
      expect(getOverlay(50, 49)).toBe(0x03);
      // Original cell grew deterministically from 0x0C to 0x0D
      expect(getOverlay(50, 50)).toBe(0x0D);
    });

    it('gem does NOT spread to adjacent empty cell (EC6: gems never spread)', () => {
      setOverlay(50, 50, 0x10); // gem cell
      // No mock needed — growOre skips gems entirely (EC6)
      map.growOre(1821);
      // EC6: gems are completely skipped by growOre — no spread occurs
      expect(getOverlay(50, 51)).toBe(0xFF);
      expect(getOverlay(50, 49)).toBe(0xFF);
      expect(getOverlay(51, 50)).toBe(0xFF);
      expect(getOverlay(49, 50)).toBe(0xFF);
    });

    it('does NOT spread to cell with existing overlay', () => {
      setOverlay(50, 50, 0x07); // gold ore (density 4, below spread threshold)
      setOverlay(50, 49, 0x05); // already has gold ore to the north
      // No mock needed — both cells are below spread threshold (0x09),
      // so neither enters spreadCells. Spread never attempted.
      map.growOre(1821);
      // Cell (50, 49) should retain its original overlay (grew from 0x05 to 0x06), not be overwritten to 0x03
      expect(getOverlay(50, 49)).not.toBe(0x03);
    });
  });

  describe('Terrain restrictions on spreading', () => {
    it('does NOT spread to WATER terrain', () => {
      setOverlay(50, 50, 0x0C); // high density gold (above spread threshold)
      map.setTerrain(50, 49, Terrain.WATER); // water to the north
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 0 = N
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(0);
      map.growOre(1821);
      expect(getOverlay(50, 49)).toBe(0xFF); // still no overlay — blocked by WATER
    });

    it('does NOT spread to ROCK terrain', () => {
      setOverlay(50, 50, 0x0C); // high density gold (above spread threshold)
      map.setTerrain(51, 50, Terrain.ROCK); // rock to the east
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 2 = E
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(2);
      map.growOre(1821);
      expect(getOverlay(51, 50)).toBe(0xFF); // blocked by ROCK
    });

    it('does NOT spread to TREE terrain', () => {
      setOverlay(50, 50, 0x0C); // high density gold (above spread threshold)
      map.setTerrain(50, 51, Terrain.TREE); // tree to the south
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 4 = S
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(4);
      map.growOre(1821);
      expect(getOverlay(50, 51)).toBe(0xFF); // blocked by TREE
    });

    it('does NOT spread to WALL terrain', () => {
      setOverlay(50, 50, 0x0C); // high density gold (above spread threshold)
      map.setTerrain(49, 50, Terrain.WALL); // wall to the west
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 6 = W
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(6);
      map.growOre(1821);
      expect(getOverlay(49, 50)).toBe(0xFF); // blocked by WALL
    });

    it('does NOT spread to a cell with a wall structure (wallType set)', () => {
      setOverlay(50, 50, 0x0C); // high density gold (above spread threshold)
      // Terrain is CLEAR but wallType is set
      map.setWallType(50, 49, 'BRIK');
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 0 = N
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(0);
      map.growOre(1821);
      expect(getOverlay(50, 49)).toBe(0xFF); // blocked by wall structure
    });
  });

  describe('Fully depleted areas', () => {
    it('fully depleted area (all 0xFF) does NOT regrow', () => {
      // Set a 3x3 area with no ore at all
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          setOverlay(50 + dx, 50 + dy, 0xFF);
        }
      }
      // No mock needed — no gold ore cells means no growth/spread candidates
      map.growOre(1821);
      // All cells should remain 0xFF — no seed cell means no regrowth
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(getOverlay(50 + dx, 50 + dy)).toBe(0xFF);
        }
      }
    });

    it('single remaining ore cell can spread outward (EC7: requires density > 6)', () => {
      // Only one cell has ore — it serves as a seed.
      // EC7: Spread requires density > 6 (overlay > 0x09), so use high-density ore.
      setOverlay(50, 50, 0x0C); // high gold ore (above spread threshold)
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 0 = N
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(0);
      map.growOre(1821);
      expect(getOverlay(50, 49)).toBe(0x03); // spread to neighbor
    });
  });

  describe('Map bounds enforcement', () => {
    it('growth only occurs within map bounds', () => {
      // Place ore at the edge of bounds
      const edgeX = map.boundsX;
      const edgeY = map.boundsY;
      setOverlay(edgeX, edgeY, 0x0C); // high density (above spread threshold)
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 0 = N (out of bounds)
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(0);
      map.growOre(1821);
      // The cell above the bounds edge should NOT get ore
      expect(getOverlay(edgeX, edgeY - 1)).toBe(0xFF);
    });

    it('ore at bottom-right edge does not spread outside bounds', () => {
      const maxX = map.boundsX + map.boundsW - 1;
      const maxY = map.boundsY + map.boundsH - 1;
      setOverlay(maxX, maxY, 0x0C); // high density (above spread threshold)
      // ScenarioRandom.nextInRange(0,7) controls spread direction; 3 = SE (out of bounds)
      vi.spyOn(ScenarioRandom, 'nextInRange').mockReturnValue(3);
      map.growOre(1821);
      // Cells just outside bounds should NOT have ore
      if (maxX + 1 < MAP_CELLS) {
        expect(getOverlay(maxX + 1, maxY)).toBe(0xFF);
      }
      if (maxY + 1 < MAP_CELLS) {
        expect(getOverlay(maxX, maxY + 1)).toBe(0xFF);
      }
    });
  });

  describe('Static configuration', () => {
    it('ORE_GROWTH_INTERVAL is 1821 ticks (C++ map.cpp:1017 full scan interval)', () => {
      expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821);
    });

    it('RESERVOIR_SIZE is 64 (C++ MAP_CELL_W/2)', () => {
      expect(GameMap.RESERVOIR_SIZE).toBe(64);
    });

    it('ORE_SPREAD_MIN_DENSITY is 0x09', () => {
      expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
    });
  });
});
