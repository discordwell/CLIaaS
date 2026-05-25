/**
 * C++ visual parity: sidebar cameos already contain their label art.
 *
 * The original sidebar does not draw custom TS credit strips, power numbers, or
 * cost text over idle production cameos. Those overlays create visible jukes.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Renderer } from '../engine/renderer';
import { Game } from '../engine';
import { getAvailableItems, type ProductionContext } from '../engine/production';
import { PRODUCTION_ITEMS, RESFACTOR, UNIT_STATS, House, SuperweaponType } from '../engine/types';

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 400,
    style: {},
    getBoundingClientRect: () => ({ width: 640, height: 400, left: 0, top: 0, right: 640, bottom: 400 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getContext: () => ({
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      filter: 'none',
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
    }),
  } as unknown as HTMLCanvasElement;
}

describe('sidebar production visuals', () => {
  it('orders allied infantry cameos by C++ InfantryType order', () => {
    const ctx: ProductionContext = {
      structures: [],
      entities: [],
      entityById: new Map(),
      credits: 10000,
      playerHouse: House.Greece,
      playerFaction: 'allied',
      playerTechLevel: 8,
      scenarioProductionItems: PRODUCTION_ITEMS,
      productionQueue: new Map(),
      pendingPlacement: null,
      wallPlacementPrepaid: false,
      map: {} as ProductionContext['map'],
      tick: 0,
      powerProduced: 100,
      powerConsumed: 0,
      builtUnitTypes: new Set(),
      builtInfantryTypes: new Set(),
      builtAircraftTypes: new Set(),
      rallyPoints: new Map(),
      isAllied: (a, b) => a === b,
      hasBuilding: type => type === 'TENT' || type === 'DOME',
      playSound: vi.fn(),
      playEva: vi.fn(),
      addEntity: vi.fn(),
      findPassableSpawn: () => ({ cx: 0, cy: 0 }),
    };

    const infantryTypes = getAvailableItems(ctx)
      .filter(item => UNIT_STATS[item.type]?.isInfantry)
      .map(item => item.type);

    // C++ RA/defines.h InfantryType and idata.cpp order:
    // E1, E2, E3, E4, E6, E7, SPY, THF, MEDI, GENERAL, DOG.
    // With SCG08-like tech/prereqs, E7/THF are hidden but SPY still precedes MEDI.
    expect(infantryTypes).toEqual(['E1', 'E3', 'E6', 'SPY', 'MEDI']);
  });

  it('does not commit pre-Logic buildables before airstrip specials can be added', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    try {
      const game = new Game(mockCanvas());
      const mig = PRODUCTION_ITEMS.find(item => item.type === 'MIG');
      const yak = PRODUCTION_ITEMS.find(item => item.type === 'YAK');
      expect(mig).toBeTruthy();
      expect(yak).toBeTruthy();

      (game as any).tick = 0;
      (game as any).playerHouse = House.USSR;
      (game as any).alliances = new Map([[House.USSR, new Set([House.USSR])]]);
      (game as any).cachedAvailableItems = [mig, yak];
      (game as any).sidebarItems = [];
      (game as any).superweapons = new Map();

      const preLogic = (game as any).getSidebarItems().map((item: { type: string }) => item.type);
      expect(preLogic).toEqual(['MIG', 'YAK']);
      expect((game as any).sidebarItems).toEqual([]);

      (game as any).superweapons.set(`${House.USSR}:${SuperweaponType.SPY_PLANE}`, {
        type: SuperweaponType.SPY_PLANE,
        house: House.USSR,
        chargeTick: 0,
        ready: false,
        structureIndex: 0,
        fired: false,
      });

      const firstLogic = (game as any).getSidebarItems().map((item: { type: string }) => item.type);
      expect(firstLogic).toEqual([`SPECIAL:${SuperweaponType.SPY_PLANE}`, 'MIG', 'YAK']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('applies the C++ MIG/YAK airfield-cap sidebar hack', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    try {
      const game = new Game(mockCanvas());
      const mig = PRODUCTION_ITEMS.find(item => item.type === 'MIG');
      expect(mig).toBeTruthy();

      (game as any).playerHouse = House.USSR;
      (game as any).structures = [
        { type: 'AFLD', house: House.USSR, alive: true, cx: 10, cy: 10, hp: 400, maxHp: 400 },
        { type: 'AFLD', house: House.USSR, alive: true, cx: 14, cy: 10, hp: 400, maxHp: 400 },
      ];
      (game as any).entities = [
        { type: 'MIG', house: House.USSR, alive: true },
        { type: 'YAK', house: House.USSR, alive: true },
      ];
      (game as any).productionQueue = new Map();

      expect([...(game as any).getSidebarHackPreventedTypes()].sort()).toEqual(['MIG', 'YAK']);

      (game as any).productionQueue.set('aircraft', { item: mig, progress: 1, queueCount: 1 });
      expect([...(game as any).getSidebarHackPreventedTypes()]).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draws the zero-state power frame but not the overwritten drain marker', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarPowerProduced = 0;
    renderer.sidebarPowerConsumed = 0;

    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') {
          return { meta: { frameWidth: 20, frameHeight: 112, frameCount: 2 } };
        }
        if (name === 'power_marker') {
          return { meta: { frameWidth: 18, frameHeight: 12, frameCount: 1 } };
        }
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderSidebar(assets);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'powerbar',
      0,
      640 - 80 * RESFACTOR,
      88 * RESFACTOR,
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'powerbar',
      1,
      640 - 80 * RESFACTOR,
      88 * RESFACTOR + 112,
    );
    expect(drawFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      'power_marker',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('does not draw TS-only bevel strokes over the C++ sidebar sprites', () => {
    const ctx = {
      imageSmoothingEnabled: false,
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
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: vi.fn(),
      canvas: { width: 640, height: 400 },
    };
    const canvas = {
      width: 640,
      height: 400,
      style: {},
      getBoundingClientRect: () => ({ width: 640, height: 400, left: 0, top: 0, right: 640, bottom: 400 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na'].includes(name)) {
          return { meta: { frameWidth: 80, frameHeight: 80, frameCount: 42 } };
        }
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderSidebar(assets);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side1na',
      0,
      640 - 80 * RESFACTOR,
      Renderer.SIDEBAR_BG_TOP_Y,
      expect.anything(),
    );
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('uses C++ raw-bottom marker math when a zero-power overlay is explicitly redrawn', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarPowerProduced = 0;
    renderer.sidebarPowerConsumed = 0;
    (renderer as any).powerFlashTimer = 1;

    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') return { meta: { frameWidth: 40, frameHeight: 56, frameCount: 2 } };
        if (name === 'power_marker') return { meta: { frameWidth: 18, frameHeight: 12, frameCount: 1 } };
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderVerticalPowerBar(assets, 640 - 80 * RESFACTOR, false);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'power_marker',
      0,
      640 - 80 * RESFACTOR + RESFACTOR,
      Renderer.POWER_RAW_BOTTOM - 2 * RESFACTOR + Renderer.POWER_MARKER_Y_OFFSET,
    );
  });

  it('switches marker math to the rescaled fill bottom only after power height is nonzero', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarPowerProduced = 100;
    renderer.sidebarPowerConsumed = 50;
    (renderer as any).powerHeight = 10;
    (renderer as any).desiredPowerHeight = 10;
    (renderer as any).powerBounce = 0;
    (renderer as any).drainHeight = 10;
    (renderer as any).desiredDrainHeight = 10;
    (renderer as any).drainBounce = 0;

    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') return { meta: { frameWidth: 40, frameHeight: 56, frameCount: 2 } };
        if (name === 'power_marker') return { meta: { frameWidth: 18, frameHeight: 12, frameCount: 1 } };
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderVerticalPowerBar(assets, 640 - 80 * RESFACTOR, false);

    const scaledDrainHeight = RESFACTOR === 1 ? 10 : Math.floor(10 * 153 / 107);
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'power_marker',
      0,
      640 - 80 * RESFACTOR + Renderer.POWER_MARKER_X_OFFSET,
      Renderer.POWER_FILL_BOTTOM - (scaledDrainHeight + 2 * RESFACTOR) + Renderer.POWER_MARKER_Y_OFFSET,
    );
  });

  it('fills the power bar through the C++ inclusive bottom pixel', () => {
    const ctx = {
      imageSmoothingEnabled: false,
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    renderer.sidebarPowerProduced = 100;
    renderer.sidebarPowerConsumed = 0;
    (renderer as any).powerHeight = 10;
    (renderer as any).desiredPowerHeight = 10;
    (renderer as any).powerBounce = 0;
    (renderer as any).drainHeight = 0;
    (renderer as any).desiredDrainHeight = 0;
    (renderer as any).drainBounce = 0;

    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') return { meta: { frameWidth: 40, frameHeight: 56, frameCount: 2 } };
        if (name === 'power_marker') return { meta: { frameWidth: 18, frameHeight: 12, frameCount: 1 } };
        return null;
      },
      drawFrame: vi.fn(),
    };

    (renderer as any).renderVerticalPowerBar(assets, 640 - 80 * RESFACTOR, false);

    const scaledHeight = RESFACTOR === 1 ? 10 : Math.floor(10 * 153 / 107);
    expect(ctx.fillRect).toHaveBeenCalledWith(
      640 - 80 * RESFACTOR + Renderer.POWER_FILL_X_OFFSET,
      Renderer.POWER_FILL_BOTTOM - scaledHeight,
      2,
      scaledHeight + 1,
    );
    expect(ctx.fillRect).toHaveBeenCalledWith(
      640 - 80 * RESFACTOR + Renderer.POWER_FILL_X_OFFSET + 2,
      Renderer.POWER_FILL_BOTTOM - scaledHeight,
      2,
      scaledHeight + 1,
    );
  });

  it('draws the full POWERBAR shape and leaves occlusion to sidebar redraw order', () => {
    const ctx = {
      imageSmoothingEnabled: false,
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    };
    const canvas = {
      width: 640,
      height: 400,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') return { meta: { frameWidth: 20, frameHeight: 112, frameCount: 2 } };
        if (name === 'power_marker') return null;
        return null;
      },
      drawFrame: vi.fn(),
    };

    (renderer as any).renderVerticalPowerBar(assets, 640 - 80 * RESFACTOR, false);

    expect(ctx.clip).not.toHaveBeenCalled();
    expect(assets.drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'powerbar',
      0,
      640 - 80 * RESFACTOR,
      Renderer.POWER_Y,
    );
    expect(assets.drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'powerbar',
      1,
      640 - 80 * RESFACTOR,
      Renderer.POWER_Y + 112,
    );
  });

  it('draws power chrome before sidebar chunks so SIDE art can occlude its edge', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.playerFaction = 'soviet';
    renderer.sidebarPowerProduced = 100;
    (renderer as any).powerHeight = 1;
    const order: string[] = [];
    const assets = {
      getSheet: (name: string) => {
        if (name === 'powerbar') return { meta: { frameWidth: 20, frameHeight: 112, frameCount: 2 } };
        if (['side1us', 'side2us', 'side3us'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame: vi.fn((_ctx, name: string) => order.push(name)),
    };

    (renderer as any).renderSidebar(assets);

    expect(order.slice(0, 5)).toEqual([
      'powerbar',
      'powerbar',
      'side1us',
      'side2us',
      'side3us',
    ]);
  });

  it('uses update-frame sidebar chunks for ordinary sidebar chrome redraws', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.playerFaction = 'soviet';
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (['side1us', 'side2us', 'side3us'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame,
    };

    renderer.sidebarItems = [];
    renderer.syncSidebarChromeItems();
    renderer.advanceSidebarChromeCache();
    drawFrame.mockClear();

    renderer.sidebarItems = [{ type: 'PROC' } as any];
    renderer.syncSidebarChromeItems();
    renderer.advanceSidebarChromeCache();
    (renderer as any).renderSidebar(assets);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side1us',
      0,
      expect.any(Number),
      Renderer.SIDEBAR_BG_TOP_Y,
      expect.anything(),
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side2us',
      1,
      expect.any(Number),
      Renderer.SIDEBAR_BG_MID_Y,
      expect.anything(),
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side3us',
      1,
      expect.any(Number),
      Renderer.SIDEBAR_BG_BOT_Y,
      expect.anything(),
    );
  });

  it('uses complete-frame sidebar chunks for full tactical redraws', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.playerFaction = 'soviet';
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (['side1us', 'side2us', 'side3us'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame,
    };

    renderer.sidebarItems = [];
    renderer.syncSidebarChromeItems();
    renderer.advanceSidebarChromeCache();
    renderer.sidebarItems = [{ type: 'PROC' } as any];
    renderer.syncSidebarChromeItems();
    renderer.advanceSidebarChromeCache();
    drawFrame.mockClear();

    renderer.markSidebarChromeDirty(true);
    renderer.advanceSidebarChromeCache();
    (renderer as any).renderSidebar(assets);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side2us',
      0,
      expect.any(Number),
      Renderer.SIDEBAR_BG_MID_Y,
      expect.anything(),
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side3us',
      0,
      expect.any(Number),
      Renderer.SIDEBAR_BG_BOT_Y,
      expect.anything(),
    );
  });

  it('does not redraw active power chrome after the sidebar buttons', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarPowerProduced = 100;
    (renderer as any).powerHeight = 1;
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderSidebar = vi.fn(() => order.push('sidebar'));
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 100);

    // C++ SidebarClass::Draw_It calls PowerClass::Draw_It first, then draws
    // SIDE1/SIDE2/SIDE3 over it. A final full power redraw would overpaint the
    // sidebar art's right edge.
    expect(order).toEqual(['sidebar', 'radar', 'buttons']);
  });

  it('redraws power after sidebar when PowerClass is dirty and sidebar chrome is clean', () => {
    const renderer = new Renderer(mockCanvas());
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame: vi.fn(),
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 0);
    order.length = 0;

    renderer.sidebarPowerProduced = 100;
    renderer.updatePowerAnimation();
    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 1);

    expect(order).toEqual(['power', 'radar', 'buttons', 'power']);
  });

  it('preserves power-over-sidebar chrome across clean redraws', () => {
    const renderer = new Renderer(mockCanvas());
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame: vi.fn(),
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 0);
    renderer.sidebarPowerProduced = 100;
    renderer.updatePowerAnimation();
    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 1);
    order.length = 0;

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 2);

    expect(order).toEqual(['power', 'radar', 'buttons', 'power']);
  });

  it('advances cached chrome state on skipped batch render ticks', () => {
    const renderer = new Renderer(mockCanvas());
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame: vi.fn(),
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 0);

    renderer.sidebarPowerProduced = 100;
    renderer.updatePowerAnimation();
    renderer.advanceSidebarChromeCache();

    renderer.sidebarItems = [{ type: 'PROC' } as any];
    renderer.syncSidebarChromeItems();
    renderer.updatePowerAnimation();
    renderer.advanceSidebarChromeCache();

    renderer.updatePowerAnimation();
    renderer.advanceSidebarChromeCache();
    order.length = 0;

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 4);

    expect(order).toEqual(['power', 'radar', 'buttons', 'power']);
  });

  it('lets dirty sidebar chrome cover the power edge even when power is also dirty', () => {
    const renderer = new Renderer(mockCanvas());
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na'].includes(name)) {
          return { meta: { frameWidth: 160, frameHeight: 100, frameCount: 2 } };
        }
        return null;
      },
      drawFrame: vi.fn(),
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 0);
    order.length = 0;

    renderer.sidebarPowerProduced = 100;
    renderer.updatePowerAnimation();
    renderer.sidebarItems = [{ type: 'PROC' } as any];
    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 1);

    expect(order).toEqual(['power', 'radar', 'buttons']);
  });

  it('does not redraw inert zero-power chrome after the sidebar buttons', () => {
    const renderer = new Renderer(mockCanvas());
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderSidebar = vi.fn(() => order.push('sidebar'));
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 100);

    expect(order).toEqual(['sidebar', 'radar', 'buttons']);
  });

  it('does not redraw drain-only startup chrome after the sidebar buttons', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarPowerProduced = 0;
    renderer.sidebarPowerConsumed = 1000;
    (renderer as any).drainHeight = 1;
    (renderer as any).desiredDrainHeight = 95;
    const order: string[] = [];
    for (const method of [
      'renderTerrain',
      'renderDecals',
      'renderOverlays',
      'renderGroundLayer',
      'renderStructures',
      'renderCrates',
      'renderCorpses',
      'renderEntities',
      'renderTargetLines',
      'renderWaypoints',
      'renderEffects',
      'renderFogOfWar',
      'renderPlacementGhost',
      'renderSelectionBox',
      'renderAttackMoveIndicator',
      'renderModeLabel',
      'renderOffscreenIndicators',
      'renderFullscreenRadar',
      'renderHelpOverlay',
      'renderCursor',
    ]) {
      (renderer as any)[method] = vi.fn();
    }
    (renderer as any).renderSidebar = vi.fn(() => order.push('sidebar'));
    (renderer as any).renderMinimap = vi.fn(() => order.push('radar'));
    (renderer as any).renderSidebarButtonRow = vi.fn(() => order.push('buttons'));
    (renderer as any).renderVerticalPowerBar = vi.fn(() => order.push('power'));

    const assets = {
      getTheatrePalette: () => [[0, 0, 0]],
      hasTileset: () => false,
    };

    renderer.render({} as any, {} as any, [], [], assets as any, {} as any, new Set(), [], 100);

    expect(order).toEqual(['sidebar', 'radar', 'buttons']);
  });

  it('draws strip scroll buttons even when a production strip has no buildable items', () => {
    const renderer = new Renderer(mockCanvas());
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (name === 'stripup' || name === 'stripdn') {
          return { meta: { frameWidth: 32, frameHeight: 27, frameCount: 2 } };
        }
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderStripScrollArrows(
      (renderer as any).ctx,
      assets,
      640 - 80 * RESFACTOR + 8 * RESFACTOR,
      [],
      0,
    );

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'stripup',
      0,
      640 - 80 * RESFACTOR + 8 * RESFACTOR + 2 * RESFACTOR,
      90 * RESFACTOR + 97 * RESFACTOR - 1,
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'stripdn',
      0,
      640 - 80 * RESFACTOR + 8 * RESFACTOR + 18 * RESFACTOR,
      90 * RESFACTOR + 97 * RESFACTOR - 1,
    );
  });

  it('draws C++ strip backgrounds inset by LEFT_EDGE_OFFSET when a column is not full', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.playerFaction = 'allied';
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => name === 'stripna'
        ? { meta: { frameWidth: 64, frameHeight: 192, frameCount: 2 } }
        : null,
      drawFrame,
    };
    const stripX = 640 - 80 * RESFACTOR + 43 * RESFACTOR;
    const startY = 90 * RESFACTOR;

    (renderer as any).renderStrip(
      (renderer as any).ctx,
      assets,
      stripX,
      startY,
      [],
      0,
      false,
      'right',
    );

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'stripna',
      1,
      stripX + 2 * RESFACTOR,
      startY,
    );
  });

  it('draws production cameos at C++ Column.X plus LEFT_EDGE_OFFSET', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarCredits = 10000;
    const image = {};
    const assets = {
      getSheet: (name: string) => name === 'e1icon'
        ? { image, meta: { frameWidth: 64, frameHeight: 48, frameCount: 1 } }
        : null,
      drawFrame: vi.fn(),
    };
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E1')!;
    const stripX = 640 - 80 * RESFACTOR + 43 * RESFACTOR;
    const startY = 90 * RESFACTOR;

    (renderer as any).renderStrip(
      (renderer as any).ctx,
      assets,
      stripX,
      startY,
      [item],
      0,
      false,
      'right',
    );

    expect((renderer as any).ctx.drawImage).toHaveBeenCalledWith(
      image,
      0,
      0,
      64,
      48,
      stripX + 2 * RESFACTOR,
      startY,
      32 * RESFACTOR,
      24 * RESFACTOR,
    );
  });

  it('does not darken idle cameos only because current cash is below item cost', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.sidebarCredits = 0;
    const image = {};
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (name === 'e6icon') return { image, meta: { frameWidth: 64, frameHeight: 48, frameCount: 1 } };
        if (name === 'clock') return { image: {}, meta: { frameWidth: 64, frameHeight: 48, frameCount: 55, columns: 16, rows: 4 } };
        return null;
      },
      drawFrame,
    };
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E6')!;

    (renderer as any).renderStrip(
      (renderer as any).ctx,
      assets,
      640 - 80 * RESFACTOR + 43 * RESFACTOR,
      90 * RESFACTOR,
      [item],
      0,
      false,
      'right',
    );

    expect(drawFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      'clock',
      0,
      expect.any(Number),
      expect.any(Number),
      expect.anything(),
    );
  });

  it('does not draw TS cost text over idle cameos', () => {
    const renderer = new Renderer(mockCanvas());
    const drawBitmapText = vi.fn();
    (renderer as any).drawBitmapText = drawBitmapText;
    renderer.sidebarCredits = 10000;

    const assets = {
      getSheet: () => null,
      drawFrame: vi.fn(),
    };
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E1')!;

    (renderer as any).renderStrip(
      (renderer as any).ctx,
      assets,
      0,
      0,
      [item],
      0,
      false,
      'left',
    );

    expect(drawBitmapText).not.toHaveBeenCalledWith(
      expect.anything(),
      '$100',
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });

  it('does not render a TS-only idle unit count over the radar panel', () => {
    const rendererSrc = readFileSync(
      join(__dirname, '../engine/renderer.ts'),
      'utf-8',
    );

    expect(rendererSrc).not.toContain('Idle:');
    expect(rendererSrc).not.toContain('renderIdleCount');
  });

  it('uses PlayerPtr faction for sidebar art, not mixed allied/player houses', () => {
    const renderer = new Renderer(mockCanvas());
    renderer.playerFaction = 'allied';
    renderer.playerHouses = new Set([House.Greece, House.BadGuy]);
    const drawFrame = vi.fn();
    const assets = {
      getSheet: (name: string) => {
        if (['side1na', 'side2na', 'side3na', 'natoradr'].includes(name)) {
          return name === 'natoradr'
            ? { meta: { frameWidth: 160, frameHeight: 141, frameCount: 43 } }
            : { meta: { frameWidth: 80, frameHeight: 80, frameCount: 42 } };
        }
        if (['side1us', 'side2us', 'side3us', 'ussrradr'].includes(name)) {
          return name === 'ussrradr'
            ? { meta: { frameWidth: 160, frameHeight: 141, frameCount: 43 } }
            : { meta: { frameWidth: 80, frameHeight: 80, frameCount: 42 } };
        }
        return null;
      },
      drawFrame,
    };

    (renderer as any).renderSidebar(assets);
    (renderer as any).drawRadarCoverPlate((renderer as any).ctx, 0, 0, 0, assets);

    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'side1na',
      0,
      expect.any(Number),
      expect.any(Number),
      expect.anything(),
    );
    expect(drawFrame).toHaveBeenCalledWith(
      expect.anything(),
      'natoradr',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(drawFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      'side1us',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.anything(),
    );
    expect(drawFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      'ussrradr',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('does not unlock PlayerPtr production from allied non-PlayerPtr factories', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    const game = new Game(mockCanvas());
    game.playerHouse = House.Greece;
    game.playerFaction = 'allied';
    (game as any).alliances = new Map([
      [House.Greece, new Set([House.Greece, House.Turkey])],
      [House.Turkey, new Set([House.Turkey, House.Greece])],
    ]);
    game.structures = [{
      type: 'FACT',
      house: House.Turkey,
      alive: true,
      cx: 31,
      cy: 31,
      hp: 400,
      maxHp: 400,
    } as any];

    expect(game.getAvailableItems().map(item => item.type)).not.toContain('POWR');

    game.structures.push({
      type: 'FACT',
      house: House.Greece,
      alive: true,
      cx: 35,
      cy: 31,
      hp: 400,
      maxHp: 400,
    } as any);

    expect(game.getAvailableItems().map(item => item.type)).toContain('POWR');
    vi.unstubAllGlobals();
  });

  it('initial scenario look skips buildings unless unit sight maps their footprint', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    try {
      const game = new Game(mockCanvas());
      game.playerHouse = House.Greece;
      (game as any).structures = [
        { type: 'TENT', house: House.Greece, alive: true, cx: 11, cy: 10, hp: 400, maxHp: 400 },
        { type: 'DOME', house: House.Greece, alive: true, cx: 40, cy: 40, hp: 400, maxHp: 400 },
      ];
      (game as any).entities = [{
        alive: true,
        inLimbo: false,
        house: House.Greece,
        cell: { cx: 10, cy: 10 },
        stats: { sight: 1 },
      }];

      (game as any).applyScenarioInitLook();

      // C++ scenario.cpp:646 calls Map.All_To_Look(true); display.cpp:4450
      // skips buildings in that initial pass.
      expect(game.map.getDisplayVisibility(40, 40)).toBe(0);
      // But if unit sight maps a PlayerPtr building footprint, TechnoClass::Revealed
      // calls Look(), so that building can cascade its own sight.
      expect(game.map.getDisplayVisibility(16, 10)).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('building Look uses TechnoClass::Coord, not BuildingClass::Center_Coord', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    try {
      const game = new Game(mockCanvas());
      game.map.setBounds(1, 1, 62, 62);

      (game as any).revealStructureSightForPlayer({
        type: 'APWR',
        house: House.Greece,
        alive: true,
        cx: 10,
        cy: 10,
        hp: 700,
        maxHp: 700,
      });

      // TechnoClass::Look() calls Coord_Cell(Coord). BuildingClass::Center_Coord()
      // is used for targeting/docking, but not for ordinary sight.
      expect((game as any).isCellMappedForPlayer(10, 6)).toBe(true);
      expect((game as any).isCellMappedForPlayer(15, 11)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('runs PlayerPtr HouseClass::IsToLook once and cascades newly revealed own buildings', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    try {
      const game = new Game(mockCanvas());
      game.playerHouse = House.Greece;
      game.map.setBounds(1, 1, 62, 62);
      game.structures = [
        { type: 'DOME', house: House.Greece, alive: true, cx: 10, cy: 10, hp: 1000, maxHp: 1000 },
        { type: 'APWR', house: House.Greece, alive: true, cx: 19, cy: 10, hp: 700, maxHp: 700 },
      ] as any;
      (game as any).playerDiscoveredStructureIds.add(0);

      expect((game as any).isCellMappedForPlayer(23, 10)).toBe(false);

      (game as any).runPlayerHouseAllToLook();

      // C++ house.cpp:1380 calls Map.All_To_Look() on PlayerPtr's first
      // HouseClass::AI frame. DisplayClass::Map_Cell reveals the APWR, and
      // TechnoClass::Revealed immediately calls its own Look().
      expect((game as any).playerDiscoveredStructureIds.has(1)).toBe(true);
      expect((game as any).isCellMappedForPlayer(23, 10)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('per-tick fog does not reveal moving units between C++ Look call sites', () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('Audio', class {
      src = '';
      preload = '';
      addEventListener = vi.fn();
    });
    try {
      const game = new Game(mockCanvas());
      game.playerHouse = House.Greece;
      game.map.setBounds(1, 1, 62, 62);
      const unit = {
        id: 1,
        alive: true,
        inLimbo: false,
        house: House.Greece,
        isAirUnit: false,
        isDriving: true,
        pos: { x: 40 * 24 + 12, y: 40 * 24 + 12 },
        cell: { cx: 40, cy: 40 },
        stats: { sight: 1 },
      } as any;
      game.entities = [unit];

      (game as any).updateFogOfWar();

      // C++ does not rebuild fog from every object every frame. A moving unit
      // reveals when TechnoClass::Look() runs from the cell-boundary PCP path,
      // not merely because its current interpolated position is on the map.
      expect(game.map.getDisplayVisibility(40, 40)).toBe(0);

      (game as any).runMobileLookForPlayer(unit);

      expect(game.map.getDisplayVisibility(40, 40)).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
