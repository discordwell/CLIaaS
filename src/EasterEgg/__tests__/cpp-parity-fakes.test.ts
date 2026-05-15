/**
 * C++ Behavioral Parity: Fake Structures — FACF (Fake Construction Yard),
 * DOMF (Fake Radar Dome), WEAF (Fake War Factory)
 *
 * Tests verify fake structure behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with fake structures (observable
 * outcomes: stats, destruction, counter behavior), not HOW the code
 * implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 *
 * C++ rules.ini: Fakes have low HP (Strength=30), match the footprint of
 * their real counterpart, have no weapon, and exist to deceive enemy AI
 * into attacking decoys instead of real buildings.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WARHEAD_META, PRODUCTION_ITEMS,
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

function makeFake(
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
  } as CombatContext;
}

// =============================================================================
//  FACF — Fake Construction Yard
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: FACF -> Strength=30, same footprint as FACT (3x3)
// No weapon, not buildable by player, placed by scenario designer.

describe('FACF stats (rules.ini parity)', () => {

  it('max HP is 30 (very fragile decoy)', () => {
    expect(STRUCTURE_MAX_HP['FACF']).toBe(30);
  });

  it('footprint is 3x3 cells (matches real FACT)', () => {
    expect(STRUCTURE_SIZE['FACF']).toEqual([3, 3]);
  });

  it('footprint matches real Construction Yard (FACT)', () => {
    expect(STRUCTURE_SIZE['FACF']).toEqual(STRUCTURE_SIZE['FACT']);
  });

  it('has no weapon (passive decoy)', () => {
    expect(STRUCTURE_WEAPONS['FACF']).toBeUndefined();
  });

  it('HP is far lower than real FACT (30 vs 1000)', () => {
    expect(STRUCTURE_MAX_HP['FACF']).toBeLessThan(STRUCTURE_MAX_HP['FACT']);
    expect(STRUCTURE_MAX_HP['FACF']).toBe(30);
    expect(STRUCTURE_MAX_HP['FACT']).toBe(1000);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------
//
// C++ Strength=30 means FACF can survive small hits but crumbles quickly.

describe('FACF destruction (Strength=30)', () => {

  it('survives 29 points of damage (HP 30->1)', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 29);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(1);
  });

  it('30 points of damage destroys FACF exactly (HP 30->0)', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 30);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
    expect(fake.hp).toBe(0);
  });

  it('1 point of damage chips HP from 30 to 29', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 1);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(29);
  });

  it('100 points of damage destroys FACF (overkill)', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 100);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    expect(fake.rubble).toBe(true);
  });

  it('dead FACF cannot be damaged again', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    const secondResult = structureDamage(ctx, fake, 1);
    expect(secondResult).toBe(false);
  });

  it('progressive damage: two 15-damage hits destroy FACF', () => {
    const fake = makeFake('FACF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    expect(structureDamage(ctx, fake, 15)).toBe(false);
    expect(fake.hp).toBe(15);
    expect(structureDamage(ctx, fake, 15)).toBe(true);
    expect(fake.alive).toBe(false);
  });
});

// =============================================================================
//  DOMF — Fake Radar Dome
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: DOMF -> Strength=30, same footprint as DOME (2x2)

describe('DOMF stats (rules.ini parity)', () => {

  it('max HP is 30 (very fragile decoy)', () => {
    expect(STRUCTURE_MAX_HP['DOMF']).toBe(30);
  });

  it('footprint is 2x2 cells (matches real DOME)', () => {
    expect(STRUCTURE_SIZE['DOMF']).toEqual([2, 2]);
  });

  it('footprint matches real Radar Dome (DOME)', () => {
    expect(STRUCTURE_SIZE['DOMF']).toEqual(STRUCTURE_SIZE['DOME']);
  });

  it('has no weapon (passive decoy)', () => {
    expect(STRUCTURE_WEAPONS['DOMF']).toBeUndefined();
  });

  it('HP is far lower than real DOME (30 vs 1000)', () => {
    expect(STRUCTURE_MAX_HP['DOMF']).toBeLessThan(STRUCTURE_MAX_HP['DOME']);
    expect(STRUCTURE_MAX_HP['DOMF']).toBe(30);
    expect(STRUCTURE_MAX_HP['DOME']).toBe(1000);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('DOMF destruction (Strength=30)', () => {

  it('survives 29 points of damage (HP 30->1)', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 29);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(1);
  });

  it('30 points of damage destroys DOMF exactly (HP 30->0)', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 30);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
    expect(fake.hp).toBe(0);
  });

  it('1 point of damage chips HP from 30 to 29', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 1);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(29);
  });

  it('100 points of damage destroys DOMF (overkill)', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 100);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    expect(fake.rubble).toBe(true);
  });

  it('dead DOMF cannot be damaged again', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    const secondResult = structureDamage(ctx, fake, 1);
    expect(secondResult).toBe(false);
  });

  it('progressive damage: three 10-damage hits destroy DOMF', () => {
    const fake = makeFake('DOMF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    expect(structureDamage(ctx, fake, 10)).toBe(false);
    expect(fake.hp).toBe(20);
    expect(structureDamage(ctx, fake, 10)).toBe(false);
    expect(fake.hp).toBe(10);
    expect(structureDamage(ctx, fake, 10)).toBe(true);
    expect(fake.alive).toBe(false);
  });
});

// =============================================================================
//  WEAF — Fake War Factory
// =============================================================================

// -- Stats (rules.ini) --------------------------------------------------------
//
// C++ rules.ini: WEAF -> Strength=30, same footprint as WEAP (3x2)

describe('WEAF stats (rules.ini parity)', () => {

  it('max HP is 30 (very fragile decoy)', () => {
    expect(STRUCTURE_MAX_HP['WEAF']).toBe(30);
  });

  it('footprint is 3x2 cells (matches real WEAP)', () => {
    expect(STRUCTURE_SIZE['WEAF']).toEqual([3, 2]);
  });

  it('footprint matches real War Factory (WEAP)', () => {
    expect(STRUCTURE_SIZE['WEAF']).toEqual(STRUCTURE_SIZE['WEAP']);
  });

  it('has no weapon (passive decoy)', () => {
    expect(STRUCTURE_WEAPONS['WEAF']).toBeUndefined();
  });

  it('HP is far lower than real WEAP (30 vs 1000)', () => {
    expect(STRUCTURE_MAX_HP['WEAF']).toBeLessThan(STRUCTURE_MAX_HP['WEAP']);
    expect(STRUCTURE_MAX_HP['WEAF']).toBe(30);
    expect(STRUCTURE_MAX_HP['WEAP']).toBe(1000);
  });
});

// -- Destruction (building.cpp / combat.cpp) ----------------------------------

describe('WEAF destruction (Strength=30)', () => {

  it('survives 29 points of damage (HP 30->1)', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 29);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(1);
  });

  it('30 points of damage destroys WEAF exactly (HP 30->0)', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 30);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
    expect(fake.hp).toBe(0);
  });

  it('1 point of damage chips HP from 30 to 29', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 1);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(29);
  });

  it('100 points of damage destroys WEAF (overkill)', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 100);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
  });

  it('leaves rubble on destruction', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    expect(fake.rubble).toBe(true);
  });

  it('dead WEAF cannot be damaged again', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 30);
    const secondResult = structureDamage(ctx, fake, 1);
    expect(secondResult).toBe(false);
  });

  it('progressive damage: six 5-damage hits destroy WEAF', () => {
    const fake = makeFake('WEAF', 10, 10);
    const ctx = makeCombatCtx([fake]);
    for (let i = 0; i < 5; i++) {
      expect(structureDamage(ctx, fake, 5)).toBe(false);
      expect(fake.hp).toBe(30 - (i + 1) * 5);
    }
    expect(structureDamage(ctx, fake, 5)).toBe(true);
    expect(fake.alive).toBe(false);
  });
});

// =============================================================================
//  nBuildingsDestroyedCount — Fakes ARE real buildings (not walls)
// =============================================================================
//
// C++ combat.ts:602: only WALL_TYPES are excluded from nBuildingsDestroyedCount.
// Fake structures are NOT walls, so destroying an enemy fake DOES increment
// the counter. This matters for TEVENT_NBUILDINGS_DESTROYED triggers.

describe('Fake destruction DOES increment nBuildingsDestroyedCount', () => {

  it('enemy FACF destruction counts toward nBuildingsDestroyedCount', () => {
    const fake = makeFake('FACF', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(fake.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('enemy DOMF destruction counts toward nBuildingsDestroyedCount', () => {
    const fake = makeFake('DOMF', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(fake.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('enemy WEAF destruction counts toward nBuildingsDestroyedCount', () => {
    const fake = makeFake('WEAF', 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(fake.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it('destroying all 3 enemy fakes counts as 3 buildings', () => {
    const f1 = makeFake('FACF', 10, 10, undefined, House.USSR);
    const f2 = makeFake('DOMF', 14, 10, undefined, House.USSR);
    const f3 = makeFake('WEAF', 17, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([f1, f2, f3]);
    structureDamage(ctx, f1, 100);
    structureDamage(ctx, f2, 100);
    structureDamage(ctx, f3, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(3);
  });

  it('allied fake destruction does NOT count (only enemy counts)', () => {
    const fake = makeFake('FACF', 10, 10, undefined, House.Spain);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(fake.alive).toBe(false);
    expect(ctx.nBuildingsDestroyedCount).toBe(0);
  });
});

// =============================================================================
//  Footprint Sizes — Fakes match their real counterparts
// =============================================================================
//
// The whole point of fakes is visual deception. Their footprint must
// exactly match the real building they impersonate.

describe('Fake footprint matches real counterpart', () => {

  it('FACF 3x3 footprint matches FACT 3x3', () => {
    const [fw, fh] = STRUCTURE_SIZE['FACF']!;
    const [rw, rh] = STRUCTURE_SIZE['FACT']!;
    expect(fw).toBe(rw);
    expect(fh).toBe(rh);
    expect(fw).toBe(3);
    expect(fh).toBe(3);
  });

  it('DOMF 2x2 footprint matches DOME 2x2', () => {
    const [fw, fh] = STRUCTURE_SIZE['DOMF']!;
    const [rw, rh] = STRUCTURE_SIZE['DOME']!;
    expect(fw).toBe(rw);
    expect(fh).toBe(rh);
    expect(fw).toBe(2);
    expect(fh).toBe(2);
  });

  it('WEAF 3x2 footprint matches WEAP 3x2', () => {
    const [fw, fh] = STRUCTURE_SIZE['WEAF']!;
    const [rw, rh] = STRUCTURE_SIZE['WEAP']!;
    expect(fw).toBe(rw);
    expect(fh).toBe(rh);
    expect(fw).toBe(3);
    expect(fh).toBe(2);
  });

  it('FACF 3x3 occupies 9 cells', () => {
    const [w, h] = STRUCTURE_SIZE['FACF']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toHaveLength(9);
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
      [10, 12], [11, 12], [12, 12],
    ]);
  });

  it('DOMF 2x2 occupies 4 cells', () => {
    const [w, h] = STRUCTURE_SIZE['DOMF']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toHaveLength(4);
    expect(cells).toEqual([
      [10, 10], [11, 10],
      [10, 11], [11, 11],
    ]);
  });

  it('WEAF 3x2 occupies 6 cells', () => {
    const [w, h] = STRUCTURE_SIZE['WEAF']!;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toHaveLength(6);
    expect(cells).toEqual([
      [10, 10], [11, 10], [12, 10],
      [10, 11], [11, 11], [12, 11],
    ]);
  });
});

// =============================================================================
//  Destruction Blast — Radial HE (building.cpp, non-barrel path)
// =============================================================================
//
// Fakes produce a visual-only FBALL1 death animation on destruction (C++ parity).
// No warhead damage is dealt to entities. Despite being cheap decoys, they produce the
// standard explosion on death (maintaining the illusion).

describe('Fake destruction blast -- visual-only (C++ parity: no entity damage)', () => {

  it('FACF entities take NO damage on destruction (visual-only explosion)', () => {
    const fake = makeFake('FACF', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 11);
    const ctx = makeCombatCtx([fake], [victim]);
    structureDamage(ctx, fake, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('DOMF entities take NO damage on destruction (visual-only explosion)', () => {
    const fake = makeFake('DOMF', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([fake], [victim]);
    structureDamage(ctx, fake, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('WEAF entities take NO damage on destruction (visual-only explosion)', () => {
    const fake = makeFake('WEAF', 10, 10, undefined, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 11);
    const ctx = makeCombatCtx([fake], [victim]);
    structureDamage(ctx, fake, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('fake destruction does NOT chain-damage adjacent structures', () => {
    // FACF blast center: (cx+1)*CELL_SIZE, (cy+1)*CELL_SIZE = cell (11,11)
    // Place SILO at (12,10) so its center is cell (13,11), distance = 2 cells (within radius)
    const fake = makeFake('FACF', 10, 10, undefined, House.USSR);
    const nearby = makeBuilding('SILO', 12, 10, 300, House.USSR);
    const ctx = makeCombatCtx([fake, nearby]);
    structureDamage(ctx, fake, 100);
    expect(nearby.hp).toBe(300);
  });
});

// =============================================================================
//  Cross-type Consistency — All 3 fakes share identical HP and no weapon
// =============================================================================

describe('Cross-type consistency: all fakes share core traits', () => {

  const fakeTypes = ['FACF', 'DOMF', 'WEAF'] as const;

  it.each(fakeTypes)('%s has HP=30', (type) => {
    expect(STRUCTURE_MAX_HP[type]).toBe(30);
  });

  it.each(fakeTypes)('%s has no weapon', (type) => {
    expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
  });

  it.each(fakeTypes)('%s is destroyed by 30 damage', (type) => {
    const fake = makeFake(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 30);
    expect(destroyed).toBe(true);
    expect(fake.alive).toBe(false);
  });

  it.each(fakeTypes)('%s survives 29 damage', (type) => {
    const fake = makeFake(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    const destroyed = structureDamage(ctx, fake, 29);
    expect(destroyed).toBe(false);
    expect(fake.alive).toBe(true);
    expect(fake.hp).toBe(1);
  });

  it.each(fakeTypes)('%s destruction increments nBuildingsDestroyedCount for enemy', (type) => {
    const fake = makeFake(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(ctx.nBuildingsDestroyedCount).toBe(1);
  });

  it.each(fakeTypes)('%s leaves rubble on destruction', (type) => {
    const fake = makeFake(type, 10, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([fake]);
    structureDamage(ctx, fake, 100);
    expect(fake.rubble).toBe(true);
  });
});

// =============================================================================
//  Fake vs Real HP Ratio — Fakes are 3% of real HP
// =============================================================================
//
// C++ design intent: fakes look identical but crumble almost instantly.
// FACT=1000, DOME=1000, WEAP=1000 vs FACF=30, DOMF=30, WEAF=30.

describe('Fake vs Real HP comparison (decoy fragility)', () => {

  it('all three real counterparts have HP 1000', () => {
    expect(STRUCTURE_MAX_HP['FACT']).toBe(1000);
    expect(STRUCTURE_MAX_HP['DOME']).toBe(1000);
    expect(STRUCTURE_MAX_HP['WEAP']).toBe(1000);
  });

  it('all three fakes have HP 30 (3% of real)', () => {
    expect(STRUCTURE_MAX_HP['FACF']).toBe(30);
    expect(STRUCTURE_MAX_HP['DOMF']).toBe(30);
    expect(STRUCTURE_MAX_HP['WEAF']).toBe(30);
  });

  it('FACF HP / FACT HP = 3%', () => {
    const ratio = STRUCTURE_MAX_HP['FACF'] / STRUCTURE_MAX_HP['FACT'];
    expect(ratio).toBeCloseTo(0.03, 2);
  });

  it('DOMF HP / DOME HP = 3%', () => {
    const ratio = STRUCTURE_MAX_HP['DOMF'] / STRUCTURE_MAX_HP['DOME'];
    expect(ratio).toBeCloseTo(0.03, 2);
  });

  it('WEAF HP / WEAP HP = 3%', () => {
    const ratio = STRUCTURE_MAX_HP['WEAF'] / STRUCTURE_MAX_HP['WEAP'];
    expect(ratio).toBeCloseTo(0.03, 2);
  });
});

// =============================================================================
//  Not Player-Buildable — Fakes are scenario-only structures
// =============================================================================
//
// C++ rules.ini: Fakes have no Owner= line or TechLevel=-1, making them
// unavailable in the production sidebar. They're placed by mission designers.

describe('Fakes are in PRODUCTION_ITEMS with low cost (decoy structures)', () => {
  // Fakes are now tracked in PRODUCTION_ITEMS for completeness,
  // but have very low cost (50) and techLevel gates.

  it('FACF is in PRODUCTION_ITEMS with cost 50', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'FACF');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(50);
    expect(item!.isStructure).toBe(true);
  });

  it('DOMF is in PRODUCTION_ITEMS with cost 50', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'DOMF');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(50);
    expect(item!.isStructure).toBe(true);
  });

  it('WEAF is in PRODUCTION_ITEMS with cost 50', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'WEAF');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(50);
    expect(item!.isStructure).toBe(true);
  });
});
