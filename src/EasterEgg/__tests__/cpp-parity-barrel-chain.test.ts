/**
 * C++ Behavioral Parity: Barrel Chain Reaction Mechanics
 *
 * Tests verify barrel chain explosion behavior matches C++ RA source code.
 * Authoritative source: rules.ini, building.cpp:1340-1369, combat.cpp:72-129.
 *
 * C++ chain reaction flow:
 *   1. Barrel dies → building.cpp:1344-1369 spawns 4 BULLET_INVISIBLE,
 *      200 damage each, WARHEAD_FIRE, at cardinal cells (N/E/S/W).
 *   2. Each bullet triggers Explosion_Damage (combat.cpp:162-255) at
 *      adjacent cell center.
 *   3. Explosion_Damage calls Take_Damage on each object in the blast
 *      cell, which calls Modify_Damage (combat.cpp:72-129) to apply
 *      warhead-vs-armor modifier and distance falloff.
 *   4. If the adjacent object is another barrel (HP=10), it dies and
 *      repeats from step 1 — synchronous recursive chain.
 *
 * Key rules.ini values:
 *   [BARL] Strength=10, no Armor= (defaults to ARMOR_NONE per object.cpp:1963)
 *   [BRL3] Strength=10, no Armor= (defaults to ARMOR_NONE per object.cpp:1963)
 *   [Fire] Spread=8, Verses=90%,100%,60%,25%,50%
 *
 * Key C++ mechanics:
 *   - Modify_Damage applies warhead Verses modifier: 200 * 0.9 = 180 for ARMOR_NONE
 *   - Modify_Damage applies distance falloff: distance / (SpreadFactor * PIXEL_LEPTON_W/2)
 *   - Barrels at distance=0 from explosion center: no falloff → 180 damage
 *   - Barrel HP=10 << 180, so barrels always chain-kill regardless of modifier
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES, WARHEAD_VS_ARMOR,
  buildDefaultAlliances, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage as rawStructureDamage,
  updateInflightProjectiles,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_ARMOR } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeBarrel(cx: number, cy: number, hp = 10): MapStructure {
  return {
    type: 'BARL', image: 'barl', house: House.Neutral,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBRL3(cx: number, cy: number, hp = 10): MapStructure {
  return {
    type: 'BRL3', image: 'brl3', house: House.Neutral,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, armor?: ArmorType): MapStructure {
  return {
    type, image: type.toLowerCase(), house: House.USSR,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    armor,
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
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
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
  } as CombatContext;
}

function flushProjectiles(ctx: CombatContext): void {
  for (let guard = 0; ctx.inflightProjectiles.length > 0 && guard < 512; guard++) {
    updateInflightProjectiles(ctx);
  }
  expect(ctx.inflightProjectiles.length).toBe(0);
}

function structureDamage(
  ctx: CombatContext,
  s: MapStructure,
  damage: number,
): boolean {
  const destroyed = rawStructureDamage(ctx, s, damage);
  flushProjectiles(ctx);
  return destroyed;
}

// ── rules.ini Barrel Properties (BARL/BRL3) ─────────────────────────────────
// C++ source: object.cpp:1963 — ObjectTypeClass constructor sets Armor=ARMOR_NONE
// rules.ini [BARL]: Strength=10, Repairable=false, Adjacent=0, BaseNormal=no
// rules.ini [BRL3]: Strength=10, Repairable=false, Adjacent=0, BaseNormal=no
// Neither section has Armor= key → C++ defaults to ARMOR_NONE

describe('rules.ini barrel properties (Strength, Armor)', () => {

  it('BARL HP = 10 (rules.ini Strength=10)', () => {
    // rules.ini line 1744: [BARL] Strength=10
    // TS scenario.ts STRUCTURE_MAX_HP maps BARL → 10
    const barrel = makeBarrel(5, 5);
    expect(barrel.hp).toBe(10);
    expect(barrel.maxHp).toBe(10);
  });

  it('BRL3 HP = 10 (rules.ini Strength=10)', () => {
    // rules.ini line 1750: [BRL3] Strength=10
    const barrel = makeBRL3(5, 5);
    expect(barrel.hp).toBe(10);
    expect(barrel.maxHp).toBe(10);
  });

  it('BARL/BRL3 armor should be ARMOR_NONE per C++ (object.cpp:1963)', () => {
    // C++ ObjectTypeClass constructor: Armor(ARMOR_NONE) (object.cpp:1963)
    // TechnoTypeClass::Read_INI reads Armor= with default=current → stays ARMOR_NONE
    // rules.ini [BARL]/[BRL3] have no Armor= key
    const barlArmor = STRUCTURE_ARMOR['BARL'];
    const brl3Armor = STRUCTURE_ARMOR['BRL3'];
    // C++ expected: ARMOR_NONE → 'none'
    expect(barlArmor).toBe('none');
    expect(brl3Armor).toBe('none');
  });
});

// ── Fire Warhead Verses (rules.ini [Fire]) ──────────────────────────────────
// rules.ini line 2694: Verses=90%,100%,60%,25%,50%
// Index: [none, wood, light, heavy, concrete]

describe('Fire warhead verses modifiers (rules.ini [Fire])', () => {

  it('Fire vs ARMOR_NONE = 0.9 (90%)', () => {
    // rules.ini [Fire] Verses: first value = 90% (vs none)
    expect(WARHEAD_VS_ARMOR.Fire[0]).toBe(0.9);
  });

  it('Fire vs ARMOR_WOOD = 1.0 (100%)', () => {
    // rules.ini [Fire] Verses: second value = 100% (vs wood)
    expect(WARHEAD_VS_ARMOR.Fire[1]).toBe(1.0);
  });

  it('Fire vs ARMOR_LIGHT = 0.6 (60%)', () => {
    // rules.ini [Fire] Verses: third value = 60% (vs light)
    expect(WARHEAD_VS_ARMOR.Fire[2]).toBe(0.6);
  });

  it('Fire vs ARMOR_HEAVY = 0.25 (25%)', () => {
    // rules.ini [Fire] Verses: fourth value = 25% (vs heavy)
    expect(WARHEAD_VS_ARMOR.Fire[3]).toBe(0.25);
  });

  it('Fire vs ARMOR_CONCRETE = 0.5 (50%)', () => {
    // rules.ini [Fire] Verses: fifth value = 50% (vs concrete)
    expect(WARHEAD_VS_ARMOR.Fire[4]).toBe(0.5);
  });
});

// ── Barrel Explosion Damage: 200 Fire, Cardinal Directions ──────────────────
// C++ building.cpp:1344-1369
// 4 x BulletClass(BULLET_INVISIBLE, Adjacent_Cell(N/E/S/W), 0, 200, WARHEAD_FIRE, MPH_MEDIUM_FAST)

describe('Barrel explosion: 200 Fire damage, cardinal directions (building.cpp:1344-1369)', () => {

  it('barrel explosion deals Fire-warhead-modified damage to cardinal structures', () => {
    // C++ fires 200-damage WARHEAD_FIRE bullets at N/E/S/W cells
    // C++ applies Modify_Damage(200, WARHEAD_FIRE, target.Armor, distance)
    // Direct east bullet deals 180, and the north/south bullets' edge splash
    // adds 20 more in this 1x1 building layout.
    const barrel = makeBarrel(10, 10);
    const eastTarget = makeBarrel(11, 10, 500); // high HP to survive
    const ctx = makeCombatCtx([barrel, eastTarget]);
    structureDamage(ctx, barrel, 100);
    expect(eastTarget.hp).toBe(300);
  });

  it('4 cardinal directions all receive damage simultaneously', () => {
    const barrel = makeBarrel(10, 10);
    const north = makeBarrel(10, 9, 500);
    const east = makeBarrel(11, 10, 500);
    const south = makeBarrel(10, 11, 500);
    const west = makeBarrel(9, 10, 500);
    const ctx = makeCombatCtx([barrel, north, east, south, west]);
    structureDamage(ctx, barrel, 100);
    expect(north.hp, `target at (${north.cx},${north.cy})`).toBe(320);
    expect(east.hp, `target at (${east.cx},${east.cy})`).toBe(300);
    expect(south.hp, `target at (${south.cx},${south.cy})`).toBe(300);
    expect(west.hp, `target at (${west.cx},${west.cy})`).toBe(320);
  });

  it('diagonal structures receive edge splash damage', () => {
    const barrel = makeBarrel(10, 10);
    const ne = makeBarrel(11, 9, 500);
    const se = makeBarrel(11, 11, 500);
    const sw = makeBarrel(9, 11, 500);
    const nw = makeBarrel(9, 9, 500);
    const ctx = makeCombatCtx([barrel, ne, se, sw, nw]);
    structureDamage(ctx, barrel, 100);
    for (const t of [ne, se, sw, nw]) {
      expect(t.hp, `diagonal at (${t.cx},${t.cy})`).toBe(440);
    }
  });

  it('structures two cells away on cardinal receive edge splash damage', () => {
    const barrel = makeBarrel(10, 10);
    const far = makeBarrel(12, 10, 500); // 2 cells east
    const ctx = makeCombatCtx([barrel, far]);
    structureDamage(ctx, barrel, 100);
    expect(far.hp).toBe(470);
  });
});

// ── Chain Reactions ─────────────────────────────────────────────────────────
// C++ barrel chain is recursive: barrel death → fire bullets → adjacent barrel
// takes 200 Fire → dies (HP=10) → fires its own bullets → next barrel...
// Chain is synchronous in C++ (within same game frame) since Take_Damage is
// called recursively. TS also chains synchronously via recursive structureDamage.

describe('Chain reactions: barrel-to-barrel propagation', () => {

  it('2 barrels in E-W line: both die', () => {
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    const ctx = makeCombatCtx([b1, b2]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
  });

  it('3 barrels in E-W line: all die (chain propagation)', () => {
    // b1 → E hits b2 → E hits b3
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    const b3 = makeBarrel(12, 10);
    const ctx = makeCombatCtx([b1, b2, b3]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(b3.alive).toBe(false);
  });

  it('5 barrels in N-S line: all die (long chain)', () => {
    const barrels = [10, 11, 12, 13, 14].map(cy => makeBarrel(10, cy));
    const ctx = makeCombatCtx(barrels);
    structureDamage(ctx, barrels[0], 100);
    for (const b of barrels) {
      expect(b.alive, `barrel at (10,${b.cy})`).toBe(false);
    }
  });

  it('L-shaped chain: b1→N→b2→E→b3 — all die', () => {
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(10, 9);  // N of b1
    const b3 = makeBarrel(11, 9);  // E of b2
    const ctx = makeCombatCtx([b1, b2, b3]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(b3.alive).toBe(false);
  });

  it('T-shaped chain: center barrel propagates N, E, S, W', () => {
    // Center barrel + 4 adjacent = 5 barrels
    const center = makeBarrel(10, 10);
    const north = makeBarrel(10, 9);
    const east = makeBarrel(11, 10);
    const south = makeBarrel(10, 11);
    const west = makeBarrel(9, 10);
    const ctx = makeCombatCtx([center, north, east, south, west]);
    structureDamage(ctx, center, 100);
    for (const b of [center, north, east, south, west]) {
      expect(b.alive, `barrel at (${b.cx},${b.cy})`).toBe(false);
    }
  });

  it('diagonal barrels chain through projectile splash', () => {
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 11); // SE diagonal
    const ctx = makeCombatCtx([b1, b2]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
  });

  it('barrels 2 cells apart on cardinal chain through projectile splash', () => {
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(12, 10); // 2 cells east — gap between
    const ctx = makeCombatCtx([b1, b2]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
  });

  it('BARL chains to BRL3 and vice-versa (mixed barrel types)', () => {
    // C++ building.cpp:1344: both STRUCT_BARREL and STRUCT_BARREL3 fire cardinal bullets
    const b1 = makeBarrel(10, 10);   // BARL
    const b2 = makeBRL3(11, 10);     // BRL3
    const b3 = makeBarrel(12, 10);   // BARL
    const ctx = makeCombatCtx([b1, b2, b3]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(b3.alive).toBe(false);
  });
});

// ── Chain Reaction: Entity Damage ───────────────────────────────────────────
// Each barrel in the chain fires 200 Fire at its own cardinal cells.
// Entity damage accumulates from multiple barrel explosions.

describe('Chain reactions damage entities at each explosion site', () => {

  it('entity between two chaining barrels takes damage from both explosions', () => {
    // Layout: b1(10,10)  entity(11,10)  b2(12,10)
    // Entity is E of b1 (damaged by b1 explosion) AND W of b2 (damaged by b2 explosion)
    // But b2 is at (12,10), so entity at (11,10) is W of b2.
    // Wait — b1 fires E to (11,10), and that hits b2? No, b2 is at (12,10).
    // Let me use: b1(10,10), b2(11,10), entity(12,10)
    // b1 fires E → (11,10) → kills b2
    // b2 fires E → (12,10) → hits entity
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = victim.hp;
    const ctx = makeCombatCtx([b1, b2], [victim]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(victim.hp).toBeLessThan(hpBefore); // hit by b2's east fire-bullet
  });

  it('entity at cardinal cell of middle barrel in 3-chain takes damage', () => {
    // b1(10,10) → b2(11,10) → b3(12,10)
    // entity at (11,9) — N of b2
    // b2's explosion fires N → (11,9) → hits entity
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    const b3 = makeBarrel(12, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 9);
    const hpBefore = victim.hp;
    const ctx = makeCombatCtx([b1, b2, b3], [victim]);
    structureDamage(ctx, b1, 100);
    expect(victim.hp).toBeLessThan(hpBefore);
  });
});

// ── Barrel → Non-Barrel Structure Damage ────────────────────────────────────
// C++ applies Modify_Damage with WARHEAD_FIRE and the structure's Armor type.
// TS applies 200 raw damage (no warhead modifier).

describe('Barrel explosion vs non-barrel structures', () => {

  it('damages adjacent POWR (ARMOR_WOOD) by 200 — Fire vs wood = 100%', () => {
    // C++ Modify_Damage(200, WARHEAD_FIRE, ARMOR_WOOD, 0) = 200 * 1.0 = 200
    // TS structureDamage(ctx, s2, 200) = 200 raw
    // Result matches: both deal 200 to ARMOR_WOOD
    const barrel = makeBarrel(10, 10);
    const powr = makeBuilding('POWR', 11, 10, 400, 'wood');
    const ctx = makeCombatCtx([barrel, powr]);
    structureDamage(ctx, barrel, 100);
    expect(powr.hp).toBe(200); // 400 - 200 = 200
  });

  it('damages adjacent WEAP (ARMOR_LIGHT) — Fire vs light = 60%', () => {
    // C++ Modify_Damage(200, WARHEAD_FIRE, ARMOR_ALUMINUM, 0) = 200 * 0.6 = 120
    const barrel = makeBarrel(10, 10);
    const weap = makeBuilding('WEAP', 11, 10, 500, 'light');
    const ctx = makeCombatCtx([barrel, weap]);
    structureDamage(ctx, barrel, 100);
    // C++ parity: 200 * 0.6 (Fire vs light) = 120 damage → 500 - 120 = 380
    expect(weap.hp).toBe(380);
  });

  it('damages adjacent FACT (ARMOR_HEAVY) — Fire vs heavy = 25%', () => {
    // C++ Modify_Damage(200, WARHEAD_FIRE, ARMOR_STEEL, 0) = 200 * 0.25 = 50
    const barrel = makeBarrel(10, 10);
    const fact = makeBuilding('FACT', 11, 10, 1000, 'heavy');
    const ctx = makeCombatCtx([barrel, fact]);
    structureDamage(ctx, barrel, 100);
    // C++ parity: 200 * 0.25 (Fire vs heavy) = 50 damage → 1000 - 50 = 950
    expect(fact.hp).toBe(950);
  });

  it('barrel chain does NOT kill high-HP building with 200 raw damage', () => {
    const barrel = makeBarrel(10, 10);
    const building = makeBuilding('POWR', 11, 10, 256, 'wood');
    const ctx = makeCombatCtx([barrel, building]);
    structureDamage(ctx, barrel, 100);
    expect(barrel.alive).toBe(false);
    expect(building.alive).toBe(true);  // 256 - 200 = 56 HP remaining
    expect(building.hp).toBe(56);
  });
});

// ── Entity Damage Uses Fire Warhead Modifier ────────────────────────────────
// TS damageEntity(ctx, e, 200, 'Fire') applies warhead modifier via entity.takeDamage
// C++ Modify_Damage(200, WARHEAD_FIRE, target.Armor, distance)

describe('Barrel entity damage uses Fire warhead (infantry armor=none)', () => {

  it('infantry (ARMOR_NONE) takes Fire-modified damage: 200 * 0.9 = 180 base', () => {
    // C++ infantry has ARMOR_NONE: Fire modifier = 0.9
    // C++ Modify_Damage(200, WARHEAD_FIRE, ARMOR_NONE, 0) = 180
    // TS damageEntity(ctx, e, 200, 'Fire') applies warhead mod in takeDamage
    const barrel = makeBarrel(10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    const ctx = makeCombatCtx([barrel], [victim]);
    structureDamage(ctx, barrel, 100);
    // E1 infantry hp = 50, any amount over 50 kills it
    // 200 * 0.9 = 180 >>> 50, so it should be dead
    expect(victim.alive).toBe(false);
  });

  it('vehicle (ARMOR_HEAVY) takes Fire-modified damage: 200 * 0.25 = 50 base', () => {
    // C++ heavy tank has ARMOR_STEEL: Fire modifier = 0.25
    // C++ Modify_Damage(200, WARHEAD_FIRE, ARMOR_STEEL, 0) = 50
    const barrel = makeBarrel(10, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 11, 10); // heavy tank
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([barrel], [tank]);
    structureDamage(ctx, barrel, 100);
    // Heavy tank HP=400 in C++. Fire*0.25=50 damage. Should survive with damage.
    expect(tank.alive).toBe(true);
    expect(tank.hp).toBeLessThan(hpBefore);
  });

  it('entity in same cell as barrel takes splash damage from adjacent bullets', () => {
    // The barrel bullets target N/E/S/W cells, but each impact uses the normal
    // Explosion_Damage splash scan. Since the bullet source is null, an entity
    // in the barrel cell is not excluded as the source object.
    const barrel = makeBarrel(10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const hpBefore = victim.hp;
    const ctx = makeCombatCtx([barrel], [victim]);
    structureDamage(ctx, barrel, 100);
    expect(victim.hp).toBeLessThan(hpBefore);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────────────

describe('Chain reaction edge cases', () => {

  it('already-dead barrel does not chain (guard against double-explosion)', () => {
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    b2.alive = false;
    b2.hp = 0;
    const ctx = makeCombatCtx([b1, b2]);
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    // b2 was already dead, should not have re-exploded or crashed
    expect(b2.alive).toBe(false);
  });

  it('barrel with HP > damage threshold still chains when destroyed', () => {
    // Barrel with artificially high HP but killed by huge damage
    const b1 = makeBarrel(10, 10, 500);
    const b2 = makeBarrel(11, 10);
    const ctx = makeCombatCtx([b1, b2]);
    structureDamage(ctx, b1, 600); // damage exceeds HP
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false); // b1's explosion still fires bullets
  });

  it('circular chain: 4 barrels in square — all die (no infinite loop)', () => {
    // (10,10) → E → (11,10) → S → (11,11) → W → (10,11) → N → (10,10) [already dead]
    const b1 = makeBarrel(10, 10);
    const b2 = makeBarrel(11, 10);
    const b3 = makeBarrel(11, 11);
    const b4 = makeBarrel(10, 11);
    const ctx = makeCombatCtx([b1, b2, b3, b4]);
    // This must not infinite loop — already-dead barrels must not re-chain
    structureDamage(ctx, b1, 100);
    expect(b1.alive).toBe(false);
    expect(b2.alive).toBe(false);
    expect(b3.alive).toBe(false);
    expect(b4.alive).toBe(false);
  });

  it('large grid of barrels: 3x3 — all die without stack overflow', () => {
    const barrels: MapStructure[] = [];
    for (let x = 10; x <= 12; x++) {
      for (let y = 10; y <= 12; y++) {
        barrels.push(makeBarrel(x, y));
      }
    }
    const ctx = makeCombatCtx(barrels);
    structureDamage(ctx, barrels[0], 100); // trigger at (10,10)
    for (const b of barrels) {
      // All should die: cardinal adjacency covers the entire grid
      // (10,10)→(11,10)→(12,10) and (10,10)→(10,11)→(10,12) etc.
      expect(b.alive, `barrel at (${b.cx},${b.cy})`).toBe(false);
    }
  });
});

// ── Parity Gaps Summary ─────────────────────────────────────────────────────
// Previously documented C++/TS parity gaps — now resolved.

describe('PARITY RESOLVED: formerly-gapped C++ vs TS barrel behaviors', () => {

  it('RESOLVED: barrel-to-structure damage now applies Fire warhead modifier', () => {
    // C++ barrel fire-bullet → Explosion_Damage → Take_Damage → Modify_Damage
    //   applies warhead Verses modifier based on target's Armor type
    // TS now applies Fire warhead vs armor modifier before structureDamage
    const barrel = makeBarrel(10, 10);
    const heavyTarget = makeBuilding('FACT', 11, 10, 1000, 'heavy');
    const ctx = makeCombatCtx([barrel, heavyTarget]);
    structureDamage(ctx, barrel, 100);

    const tsDamage = 1000 - heavyTarget.hp;
    const cppExpected = Math.round(200 * 0.25);  // C++ Fire vs heavy=25% → 50

    expect(tsDamage).toBe(50);            // TS now matches C++
    expect(cppExpected).toBe(50);         // C++ expected
    expect(tsDamage).toBe(cppExpected);   // parity achieved
  });

  it('RESOLVED: BARL/BRL3 in STRUCTURE_ARMOR as none', () => {
    // C++ object.cpp:1963: ObjectTypeClass constructor sets Armor=ARMOR_NONE
    // rules.ini [BARL]/[BRL3] have no Armor= key → ARMOR_NONE persists
    // TS STRUCTURE_ARMOR now includes BARL/BRL3 as 'none'
    expect(STRUCTURE_ARMOR['BARL']).toBe('none');
    expect(STRUCTURE_ARMOR['BRL3']).toBe('none');
  });
});
