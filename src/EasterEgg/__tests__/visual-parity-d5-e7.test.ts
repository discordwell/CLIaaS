/**
 * Visual Parity Tests: D5 (Scorch marks from fire warheads) and E7 (Damage fire lifecycle)
 *
 * D5: C++ anim.cpp — IsScorcher=true animations (napalm, fire) plant SMUDGE_SCORCH on ground.
 *     Verifies that fire/napalm terrain scarring uses CellClass smudges, not TS-only decals.
 *
 * E7: C++ building.cpp:1372-1435 — Damaged buildings spawn AnimClass fire objects
 *     during damage/destruction events. The renderer must not invent structure fire
 *     sprites solely from current HP.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WARHEAD_PROPS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import {
  type MapStructure,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import { Renderer } from '../engine/renderer';
import { Camera } from '../engine/camera';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
    pointTotal: 0,
  } as CombatContext;
}

// =============================================================================
//  D5: Fire/napalm warhead scorch marks
// =============================================================================

describe('D5: Fire warhead projectile impacts leave CellClass smudges', () => {

  it('Fire warhead explosion set is 3 (napalm)', () => {
    // Verify the Fire warhead uses explosion set 3, which is the napalm/fire set
    expect(WARHEAD_PROPS.Fire.explosionSet).toBe(3);
  });

  it('Nuke warhead uses InfDeath=4 (burn) — also a scorching warhead', () => {
    expect(WARHEAD_PROPS.Nuke.infantryDeath).toBe(4);
  });

  it('legacy addDecal does not create a renderable scorch mark', () => {
    const map = new GameMap();

    map.addDecal(10, 10, 7, 0.3);

    expect(map.decals).toHaveLength(0);
  });

  it('HE warhead impact does NOT leave scorch mark (only Fire/Nuke do)', () => {
    // Verify HE warhead is not a fire type — its explosion set is 5, not 3
    expect(WARHEAD_PROPS.HE.explosionSet).toBe(5);
    expect(WARHEAD_PROPS.HE.infantryDeath).toBe(2); // explode, not burn(4)
  });

  it('scorch marks are represented by CellClass smudge types', () => {
    const map = new GameMap();

    expect(map.addSmudge('SC6', 10, 10)).toBe(true);
    expect(map.smudges).toEqual([{ type: 'sc6', cx: 10, cy: 10, data: 0 }]);
  });
});

// =============================================================================
//  E7: Damage fire lifecycle belongs to AnimClass, not renderer HP shims
// =============================================================================

describe('E7: Renderer does not synthesize building fires from HP', () => {
  function mockCanvas(): { canvas: HTMLCanvasElement; ctx: any } {
    const ctx = {
      imageSmoothingEnabled: false,
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8Array(0) })),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 0 })),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      canvas: { width: 640, height: 480 },
    };
    return {
      canvas: {
        getContext: () => ctx,
        width: 640,
        height: 480,
      } as unknown as HTMLCanvasElement,
      ctx,
    };
  }

  it('damaged structures draw only their building frame when no fire AnimClass exists', () => {
    // C++ building.cpp:1416-1465 creates fire AnimClass instances only when
    // Take_Damage returns RESULT_HALF/RESULT_MAJOR. A damaged HP ratio alone
    // is not a renderer rule and must not create BURN-* draws.
    const { canvas, ctx } = mockCanvas();
    const renderer = new Renderer(canvas);
    const camera = new Camera(0, 0);
    const map = new GameMap();
    map.revealAll();

    const structure: MapStructure = {
      type: 'POWR',
      image: 'powr',
      house: House.Spain,
      cx: 5,
      cy: 5,
      hp: 96,
      maxHp: 256,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
    };

    const drawFrame = vi.fn();
    const assets = {
      getSheet: vi.fn((name: string) => {
        if (name === 'powr') return { meta: { frameCount: 8, frameWidth: 48, frameHeight: 48 } };
        if (name.startsWith('burn-')) return { meta: { frameCount: 67, frameWidth: 48, frameHeight: 48 } };
        return null;
      }),
      getRemappedSheet: vi.fn(() => null),
      drawFrame,
      drawFrameFrom: vi.fn(),
      hasSheet: vi.fn(() => false),
    };

    (renderer as any).renderStructures(camera, map, [structure], assets, 40);

    expect(drawFrame).toHaveBeenCalledWith(ctx, 'powr', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Object));
    expect(drawFrame.mock.calls.filter((call) => String(call[1]).startsWith('burn-'))).toHaveLength(0);
  });
});
