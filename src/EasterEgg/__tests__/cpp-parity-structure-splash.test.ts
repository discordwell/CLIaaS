/**
 * C++ Behavioral Parity: Structure Splash Damage
 *
 * Tests verify that splash damage (Explosion_Damage, combat.cpp:162-237)
 * correctly damages structures within the splash radius, matching C++ behavior.
 *
 * C++ source of truth:
 * - combat.cpp:205-213 — Cell_Occupier() chains include buildings (RTTI_BUILDING)
 * - combat.cpp:227-228 — Buildings at impact cell get distance=0 (full damage)
 * - combat.cpp:229-230 — Other buildings use actual distance
 * - combat.cpp:232-234 — All objects within range take damage via Take_Damage
 *
 * Prior to this fix, applySplashDamage only iterated ctx.entities (units/infantry),
 * so structures never took splash damage from nearby explosions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist, modifyDamage,
  WARHEAD_VS_ARMOR,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { ScenarioRandom } from '../engine/random';
import {
  type CombatContext,
  applySplashDamage,
  structureDamage,
  getWarheadMult,
  getWarheadMeta,
  SPLASH_RADIUS,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE, STRUCTURE_ARMOR } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStructure(type: string, cx: number, cy: number, hp: number, house = House.USSR): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, armor: STRUCTURE_ARMOR[type] ?? 'wood',
    alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
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

// ── Structure at Impact Cell (combat.cpp:227-228) ───────────────────────────

describe('Structure at impact cell takes full splash damage (combat.cpp:227-228)', () => {

  it('1x1 structure at impact cell takes full damage (distance=0)', () => {
    const structure = makeStructure('SILO', 10, 10, 300);
    const ctx = makeCombatCtx([structure]);
    // Splash center at center of cell (10,10) — directly on the structure
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBeLessThan(300);
  });

  it('2x2 structure hit on any occupied cell gets distance=0', () => {
    // POWR is 2x2, placed at (10,10) occupying (10,10), (11,10), (10,11), (11,11)
    const structure = makeStructure('POWR', 10, 10, 400);
    const ctx = makeCombatCtx([structure]);
    // Splash center at cell (11,11) — corner of the 2x2 footprint
    const center = { x: 11 * CELL_SIZE + CELL_SIZE / 2, y: 11 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBeLessThan(400);
  });

  it('3x3 structure (FACT) hit on edge cell gets distance=0', () => {
    // FACT is 3x3, placed at (5,5) occupying (5..7, 5..7)
    const structure = makeStructure('FACT', 5, 5, 1000);
    const ctx = makeCombatCtx([structure]);
    // Splash center at cell (7,7) — far corner of the 3x3 footprint
    const center = { x: 7 * CELL_SIZE + CELL_SIZE / 2, y: 7 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBeLessThan(1000);
  });
});

// ── Structure at Adjacent Cell (combat.cpp:229-230) ─────────────────────────

describe('Structure at adjacent cell takes reduced splash damage (combat.cpp:229-230)', () => {

  it('structure 1 cell away takes less damage than structure at impact cell', () => {
    const atImpact = makeStructure('SILO', 10, 10, 500);
    const adjacent = makeStructure('SILO', 11, 10, 500);
    const ctx = makeCombatCtx([atImpact, adjacent]);
    // Splash at center of cell (10,10)
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    const impactDmg = 500 - atImpact.hp;
    const adjacentDmg = 500 - adjacent.hp;
    expect(impactDmg).toBeGreaterThan(0);
    expect(adjacentDmg).toBeGreaterThan(0);
    expect(impactDmg).toBeGreaterThan(adjacentDmg);
  });

  it('structure diagonally adjacent takes reduced damage when impact is inside strict splash radius', () => {
    const structure = makeStructure('SILO', 11, 11, 500);
    const ctx = makeCombatCtx([structure]);
    // Shift the impact toward the diagonal cell. A cell-center diagonal is
    // exactly 384 leptons by C++ Distance() and is excluded by `distance < range`.
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + 6, y: 10 * CELL_SIZE + CELL_SIZE / 2 + 6 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBeLessThan(500);
  });
});

// ── Structure Beyond Splash Radius ──────────────────────────────────────────

describe('Structure beyond splash radius takes no damage (combat.cpp:232)', () => {

  it('structure 2 cells away takes no splash damage (radius = 1.5 cells)', () => {
    const structure = makeStructure('SILO', 12, 10, 300);
    const ctx = makeCombatCtx([structure]);
    // Splash at center of cell (10,10) — 2 cells away from structure center
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBe(300);
  });

  it('structure 3 cells away takes no splash damage', () => {
    const structure = makeStructure('POWR', 13, 10, 400);
    const ctx = makeCombatCtx([structure]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBe(400);
  });

  it('structure diagonally 2 cells away (~2.83 cells) takes no splash damage', () => {
    const structure = makeStructure('SILO', 12, 12, 300);
    const ctx = makeCombatCtx([structure]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBe(300);
  });
});

// ── Multiple Structures in Radius ───────────────────────────────────────────

describe('Multiple structures in radius all take appropriate damage (combat.cpp:205-213)', () => {

  it('3 structures at varying distances each take proportional damage', () => {
    const atImpact = makeStructure('SILO', 10, 10, 500);
    const oneAway = makeStructure('SILO', 11, 10, 500);
    const diagAway = makeStructure('SILO', 11, 11, 500);
    const ctx = makeCombatCtx([atImpact, oneAway, diagAway]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + 6, y: 10 * CELL_SIZE + CELL_SIZE / 2 + 6 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);

    const impactDmg = 500 - atImpact.hp;
    const oneDmg = 500 - oneAway.hp;
    const diagDmg = 500 - diagAway.hp;

    // All should take damage
    expect(impactDmg).toBeGreaterThan(0);
    expect(oneDmg).toBeGreaterThan(0);
    expect(diagDmg).toBeGreaterThan(0);

    // Impact > 1-cell > diagonal (farther = less damage)
    expect(impactDmg).toBeGreaterThan(oneDmg);
    expect(oneDmg).toBeGreaterThan(diagDmg);
  });

  it('structures outside radius are unaffected while inside ones take damage', () => {
    const inside = makeStructure('SILO', 10, 10, 500);
    const outside = makeStructure('SILO', 13, 10, 500);
    const ctx = makeCombatCtx([inside, outside]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(inside.hp).toBeLessThan(500);
    expect(outside.hp).toBe(500);
  });

  it('dead structures are skipped', () => {
    const dead = makeStructure('SILO', 10, 10, 0);
    dead.alive = false;
    const alive = makeStructure('SILO', 11, 10, 500);
    const ctx = makeCombatCtx([dead, alive]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(dead.alive).toBe(false);
    expect(alive.hp).toBeLessThan(500);
  });
});

// ── Warhead Modifiers ───────────────────────────────────────────────────────

describe('Structure splash damage uses warhead modifiers (combat.cpp:98-101)', () => {

  it('HE warhead applies per-building armor multiplier (SILO=wood)', () => {
    const structure = makeStructure('SILO', 10, 10, 500);
    const ctx = makeCombatCtx([structure]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    const actualDmg = 500 - structure.hp;
    // SILO has wood armor per rules.ini (C++ bdata.cpp)
    const armor = STRUCTURE_ARMOR['SILO'] ?? 'wood';
    const whMult = getWarheadMult('HE', armor, {});
    const expected = modifyDamage(100, 'HE', armor, 0, 1.0, whMult, getWarheadMeta('HE', {}).spreadFactor);
    expect(actualDmg).toBe(expected);
  });

  it('AP warhead applies per-building armor multiplier (SILO=wood)', () => {
    const structure = makeStructure('SILO', 10, 10, 500);
    const ctx = makeCombatCtx([structure]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'AP', splash: 1 }, -1, House.Spain);
    const actualDmg = 500 - structure.hp;
    const armor = STRUCTURE_ARMOR['SILO'] ?? 'wood';
    const whMult = getWarheadMult('AP', armor, {});
    const expected = modifyDamage(100, 'AP', armor, 0, 1.0, whMult, getWarheadMeta('AP', {}).spreadFactor);
    expect(actualDmg).toBe(expected);
  });

  it('SA warhead applies per-building armor multiplier (SILO=wood)', () => {
    const structure = makeStructure('SILO', 10, 10, 500);
    const ctx = makeCombatCtx([structure]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'SA', splash: 1 }, -1, House.Spain);
    const actualDmg = 500 - structure.hp;
    const armor = STRUCTURE_ARMOR['SILO'] ?? 'wood';
    const whMult = getWarheadMult('SA', armor, {});
    const expected = modifyDamage(100, 'SA', armor, 0, 1.0, whMult, getWarheadMeta('SA', {}).spreadFactor);
    expect(actualDmg).toBe(expected);
  });

  it('different warheads produce different damage amounts on same structure', () => {
    const sHE = makeStructure('SILO', 10, 10, 500);
    const sSA = makeStructure('SILO', 10, 10, 500);
    const ctxHE = makeCombatCtx([sHE]);
    const ctxSA = makeCombatCtx([sSA]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctxHE, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    applySplashDamage(ctxSA, center, { damage: 100, warhead: 'SA', splash: 1 }, -1, House.Spain);
    const heDmg = 500 - sHE.hp;
    const saDmg = 500 - sSA.hp;
    // HE and SA have different multipliers vs wood armor (SILO), so damage should differ
    const armor = STRUCTURE_ARMOR['SILO'] ?? 'wood';
    const heMult = getWarheadMult('HE', armor, {});
    const saMult = getWarheadMult('SA', armor, {});
    if (heMult !== saMult) {
      expect(heDmg).not.toBe(saDmg);
    }
  });
});

// ── Splash Hits Both Entities AND Structures ────────────────────────────────

describe('Splash hits both entities and structures simultaneously (combat.cpp:205-237)', () => {

  it('entity and structure at same cell both take splash damage', () => {
    const structure = makeStructure('SILO', 10, 10, 500);
    const entity = new Entity(UnitType.V_2TNK, House.USSR,
      10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    const ctx = makeCombatCtx([structure], [entity]);
    // Splash at an adjacent cell so neither is the primary target
    const center = { x: 11 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1 }, -1, House.Spain);
    expect(structure.hp).toBeLessThan(500);
    expect(entity.hp).toBeLessThan(entity.maxHp);
  });
});

// ── Mine Armor Defaults ────────────────────────────────────────────────────

describe('Mine structures use C++ ARMOR_NONE defaults for splash falloff', () => {
  it('adjacent MINV survives low AP splash that falls to zero vs ARMOR_NONE', () => {
    const mine = makeStructure('MINV', 11, 10, 1);
    const ctx = makeCombatCtx([mine]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    applySplashDamage(ctx, center, { damage: 30, warhead: 'AP', splash: 1 }, -1, House.Spain);

    expect(STRUCTURE_ARMOR['MINV']).toBe('none');
    expect(mine.hp).toBe(1);
    expect(mine.alive).toBe(true);
  });

  it('adjacent MINP survives low AP splash that falls to zero vs ARMOR_NONE', () => {
    const mine = makeStructure('MINP', 11, 10, 1);
    const ctx = makeCombatCtx([mine]);
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    applySplashDamage(ctx, center, { damage: 30, warhead: 'AP', splash: 1 }, -1, House.Spain);

    expect(STRUCTURE_ARMOR['MINP']).toBe('none');
    expect(mine.hp).toBe(1);
    expect(mine.alive).toBe(true);
  });

  it('insignificant mines do not trigger Base_Is_Attacked recruitment RNG on zero-damage splash', () => {
    const mine = makeStructure('MINV', 11, 10, 1, House.USSR);
    const attacker = new Entity(UnitType.I_E1, House.Spain, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    const defender = new Entity(UnitType.I_E3, House.USSR, 12 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    defender.mission = Mission.GUARD;
    const ctx = makeCombatCtx([mine], [attacker, defender]);
    let suspendCalls = 0;
    ctx.suspendTeamsByPriority = () => { suspendCalls++; };

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    applySplashDamage(ctx, center, { damage: 30, warhead: 'AP', splash: 1 }, -1, attacker.house, attacker);

    expect(STRUCTURE_ARMOR['MINV']).toBe('none');
    expect(mine.hp).toBe(1);
    expect(mine.alive).toBe(true);
    expect(suspendCalls).toBe(0);
    expect(defender.target).toBeNull();
    expect(defender.mission).toBe(Mission.GUARD);
    expect(ScenarioRandom.callCount).toBe(0);
  });
});
