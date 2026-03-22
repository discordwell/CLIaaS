/**
 * C++ Behavioral Parity: HBOX (Camo Pillbox)
 *
 * Tests verify Camo Pillbox behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * HBOX key properties (rules.ini / building.cpp):
 *   - HP 600, Size 1x1, Cost 600, Allied faction
 *   - Weapon: SA warhead, 40 damage, range 5, ROF 40 (identical to PBOX)
 *   - NOT power-dependent: fires during power outage
 *   - Does NOT target airborne aircraft (no isAntiAir flag)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeHBOX(cx: number, cy: number, house: House = House.Spain, hp?: number): MapStructure {
  const maxHp = hp ?? STRUCTURE_MAX_HP['HBOX'] ?? 600;
  return {
    type: 'HBOX', image: 'hbox', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    weapon: { ...STRUCTURE_WEAPONS['HBOX'] },
  };
}

function makePBOX(cx: number, cy: number, house: House = House.Spain, hp?: number): MapStructure {
  const maxHp = hp ?? STRUCTURE_MAX_HP['PBOX'] ?? 400;
  return {
    type: 'PBOX', image: 'pbox', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    weapon: { ...STRUCTURE_WEAPONS['PBOX'] },
  };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an airborne aircraft entity */
function airborneAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = entityAtCell(type, house, cx, cy);
  e.flightAltitude = 24; // standard flight altitude
  return e;
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
  overrides: Partial<CombatContext> = {},
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
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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
    ...overrides,
  } as CombatContext;
}

// -- Structure Stats (rules.ini parity) ---------------------------------------

describe('HBOX structure stats (rules.ini)', () => {

  it('has 600 max HP', () => {
    expect(STRUCTURE_MAX_HP['HBOX']).toBe(600);
  });

  it('has higher HP than PBOX (400)', () => {
    expect(STRUCTURE_MAX_HP['HBOX']).toBeGreaterThan(STRUCTURE_MAX_HP['PBOX']);
  });

  it('is 1x1 footprint', () => {
    expect(STRUCTURE_SIZE['HBOX']).toEqual([1, 1]);
  });

  it('is NOT in the powered structures set', () => {
    expect(STRUCTURE_POWERED.has('HBOX')).toBe(false);
  });
});

// -- Weapon Stats (rules.ini / STRUCTURE_WEAPONS parity) ----------------------

describe('HBOX weapon stats — SA warhead, 40 dmg, range 5, ROF 40', () => {

  it('has a weapon defined in STRUCTURE_WEAPONS', () => {
    expect(STRUCTURE_WEAPONS['HBOX']).toBeDefined();
  });

  it('deals 40 base damage', () => {
    expect(STRUCTURE_WEAPONS['HBOX'].damage).toBe(40);
  });

  it('uses SA warhead', () => {
    expect(STRUCTURE_WEAPONS['HBOX'].warhead).toBe('SA');
  });

  it('has range 5 cells', () => {
    expect(STRUCTURE_WEAPONS['HBOX'].range).toBe(5);
  });

  it('has ROF 40 ticks', () => {
    expect(STRUCTURE_WEAPONS['HBOX'].rof).toBe(40);
  });

  it('has identical weapon stats to PBOX', () => {
    const hbox = STRUCTURE_WEAPONS['HBOX'];
    const pbox = STRUCTURE_WEAPONS['PBOX'];
    expect(hbox.damage).toBe(pbox.damage);
    expect(hbox.range).toBe(pbox.range);
    expect(hbox.rof).toBe(pbox.rof);
    expect(hbox.warhead).toBe(pbox.warhead);
  });

  it('does NOT have isAntiAir flag', () => {
    expect(STRUCTURE_WEAPONS['HBOX'].isAntiAir).toBeFalsy();
  });
});

// -- Fires at ground enemies (updateStructureCombat) --------------------------

describe('HBOX fires at ground enemies (building.cpp auto-fire)', () => {

  it('damages an enemy infantry within range', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10); // 2 cells E, within range 5
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([hbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('damages an enemy vehicle within range', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10); // 3 cells E
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([hbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('does NOT fire at allied units', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 12, 10); // Greece is allied with Spain
    const ctx = makeCombatCtx([hbox], [ally]);
    updateStructureCombat(ctx);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('does NOT fire at enemies beyond range 5', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    // Place enemy well beyond 5-cell range
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 18, 10); // 8 cells E
    const ctx = makeCombatCtx([hbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('sets attackCooldown to ROF after firing', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([hbox], [enemy]);
    updateStructureCombat(ctx);
    expect(hbox.attackCooldown).toBe(STRUCTURE_WEAPONS['HBOX'].rof);
  });

  it('does NOT fire while on cooldown', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    hbox.attackCooldown = 10; // on cooldown
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([hbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });
});

// -- Does NOT target airborne aircraft ----------------------------------------

describe('HBOX does NOT target airborne aircraft (no isAntiAir)', () => {

  it('ignores airborne helicopter within range', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const heli = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const ctx = makeCombatCtx([hbox], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('ignores airborne MiG within range', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const mig = airborneAtCell(UnitType.V_MIG, House.USSR, 12, 10);
    const ctx = makeCombatCtx([hbox], [mig]);
    updateStructureCombat(ctx);
    expect(mig.hp).toBe(mig.maxHp);
  });

  it('fires at ground units even when airborne aircraft is closer', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const heli = airborneAtCell(UnitType.V_HIND, House.USSR, 11, 10); // 1 cell E, closer
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 14, 10); // 4 cells E, further
    const ctx = makeCombatCtx([hbox], [heli, infantry]);
    updateStructureCombat(ctx);
    // Helicopter should be untouched, infantry should be hit
    expect(heli.hp).toBe(heli.maxHp);
    expect(infantry.hp).toBeLessThan(infantry.maxHp);
  });
});

// -- NOT power-dependent (PW2 parity) ----------------------------------------

describe('HBOX fires during power outage (PW2: not in STRUCTURE_POWERED)', () => {

  it('fires normally when power consumed > power produced', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    // Low power: consuming 200, producing only 100
    const ctx = makeCombatCtx([hbox], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires normally when power produced is zero', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([hbox], [enemy], {
      powerConsumed: 0,
      powerProduced: 0,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('contrast: GUN (also unpowered) fires during power deficit too', () => {
    // Neither GUN nor HBOX are in STRUCTURE_POWERED — both fire during deficit
    // C++ bdata.cpp:2836 — GUN has IsPowered=false (default)
    expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
    expect(STRUCTURE_POWERED.has('HBOX')).toBe(false);
  });
});

// -- Damage and destruction behavior ------------------------------------------

describe('HBOX takes damage and destruction (structureDamage)', () => {

  it('survives damage that does not reduce HP to zero', () => {
    const hbox = makeHBOX(10, 10);
    const ctx = makeCombatCtx([hbox]);
    structureDamage(ctx, hbox, 200);
    expect(hbox.alive).toBe(true);
    expect(hbox.hp).toBe(400); // 600 - 200
  });

  it('is destroyed when cumulative damage exceeds 600 HP', () => {
    const hbox = makeHBOX(10, 10);
    const ctx = makeCombatCtx([hbox]);
    structureDamage(ctx, hbox, 300);
    expect(hbox.alive).toBe(true);
    expect(hbox.hp).toBe(300);
    structureDamage(ctx, hbox, 300);
    expect(hbox.alive).toBe(false);
    expect(hbox.rubble).toBe(true);
  });

  it('PBOX is destroyed at 400 HP while HBOX survives same damage', () => {
    // Place far apart so destruction blast doesn't chain between them
    const hbox = makeHBOX(10, 10);
    const pbox = makePBOX(20, 10);
    const ctx = makeCombatCtx([hbox, pbox]);
    structureDamage(ctx, hbox, 400);
    structureDamage(ctx, pbox, 400);
    expect(hbox.alive).toBe(true);
    expect(hbox.hp).toBe(200); // 600 - 400 = 200 HP remaining
    expect(pbox.alive).toBe(false); // 400 - 400 = 0 HP
  });

  it('does not fire after being destroyed', () => {
    const hbox = makeHBOX(10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([hbox], [enemy]);
    structureDamage(ctx, hbox, 600); // destroy it
    expect(hbox.alive).toBe(false);
    const hpBefore = enemy.hp;
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('destruction does NOT damage nearby entities (visual-only explosion)', () => {
    const hbox = makeHBOX(10, 10);
    // Place entity near the HBOX — should take blast damage on destruction
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const ctx = makeCombatCtx([hbox], [victim]);
    structureDamage(ctx, hbox, 600);
    expect(hbox.alive).toBe(false);
    expect(victim.hp).toBe(victim.maxHp);
  });
});

// -- Same weapon as PBOX: behavioral equivalence ------------------------------

describe('HBOX vs PBOX weapon behavioral equivalence', () => {

  it('both deal the same damage to the same target type', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const pbox = makePBOX(20, 10, House.Spain);
    const enemyH = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const enemyP = entityAtCell(UnitType.I_E1, House.USSR, 22, 10);

    const ctxH = makeCombatCtx([hbox], [enemyH]);
    const ctxP = makeCombatCtx([pbox], [enemyP]);

    updateStructureCombat(ctxH);
    updateStructureCombat(ctxP);

    const hboxDmg = enemyH.maxHp - enemyH.hp;
    const pboxDmg = enemyP.maxHp - enemyP.hp;
    expect(hboxDmg).toBe(pboxDmg);
    expect(hboxDmg).toBeGreaterThan(0);
  });

  it('both set the same cooldown after firing', () => {
    const hbox = makeHBOX(10, 10, House.Spain);
    const pbox = makePBOX(20, 10, House.Spain);
    const enemyH = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const enemyP = entityAtCell(UnitType.I_E1, House.USSR, 22, 10);

    const ctxH = makeCombatCtx([hbox], [enemyH]);
    const ctxP = makeCombatCtx([pbox], [enemyP]);

    updateStructureCombat(ctxH);
    updateStructureCombat(ctxP);

    expect(hbox.attackCooldown).toBe(pbox.attackCooldown);
    expect(hbox.attackCooldown).toBe(40);
  });
});
