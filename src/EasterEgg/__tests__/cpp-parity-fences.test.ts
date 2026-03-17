/**
 * C++ Behavioral Parity: Fences — WOOD (Wooden Fence) and CYCL (Chain Link Fence)
 *
 * Tests verify fence behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with fence structures (observable
 * outcomes: stats, destruction, counter behavior), not HOW the code
 * implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 *
 * Key C++ facts:
 *   - WOOD: Strength=1, Cost=50, Owner=allies,soviet (rules.ini)
 *   - CYCL: Strength=1, Cost=75, Owner=allies,soviet (rules.ini)
 *   - Both are 1x1, no weapon, destroyed by any damage
 *   - Both are wall types and should be excluded from nBuildingsDestroyedCount
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WARHEAD_META,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
  applySplashDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeFence(
  type: string, cx: number, cy: number, hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 1;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(
  type: string, cx: number, cy: number, hp: number, house: House = House.USSR,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

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
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
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
  } as CombatContext;
}

// =============================================================================
//  WOOD — Wooden Fence
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: WOOD -> Strength=1, 1x1 footprint, no weapon
// WOOD is a map-placed overlay fence, not a sidebar-buildable structure.

describe('WOOD stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['WOOD']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['WOOD']).toEqual([1, 1]);
  });

  it('has no weapon (passive barrier)', () => {
    expect(STRUCTURE_WEAPONS['WOOD']).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=1 means any damage instantly destroys the fence.

describe('WOOD destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys WOOD (HP 1->0)', () => {
    const fence = makeFence('WOOD', 10, 10);
    const ctx = makeCombatCtx([fence]);
    const destroyed = structureDamage(ctx, fence, 1);
    expect(destroyed).toBe(true);
    expect(fence.alive).toBe(false);
    expect(fence.hp).toBe(0);
  });

  it('100 points of damage destroys WOOD (overkill)', () => {
    const fence = makeFence('WOOD', 10, 10);
    const ctx = makeCombatCtx([fence]);
    const destroyed = structureDamage(ctx, fence, 100);
    expect(destroyed).toBe(true);
    expect(fence.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const fence = makeFence('WOOD', 10, 10);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 1);
    expect(fence.rubble).toBe(true);
  });

  it('dead WOOD cannot be damaged again', () => {
    const fence = makeFence('WOOD', 10, 10);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 1);
    const secondResult = structureDamage(ctx, fence, 1);
    expect(secondResult).toBe(false);
  });
});

// =============================================================================
//  CYCL — Chain Link Fence
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: CYCL -> Strength=1, 1x1 footprint, no weapon
// CYCL is a map-placed overlay fence, not a sidebar-buildable structure.

describe('CYCL stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['CYCL']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['CYCL']).toEqual([1, 1]);
  });

  it('has no weapon (passive barrier)', () => {
    expect(STRUCTURE_WEAPONS['CYCL']).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('CYCL destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys CYCL (HP 1->0)', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    const destroyed = structureDamage(ctx, fence, 1);
    expect(destroyed).toBe(true);
    expect(fence.alive).toBe(false);
    expect(fence.hp).toBe(0);
  });

  it('100 points of damage destroys CYCL (overkill)', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    const destroyed = structureDamage(ctx, fence, 100);
    expect(destroyed).toBe(true);
    expect(fence.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 1);
    expect(fence.rubble).toBe(true);
  });

  it('dead CYCL cannot be damaged again', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 1);
    const secondResult = structureDamage(ctx, fence, 1);
    expect(secondResult).toBe(false);
  });
});

// =============================================================================
//  WALL_TYPES exclusion from nBuildingsDestroyedCount (building.cpp)
// =============================================================================
//
// C++ combat.cpp: destroyed walls do NOT increment nBuildingsDestroyedCount.
// This is critical for trigger parity — TEVENT_NBUILDINGS_DESTROYED counts
// real buildings, not walls/fences. Both WOOD and CYCL are wall types and
// must be excluded from the counter.

describe('Fence destruction does NOT increment nBuildingsDestroyedCount', () => {

  it('WOOD destruction does not count toward nBuildingsDestroyedCount', () => {
    const fence = makeFence('WOOD', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 10);
    expect(fence.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('CYCL destruction does not count toward nBuildingsDestroyedCount', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 10);
    expect(fence.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('non-wall enemy building destruction DOES count', () => {
    const silo = makeBuilding('SILO', 10, 10, 1, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 10);
    expect(silo.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('destroying 2 fences and 1 building counts only the building', () => {
    const w1 = makeFence('WOOD', 10, 10, undefined, House.USSR);
    const w2 = makeFence('CYCL', 11, 10, undefined, House.USSR);
    const silo = makeBuilding('SILO', 12, 10, 1, House.USSR);
    const ctx = makeCombatCtx([w1, w2, silo]);
    structureDamage(ctx, w1, 10);
    structureDamage(ctx, w2, 10);
    structureDamage(ctx, silo, 10);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('allied fence destruction also does not count', () => {
    const fence = makeFence('WOOD', 10, 10, undefined, House.Spain);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 10);
    expect(fence.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  1x1 Footprint — Both fences share 1x1 cell footprint
// =============================================================================

describe('Both fences have 1x1 footprint', () => {

  it.each([
    ['WOOD'],
    ['CYCL'],
  ])('%s footprint is exactly 1 cell', (type) => {
    const [w, h] = STRUCTURE_SIZE[type]!;
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it('1x1 footprint occupies only the origin cell', () => {
    const [w, h] = STRUCTURE_SIZE['WOOD']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10]]);
  });
});

// =============================================================================
//  Destruction Blast — Radial HE (building.cpp, non-barrel path)
// =============================================================================
//
// Fences use the generic non-barrel destruction blast: 2-cell radial HE
// with distance falloff. Even though fences are tiny (1 HP), they still
// produce the standard explosion on death.

describe('Fence destruction blast — radial HE (non-barrel)', () => {

  it('WOOD damages entities within 2-cell radius on destruction', () => {
    const fence = makeFence('WOOD', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fence], [victim]);
    structureDamage(ctx, fence, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('CYCL damages entities within 2-cell radius on destruction', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fence], [victim]);
    structureDamage(ctx, fence, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('fence destruction does NOT damage entities beyond 2-cell radius', () => {
    const fence = makeFence('WOOD', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells east
    const ctx = makeCombatCtx([fence], [victim]);
    structureDamage(ctx, fence, 10);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('fence destruction can chain-damage adjacent structures', () => {
    const fence = makeFence('CYCL', 10, 10, undefined, House.USSR);
    const nearby = makeBuilding('SILO', 11, 10, 300, House.USSR);
    const ctx = makeCombatCtx([fence, nearby]);
    structureDamage(ctx, fence, 10);
    expect(nearby.hp).toBeLessThan(300);
  });
});

// =============================================================================
//  Wall Destruction via Splash — destroysWalls flag (combat.cpp:244-270)
// =============================================================================
//
// C++ WARHEAD_META: HE and AP warheads have destroysWalls=true.
// When splash damage hits a cell with a fence (via map.getWallType), the
// fence is removed from the map overlay.

describe('Fence destruction via splash (destroysWalls warhead flag)', () => {

  it('HE splash clears WOOD wall type from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'WOOD');
    expect(ctx.map.getWallType(10, 10)).toBe('WOOD');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'HE' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('HE splash clears CYCL wall type from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'CYCL');
    expect(ctx.map.getWallType(10, 10)).toBe('CYCL');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'HE' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('AP splash clears WOOD wall type from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'WOOD');
    expect(ctx.map.getWallType(10, 10)).toBe('WOOD');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'AP' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('SA splash does NOT clear WOOD from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'WOOD');
    expect(ctx.map.getWallType(10, 10)).toBe('WOOD');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'SA' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('WOOD');
  });

  it('SA splash does NOT clear CYCL from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'CYCL');
    expect(ctx.map.getWallType(10, 10)).toBe('CYCL');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'SA' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('CYCL');
  });
});

// =============================================================================
//  Cross-type Consistency — Both fences share identical combat behavior
// =============================================================================

describe('Cross-type consistency: both fences behave identically in combat', () => {

  const fenceTypes = ['WOOD', 'CYCL'] as const;

  it.each(fenceTypes)('%s has HP=1', (type) => {
    expect(STRUCTURE_MAX_HP[type]).toBe(1);
  });

  it.each(fenceTypes)('%s has 1x1 footprint', (type) => {
    expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
  });

  it.each(fenceTypes)('%s has no weapon', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });

  it.each(fenceTypes)('%s is destroyed by 1 damage', (type) => {
    const fence = makeFence(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    const destroyed = structureDamage(ctx, fence, 1);
    expect(destroyed).toBe(true);
    expect(fence.alive).toBe(false);
  });

  it.each(fenceTypes)('%s destruction does not increment nBuildingsDestroyedCount', (type) => {
    const fence = makeFence(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fence]);
    structureDamage(ctx, fence, 1);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  Not Buildable — WOOD and CYCL are map-only overlay structures
// =============================================================================
//
// Unlike SBAG/FENC/BRIK which appear in the sidebar, WOOD and CYCL are
// only placed via map overlays (decodeOverlayPack). They have no entry
// in PRODUCTION_ITEMS.

describe('WOOD and CYCL are not sidebar-buildable (map overlay only)', () => {

  // Import PRODUCTION_ITEMS inline to avoid test coupling issues
  let PRODUCTION_ITEMS: { type: string }[];

  beforeEach(async () => {
    const types = await import('../engine/types');
    PRODUCTION_ITEMS = types.PRODUCTION_ITEMS;
  });

  it('WOOD is not in PRODUCTION_ITEMS', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'WOOD');
    expect(item).toBeUndefined();
  });

  it('CYCL is not in PRODUCTION_ITEMS', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'CYCL');
    expect(item).toBeUndefined();
  });

  it('WOOD still exists in STRUCTURE_MAX_HP (used by map overlay parsing)', () => {
    expect(STRUCTURE_MAX_HP['WOOD']).toBeDefined();
  });

  it('CYCL still exists in STRUCTURE_MAX_HP (used by map overlay parsing)', () => {
    expect(STRUCTURE_MAX_HP['CYCL']).toBeDefined();
  });

  it('WOOD still exists in STRUCTURE_SIZE (used by map overlay parsing)', () => {
    expect(STRUCTURE_SIZE['WOOD']).toBeDefined();
  });

  it('CYCL still exists in STRUCTURE_SIZE (used by map overlay parsing)', () => {
    expect(STRUCTURE_SIZE['CYCL']).toBeDefined();
  });
});
