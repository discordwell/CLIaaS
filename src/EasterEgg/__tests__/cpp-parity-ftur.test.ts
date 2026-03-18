/**
 * C++ Behavioral Parity: FTUR — Flame Tower Defense Structure
 *
 * Tests verify Flame Tower behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * FTUR key stats (rules.ini / building.cpp):
 *   HP: 400, Size: 1x1, Cost: 600, Soviet faction
 *   Weapon: Fire warhead, 125 damage (highest non-Tesla defense), range 4, ROF 50, projSpeed 12
 *   Fire warhead vs armor: none=0.9, wood=1.0, light=0.6, heavy=0.25, concrete=0.5
 *   NOT power-dependent (not in STRUCTURE_POWERED)
 *   NOT turreted (not in TURRETED_STRUCTURES)
 *   NO anti-air capability (Fire weapon has no isAntiAir)
 *   Fire warhead infantryDeath=4 (burn animation)
 *   Short range: only 4 cells — shortest defense range
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, WARHEAD_VS_ARMOR, WARHEAD_PROPS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, type StructureWeapon,
  STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDefenseStructure(
  type: string,
  house: House,
  cx: number,
  cy: number,
  opts: { hp?: number; cooldown?: number; ammo?: number } = {},
): MapStructure {
  const maxHp = opts.hp ?? STRUCTURE_MAX_HP[type] ?? 256;
  const weapon = STRUCTURE_WEAPONS[type] ? { ...STRUCTURE_WEAPONS[type] } : undefined;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon,
    attackCooldown: opts.cooldown ?? 0,
    ammo: opts.ammo ?? -1,
    maxAmmo: -1,
  };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
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

// ── Structure Stats (rules.ini / building.cpp) ──────────────────────────────────

describe('FTUR structure stats (rules.ini)', () => {
  it('has 400 max HP', () => {
    expect(STRUCTURE_MAX_HP['FTUR']).toBe(400);
  });

  it('has 1x1 footprint', () => {
    expect(STRUCTURE_SIZE['FTUR']).toEqual([1, 1]);
  });

  it('is NOT power-dependent', () => {
    expect(STRUCTURE_POWERED.has('FTUR')).toBe(false);
  });
});

// ── Weapon Stats (rules.ini: Weapon=FireballLauncher) ─────────────────────────────

describe('FTUR weapon stats (rules.ini: Weapon=FireballLauncher)', () => {
  it('has Fire warhead', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].warhead).toBe('Fire');
  });

  it('has 125 base damage — highest non-Tesla defense', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].damage).toBe(125);
    // Verify it is indeed the highest non-Tesla defense damage
    for (const [type, w] of Object.entries(STRUCTURE_WEAPONS)) {
      if (type === 'TSLA' || type === 'QUEE') continue; // skip Tesla/Queen
      if (type === 'FTUR') continue;
      expect(w.damage, `${type} damage ${w.damage} should be < 125`).toBeLessThan(125);
    }
  });

  it('has range 4 cells — shortest defense range', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBe(4);
    // Verify it is the shortest defense range
    for (const [type, w] of Object.entries(STRUCTURE_WEAPONS)) {
      if (type === 'FTUR') continue;
      expect(w.range, `${type} range ${w.range} should be >= 4`).toBeGreaterThanOrEqual(4);
    }
  });

  it('has ROF 50 ticks', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].rof).toBe(50);
  });

  it('has projSpeed 12', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].projSpeed).toBe(12);
  });

  it('does NOT have isAntiAir flag', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].isAntiAir).toBeFalsy();
  });

  it('does NOT have splash defined in structure weapon table', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].splash).toBeUndefined();
  });
});

// ── Fire Warhead vs Armor (warhead.cpp) ────────────────────────────────────────────

describe('Fire warhead damage multipliers (warhead.cpp)', () => {
  it('0.9x vs none armor (infantry) — strong anti-infantry', () => {
    expect(WARHEAD_VS_ARMOR['Fire'][0]).toBe(0.9);
  });

  it('1.0x vs wood armor — full damage, best vs wood', () => {
    expect(WARHEAD_VS_ARMOR['Fire'][1]).toBe(1.0);
  });

  it('0.6x vs light armor', () => {
    expect(WARHEAD_VS_ARMOR['Fire'][2]).toBe(0.6);
  });

  it('0.25x vs heavy armor (tanks) — very weak vs tanks', () => {
    expect(WARHEAD_VS_ARMOR['Fire'][3]).toBe(0.25);
  });

  it('0.5x vs concrete armor (buildings)', () => {
    expect(WARHEAD_VS_ARMOR['Fire'][4]).toBe(0.5);
  });
});

// ── Fire Warhead Death Animation (warhead.cpp) ─────────────────────────────────────

describe('Fire warhead infantry death animation (warhead.cpp)', () => {
  it('uses infantryDeath=4 (burn) — fire death animation', () => {
    expect(WARHEAD_PROPS['Fire'].infantryDeath).toBe(4);
  });

  it('uses napalm1 explosion set', () => {
    expect(WARHEAD_PROPS['Fire'].explosionSet).toBe(3);
  });
});

// ── Firing at Enemies (building.cpp: updateStructureCombat) ──────────────────────

describe('FTUR fires at enemy in range (building.cpp)', () => {
  it('damages an infantry enemy within range', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Enemy 2 cells east — within range 4
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('applies Fire warhead multiplier — 0.9x damage to none armor infantry', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Use a high-HP infantry so it survives the hit (E1 has only 50 HP which is < 113 damage)
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    enemy.hp = 200;
    enemy.maxHp = 200;
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    // Fire vs none = 0.9 mult, damage 125 * 0.9 = 112.5 -> Math.round = 113
    expect(hpBefore - enemy.hp).toBe(113);
  });

  it('applies reduced damage to heavy armor (0.25x)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Heavy tank: armor = 'heavy'
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([ftur], [tank]);
    updateStructureCombat(ctx);
    // Fire vs heavy = 0.25 mult, damage 125 * 0.25 = 31.25 -> Math.round = 31
    expect(hpBefore - tank.hp).toBe(31);
  });

  it('applies reduced damage to light armor (0.6x)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // JEEP: armor = 'light'
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 12, 10);
    const hpBefore = jeep.hp;
    const ctx = makeCombatCtx([ftur], [jeep]);
    updateStructureCombat(ctx);
    // Fire vs light = 0.6 mult, damage 125 * 0.6 = 75
    expect(hpBefore - jeep.hp).toBe(75);
  });

  it('does NOT fire at enemy outside range 4', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Enemy 5 cells east — beyond range 4
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('fires at enemy at boundary range (just within 4 cells)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Enemy 3 cells east — inside range 4
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('does NOT fire at allied units', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Ukraine is allied with USSR
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 12, 10);
    const ctx = makeCombatCtx([ftur], [ally]);
    updateStructureCombat(ctx);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('sets attackCooldown to ROF after firing', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(ftur.attackCooldown).toBe(STRUCTURE_WEAPONS['FTUR'].rof);
  });

  it('does NOT fire while on cooldown', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10, { cooldown: 10 });
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('decrements cooldown each tick', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10, { cooldown: 5 });
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(ftur.attackCooldown).toBe(4);
  });
});

// ── Power Independence (building.cpp: PW1/PW3) ──────────────────────────────────

describe('FTUR fires during power outage (building.cpp: PW1/PW3)', () => {
  it('fires normally when power consumed > produced', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const hpBefore = enemy.hp;
    // Low power: consuming 200, producing 100
    const ctx = makeCombatCtx([ftur], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires normally when power produced is 0', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([ftur], [enemy], {
      powerConsumed: 100,
      powerProduced: 0,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('powered structure (GUN) does NOT fire during power outage — contrast with FTUR', () => {
    const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── No Turret (building.cpp) ─────────────────────────────────────────────────────

describe('FTUR has no turret rotation (building.cpp)', () => {
  it('does NOT set turretDir after firing', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(ftur.turretDir).toBeUndefined();
  });

  it('does NOT set desiredTurretDir after firing', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(ftur.desiredTurretDir).toBeUndefined();
  });

  it('does NOT set firingFlash after firing', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(ftur.firingFlash).toBeUndefined();
  });
});

// ── Anti-Air Gate (building.cpp) ─────────────────────────────────────────────────

describe('FTUR does NOT target airborne aircraft (building.cpp — AA gate)', () => {
  it('does NOT fire at airborne helicopter', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 12, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    const ctx = makeCombatCtx([ftur], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire at airborne fixed-wing aircraft', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 12, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([ftur], [mig]);
    updateStructureCombat(ctx);
    expect(mig.hp).toBe(mig.maxHp);
  });

  it('fires at landed aircraft (flightAltitude = 0)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 12, 10);
    heli.flightAltitude = 0; // landed
    const ctx = makeCombatCtx([ftur], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });
});

// ── Short Range Comparison (rules.ini) ──────────────────────────────────────────

describe('FTUR short range — only 4 cells (rules.ini)', () => {
  it('range is shorter than PBOX (range 5)', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBeLessThan(STRUCTURE_WEAPONS['PBOX'].range);
  });

  it('range is shorter than GUN (range 6)', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBeLessThan(STRUCTURE_WEAPONS['GUN'].range);
  });

  it('range is shorter than SAM (range 7.5)', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBeLessThan(STRUCTURE_WEAPONS['SAM'].range);
  });

  it('range is shorter than TSLA (range 8.5)', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBeLessThan(STRUCTURE_WEAPONS['TSLA'].range);
  });

  it('hits enemy at 3 cells but misses at 5 cells', () => {
    // Within range
    const ftur1 = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const close = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx1 = makeCombatCtx([ftur1], [close]);
    updateStructureCombat(ctx1);
    expect(close.hp).toBeLessThan(close.maxHp);

    // Outside range
    const ftur2 = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const far = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    const ctx2 = makeCombatCtx([ftur2], [far]);
    updateStructureCombat(ctx2);
    expect(far.hp).toBe(far.maxHp);
  });
});

// ── Target Selection / Threat Scoring (building.cpp) ──────────────────────────────

describe('FTUR target selection — threat-based scoring (building.cpp)', () => {
  it('prefers closer enemy over farther one when threat is similar', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    // Both are infantry: similar threat score, but closeEnemy is much closer
    const closeEnemy = entityAtCell(UnitType.I_E1, House.Spain, 11, 10); // 1 cell
    const farEnemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);   // 3 cells
    const ctx = makeCombatCtx([ftur], [closeEnemy, farEnemy]);
    updateStructureCombat(ctx);
    // Closer enemy should be targeted (damaged)
    const closeDmg = closeEnemy.maxHp - closeEnemy.hp;
    const farDmg = farEnemy.maxHp - farEnemy.hp;
    // Exactly one target should be damaged (single shot per tick)
    expect(closeDmg + farDmg).toBeGreaterThan(0);
    // Close enemy should be the one that got hit (higher score due to distance weighting)
    expect(closeDmg).toBeGreaterThan(0);
  });

  it('does NOT fire at dead enemies', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const deadEnemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    deadEnemy.hp = 0;
    deadEnemy.alive = false;
    const ctx = makeCombatCtx([ftur], [deadEnemy]);
    updateStructureCombat(ctx);
    // No target found — cooldown should remain 0
    expect(ftur.attackCooldown).toBe(0);
  });

  it('does NOT fire when structure is dead', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    ftur.alive = false;
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── Kill Tracking (building.cpp) ─────────────────────────────────────────────────

describe('FTUR kill tracking (building.cpp)', () => {
  it('increments killCount when player-allied FTUR kills an enemy', () => {
    // FTUR owned by player-allied house (Spain)
    const ftur = makeDefenseStructure('FTUR', House.Spain, 10, 10);
    // Weak enemy that will die from 113 Fire damage (125 * 0.9 vs none)
    const weakEnemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    weakEnemy.hp = 1; // will die from 113 damage
    const ctx = makeCombatCtx([ftur], [weakEnemy]);
    expect(ctx.killCount).toBe(0);
    updateStructureCombat(ctx);
    expect(weakEnemy.alive).toBe(false);
    expect(ctx.killCount).toBe(1);
  });

  it('one-shots standard infantry (50 HP) — 113 Fire damage vs none armor', () => {
    const ftur = makeDefenseStructure('FTUR', House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    // E1 has 50 HP, FTUR does 113 damage vs none armor
    expect(infantry.maxHp).toBe(50);
    const ctx = makeCombatCtx([ftur], [infantry]);
    updateStructureCombat(ctx);
    expect(infantry.alive).toBe(false);
  });
});

// ── Effects (rendering parity) ───────────────────────────────────────────────────

describe('FTUR fire effects (rendering parity)', () => {
  it('produces muzzle and projectile effects when firing', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    const muzzles = ctx.effects.filter(e => e.type === 'muzzle');
    const projectiles = ctx.effects.filter(e => e.type === 'projectile');
    expect(muzzles.length).toBeGreaterThanOrEqual(1);
    expect(projectiles.length).toBeGreaterThanOrEqual(1);
  });

  it('muzzle effect originates from structure center', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
    // Structure center: cx * CELL_SIZE + CELL_SIZE = 10*24 + 24 = 264
    const expectedX = 10 * CELL_SIZE + CELL_SIZE;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE;
    expect(muzzle!.x).toBe(expectedX);
    expect(muzzle!.y).toBe(expectedY);
  });

  it('does NOT produce tesla effect (FTUR is not a Tesla Coil)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    const teslaEffects = ctx.effects.filter(e => e.type === 'tesla');
    expect(teslaEffects.length).toBe(0);
  });
});

// ── Damage Comparison vs PBOX (cross-defense parity) ──────────────────────────────

describe('FTUR vs PBOX damage comparison (cross-defense parity)', () => {
  it('FTUR does more damage to infantry than PBOX (113 vs 40)', () => {
    // Use high-HP targets so they survive and we can measure exact damage
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const fturTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    fturTarget.hp = 200;
    fturTarget.maxHp = 200;
    const ctx1 = makeCombatCtx([ftur], [fturTarget]);
    updateStructureCombat(ctx1);
    const fturDmg = 200 - fturTarget.hp;

    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const pboxTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    pboxTarget.hp = 200;
    pboxTarget.maxHp = 200;
    const ctx2 = makeCombatCtx([pbox], [pboxTarget]);
    updateStructureCombat(ctx2);
    const pboxDmg = 200 - pboxTarget.hp;

    // FTUR: 125 * 0.9 = 113, PBOX: 40 * 1.0 = 40
    expect(fturDmg).toBeGreaterThan(pboxDmg);
    expect(fturDmg).toBe(113);
    expect(pboxDmg).toBe(40);
  });

  it('FTUR has shorter range than PBOX (4 vs 5)', () => {
    expect(STRUCTURE_WEAPONS['FTUR'].range).toBeLessThan(STRUCTURE_WEAPONS['PBOX'].range);
  });

  it('FTUR has same HP as PBOX (both 400)', () => {
    expect(STRUCTURE_MAX_HP['FTUR']).toBe(STRUCTURE_MAX_HP['PBOX']);
  });
});
