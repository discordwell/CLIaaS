/**
 * C++ Behavioral Parity: Mines -- MINP (AP Mine), MINV (AV Mine)
 *
 * Tests verify mine behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with mine structures (observable
 * outcomes: stats, destruction, counter behavior), not HOW the code
 * implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeMine(
  type: string, cx: number, cy: number, hp?: number, house: House = House.USSR,
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
//  MINP -- Anti-Personnel Mine
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: MINP -> Strength=1, 1x1 footprint, passive (no weapon)

describe('MINP stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['MINP']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['MINP']).toEqual([1, 1]);
  });

  it('has no weapon (passive trap)', () => {
    expect(STRUCTURE_WEAPONS['MINP']).toBeUndefined();
  });

  it('is not in PRODUCTION_ITEMS (pre-placed only)', () => {
    // Mines are placed by minelayers or scenario data, not built from sidebar
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MINP');
    expect(item).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=1 means any damage instantly destroys the mine.

describe('MINP destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys MINP (HP 1->0)', () => {
    const mine = makeMine('MINP', 10, 10);
    const ctx = makeCombatCtx([mine]);
    const destroyed = structureDamage(ctx, mine, 1);
    expect(destroyed).toBe(true);
    expect(mine.alive).toBe(false);
    expect(mine.hp).toBe(0);
  });

  it('100 points of damage destroys MINP (overkill)', () => {
    const mine = makeMine('MINP', 10, 10);
    const ctx = makeCombatCtx([mine]);
    const destroyed = structureDamage(ctx, mine, 100);
    expect(destroyed).toBe(true);
    expect(mine.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const mine = makeMine('MINP', 10, 10);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 1);
    expect(mine.rubble).toBe(true);
  });

  it('dead MINP cannot be damaged again', () => {
    const mine = makeMine('MINP', 10, 10);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 1);
    const secondResult = structureDamage(ctx, mine, 1);
    expect(secondResult).toBe(false);
  });
});

// =============================================================================
//  MINV -- Anti-Vehicle Mine
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: MINV -> Strength=1, 1x1 footprint, passive (no weapon)

describe('MINV stats (rules.ini parity)', () => {

  it('max HP is 1', () => {
    expect(STRUCTURE_MAX_HP['MINV']).toBe(1);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['MINV']).toEqual([1, 1]);
  });

  it('has no weapon (passive trap)', () => {
    expect(STRUCTURE_WEAPONS['MINV']).toBeUndefined();
  });

  it('is not in PRODUCTION_ITEMS (pre-placed only)', () => {
    // Mines are placed by minelayers or scenario data, not built from sidebar
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MINV');
    expect(item).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('MINV destruction (Strength=1, any damage kills)', () => {

  it('1 point of damage destroys MINV (HP 1->0)', () => {
    const mine = makeMine('MINV', 10, 10);
    const ctx = makeCombatCtx([mine]);
    const destroyed = structureDamage(ctx, mine, 1);
    expect(destroyed).toBe(true);
    expect(mine.alive).toBe(false);
    expect(mine.hp).toBe(0);
  });

  it('100 points of damage destroys MINV (overkill)', () => {
    const mine = makeMine('MINV', 10, 10);
    const ctx = makeCombatCtx([mine]);
    const destroyed = structureDamage(ctx, mine, 100);
    expect(destroyed).toBe(true);
    expect(mine.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const mine = makeMine('MINV', 10, 10);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 1);
    expect(mine.rubble).toBe(true);
  });

  it('dead MINV cannot be damaged again', () => {
    const mine = makeMine('MINV', 10, 10);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 1);
    const secondResult = structureDamage(ctx, mine, 1);
    expect(secondResult).toBe(false);
  });
});

// =============================================================================
//  NOT in WALL_TYPES -- mines DO increment nBuildingsDestroyedCount
// =============================================================================
//
// C++ combat.ts:602: WALL_TYPES = {SBAG, FENC, BARB, BRIK}. Mines are NOT
// walls, so destroying enemy mines DOES increment nBuildingsDestroyedCount.
// This is the key behavioral difference from walls.

describe('Mine destruction DOES increment nBuildingsDestroyedCount (not in WALL_TYPES)', () => {

  it('enemy MINP destruction increments nBuildingsDestroyedCount', () => {
    const mine = makeMine('MINP', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 10);
    expect(mine.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('enemy MINV destruction increments nBuildingsDestroyedCount', () => {
    const mine = makeMine('MINV', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 10);
    expect(mine.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('allied mine destruction does NOT increment count (only enemy structures count)', () => {
    const mine = makeMine('MINP', 10, 10, undefined, House.Spain);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 10);
    expect(mine.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });

  it('destroying 2 enemy mines and 1 wall counts only the mines', () => {
    const m1 = makeMine('MINP', 10, 10, undefined, House.USSR);
    const m2 = makeMine('MINV', 11, 10, undefined, House.USSR);
    // Wall — use makeBuilding with hp=1 for SBAG
    const wall: MapStructure = {
      type: 'SBAG', image: 'sbag', house: House.USSR,
      cx: 12, cy: 10, hp: 1, maxHp: 1, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctx = makeCombatCtx([m1, m2, wall]);
    structureDamage(ctx, m1, 10);
    structureDamage(ctx, m2, 10);
    structureDamage(ctx, wall, 10);
    // 2 mines count, wall does not
    expect(ctx.nBuildingsDestroyedCount).toBe(2);
  });

  it('destroying enemy mine + building counts both', () => {
    const mine = makeMine('MINP', 10, 10, undefined, House.USSR);
    const silo = makeBuilding('SILO', 11, 10, 1, House.USSR);
    const ctx = makeCombatCtx([mine, silo]);
    structureDamage(ctx, mine, 10);
    structureDamage(ctx, silo, 10);
    expect(ctx.nBuildingsDestroyedCount).toBe(2);
  });
});

// =============================================================================
//  1x1 Footprint -- Both mines share 1x1 cell footprint
// =============================================================================

describe('Both mines have 1x1 footprint', () => {

  it.each([
    ['MINP'],
    ['MINV'],
  ])('%s footprint is exactly 1 cell', (type) => {
    const [w, h] = STRUCTURE_SIZE[type]!;
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it('1x1 footprint occupies only the origin cell', () => {
    const [w, h] = STRUCTURE_SIZE['MINP']!;
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
//  Destruction Blast -- Radial HE (building.cpp, non-barrel path)
// =============================================================================
//
// Mines use the generic non-barrel destruction blast: 2-cell radial HE
// with distance falloff. Even though mines are tiny (1 HP), they still
// produce the standard explosion on death.

describe('Mine destruction blast -- radial HE (non-barrel)', () => {

  it('MINP damages entities within 2-cell radius on destruction', () => {
    const mine = makeMine('MINP', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([mine], [victim]);
    structureDamage(ctx, mine, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('MINV damages entities within 2-cell radius on destruction', () => {
    const mine = makeMine('MINV', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([mine], [victim]);
    structureDamage(ctx, mine, 10);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('mine destruction does NOT damage entities beyond 2-cell radius', () => {
    const mine = makeMine('MINP', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells east
    const ctx = makeCombatCtx([mine], [victim]);
    structureDamage(ctx, mine, 10);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('mine destruction can chain-damage adjacent structures', () => {
    const mine = makeMine('MINV', 10, 10, undefined, House.USSR);
    const nearby = makeBuilding('SILO', 11, 10, 300, House.USSR);
    const ctx = makeCombatCtx([mine, nearby]);
    structureDamage(ctx, mine, 10);
    expect(nearby.hp).toBeLessThan(300);
  });
});

// =============================================================================
//  Cross-type Consistency -- Both mine types share identical combat behavior
// =============================================================================

describe('Cross-type consistency: both mines behave identically in combat', () => {

  const mineTypes = ['MINP', 'MINV'] as const;

  it.each(mineTypes)('%s has HP=1', (type) => {
    expect(STRUCTURE_MAX_HP[type]).toBe(1);
  });

  it.each(mineTypes)('%s has 1x1 footprint', (type) => {
    expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
  });

  it.each(mineTypes)('%s has no weapon', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });

  it.each(mineTypes)('%s is destroyed by 1 damage', (type) => {
    const mine = makeMine(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mine]);
    const destroyed = structureDamage(ctx, mine, 1);
    expect(destroyed).toBe(true);
    expect(mine.alive).toBe(false);
  });

  it.each(mineTypes)('%s destruction increments nBuildingsDestroyedCount (not a wall)', (type) => {
    const mine = makeMine(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mine]);
    structureDamage(ctx, mine, 1);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });
});

// =============================================================================
//  Mine vs Wall distinction -- structural behavior difference
// =============================================================================
//
// C++ WALL_TYPES = {SBAG, FENC, BARB, BRIK}. Mines are structurally similar
// (1 HP, 1x1) but are NOT walls. This matters for:
//   - nBuildingsDestroyedCount (mines count, walls don't)
//   - Sell behavior (walls sell instantly, mines are not sellable from sidebar)
//   - Production (walls are buildable, mines are pre-placed by minelayer/scenario)

describe('Mine vs Wall distinction', () => {

  it('MINP shares HP=1 with walls but is not in WALL_TYPES exclusion', () => {
    // Both have HP=1
    expect(STRUCTURE_MAX_HP['MINP']).toBe(1);
    expect(STRUCTURE_MAX_HP['SBAG']).toBe(1);
    // But destroying enemy MINP counts, SBAG does not
    const mine = makeMine('MINP', 10, 10, undefined, House.USSR);
    const wall: MapStructure = {
      type: 'SBAG', image: 'sbag', house: House.USSR,
      cx: 11, cy: 10, hp: 1, maxHp: 1, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctx = makeCombatCtx([mine, wall]);
    structureDamage(ctx, mine, 10);
    structureDamage(ctx, wall, 10);
    expect(ctx.nBuildingsDestroyedCount).toBe(1); // only the mine
  });

  it('MINV shares 1x1 footprint with walls but behaves differently for counters', () => {
    expect(STRUCTURE_SIZE['MINV']).toEqual([1, 1]);
    expect(STRUCTURE_SIZE['BRIK']).toEqual([1, 1]);
    // Destroying enemy MINV counts, BRIK does not
    const mine = makeMine('MINV', 10, 10, undefined, House.USSR);
    const wall: MapStructure = {
      type: 'BRIK', image: 'brik', house: House.USSR,
      cx: 11, cy: 10, hp: 1, maxHp: 1, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
    };
    const ctx = makeCombatCtx([mine, wall]);
    structureDamage(ctx, mine, 10);
    structureDamage(ctx, wall, 10);
    expect(ctx.nBuildingsDestroyedCount).toBe(1); // only the mine
  });
});
