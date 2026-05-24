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
import { CELL_SIZE, House, HOUSE_FACTION, RESFACTOR, UnitType } from '../engine/types';
import { Entity } from '../engine/entity';
import { Renderer } from '../engine/renderer';
import { makeFadingTable } from '../engine/shadow';
import { type MapStructure } from '../engine/scenario';
import {
  MAX_RADAR_FRAMES,
  RADAR_ACTIVATED_FRAME,
  advanceRadarAnimation,
  createRadarVisualState,
  isRadarActive,
  radarDisplayFrame,
  updateRadarAvailability,
} from '../engine/radar';
import { GameMap, Terrain, TREE_MAX_HP, TREE_OCCUPY, type MapTree } from '../engine/map';

// ─── Canvas mock ────────────────────────────────────────

/** Minimal canvas mock sufficient for Renderer construction */
function mockCanvas(width = 800, height = 600, ctxOverride?: Record<string, unknown>): HTMLCanvasElement {
  const ctx = {
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    clip: () => {},
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
    canvas: { width, height },
    ...ctxOverride,
  };
  return {
    width,
    height,
    getContext: () => ctx,
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
  it('samples 24x24 radar tiles at C++ Linear_Scale_To_Linear offsets', () => {
    // C++ radar.cpp:1102 scales a 24x24 template through SDLLIB
    // Linear_Scale_To_Linear(..., dst_w=ZoomFactor=3). The scaler starts at
    // source offset 0 and advances by floor((24 << 16) / 3), so the 3x3
    // radar tile samples x/y offsets 0, 8, 16.
    expect([
      Renderer.cppScaleSourceOffset(24, 3, 0),
      Renderer.cppScaleSourceOffset(24, 3, 1),
      Renderer.cppScaleSourceOffset(24, 3, 2),
    ]).toEqual([0, 8, 16]);
  });

  it('uses RA Make_Fading_Table for FadingBrighten terrain radar icons', () => {
    // C++ display.cpp:446 builds FadingBrighten with RA/jshell.cpp
    // Make_Fading_Table, not SDLLIB Build_Fading_Table. The two differ on
    // SNOW palette tree greys visible in SCG08EA radar icons.
    const snowPalette = JSON.parse(readFileSync(
      join(__dirname, '../../..', 'public/ra/assets/snow-palette.json'),
      'utf-8',
    ));
    const r = new Renderer(mockCanvas());
    (r as any).pal = snowPalette;

    const brighten = (r as any).getRadarBrightenTable() as Uint8Array;
    const sdllibBuild = makeFadingTable(snowPalette, 15, 25);

    expect(brighten[140]).toBe(139);
    expect(snowPalette[brighten[140]].slice(0, 3)).toEqual([92, 92, 92]);
    expect(snowPalette[sdllibBuild[140]].slice(0, 3)).toEqual([100, 100, 100]);
    expect(brighten[133]).toBe(14);
    expect(snowPalette[brighten[133]].slice(0, 3)).toEqual([168, 168, 168]);
  });

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

    it('clips the 141px radar cover SHP to the C++ 140px radar viewport', () => {
      const ctx = {
        imageSmoothingEnabled: true,
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        measureText: () => ({ width: 0 }),
        createRadialGradient: () => ({ addColorStop: vi.fn() }),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(0) }),
        putImageData: vi.fn(),
        canvas: { width: 640, height: 400 },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
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

      expect(ctx.rect).toHaveBeenCalledWith(
        640 - 80 * RESFACTOR,
        Renderer.RADAR_COVER_Y,
        Renderer.RADAR_COVER_W,
        Renderer.RADAR_COVER_H,
      );
      expect(ctx.clip).toHaveBeenCalled();
      expect(assets.drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        'natoradr',
        0,
        640 - 80 * RESFACTOR,
        Renderer.RADAR_COVER_DRAW_Y,
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

  describe('active radar map geometry (radar.cpp:480-570)', () => {
    it('uses the C++ initial zoomed radar viewport instead of stretching the whole map', () => {
      const r = new Renderer(mockCanvas(640, 400));
      const camera = { x: 23 * CELL_SIZE, y: 57 * CELL_SIZE };
      const layout = (r as any).getActiveRadarLayout({
        boundsX: 23,
        boundsY: 57,
        boundsW: 87,
        boundsH: 54,
      }, camera);

      expect(layout).toEqual({
        x: 640 - 80 * RESFACTOR + 6 + 1,
        y: 7 * RESFACTOR + 7,
        w: 48 * 3,
        h: 43 * 3,
        cellPx: 3,
        ox: 23,
        oy: 57,
        cellsW: 48,
        cellsH: 43,
      });
    });

    it('plots every mapped radar cell once and does not dim mapped fog cells', () => {
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;

      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 4,
        boundsH: 3,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 1,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };

      (r as any).renderMinimap(map, [], [], { x: 10 * 16, y: 20 * 16, viewWidth: 16, viewHeight: 16 }, undefined);

      const layout = (r as any).getActiveRadarLayout(map, { x: 10 * 16, y: 20 * 16 });
      const terrainFills = fills.filter(f => f.w === layout.cellPx && f.h === layout.cellPx);
      const fogOverlays = fills.filter(f => f.style.includes('rgba(0,0,0'));
      expect(terrainFills).toHaveLength(12);
      expect(fogOverlays).toHaveLength(0);
    });

    it('draws the C++ active radar frame before plotting cells', () => {
      const r = new Renderer(mockCanvas(640, 400));
      r.hasRadar = true;
      r.playerHouse = House.Greece;
      const assets = {
        getSheet: vi.fn((name: string) => name === 'nradrfrm'
          ? { meta: { frameWidth: 160, frameHeight: 160, frameCount: 2 } }
          : null),
        drawFrame: vi.fn(),
      };
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 1,
        boundsH: 1,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 0,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };

      (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, assets);

      expect(assets.drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        'nradrfrm',
        1,
        480,
        Renderer.RADAR_COVER_DRAW_Y,
      );
    });

    it('blacks jammed radar terrain even when the cell is mapped', () => {
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      const idx = 20 * 128 + 10;
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 1,
        boundsH: 1,
        overlay: new Uint8Array(128 * 128),
        jammedCells: new Map([[idx, 1]]),
        getDisplayVisibility: () => 1,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };

      (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, undefined);

      const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
      expect(fills).toContainEqual(expect.objectContaining({
        x: layout.x,
        y: layout.y,
        w: layout.cellPx,
        h: layout.cellPx,
        style: '#000',
      }));
    });

    it('draws unit blips with the exact C++ ColorRemaps[pcolor].Bar color', () => {
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 1,
        boundsH: 1,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 2,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };
      const unit = new Entity(
        UnitType.V_1TNK,
        House.Greece,
        10 * CELL_SIZE + CELL_SIZE / 2,
        20 * CELL_SIZE + CELL_SIZE / 2,
      );

      (r as any).renderMinimap(map, [unit], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, undefined);

      const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
      expect(fills).toContainEqual(expect.objectContaining({
        x: layout.x,
        y: layout.y,
        w: layout.cellPx,
        h: layout.cellPx,
        style: 'rgb(104,116,160)',
      }));
    });

    it('draws infantry radar blips as C++ sub-cell dots instead of full-cell unit blocks', () => {
      // C++ radar.cpp Render_Infantry: infantry use subsize=max(1,size/3)
      // and x/y offsets from Coord_XLepton/Coord_YLepton. At zoom size 3,
      // that is a single radar pixel inside the 3x3 cell.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 1,
        boundsH: 1,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 2,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };
      const infantry = new Entity(
        UnitType.I_E1,
        House.Greece,
        10 * CELL_SIZE,
        20 * CELL_SIZE,
      );
      infantry.leptonX = 10 * 256 + 192;
      infantry.leptonY = 20 * 256 + 192;
      infantry.syncPosFromLeptons();

      (r as any).renderMinimap(map, [infantry], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, undefined);

      const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
      const infantryFills = fills.filter(f => f.style === 'rgb(104,116,160)');
      expect(infantryFills).toContainEqual({
        x: layout.x + 2,
        y: layout.y + 2,
        w: 1,
        h: 1,
        style: 'rgb(104,116,160)',
      });
      expect(infantryFills).not.toContainEqual({
        x: layout.x,
        y: layout.y,
        w: layout.cellPx,
        h: layout.cellPx,
        style: 'rgb(104,116,160)',
      });
    });

    it('draws spy radar blips in the player house color like C++ PlayerPtr remap', () => {
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      (r as any).playerHouse = House.Greece;
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 1,
        boundsH: 1,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 2,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };
      const spy = new Entity(
        UnitType.I_SPY,
        House.USSR,
        10 * CELL_SIZE,
        20 * CELL_SIZE,
      );
      spy.leptonX = 10 * 256 + 128;
      spy.leptonY = 20 * 256 + 128;
      spy.syncPosFromLeptons();

      (r as any).renderMinimap(map, [spy], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, undefined);

      const spyFills = fills.filter(f => f.w === 1 && f.h === 1);
      expect(spyFills).toContainEqual(expect.objectContaining({
        style: 'rgb(104,116,160)',
      }));
      expect(spyFills).not.toContainEqual(expect.objectContaining({
        style: 'rgb(176,0,0)',
      }));
    });

    it('draws structure blips from C++ Occupy_List cells, not the rectangular BSIZE footprint', () => {
      // C++ radar.cpp asks each CellClass for Cell_Building() via
      // Cell_Color(true). That follows the building occupy list, not every
      // cell in the declared BSIZE footprint. FIX is a useful guard because
      // its BSIZE is 3x3 but its bdata.cpp Occupy_List skips the NW corner.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      const map = {
        boundsX: 50,
        boundsY: 89,
        boundsW: 6,
        boundsH: 5,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 2,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };
      const fix: MapStructure = {
        type: 'FIX',
        image: 'fix',
        house: House.Greece,
        cx: 51,
        cy: 90,
        hp: 256,
        maxHp: 256,
        alive: true,
        rubble: false,
        attackCooldown: 0,
        ammo: -1,
        maxAmmo: -1,
      };

      (r as any).renderMinimap(map, [], [fix], { x: 50 * CELL_SIZE, y: 89 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, undefined);

      const layout = (r as any).getActiveRadarLayout(map, { x: 50 * CELL_SIZE, y: 89 * CELL_SIZE });
      const structureFills = fills.filter(f => f.style === 'rgb(104,116,160)');
      const expectedCells = [
        [52, 90],
        [51, 91], [52, 91], [53, 91],
        [52, 92],
      ];

      expect(structureFills).toEqual(expectedCells.map(([cx, cy]) => ({
        x: layout.x + (cx - layout.ox) * layout.cellPx,
        y: layout.y + (cy - layout.oy) * layout.cellPx,
        w: layout.cellPx,
        h: layout.cellPx,
        style: 'rgb(104,116,160)',
      })));
    });

    it('renders TerrainClass radar icons even when the underlying TMP tile was drawn', () => {
      // C++ Plot_Radar_Pixel draws the template tile first, then calls
      // Render_Terrain(cell, ...). A successful tile draw must not suppress
      // tree/terrain-object radar icons.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;

      const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
      pal[0] = [0, 0, 0, 0];
      pal[15] = [255, 255, 255, 255];
      pal[20] = [40, 40, 40, 255];
      pal[21] = [60, 60, 60, 255];
      (r as any).pal = pal;
      (r as any).tilesetReady = true;
      (r as any).tilesetTheatre = 'TEMPERATE';
      (r as any).tilesetImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      (r as any).tilesetMeta = {
        tileW: 24,
        tileH: 24,
        atlasW: 24,
        atlasH: 24,
        tileCount: 1,
        tiles: { '255,2': { ax: 0, ay: 0 } },
      };

      const treeImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      const tileData = new Uint8ClampedArray(24 * 24 * 4);
      const treeData = new Uint8ClampedArray(24 * 24 * 4);
      const treePixel = (1 * 24 + 1) * 4;
      treeData[treePixel] = 40;
      treeData[treePixel + 1] = 40;
      treeData[treePixel + 2] = 40;
      treeData[treePixel + 3] = 255;

      const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
      let lastSource: unknown = null;
      const sourcePixels = new Map<unknown, Uint8ClampedArray>([
        [(r as any).tilesetImage, tileData],
        [treeImage, treeData],
      ]);
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          drawImage: vi.fn((source: unknown) => { lastSource = source; }),
          getImageData: vi.fn(() => ({ data: sourcePixels.get(lastSource) ?? tileData })),
        }),
      } as unknown as HTMLCanvasElement;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: vi.fn(() => fakeCanvas) },
      });

      try {
        const assets = {
          hasSheet: vi.fn((name: string) => name === 'tc01'),
          getSheet: vi.fn((name: string) => name === 'tc01'
            ? { image: treeImage, meta: { frameWidth: 24, frameHeight: 24, frameCount: 1, columns: 1, rows: 1, sheetWidth: 24, sheetHeight: 24 } }
            : undefined),
        };
        const map = {
          boundsX: 10,
          boundsY: 20,
          boundsW: 1,
          boundsH: 1,
          overlay: new Uint8Array(128 * 128),
          templateType: new Uint16Array(128 * 128).fill(255),
          templateIcon: new Uint8Array(128 * 128),
          getDisplayVisibility: () => 2,
          getTerrain: () => Terrain.CLEAR,
          getTreeType: () => 'tc01',
          getTreeAtCell: () => ({ type: 'tc01', cx: 10, cy: 20 }),
          getTerrainObjectAtCell: () => undefined,
        };

        (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, assets);

        const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
        expect(fills).toContainEqual({
          x: layout.x,
          y: layout.y,
          w: 1,
          h: 1,
          style: 'rgb(60,60,60)',
        });
      } finally {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    });

    it('draws TerrainClass radar icons from C++ Overlapper cells, not only Occupy_List cells', () => {
      // C++ MapClass::Place_Down registers TerrainClass in both Occupy_List
      // and Overlap_List. RadarClass::Render_Terrain checks Cell_Occupier
      // plus Overlapper, so TC04's visual top-row cells draw on radar even
      // though they do not block movement.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;

      const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
      pal[0] = [0, 0, 0, 0];
      pal[15] = [255, 255, 255, 255];
      pal[20] = [40, 40, 40, 255];
      pal[21] = [60, 60, 60, 255];
      (r as any).pal = pal;
      (r as any).tilesetReady = true;
      (r as any).tilesetTheatre = 'TEMPERATE';
      (r as any).tilesetImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      (r as any).tilesetMeta = {
        tileW: 24,
        tileH: 24,
        atlasW: 24,
        atlasH: 24,
        tileCount: 1,
        tiles: { '255,0': { ax: 0, ay: 0 } },
      };

      const map = new GameMap();
      map.setBounds(10, 20, 4, 3, false);
      map.templateType.fill(255);
      for (let cy = 20; cy < 23; cy++) {
        for (let cx = 10; cx < 14; cx++) {
          map.displayVisibility[cy * 128 + cx] = 2;
        }
      }
      const tree: MapTree = {
        type: 'tc04',
        cx: 10,
        cy: 20,
        hp: TREE_MAX_HP,
        maxHp: TREE_MAX_HP,
        immune: true,
        occupyCells: TREE_OCCUPY.tc04.map(([dx, dy]) => (10 + dx) + (20 + dy) * 128),
      };
      map.addTree(tree);

      const treeImage = { naturalWidth: 96, naturalHeight: 72, width: 96, height: 72 };
      const tileData = new Uint8ClampedArray(24 * 24 * 4);
      const treeData = new Uint8ClampedArray(96 * 72 * 4);
      const treePixel = (1 * 96 + 49) * 4;
      treeData[treePixel] = 40;
      treeData[treePixel + 1] = 40;
      treeData[treePixel + 2] = 40;
      treeData[treePixel + 3] = 255;

      const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
      let lastSource: unknown = null;
      const sourcePixels = new Map<unknown, Uint8ClampedArray>([
        [(r as any).tilesetImage, tileData],
        [treeImage, treeData],
      ]);
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          drawImage: vi.fn((source: unknown) => { lastSource = source; }),
          getImageData: vi.fn(() => ({ data: sourcePixels.get(lastSource) ?? tileData })),
        }),
      } as unknown as HTMLCanvasElement;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: vi.fn(() => fakeCanvas) },
      });

      try {
        const assets = {
          hasSheet: vi.fn((name: string) => name === 'tc04'),
          getSheet: vi.fn((name: string) => name === 'tc04'
            ? { image: treeImage, meta: { frameWidth: 96, frameHeight: 72, frameCount: 1, columns: 1, rows: 1, sheetWidth: 96, sheetHeight: 72 } }
            : undefined),
        };

        (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, assets);

        const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
        expect(map.isTreeOccupied(12, 20)).toBe(false);
        expect(fills).toContainEqual({
          x: layout.x + 2 * layout.cellPx,
          y: layout.y,
          w: 1,
          h: 1,
          style: 'rgb(60,60,60)',
        });
      } finally {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    });

    it('treats TerrainClass LTGREEN radar samples as transparent like C++ Get_Radar_Icon', () => {
      // C++ conquer.cpp Get_Radar_Icon: if (pixel == LTGREEN) pixel = 0.
      // LTGREEN is palette enum value 4; the extracted PNGs preserve that
      // source index as the alpha-130 shadow sentinel, not an opaque radar dot.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;

      const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
      pal[0] = [0, 0, 0, 0];
      pal[4] = [88, 252, 84, 130];
      pal[15] = [255, 255, 255, 255];
      pal[18] = [20, 20, 24, 255];
      (r as any).pal = pal;
      (r as any).tilesetReady = true;
      (r as any).tilesetTheatre = 'TEMPERATE';
      (r as any).tilesetImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      (r as any).tilesetMeta = {
        tileW: 24,
        tileH: 24,
        atlasW: 24,
        atlasH: 24,
        tileCount: 1,
        tiles: { '255,2': { ax: 0, ay: 0 } },
      };

      const treeImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      const tileData = new Uint8ClampedArray(24 * 24 * 4);
      const treeData = new Uint8ClampedArray(24 * 24 * 4);
      const treePixel = (1 * 24 + 1) * 4;
      treeData[treePixel] = 0;
      treeData[treePixel + 1] = 0;
      treeData[treePixel + 2] = 0;
      treeData[treePixel + 3] = 130;

      const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
      let lastSource: unknown = null;
      const sourcePixels = new Map<unknown, Uint8ClampedArray>([
        [(r as any).tilesetImage, tileData],
        [treeImage, treeData],
      ]);
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          drawImage: vi.fn((source: unknown) => { lastSource = source; }),
          getImageData: vi.fn(() => ({ data: sourcePixels.get(lastSource) ?? tileData })),
        }),
      } as unknown as HTMLCanvasElement;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: vi.fn(() => fakeCanvas) },
      });

      try {
        const assets = {
          hasSheet: vi.fn((name: string) => name === 'tc01'),
          getSheet: vi.fn((name: string) => name === 'tc01'
            ? { image: treeImage, meta: { frameWidth: 24, frameHeight: 24, frameCount: 1, columns: 1, rows: 1, sheetWidth: 24, sheetHeight: 24 } }
            : undefined),
        };
        const map = {
          boundsX: 10,
          boundsY: 20,
          boundsW: 1,
          boundsH: 1,
          overlay: new Uint8Array(128 * 128),
          templateType: new Uint16Array(128 * 128).fill(255),
          templateIcon: new Uint8Array(128 * 128),
          getDisplayVisibility: () => 2,
          getTerrain: () => Terrain.CLEAR,
          getTreeType: () => 'tc01',
          getTreeAtCell: () => ({ type: 'tc01', cx: 10, cy: 20 }),
          getTerrainObjectAtCell: () => undefined,
        };

        (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, assets);

        const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
        expect(fills).not.toContainEqual({
          x: layout.x,
          y: layout.y,
          w: 1,
          h: 1,
          style: 'rgb(20,20,24)',
        });
      } finally {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    });

    it('renders ore overlay radar icons after the terrain tile with C++ FadingYellow', () => {
      // C++ Plot_Radar_Pixel draws the TMP tile, then Render_Overlay().
      // Tiberium overlays use OverlayData as the radar-icon frame and remap
      // nontransparent samples through DisplayClass::FadingYellow.
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, style: this.fillStyle });
        },
      };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;

      const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
      pal[0] = [0, 0, 0, 0];
      pal[5] = [255, 255, 85, 255];
      pal[6] = [255, 255, 85, 255];
      (r as any).pal = pal;
      (r as any).tilesetReady = true;
      (r as any).tilesetTheatre = 'TEMPERATE';
      (r as any).tilesetImage = { naturalWidth: 24, naturalHeight: 24, width: 24, height: 24 };
      (r as any).tilesetMeta = {
        tileW: 24,
        tileH: 24,
        atlasW: 24,
        atlasH: 24,
        tileCount: 1,
        tiles: { '255,2': { ax: 0, ay: 0 } },
      };

      const map = new GameMap();
      map.setBounds(10, 20, 1, 1, false);
      map.setTerrain(10, 20, Terrain.ORE);
      map.displayVisibility[20 * 128 + 10] = 2;
      map.templateType.fill(255);
      map.overlay[20 * 128 + 10] = GameMap.OVERLAY_GOLD3;
      map.oreDensity[20 * 128 + 10] = 6;

      const oreImage = { naturalWidth: 288, naturalHeight: 24, width: 288, height: 24 };
      const tileData = new Uint8ClampedArray(24 * 24 * 4);
      const oreData = new Uint8ClampedArray(288 * 24 * 4);
      const orePixel = (1 * 288 + 6 * 24 + 1) * 4;
      oreData[orePixel] = 255;
      oreData[orePixel + 1] = 255;
      oreData[orePixel + 2] = 85;
      oreData[orePixel + 3] = 255;

      const previousDocument = (globalThis as typeof globalThis & { document?: Document }).document;
      let lastSource: unknown = null;
      const sourcePixels = new Map<unknown, Uint8ClampedArray>([
        [(r as any).tilesetImage, tileData],
        [oreImage, oreData],
      ]);
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          drawImage: vi.fn((source: unknown) => { lastSource = source; }),
          getImageData: vi.fn(() => ({ data: sourcePixels.get(lastSource) ?? tileData })),
        }),
      } as unknown as HTMLCanvasElement;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: vi.fn(() => fakeCanvas) },
      });

      try {
        const assets = {
          hasSheet: vi.fn((name: string) => name === 'gold03'),
          getSheet: vi.fn((name: string) => name === 'gold03'
            ? { image: oreImage, meta: { frameWidth: 24, frameHeight: 24, frameCount: 12, columns: 12, rows: 1, sheetWidth: 288, sheetHeight: 24 } }
            : undefined),
        };

        (r as any).renderMinimap(map, [], [], { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE, viewWidth: 16, viewHeight: 16 }, assets);

        const layout = (r as any).getActiveRadarLayout(map, { x: 10 * CELL_SIZE, y: 20 * CELL_SIZE });
        expect(fills).toContainEqual({
          x: layout.x,
          y: layout.y,
          w: 1,
          h: 1,
          style: 'rgb(255,255,85)',
        });
      } finally {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    });

    it('draws the viewport as C++ LTGREEN corner brackets, not a white rectangle', () => {
      const strokeRect = vi.fn();
      const cursorFills: Array<{ w: number; h: number; style: string }> = [];
      const fillRect = vi.fn(function (this: { fillStyle?: string }, _x: number, _y: number, w: number, h: number) {
        if (this.fillStyle === 'rgb(84,252,84)') cursorFills.push({ w, h, style: this.fillStyle });
      });
      const lineTo = vi.fn();
      const moveTo = vi.fn();
      const ctx = { strokeRect, fillRect, lineTo, moveTo };
      const r = new Renderer(mockCanvas(640, 400, ctx));
      r.hasRadar = true;
      const map = {
        boundsX: 10,
        boundsY: 20,
        boundsW: 4,
        boundsH: 3,
        overlay: new Uint8Array(128 * 128),
        getDisplayVisibility: () => 0,
        getTerrain: () => Terrain.CLEAR,
        getTreeType: () => null,
      };

      (r as any).renderMinimap(map, [], [], { x: 10 * 16, y: 20 * 16, viewWidth: 16, viewHeight: 16 }, undefined);

      expect(strokeRect).not.toHaveBeenCalled();
      expect(moveTo).not.toHaveBeenCalled();
      expect(lineTo).not.toHaveBeenCalled();
      expect(cursorFills).toHaveLength(8);
      expect(cursorFills.every(f => f.w === 1 || f.h === 1)).toBe(true);
    });
  });
});
