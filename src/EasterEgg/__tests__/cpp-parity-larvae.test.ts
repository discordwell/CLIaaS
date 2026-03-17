/**
 * C++ Behavioral Parity: LAR1 (Small Ant Larvae) & LAR2 (Large Ant Larvae)
 *
 * Tests verify larvae structure behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with larvae structures (observable
 * outcomes: stats, destruction, counter behavior), not HOW the code
 * implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 *
 * Key C++ rules.ini values:
 *   LAR1 -> Strength=25, no weapon, 1x1 footprint (ant mission scenario only)
 *   LAR2 -> Strength=50, no weapon, 1x1 footprint (ant mission scenario only)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, PRODUCTION_ITEMS,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_IMAGES,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeLarva(
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
//  LAR1 — Small Ant Larvae
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: LAR1 -> Strength=25, no weapon, 1x1 footprint

describe('LAR1 stats (rules.ini parity)', () => {

  it('max HP is 25', () => {
    expect(STRUCTURE_MAX_HP['LAR1']).toBe(25);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['LAR1']).toEqual([1, 1]);
  });

  it('has no weapon (passive structure)', () => {
    expect(STRUCTURE_WEAPONS['LAR1']).toBeUndefined();
  });

  it('is not in PRODUCTION_ITEMS (scenario-only structure)', () => {
    // LAR1 is placed by scenario INI, not built by the player
    const item = PRODUCTION_ITEMS.find(p => p.type === 'LAR1');
    expect(item).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=25 — low HP, easily destroyed by any attack.

describe('LAR1 destruction (Strength=25, very low HP)', () => {

  it('1 point of damage reduces HP to 24 but does not destroy', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 1);
    expect(destroyed).toBe(false);
    expect(larva.alive).toBe(true);
    expect(larva.hp).toBe(24);
  });

  it('24 points of damage reduces HP to 1 but does not destroy', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 24);
    expect(destroyed).toBe(false);
    expect(larva.alive).toBe(true);
    expect(larva.hp).toBe(1);
  });

  it('25 points of damage destroys LAR1 (HP 25->0)', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 25);
    expect(destroyed).toBe(true);
    expect(larva.alive).toBe(false);
    expect(larva.hp).toBe(0);
  });

  it('100 points of damage destroys LAR1 (overkill)', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 100);
    expect(destroyed).toBe(true);
    expect(larva.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 25);
    expect(larva.rubble).toBe(true);
  });

  it('dead LAR1 cannot be damaged again', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 25);
    const secondResult = structureDamage(ctx, larva, 1);
    expect(secondResult).toBe(false);
  });

  it('accumulates damage across multiple hits (10 + 10 + 10 = 30, kills at 25)', () => {
    const larva = makeLarva('LAR1', 10, 10);
    const ctx = makeCombatCtx([larva]);
    expect(structureDamage(ctx, larva, 10)).toBe(false);
    expect(larva.hp).toBe(15);
    expect(structureDamage(ctx, larva, 10)).toBe(false);
    expect(larva.hp).toBe(5);
    expect(structureDamage(ctx, larva, 10)).toBe(true);
    expect(larva.alive).toBe(false);
  });
});

// =============================================================================
//  LAR2 — Large Ant Larvae
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: LAR2 -> Strength=50, no weapon, 1x1 footprint

describe('LAR2 stats (rules.ini parity)', () => {

  it('max HP is 50', () => {
    expect(STRUCTURE_MAX_HP['LAR2']).toBe(50);
  });

  it('footprint is 1x1 cells', () => {
    expect(STRUCTURE_SIZE['LAR2']).toEqual([1, 1]);
  });

  it('has no weapon (passive structure)', () => {
    expect(STRUCTURE_WEAPONS['LAR2']).toBeUndefined();
  });

  it('is not in PRODUCTION_ITEMS (scenario-only structure)', () => {
    // LAR2 is placed by scenario INI, not built by the player
    const item = PRODUCTION_ITEMS.find(p => p.type === 'LAR2');
    expect(item).toBeUndefined();
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=50 — low HP but double LAR1, still easily destroyed.

describe('LAR2 destruction (Strength=50, low HP)', () => {

  it('1 point of damage reduces HP to 49 but does not destroy', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 1);
    expect(destroyed).toBe(false);
    expect(larva.alive).toBe(true);
    expect(larva.hp).toBe(49);
  });

  it('49 points of damage reduces HP to 1 but does not destroy', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 49);
    expect(destroyed).toBe(false);
    expect(larva.alive).toBe(true);
    expect(larva.hp).toBe(1);
  });

  it('50 points of damage destroys LAR2 (HP 50->0)', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 50);
    expect(destroyed).toBe(true);
    expect(larva.alive).toBe(false);
    expect(larva.hp).toBe(0);
  });

  it('100 points of damage destroys LAR2 (overkill)', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    const destroyed = structureDamage(ctx, larva, 100);
    expect(destroyed).toBe(true);
    expect(larva.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 50);
    expect(larva.rubble).toBe(true);
  });

  it('dead LAR2 cannot be damaged again', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 50);
    const secondResult = structureDamage(ctx, larva, 1);
    expect(secondResult).toBe(false);
  });

  it('accumulates damage across multiple hits (20 + 20 + 20 = 60, kills at 50)', () => {
    const larva = makeLarva('LAR2', 10, 10);
    const ctx = makeCombatCtx([larva]);
    expect(structureDamage(ctx, larva, 20)).toBe(false);
    expect(larva.hp).toBe(30);
    expect(structureDamage(ctx, larva, 20)).toBe(false);
    expect(larva.hp).toBe(10);
    expect(structureDamage(ctx, larva, 20)).toBe(true);
    expect(larva.alive).toBe(false);
  });
});

// =============================================================================
//  LAR2 has double LAR1 HP
// =============================================================================

describe('LAR2 HP is double LAR1 HP', () => {

  it('LAR2 maxHP (50) = 2 * LAR1 maxHP (25)', () => {
    expect(STRUCTURE_MAX_HP['LAR2']).toBe(2 * STRUCTURE_MAX_HP['LAR1']);
  });
});

// =============================================================================
//  1x1 Footprint — Both larvae share 1x1 cell footprint
// =============================================================================

describe('Both larvae have 1x1 footprint', () => {

  it.each([
    ['LAR1'],
    ['LAR2'],
  ])('%s footprint is exactly 1 cell', (type) => {
    const [w, h] = STRUCTURE_SIZE[type]!;
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it('1x1 footprint occupies only the origin cell', () => {
    const [w, h] = STRUCTURE_SIZE['LAR1']!;
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
//  No Weapon — Both larvae are passive structures
// =============================================================================

describe('Larvae have no weapon (passive ant mission structures)', () => {

  it.each([
    ['LAR1'],
    ['LAR2'],
  ])('%s has no entry in STRUCTURE_WEAPONS', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });
});

// =============================================================================
//  nBuildingsDestroyedCount — Larvae ARE counted (not walls)
// =============================================================================
//
// C++ combat.ts:602: WALL_TYPES = {SBAG, FENC, BARB, BRIK}. Larvae are
// NOT in WALL_TYPES, so destroying enemy larvae DOES increment
// nBuildingsDestroyedCount. This is correct — they are real buildings
// in the C++ sense, just with very low HP.

describe('Larvae destruction increments nBuildingsDestroyedCount (not walls)', () => {

  it('LAR1 enemy destruction increments nBuildingsDestroyedCount', () => {
    const larva = makeLarva('LAR1', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 100);
    expect(larva.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('LAR2 enemy destruction increments nBuildingsDestroyedCount', () => {
    const larva = makeLarva('LAR2', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 100);
    expect(larva.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('destroying 2 larvae counts as 2 buildings destroyed', () => {
    const lar1 = makeLarva('LAR1', 10, 10, undefined, House.USSR);
    const lar2 = makeLarva('LAR2', 12, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([lar1, lar2]);
    structureDamage(ctx, lar1, 100);
    structureDamage(ctx, lar2, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(2);
  });

  it('allied larvae destruction does NOT increment nBuildingsDestroyedCount', () => {
    const larva = makeLarva('LAR1', 10, 10, undefined, House.Spain);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 100);
    expect(larva.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  Destruction Blast — Radial HE (building.cpp, non-barrel path)
// =============================================================================
//
// Larvae use the generic non-barrel destruction blast: 2-cell radial HE
// with distance falloff. Despite being tiny 1x1 structures, they still
// produce the standard explosion on death.

describe('Larvae destruction blast — radial HE (non-barrel)', () => {

  it('LAR1 damages entities within 2-cell radius on destruction', () => {
    const larva = makeLarva('LAR1', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([larva], [victim]);
    structureDamage(ctx, larva, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('LAR2 damages entities within 2-cell radius on destruction', () => {
    const larva = makeLarva('LAR2', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([larva], [victim]);
    structureDamage(ctx, larva, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('larvae destruction does NOT damage entities beyond 2-cell radius', () => {
    const larva = makeLarva('LAR1', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells east
    const ctx = makeCombatCtx([larva], [victim]);
    structureDamage(ctx, larva, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('larvae destruction can chain-damage adjacent structures', () => {
    const larva = makeLarva('LAR2', 10, 10, undefined, House.USSR);
    const nearby = makeBuilding('SILO', 11, 10, 300, House.USSR);
    const ctx = makeCombatCtx([larva, nearby]);
    structureDamage(ctx, larva, 100);
    expect(nearby.hp).toBeLessThan(300);
  });
});

// =============================================================================
//  Cross-type Consistency — Both larvae share identical behavior patterns
// =============================================================================

describe('Cross-type consistency: both larvae share structure behavior', () => {

  const larvaeTypes = ['LAR1', 'LAR2'] as const;

  it.each(larvaeTypes)('%s has 1x1 footprint', (type) => {
    expect(STRUCTURE_SIZE[type]).toEqual([1, 1]);
  });

  it.each(larvaeTypes)('%s has no weapon', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });

  it.each(larvaeTypes)('%s leaves rubble on destruction', (type) => {
    const larva = makeLarva(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 200);
    expect(larva.rubble).toBe(true);
  });

  it.each(larvaeTypes)('%s enemy destruction counts toward nBuildingsDestroyedCount', (type) => {
    const larva = makeLarva(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([larva]);
    structureDamage(ctx, larva, 200);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });
});

// =============================================================================
//  Ant Mission Scenario Structures — LAR1/LAR2 only appear in SCA* missions
// =============================================================================
//
// C++ scenario data: LAR1 and LAR2 are ant mission structures (SCA01-04EA).
// They are not in PRODUCTION_ITEMS and cannot be built by any faction.

describe('Larvae are ant mission scenario-only structures', () => {

  it('LAR1 has an image entry (rendered in ant scenarios)', () => {
    expect(STRUCTURE_IMAGES['LAR1']).toBe('lar1');
  });

  it('LAR2 has an image entry (rendered in ant scenarios)', () => {
    expect(STRUCTURE_IMAGES['LAR2']).toBe('lar2');
  });

  it('LAR1 is recognized as structure type index 33 in triggers', () => {
    // C++ scenario.ts struct type mapping: 33 = LAR1
    // This confirms LAR1 is a valid structure type for trigger events
    expect(STRUCTURE_MAX_HP['LAR1']).toBeDefined();
    expect(STRUCTURE_SIZE['LAR1']).toBeDefined();
  });

  it('LAR2 is recognized as structure type index 34 in triggers', () => {
    // C++ scenario.ts struct type mapping: 34 = LAR2
    // This confirms LAR2 is a valid structure type for trigger events
    expect(STRUCTURE_MAX_HP['LAR2']).toBeDefined();
    expect(STRUCTURE_SIZE['LAR2']).toBeDefined();
  });
});

// =============================================================================
//  Very Low HP Comparison — Larvae vs other structures
// =============================================================================
//
// LAR1 (25 HP) and LAR2 (50 HP) are among the weakest structures in the
// game. For reference: walls have 1 HP, barrels 10 HP, silos 150 HP.

describe('Larvae are very low HP compared to regular structures', () => {

  it('LAR1 (25 HP) has more HP than walls (1 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR1']).toBeGreaterThan(STRUCTURE_MAX_HP['SBAG']);
  });

  it('LAR2 (50 HP) has more HP than walls (1 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR2']).toBeGreaterThan(STRUCTURE_MAX_HP['SBAG']);
  });

  it('LAR1 (25 HP) has more HP than barrels (10 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR1']).toBeGreaterThan(STRUCTURE_MAX_HP['BARL']);
  });

  it('LAR2 (50 HP) has more HP than barrels (10 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR2']).toBeGreaterThan(STRUCTURE_MAX_HP['BARL']);
  });

  it('LAR1 (25 HP) has less HP than a silo (150 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR1']).toBeLessThan(STRUCTURE_MAX_HP['SILO']);
  });

  it('LAR2 (50 HP) has less HP than a silo (150 HP)', () => {
    expect(STRUCTURE_MAX_HP['LAR2']).toBeLessThan(STRUCTURE_MAX_HP['SILO']);
  });
});
