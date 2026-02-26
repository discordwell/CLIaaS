import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';

/**
 * Ore Regrowth Tests — C++ parity with OverlayClass::AI()
 *
 * Overlay values:
 *   0x03-0x0E = Gold ore (GOLD01-GOLD12, 12 density levels)
 *   0x0F-0x12 = Gems (GEM01-GEM04, 4 density levels)
 *   0xFF      = No overlay
 *
 * C++ behavior:
 *   - Growth fires every ~256 ticks (~17s at 15 FPS)
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
      // Force Math.random to always return 0 (always grow)
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(0);
      expect(getOverlay(50, 50)).toBe(0x05); // no change
      vi.restoreAllMocks();
    });

    it('does not trigger at non-256-aligned ticks', () => {
      setOverlay(50, 50, 0x05);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(100);
      expect(getOverlay(50, 50)).toBe(0x05);
      map.growOre(255);
      expect(getOverlay(50, 50)).toBe(0x05);
      vi.restoreAllMocks();
    });

    it('triggers at tick 256', () => {
      setOverlay(50, 50, 0x05);
      vi.spyOn(Math, 'random').mockReturnValue(0); // always grow
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x06); // increased by 1
      vi.restoreAllMocks();
    });

    it('triggers at tick 512 (multiple of 256)', () => {
      setOverlay(50, 50, 0x05);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(512);
      expect(getOverlay(50, 50)).toBe(0x06);
      vi.restoreAllMocks();
    });
  });

  describe('Density growth', () => {
    it('gold ore at density 0x05 increases to 0x06', () => {
      setOverlay(50, 50, 0x05);
      // Math.random < 0.5 triggers density growth
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x06);
      vi.restoreAllMocks();
    });

    it('gold ore at min density 0x03 increases to 0x04', () => {
      setOverlay(50, 50, 0x03);
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x04);
      vi.restoreAllMocks();
    });

    it('gold ore at max density 0x0E does NOT increase further', () => {
      setOverlay(50, 50, 0x0E);
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
      map.growOre(256);
      // Density stays at max — should NOT wrap or go above 0x0E
      expect(getOverlay(50, 50)).toBe(0x0E);
      vi.restoreAllMocks();
    });

    it('gem at density 0x0F increases to 0x10', () => {
      setOverlay(50, 50, 0x0F);
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x10);
      vi.restoreAllMocks();
    });

    it('gem at density 0x11 increases to 0x12', () => {
      setOverlay(50, 50, 0x11);
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x12);
      vi.restoreAllMocks();
    });

    it('gem at max density 0x12 does NOT increase further', () => {
      setOverlay(50, 50, 0x12);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x12);
      vi.restoreAllMocks();
    });

    it('does NOT grow when random exceeds density chance', () => {
      setOverlay(50, 50, 0x05);
      // 0.8 > 0.5 (ORE_DENSITY_CHANCE), so no density growth
      // Also > 0.25 (ORE_SPREAD_CHANCE), so no spread either
      vi.spyOn(Math, 'random').mockReturnValue(0.8);
      map.growOre(256);
      expect(getOverlay(50, 50)).toBe(0x05); // no change
      vi.restoreAllMocks();
    });
  });

  describe('Ore spreading', () => {
    it('gold ore spreads to adjacent empty cell with overlay 0x03', () => {
      setOverlay(50, 50, 0x07); // gold ore cell
      // First random call: density check (0.6 > 0.5, no density growth)
      // Second random call: spread check (0.1 < 0.25, spread triggers)
      // Third random call: direction pick (0.0 → index 0 → [0,-1] → north)
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip (0.6 >= 0.5)
        .mockReturnValueOnce(0.1)  // spread: trigger (0.1 < 0.25)
        .mockReturnValueOnce(0.0); // direction: north [0,-1] → cell (50, 49)
      map.growOre(256);
      // Cell (50, 49) should now have minimum gold ore
      expect(getOverlay(50, 49)).toBe(0x03);
      // Original cell should NOT have changed density (we skipped it)
      expect(getOverlay(50, 50)).toBe(0x07);
      vi.restoreAllMocks();
    });

    it('gem spreads to adjacent empty cell with overlay 0x0F', () => {
      setOverlay(50, 50, 0x10); // gem cell
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip (source cell)
        .mockReturnValueOnce(0.1)  // spread: trigger (source cell)
        .mockReturnValueOnce(0.5)  // direction: index 2 → [0,1] → south → (50, 51)
        .mockReturnValueOnce(0.9)  // density: skip (spread cell processed in same pass)
        .mockReturnValueOnce(0.9); // spread: skip (spread cell)
      map.growOre(256);
      expect(getOverlay(50, 51)).toBe(0x0F); // minimum gem density
      vi.restoreAllMocks();
    });

    it('does NOT spread to cell with existing overlay', () => {
      setOverlay(50, 50, 0x07); // gold ore
      setOverlay(50, 49, 0x05); // already has gold ore to the north
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip for (50,50)
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.0)  // direction: north → (50, 49)
        // Continue returning high values for remaining cells
        .mockReturnValue(0.9);
      // Need to handle (50,49) too since it also has ore:
      // It would be processed before (50,50) due to row order
      map.growOre(256);
      // Cell (50, 49) should retain its original overlay, not be overwritten to 0x03
      expect(getOverlay(50, 49)).not.toBe(0x03);
      vi.restoreAllMocks();
    });
  });

  describe('Terrain restrictions on spreading', () => {
    it('does NOT spread to WATER terrain', () => {
      setOverlay(50, 50, 0x07);
      map.setTerrain(50, 49, Terrain.WATER); // water to the north
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.0); // direction: north → (50, 49) which is WATER
      map.growOre(256);
      expect(getOverlay(50, 49)).toBe(0xFF); // still no overlay
      vi.restoreAllMocks();
    });

    it('does NOT spread to ROCK terrain', () => {
      setOverlay(50, 50, 0x07);
      map.setTerrain(51, 50, Terrain.ROCK); // rock to the east
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.25); // direction: index 1 → [1,0] → east → (51, 50)
      map.growOre(256);
      expect(getOverlay(51, 50)).toBe(0xFF);
      vi.restoreAllMocks();
    });

    it('does NOT spread to TREE terrain', () => {
      setOverlay(50, 50, 0x07);
      map.setTerrain(50, 51, Terrain.TREE); // tree to the south
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.5); // direction: index 2 → [0,1] → south → (50, 51)
      map.growOre(256);
      expect(getOverlay(50, 51)).toBe(0xFF);
      vi.restoreAllMocks();
    });

    it('does NOT spread to WALL terrain', () => {
      setOverlay(50, 50, 0x07);
      map.setTerrain(49, 50, Terrain.WALL); // wall to the west
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.75); // direction: index 3 → [-1,0] → west → (49, 50)
      map.growOre(256);
      expect(getOverlay(49, 50)).toBe(0xFF);
      vi.restoreAllMocks();
    });

    it('does NOT spread to a cell with a wall structure (wallType set)', () => {
      setOverlay(50, 50, 0x07);
      // Terrain is CLEAR but wallType is set
      map.setWallType(50, 49, 'BRIK');
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.0); // direction: north → (50, 49)
      map.growOre(256);
      expect(getOverlay(50, 49)).toBe(0xFF); // blocked by wall structure
      vi.restoreAllMocks();
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
      vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger everything
      map.growOre(256);
      // All cells should remain 0xFF — no seed cell means no regrowth
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(getOverlay(50 + dx, 50 + dy)).toBe(0xFF);
        }
      }
      vi.restoreAllMocks();
    });

    it('single remaining ore cell can spread outward', () => {
      // Only one cell has ore — it serves as a seed
      setOverlay(50, 50, 0x03); // min gold ore
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.0); // direction: north
      map.growOre(256);
      expect(getOverlay(50, 49)).toBe(0x03); // spread to neighbor
      vi.restoreAllMocks();
    });
  });

  describe('Map bounds enforcement', () => {
    it('growth only occurs within map bounds', () => {
      // Place ore at the edge of bounds
      const edgeX = map.boundsX;
      const edgeY = map.boundsY;
      setOverlay(edgeX, edgeY, 0x07);
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom
        .mockReturnValueOnce(0.6)  // density: skip
        .mockReturnValueOnce(0.1)  // spread: trigger
        .mockReturnValueOnce(0.0); // direction: north → (edgeX, edgeY - 1) — out of bounds!
      map.growOre(256);
      // The cell above the bounds edge should NOT get ore
      expect(getOverlay(edgeX, edgeY - 1)).toBe(0xFF);
      vi.restoreAllMocks();
    });

    it('ore at bottom-right edge does not spread outside bounds', () => {
      const maxX = map.boundsX + map.boundsW - 1;
      const maxY = map.boundsY + map.boundsH - 1;
      setOverlay(maxX, maxY, 0x07);
      // We need to process all cells up to (maxX, maxY)
      // Use a mock that returns high values for all preceding cells,
      // then low for the spread at the target cell
      const callCount = { n: 0 };
      const targetCallOffset = ((maxY - map.boundsY) * map.boundsW + (maxX - map.boundsX)) * 2;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount.n++;
        // For the target cell's density check: skip
        if (callCount.n === targetCallOffset + 1) return 0.6;
        // For the target cell's spread check: trigger
        if (callCount.n === targetCallOffset + 2) return 0.1;
        // High value = skip for all other cells
        return 0.9;
      });
      map.growOre(256);
      // Cells just outside bounds should NOT have ore
      if (maxX + 1 < MAP_CELLS) {
        expect(getOverlay(maxX + 1, maxY)).toBe(0xFF);
      }
      if (maxY + 1 < MAP_CELLS) {
        expect(getOverlay(maxX, maxY + 1)).toBe(0xFF);
      }
      vi.restoreAllMocks();
    });
  });

  describe('Static configuration', () => {
    it('ORE_GROWTH_INTERVAL is 256 ticks', () => {
      expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256);
    });

    it('ORE_DENSITY_CHANCE is 0.5', () => {
      expect(GameMap.ORE_DENSITY_CHANCE).toBe(0.5);
    });

    it('ORE_SPREAD_CHANCE is 0.25', () => {
      expect(GameMap.ORE_SPREAD_CHANCE).toBe(0.25);
    });
  });
});
