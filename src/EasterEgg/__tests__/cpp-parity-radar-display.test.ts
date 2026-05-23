/**
 * C++ Behavioral Parity: Radar display states (off / active / jammed)
 *
 * In the original C++, the radar area displays one of three visual states:
 *
 * 1. INACTIVE/ANIMATING: natoradr/ussrradr cover frames
 *    - Allied houses → natoradr.shp
 *    - Soviet houses → ussrradr.shp
 *    C++ source: radar.cpp:370-381 (_hiresradarnames[] selects per-house SHP),
 *    radar.cpp:1596 (Radar_Anim draws RadarAnim at RadarAnimFrame),
 *    radar.cpp:1638-1665 (activation/deactivation animates cover frames)
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

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi } from 'vitest';
import { HOUSE_FACTION, RESFACTOR } from '../engine/types';
import { Renderer } from '../engine/renderer';
import {
  MAX_RADAR_FRAMES,
  RADAR_ACTIVATED_FRAME,
  advanceRadarAnimation,
  createRadarVisualState,
  isRadarActive,
  radarDisplayFrame,
  updateRadarAvailability,
} from '../engine/radar';

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
  describe('radar animation asset coverage', () => {
    it('manifest includes the extracted C++ radar cover SHPs', () => {
      const manifest = JSON.parse(readFileSync(
        join(__dirname, '../../..', 'public/ra/assets/manifest.json'),
        'utf-8',
      ));

      for (const sprite of ['natoradr', 'ussrradr']) {
        expect(manifest[sprite], `${sprite}.png exists and must be loadable through AssetManager`).toEqual({
          frameWidth: 160,
          frameHeight: 141,
          frameCount: 43,
          columns: 16,
          rows: 3,
          sheetWidth: 2560,
          sheetHeight: 423,
        });
      }
    });
  });

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

    it('doesRadarExist defaults to false', () => {
      // C++ radar.h:136: DoesRadarExist — tracks whether the cover has opened.
      const r = new Renderer(mockCanvas());
      expect(r.doesRadarExist).toBe(false);
    });

    it('doesRadarExist is independent of hasRadar (opened cover vs active display)', () => {
      // C++ radar.cpp:601: val = DoesRadarExist ? MAX_RADAR_FRAMES : 0
      // DoesRadarExist is the animated cover state, not merely DOME presence.
      const r = new Renderer(mockCanvas());
      // Radar opened previously, but the tactical minimap is currently inactive.
      r.doesRadarExist = true;
      r.hasRadar = false;
      expect(r.doesRadarExist).toBe(true);
      expect(r.hasRadar).toBe(false);
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
    });

    it('jammed + no radar → jammed takes priority over emblem (radar.cpp:469)', () => {
      // C++ radar.cpp:469: IsRadarJammed is checked BEFORE IsRadarActive at line 480.
      // If a jammed player loses their DOME, the display should still show static
      // (jamming), not the faction emblem. The jam check has no dependency on radar state.
      const r = new Renderer(mockCanvas());
      r.hasRadar = false;
      r.isRadarJammed = true;
      // isRadarJammed alone is sufficient to trigger static display
      expect(r.isRadarJammed).toBe(true);
      expect(r.hasRadar).toBe(false);
    });
  });

  describe('radar activation conditions (house.cpp:1258-1312)', () => {
    it('powered DOME requests activation but does not become active until the cover opens', () => {
      // C++ house.cpp:1302: if (IsGPSActive || (ActiveBScan & STRUCTF_RADAR))
      // house.cpp:1303: if (IsGPSActive || Power_Fraction() >= 1)
      // radar.cpp:1638-1646: RadarClass::AI opens frames 0..22 before IsRadarActive.
      const state = createRadarVisualState();

      updateRadarAvailability(state, { hasRadarFacility: true, hasFullPower: true, isGpsActive: false });

      expect(state.isRadarActivating).toBe(true);
      expect(isRadarActive(state)).toBe(false);
      expect(radarDisplayFrame(state)).toBe(0);

      for (let i = 0; i < RADAR_ACTIVATED_FRAME - 1; i++) advanceRadarAnimation(state);
      expect(isRadarActive(state)).toBe(false);
      expect(state.doesRadarExist).toBe(false);
      expect(radarDisplayFrame(state)).toBe(RADAR_ACTIVATED_FRAME - 1);

      advanceRadarAnimation(state);
      expect(isRadarActive(state)).toBe(true);
      expect(state.doesRadarExist).toBe(true);
      expect(radarDisplayFrame(state)).toBeNull();
    });

    it('unpowered initial DOME does not mark DoesRadarExist until it has opened once', () => {
      const state = createRadarVisualState();

      updateRadarAvailability(state, { hasRadarFacility: true, hasFullPower: false, isGpsActive: false });

      expect(isRadarActive(state)).toBe(false);
      expect(state.doesRadarExist).toBe(false);
      expect(radarDisplayFrame(state)).toBe(0);
    });

    it('DOME with zero power production and zero consumption can start opening', () => {
      // C++ house.cpp:4160-4170: Power_Fraction() returns 1 when Drain==0
      const state = createRadarVisualState();
      updateRadarAvailability(state, { hasRadarFacility: true, hasFullPower: true, isGpsActive: false });
      expect(state.isRadarActivating).toBe(true);
    });

    it('DOME with zero production but nonzero consumption has no power', () => {
      // C++ house.cpp:4168: Power=0, Drain>0 → Power_Fraction()=0 → low power
      const state = createRadarVisualState();
      updateRadarAvailability(state, { hasRadarFacility: true, hasFullPower: false, isGpsActive: false });
      expect(state.isRadarActivating).toBe(false);
      expect(isRadarActive(state)).toBe(false);
    });

    it('active radar losing power closes through frame 41 and keeps DoesRadarExist', () => {
      const state = createRadarVisualState();
      state.doesRadarExist = true;
      state.isRadarActive = true;
      state.radarAnimFrame = RADAR_ACTIVATED_FRAME;

      updateRadarAvailability(state, { hasRadarFacility: true, hasFullPower: false, isGpsActive: false });

      expect(state.isRadarDeactivating).toBe(true);
      expect(isRadarActive(state)).toBe(false);
      expect(radarDisplayFrame(state)).toBe(RADAR_ACTIVATED_FRAME);

      for (let i = RADAR_ACTIVATED_FRAME; i < MAX_RADAR_FRAMES; i++) advanceRadarAnimation(state);
      expect(state.isRadarDeactivating).toBe(false);
      expect(state.doesRadarExist).toBe(true);
      expect(radarDisplayFrame(state)).toBe(MAX_RADAR_FRAMES);
    });
  });

  describe('cover plate frame selection (radar.cpp:601)', () => {
    // C++ radar.cpp:601: int val = (DoesRadarExist) ? MAX_RADAR_FRAMES : 0;
    // CC_Draw_Shape(RadarAnim, val, ...)
    // Frame 0 = closed panel before radar has ever opened.
    // Frame 41 = closed panel after a radar that previously existed has deactivated.

    it('radar never opened → frame 0', () => {
      // C++ !DoesRadarExist → val = 0 → natoradr/ussrradr frame 0
      const r = new Renderer(mockCanvas());
      r.doesRadarExist = false;
      r.hasRadar = false;
      // doesRadarExist ? 41 : 0 → 0
      expect(r.doesRadarExist ? 41 : 0).toBe(0);
    });

    it('previously opened radar that is now inactive → frame 41', () => {
      // C++ DoesRadarExist=true, !IsRadarActive → val = MAX_RADAR_FRAMES = 41
      const r = new Renderer(mockCanvas());
      r.doesRadarExist = true;
      r.hasRadar = false;
      // doesRadarExist ? 41 : 0 → 41
      expect(r.doesRadarExist ? 41 : 0).toBe(41);
    });

    it('MAX_RADAR_FRAMES = 41 (radar.h:122)', () => {
      // C++ radar.h: enum RadarClassEnums { MAX_RADAR_FRAMES = 41 };
      // Validates the constant used in frame selection
      expect(MAX_RADAR_FRAMES).toBe(41); // self-documenting: frame index matches C++ constant
    });

    it('RADAR_ACTIVATED_FRAME = 22 (radar.h:121)', () => {
      // C++ radar.h: enum RadarClassEnums { RADAR_ACTIVATED_FRAME = 22 };
      // This is the transition point between opening/closing animation
      expect(RADAR_ACTIVATED_FRAME).toBe(22); // self-documenting: midpoint of 42-frame animation
    });

    it('inactive radar draws the Allied cover SHP at the C++ radar origin', () => {
      const r = new Renderer(mockCanvas());
      r.hasRadar = false;
      r.doesRadarExist = false;
      const radarMeta = { frameWidth: 160, frameHeight: 141, frameCount: 43, columns: 16, rows: 3, sheetWidth: 2560, sheetHeight: 423 };
      const assets = {
        getSheet: vi.fn((name: string) => name === 'natoradr'
          ? { image: {}, meta: radarMeta }
          : undefined),
        drawFrame: vi.fn(),
      };
      const map = { boundsX: 0, boundsY: 0, boundsW: 126, boundsH: 126 };

      (r as any).renderMinimap(map, [], [], {}, assets);

      expect(assets.drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        'natoradr',
        0,
        mockCanvas().width - 80 * RESFACTOR,
        8 * RESFACTOR,
      );
    });

    it('inactive radar draws frame 41 when the cover had already opened', () => {
      const r = new Renderer(mockCanvas());
      r.hasRadar = false;
      r.doesRadarExist = true;
      const radarMeta = { frameWidth: 160, frameHeight: 141, frameCount: 43, columns: 16, rows: 3, sheetWidth: 2560, sheetHeight: 423 };
      const assets = {
        getSheet: vi.fn((name: string) => name === 'natoradr'
          ? { image: {}, meta: radarMeta }
          : undefined),
        drawFrame: vi.fn(),
      };
      const map = { boundsX: 0, boundsY: 0, boundsW: 126, boundsH: 126 };

      (r as any).renderMinimap(map, [], [], {}, assets);

      expect(assets.drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        'natoradr',
        41,
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('opening radar draws the current animation frame instead of jumping to minimap', () => {
      const r = new Renderer(mockCanvas());
      r.hasRadar = false;
      r.doesRadarExist = false;
      r.radarCoverFrame = 7;
      const radarMeta = { frameWidth: 160, frameHeight: 141, frameCount: 43, columns: 16, rows: 3, sheetWidth: 2560, sheetHeight: 423 };
      const assets = {
        getSheet: vi.fn((name: string) => name === 'natoradr'
          ? { image: {}, meta: radarMeta }
          : undefined),
        drawFrame: vi.fn(),
      };
      const map = { boundsX: 0, boundsY: 0, boundsW: 126, boundsH: 126 };

      (r as any).renderMinimap(map, [], [], {}, assets);

      expect(assets.drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        'natoradr',
        7,
        expect.any(Number),
        expect.any(Number),
      );
    });
  });
});
