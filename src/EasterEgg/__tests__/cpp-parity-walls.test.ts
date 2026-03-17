/**
 * C++ Behavioral Parity: Walls — SBAG (Sandbag), FENC (Wire Fence), BRIK (Concrete Wall)
 *
 * Tests verify wall behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with wall structures (observable
 * outcomes: stats, destruction, counter behavior), not HOW the code
 * implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, PRODUCTION_ITEMS, WARHEAD_META,
  buildDefaultAlliances, worldDist,
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
import { sellRefund } from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeWall(
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
  } as CombatContext;
}

// =============================================================================
//  SBAG — Sandbag Wall
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: SBAG -> Strength=1, Cost=25, Owner=allies, TechLevel=2

describe('SBAG stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['SBAG']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['SBAG']).toEqual([1, 1]);
  });

  it('has no weapon (passive barrier)', () => {
    expect(STRUCTURE_WEAPONS['SBAG']).toBeUndefined();
  });

  it('cost is 25 credits (PRODUCTION_ITEMS)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(25);
  });

  it('is allied faction (rules.ini Owner=allies)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(item).toBeDefined();
    expect(item!.faction).toBe('allied');
  });

  it('is a structure (isStructure=true)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=1 means any damage instantly destroys the wall.

describe('SBAG destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys SBAG (HP 1->0)', () => {
    const wall = makeWall('SBAG', 10, 10);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 1);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
    expect(wall.hp).toBe(0);
  });

  it('100 points of damage destroys SBAG (overkill)', () => {
    const wall = makeWall('SBAG', 10, 10);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 100);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const wall = makeWall('SBAG', 10, 10);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 1);
    expect(wall.rubble).toBe(true);
  });

  it('dead SBAG cannot be damaged again', () => {
    const wall = makeWall('SBAG', 10, 10);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 1);
    const secondResult = structureDamage(ctx, wall, 1);
    expect(secondResult).toBe(false);
  });
});

// =============================================================================
//  FENC — Wire Fence
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: FENC -> Strength=1, Cost=25, Owner=soviet, TechLevel=2

describe('FENC stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['FENC']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['FENC']).toEqual([1, 1]);
  });

  it('has no weapon (passive barrier)', () => {
    expect(STRUCTURE_WEAPONS['FENC']).toBeUndefined();
  });

  it('cost is 25 credits (PRODUCTION_ITEMS)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(25);
  });

  it('is soviet faction (rules.ini Owner=soviet)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(item).toBeDefined();
    expect(item!.faction).toBe('soviet');
  });

  it('is a structure (isStructure=true)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('FENC destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys FENC (HP 1->0)', () => {
    const wall = makeWall('FENC', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 1);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
    expect(wall.hp).toBe(0);
  });

  it('100 points of damage destroys FENC (overkill)', () => {
    const wall = makeWall('FENC', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 100);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const wall = makeWall('FENC', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 1);
    expect(wall.rubble).toBe(true);
  });
});

// =============================================================================
//  BRIK — Concrete Wall
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: BRIK -> Strength=1, Cost=100, Owner=allies,soviet, TechLevel=8

describe('BRIK stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['BRIK']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['BRIK']).toEqual([1, 1]);
  });

  it('has no weapon (passive barrier)', () => {
    expect(STRUCTURE_WEAPONS['BRIK']).toBeUndefined();
  });

  it('cost is 100 credits (PRODUCTION_ITEMS)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(100);
  });

  it('is available to both factions (rules.ini Owner=allies,soviet)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(item).toBeDefined();
    expect(item!.faction).toBe('both');
  });

  it('is a structure (isStructure=true)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(item).toBeDefined();
    expect(item!.isStructure).toBe(true);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('BRIK destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys BRIK (HP 1->0)', () => {
    const wall = makeWall('BRIK', 10, 10);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 1);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
    expect(wall.hp).toBe(0);
  });

  it('100 points of damage destroys BRIK (overkill)', () => {
    const wall = makeWall('BRIK', 10, 10);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 100);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const wall = makeWall('BRIK', 10, 10);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 1);
    expect(wall.rubble).toBe(true);
  });
});

// =============================================================================
//  WALL_TYPES exclusion from nBuildingsDestroyedCount (building.cpp)
// =============================================================================
//
// C++ combat.ts:602: destroyed walls do NOT increment nBuildingsDestroyedCount.
// This is critical for trigger parity — TEVENT_NBUILDINGS_DESTROYED counts
// real buildings, not walls.

describe('Wall destruction does NOT increment nBuildingsDestroyedCount', () => {

  it('SBAG destruction does not count toward nBuildingsDestroyedCount', () => {
    const wall = makeWall('SBAG', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 10);
    expect(wall.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('FENC destruction does not count toward nBuildingsDestroyedCount', () => {
    const wall = makeWall('FENC', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 10);
    expect(wall.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('BRIK destruction does not count toward nBuildingsDestroyedCount', () => {
    const wall = makeWall('BRIK', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 10);
    expect(wall.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('non-wall enemy building destruction DOES count', () => {
    const silo = makeBuilding('SILO', 10, 10, 1, House.USSR);
    const ctx = makeCombatCtx([silo]);
    structureDamage(ctx, silo, 10);
    expect(silo.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('destroying 3 walls and 1 building counts only the building', () => {
    const w1 = makeWall('SBAG', 10, 10, undefined, House.USSR);
    const w2 = makeWall('FENC', 11, 10, undefined, House.USSR);
    const w3 = makeWall('BRIK', 12, 10, undefined, House.USSR);
    const silo = makeBuilding('SILO', 13, 10, 1, House.USSR);
    const ctx = makeCombatCtx([w1, w2, w3, silo]);
    structureDamage(ctx, w1, 10);
    structureDamage(ctx, w2, 10);
    structureDamage(ctx, w3, 10);
    structureDamage(ctx, silo, 10);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('allied wall destruction also does not count (only enemy non-walls count)', () => {
    const wall = makeWall('SBAG', 10, 10, undefined, House.Spain);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 10);
    expect(wall.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  1x1 Footprint — All walls share 1x1 cell footprint
// =============================================================================

describe('All walls have 1x1 footprint', () => {

  it.each([
    ['SBAG'],
    ['FENC'],
    ['BRIK'],
  ])('%s footprint is exactly 1 cell', (type) => {
    const [w, h] = STRUCTURE_SIZE[type]!;
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it('1x1 footprint occupies only the origin cell', () => {
    // Origin at (10,10) -> only cell (10,10) — no neighbors
    const [w, h] = STRUCTURE_SIZE['SBAG']!;
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
// Walls use the generic non-barrel destruction blast: 2-cell radial HE
// with distance falloff. Even though walls are tiny (1 HP), they still
// produce the standard explosion on death.

describe('Wall destruction blast — radial HE (non-barrel)', () => {

  it('SBAG damages entities within 2-cell radius on destruction', () => {
    const wall = makeWall('SBAG', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([wall], [victim]);
    structureDamage(ctx, wall, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('FENC damages entities within 2-cell radius on destruction', () => {
    const wall = makeWall('FENC', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([wall], [victim]);
    structureDamage(ctx, wall, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('BRIK damages entities within 2-cell radius on destruction', () => {
    const wall = makeWall('BRIK', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([wall], [victim]);
    structureDamage(ctx, wall, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('wall destruction does NOT damage entities beyond 2-cell radius', () => {
    const wall = makeWall('SBAG', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells east
    const ctx = makeCombatCtx([wall], [victim]);
    structureDamage(ctx, wall, 10);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('wall destruction can chain-damage adjacent structures', () => {
    const wall = makeWall('BRIK', 10, 10, undefined, House.USSR);
    const nearby = makeBuilding('SILO', 11, 10, 300, House.USSR);
    const ctx = makeCombatCtx([wall, nearby]);
    structureDamage(ctx, wall, 10);
    expect(nearby.hp).toBeLessThan(300);
  });
});

// =============================================================================
//  Sell Refund (rules.ini Cost / repair_sell)
// =============================================================================
//
// C++ sell refund = 50% of build cost.

describe('Wall sell refunds (50% of build cost)', () => {

  it('SBAG sell refund = floor(25 * 0.5) = 12', () => {
    expect(sellRefund(25)).toBe(12);
  });

  it('FENC sell refund = floor(25 * 0.5) = 12', () => {
    expect(sellRefund(25)).toBe(12);
  });

  it('BRIK sell refund = floor(100 * 0.5) = 50', () => {
    expect(sellRefund(100)).toBe(50);
  });
});

// =============================================================================
//  Wall Destruction via Splash — destroysWalls flag (combat.cpp:244-270)
// =============================================================================
//
// C++ WARHEAD_META: HE and AP warheads have destroysWalls=true.
// When splash damage hits a cell with a wall (via map.getWallType), the
// wall is removed from the map overlay.

describe('Wall destruction via splash (destroysWalls warhead flag)', () => {

  it('HE warhead has destroysWalls=true', () => {
    expect(WARHEAD_META['HE'].destroysWalls).toBe(true);
  });

  it('AP warhead has destroysWalls=true', () => {
    expect(WARHEAD_META['AP'].destroysWalls).toBe(true);
  });

  it('SA warhead does NOT have destroysWalls', () => {
    expect(WARHEAD_META['SA'].destroysWalls).toBeFalsy();
  });

  it('Fire warhead does NOT have destroysWalls', () => {
    expect(WARHEAD_META['Fire'].destroysWalls).toBeFalsy();
  });

  it('HE splash clears wall type from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'SBAG');
    expect(ctx.map.getWallType(10, 10)).toBe('SBAG');

    // Fire an HE weapon centered on (10,10)
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'HE' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('AP splash clears wall type from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'FENC');
    expect(ctx.map.getWallType(10, 10)).toBe('FENC');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'AP' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('SA splash does NOT clear wall from map cell', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'BRIK');
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'SA' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);
    // SA does not destroy walls
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
  });

  it('HE splash clears adjacent wall cells within splash radius', () => {
    const ctx = makeCombatCtx();
    ctx.map.setWallType(10, 10, 'SBAG');
    ctx.map.setWallType(11, 10, 'SBAG');
    ctx.map.setWallType(10, 11, 'SBAG');

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const weapon = { damage: 50, warhead: 'HE' as const, splash: 1.5 };
    applySplashDamage(ctx, center, weapon, -1, House.Spain);

    expect(ctx.map.getWallType(10, 10)).toBe('');
    expect(ctx.map.getWallType(11, 10)).toBe('');
    expect(ctx.map.getWallType(10, 11)).toBe('');
  });
});

// =============================================================================
//  Cross-type Consistency — All 3 walls share identical combat behavior
// =============================================================================

describe('Cross-type consistency: all walls behave identically in combat', () => {

  const wallTypes = ['SBAG', 'FENC', 'BRIK'] as const;

  it.each(wallTypes)('%s has HP=1', (type) => {
    expect(STRUCTURE_MAX_HP[type]).toBe(1);
  });

  it.each(wallTypes)('%s has 1x1 footprint', (type) => {
    expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
  });

  it.each(wallTypes)('%s has no weapon', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });

  it.each(wallTypes)('%s is destroyed by 1 damage', (type) => {
    const wall = makeWall(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    const destroyed = structureDamage(ctx, wall, 1);
    expect(destroyed).toBe(true);
    expect(wall.alive).toBe(false);
  });

  it.each(wallTypes)('%s destruction does not increment nBuildingsDestroyedCount', (type) => {
    const wall = makeWall(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([wall]);
    structureDamage(ctx, wall, 1);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  Faction Ownership Distinction
// =============================================================================
//
// SBAG = allied only, FENC = soviet only, BRIK = both factions.
// This determines which sidebar they appear in during gameplay.

describe('Wall faction ownership (rules.ini Owner= parity)', () => {

  it('SBAG is allied-only', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(item!.faction).toBe('allied');
  });

  it('FENC is soviet-only', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(item!.faction).toBe('soviet');
  });

  it('BRIK is available to both factions', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(item!.faction).toBe('both');
  });

  it('SBAG costs less than BRIK (25 < 100)', () => {
    const sbag = PRODUCTION_ITEMS.find(p => p.type === 'SBAG')!;
    const brik = PRODUCTION_ITEMS.find(p => p.type === 'BRIK')!;
    expect(sbag.cost).toBeLessThan(brik.cost);
  });

  it('FENC costs less than BRIK (25 < 100)', () => {
    const fenc = PRODUCTION_ITEMS.find(p => p.type === 'FENC')!;
    const brik = PRODUCTION_ITEMS.find(p => p.type === 'BRIK')!;
    expect(fenc.cost).toBeLessThan(brik.cost);
  });

  it('SBAG and FENC have equal cost (25 = 25)', () => {
    const sbag = PRODUCTION_ITEMS.find(p => p.type === 'SBAG')!;
    const fenc = PRODUCTION_ITEMS.find(p => p.type === 'FENC')!;
    expect(sbag.cost).toBe(fenc.cost);
  });
});
