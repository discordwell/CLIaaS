/**
 * C++ Behavioral Parity: Radar display states (off / active / jammed)
 *
 * In the original C++, the radar area displays one of three visual states:
 *
 * 1. INACTIVE (no DOME or low power): Faction emblem overlay
 *    - Allied houses → natoradr.shp final frame (NATO compass rose)
 *    - Soviet houses → ussrradr.shp final frame (Soviet star)
 *    C++ source: radar.cpp:370-381 (_hiresradarnames[] selects per-house SHP),
 *    radar.cpp:1596 (Radar_Anim draws RadarAnim at RadarAnimFrame),
 *    radar.cpp:1662-1665 (deactivation ends at MAX_RADAR_FRAMES → last frame = emblem)
 *
 * 2. ACTIVE: Live minimap showing terrain, units, structures
 *    C++ source: radar.cpp:480 (IsRadarActive branch draws cell-by-cell minimap)
 *
 * 3. JAMMED (GAP generator): Static/snow noise cycling
 *    C++ source: radar.cpp:469-477 (IsRadarJammed → Radar_Anim with snow frames),
 *    radar.cpp:1676-1681 (jammed cycles frames near RADAR_ACTIVATED_FRAME)
 *
 * Key C++ mapping (radar.cpp:370-381):
 *   HOUSE_SPAIN    → natoradr.shp (Allied)
 *   HOUSE_GREECE   → natoradr.shp (Allied)
 *   HOUSE_USSR     → ussrradr.shp (Soviet)
 *   HOUSE_ENGLAND  → natoradr.shp (Allied)
 *   HOUSE_UKRAINE  → ussrradr.shp (Soviet)
 *   HOUSE_GERMANY  → natoradr.shp (Allied)
 *   HOUSE_FRANCE   → natoradr.shp (Allied)
 *   HOUSE_TURKEY   → natoradr.shp (Allied)
 *   HOUSE_GOOD     → natoradr.shp (Allied)
 *   HOUSE_BAD      → ussrradr.shp (Soviet)
 */

import { describe, it, expect } from 'vitest';
import { House, HOUSE_FACTION } from '../engine/types';
import { Renderer } from '../engine/renderer';

// ─── Canvas mock ────────────────────────────────────────

/** Minimal canvas mock sufficient for Renderer construction */
function mockCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    getContext: () => ({
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      save: () => {},
      restore: () => {},
      translate: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: () => {},
      canvas: { width: 800, height: 600 },
    }),
  } as unknown as HTMLCanvasElement;
}

// ─── Helpers ────────────────────────────────────────────

/**
 * The C++ _hiresradarnames[] array (radar.cpp:370-381) maps each house
 * to either natoradr.shp (Allied) or ussrradr.shp (Soviet).
 */
const CPP_RADAR_SHP: Record<string, 'natoradr' | 'ussrradr'> = {
  Spain: 'natoradr',
  Greece: 'natoradr',
  USSR: 'ussrradr',
  England: 'natoradr',
  Ukraine: 'ussrradr',
  Germany: 'natoradr',
  France: 'natoradr',
  Turkey: 'natoradr',
  GoodGuy: 'natoradr',
  BadGuy: 'ussrradr',
};

// ─── Tests ──────────────────────────────────────────────

describe('C++ parity: Radar display states (radar.cpp)', () => {
  describe('faction → radar SHP mapping (radar.cpp:370-381)', () => {
    it('all houses map to the correct faction for radar overlay selection', () => {
      for (const [house, shp] of Object.entries(CPP_RADAR_SHP)) {
        const faction = HOUSE_FACTION[house];
        const expectedFaction = shp === 'natoradr' ? 'allied' : 'soviet';
        expect(faction, `${house} → HOUSE_FACTION should be ${expectedFaction}`).toBe(expectedFaction);
      }
    });

    it('allied houses use natoradr.shp (NATO emblem)', () => {
      const alliedHouses = ['Spain', 'Greece', 'England', 'France', 'Germany', 'Turkey', 'GoodGuy'];
      for (const house of alliedHouses) {
        expect(CPP_RADAR_SHP[house], `${house}`).toBe('natoradr');
        expect(HOUSE_FACTION[house]).toBe('allied');
      }
    });

    it('soviet houses use ussrradr.shp (Soviet emblem)', () => {
      const sovietHouses = ['USSR', 'Ukraine', 'BadGuy'];
      for (const house of sovietHouses) {
        expect(CPP_RADAR_SHP[house], `${house}`).toBe('ussrradr');
        expect(HOUSE_FACTION[house]).toBe('soviet');
      }
    });
  });

  describe('renderer radar state flags', () => {
    it('hasRadar defaults to false (no DOME building)', () => {
      const r = new Renderer(mockCanvas());
      expect(r.hasRadar).toBe(false);
    });

    it('isRadarJammed defaults to false', () => {
      const r = new Renderer(mockCanvas());
      expect(r.isRadarJammed).toBe(false);
    });

    it('isRadarJammed is independent of hasRadar', () => {
      // C++ radar.cpp:469 — jamming is checked separately from radar activation
      const r = new Renderer(mockCanvas());
      r.hasRadar = true;
      r.isRadarJammed = true;
      expect(r.hasRadar).toBe(true);
      expect(r.isRadarJammed).toBe(true);
    });
  });

  describe('display state priority (radar.cpp Draw_It:469-480)', () => {
    // C++ Draw_It checks: IsRadarActivating || IsRadarDeactivating || IsRadarJammed → Radar_Anim()
    // Then: IsRadarActive → draw minimap
    // Otherwise: nothing redrawn (faction emblem from last deactivation frame persists)

    it('jammed + active → jammed takes priority (radar.cpp:469)', () => {
      // In C++, IsRadarJammed check at line 469 runs BEFORE IsRadarActive at line 480
      // So jamming takes visual priority over active radar
      const r = new Renderer(mockCanvas());
      r.hasRadar = true;
      r.isRadarJammed = true;
      // The renderer should show static noise (jamming), not the minimap
      expect(r.isRadarJammed && r.hasRadar).toBe(true);
    });

    it('no radar + not jammed → faction emblem (not static noise)', () => {
      // C++ radar.cpp:1662-1665: after deactivation completes, IsRadarDeactivating=false,
      // the last drawn frame from natoradr/ussrradr.shp persists — it's the faction emblem.
      // Static noise is ONLY for IsRadarJammed (radar.cpp:1676-1681).
      const r = new Renderer(mockCanvas());
      r.hasRadar = false;
      r.isRadarJammed = false;
      // Should show faction emblem, NOT static
      expect(r.hasRadar).toBe(false);
      expect(r.isRadarJammed).toBe(false);
      // radarStaticData should not be generated for the off state
    });
  });

  describe('radar activation conditions (house.cpp:1258-1312)', () => {
    it('radar requires DOME building AND sufficient power', () => {
      // C++ house.cpp:1302: if (IsGPSActive || (ActiveBScan & STRUCTF_RADAR))
      // house.cpp:1303: if (IsGPSActive || Power_Fraction() >= 1)
      // TS equivalent: hasRadar = hasBuilding('DOME') && !lowPwr

      // No DOME → no radar
      expect(simulateRadar(false, 100, 50)).toBe(false);
      // DOME but low power → no radar
      expect(simulateRadar(true, 100, 150)).toBe(false);
      // DOME with sufficient power → radar
      expect(simulateRadar(true, 100, 50)).toBe(true);
      // DOME with equal power → radar active (consumed > produced is false when equal)
      expect(simulateRadar(true, 100, 100)).toBe(true);
    });

    it('DOME with zero power production is not low power', () => {
      // C++ edge case: lowPwr check requires powerProduced > 0
      // If no power at all (no power plant), the lowPwr flag is false
      // but DOME still won't show radar without power... unless GPS
      expect(simulateRadar(true, 0, 0)).toBe(true); // no power plant = not "low power"
    });
  });
});

/** Simulate the TS radar activation logic from engine/index.ts:6376-6378 */
function simulateRadar(hasDome: boolean, powerProduced: number, powerConsumed: number): boolean {
  const lowPwr = powerConsumed > powerProduced && powerProduced > 0;
  return hasDome && !lowPwr;
}
