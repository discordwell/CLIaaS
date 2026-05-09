/**
 * C++ Behavioral Parity: PBOX — Pillbox Defense Structure
 *
 * Tests verify pillbox behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * PBOX key stats (rules.ini / building.cpp):
 *   HP: 400, Size: 1x1, Cost: 400, Allied faction
 *   Weapon: SA warhead, 40 damage, range 5, ROF 40, projSpeed 100
 *   SA warhead vs armor: none=1.0, wood=0.5, light=0.6, heavy=0.25, concrete=0.25
 *   NOT power-dependent (not in STRUCTURE_POWERED)
 *   NOT turreted (not in TURRETED_STRUCTURES)
 *   NO anti-air capability (SA weapon has no isAntiAir)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, WARHEAD_VS_ARMOR,
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
    ...overrides,
  } as CombatContext;
}

// ── Structure Stats (rules.ini / building.cpp) ──────────────────────────────────

describe('PBOX structure stats (rules.ini)', () => {
  it('has 400 max HP', () => {
    expect(STRUCTURE_MAX_HP['PBOX']).toBe(400);
  });

  it('has 1x1 footprint', () => {
    expect(STRUCTURE_SIZE['PBOX']).toEqual([1, 1]);
  });

  it('is NOT power-dependent', () => {
    expect(STRUCTURE_POWERED.has('PBOX')).toBe(false);
  });
});

// ── Weapon Stats (rules.ini: Weapon=Vulcan) ─────────────────────────────────────

describe('PBOX weapon stats (rules.ini: Weapon=Vulcan)', () => {
  it('has SA warhead', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].warhead).toBe('SA');
  });

  it('has 40 base damage', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].damage).toBe(40);
  });

  it('has range 5 cells', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].range).toBe(5);
  });

  it('has ROF 40 ticks', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].rof).toBe(40);
  });

  it('has projSpeed 100', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].projSpeed).toBe(100);
  });

  it('does NOT have isAntiAir flag', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].isAntiAir).toBeFalsy();
  });

  it('shares identical weapon stats with HBOX (Camo Pillbox)', () => {
    const pbox = STRUCTURE_WEAPONS['PBOX'];
    const hbox = STRUCTURE_WEAPONS['HBOX'];
    expect(pbox.damage).toBe(hbox.damage);
    expect(pbox.range).toBe(hbox.range);
    expect(pbox.rof).toBe(hbox.rof);
    expect(pbox.warhead).toBe(hbox.warhead);
    expect(pbox.projSpeed).toBe(hbox.projSpeed);
  });
});

// ── SA Warhead vs Armor (warhead.cpp) ────────────────────────────────────────────

describe('SA warhead damage multipliers (warhead.cpp)', () => {
  it('1.0x vs none armor (infantry)', () => {
    expect(WARHEAD_VS_ARMOR['SA'][0]).toBe(1.0);
  });

  it('0.5x vs wood armor', () => {
    expect(WARHEAD_VS_ARMOR['SA'][1]).toBe(0.5);
  });

  it('0.6x vs light armor', () => {
    expect(WARHEAD_VS_ARMOR['SA'][2]).toBe(0.6);
  });

  it('0.25x vs heavy armor (tanks)', () => {
    expect(WARHEAD_VS_ARMOR['SA'][3]).toBe(0.25);
  });

  it('0.25x vs concrete armor (buildings)', () => {
    expect(WARHEAD_VS_ARMOR['SA'][4]).toBe(0.25);
  });
});

// ── Firing at Enemies (building.cpp: updateStructureCombat) ──────────────────────

describe('PBOX fires at enemy in range (building.cpp)', () => {
  it('damages an infantry enemy within range', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Enemy 2 cells east — well within range 5
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('applies SA warhead multiplier — full damage to none armor infantry', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    // SA vs none = 1.0 mult, damage 40, distance 0 (direct hit) => 40 damage
    expect(hpBefore - enemy.hp).toBe(40);
  });

  it('applies reduced damage to heavy armor (0.25x)', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Heavy tank: armor = 'heavy'
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([pbox], [tank]);
    updateStructureCombat(ctx);
    // SA vs heavy = 0.25 mult, damage 40 * 0.25 = 10
    expect(hpBefore - tank.hp).toBe(10);
  });

  it('does NOT fire at enemy outside range', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Enemy 6 cells east — beyond range 5
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 16, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('does NOT fire at allied units', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Greece is allied with Spain
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 12, 10);
    const ctx = makeCombatCtx([pbox], [ally]);
    updateStructureCombat(ctx);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('sets attackCooldown to ROF after firing', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(pbox.attackCooldown).toBe(STRUCTURE_WEAPONS['PBOX'].rof);
  });

  it('does NOT fire while on cooldown', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10, { cooldown: 10 });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('decrements cooldown each tick', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10, { cooldown: 5 });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(pbox.attackCooldown).toBe(4);
  });
});

// ── Power Independence (building.cpp: PW1/PW3) ──────────────────────────────────

describe('PBOX fires during power outage (building.cpp: PW1/PW3)', () => {
  it('fires normally when power consumed > produced', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    // Low power: consuming 200, producing 100
    const ctx = makeCombatCtx([pbox], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires normally when power produced is 0', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([pbox], [enemy], {
      powerConsumed: 100,
      powerProduced: 0,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('powered structure (GUN) does NOT fire during power outage — contrast with PBOX', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── No Turret (building.cpp) ─────────────────────────────────────────────────────

describe('PBOX has no turret rotation (building.cpp)', () => {
  it('does NOT set turretDir after firing', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(pbox.turretDir).toBeUndefined();
  });

  it('does NOT set desiredTurretDir after firing', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(pbox.desiredTurretDir).toBeUndefined();
  });

  it('does NOT set firingFlash after firing', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(pbox.firingFlash).toBeUndefined();
  });
});

// ── Anti-Air Gate (building.cpp) ─────────────────────────────────────────────────

describe('PBOX does NOT target airborne aircraft (building.cpp — AA gate)', () => {
  it('does NOT fire at airborne helicopter', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    const ctx = makeCombatCtx([pbox], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire at airborne fixed-wing aircraft', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 12, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([pbox], [mig]);
    updateStructureCombat(ctx);
    expect(mig.hp).toBe(mig.maxHp);
  });

  it('fires at landed aircraft (flightAltitude = 0)', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    heli.flightAltitude = 0; // landed
    const ctx = makeCombatCtx([pbox], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });
});

// ── Target Selection / Threat Scoring (building.cpp) ──────────────────────────────

describe('PBOX target selection — threat-based scoring (building.cpp)', () => {
  it('prefers closer enemy over farther one when threat is similar', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Both are infantry: similar threat score, but closeEnemy is much closer
    const closeEnemy = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // 1 cell
    const farEnemy = entityAtCell(UnitType.I_E1, House.USSR, 14, 10);   // 4 cells
    const ctx = makeCombatCtx([pbox], [closeEnemy, farEnemy]);
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
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const deadEnemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    deadEnemy.hp = 0;
    deadEnemy.alive = false;
    const ctx = makeCombatCtx([pbox], [deadEnemy]);
    updateStructureCombat(ctx);
    // No target found — cooldown should remain 0
    expect(pbox.attackCooldown).toBe(0);
  });

  it('does NOT fire when structure is dead', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    pbox.alive = false;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── Kill Tracking (building.cpp) ─────────────────────────────────────────────────

describe('PBOX kill tracking (building.cpp)', () => {
  it('increments killCount when player-allied PBOX kills an enemy', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    // Use a very weak enemy that will die in one shot (40 SA damage vs none armor = 40 damage)
    const weakEnemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    weakEnemy.hp = 1; // will die from 40 damage
    const ctx = makeCombatCtx([pbox], [weakEnemy]);
    expect(ctx.killCount).toBe(0);
    updateStructureCombat(ctx);
    expect(weakEnemy.alive).toBe(false);
    // killCount should have incremented for player-allied kill
    expect(ctx.killCount).toBe(1);
  });
});

// ── Effects (rendering parity) ───────────────────────────────────────────────────

describe('PBOX fire effects (rendering parity)', () => {
  it('produces muzzle and projectile effects when firing', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    const muzzles = ctx.effects.filter(e => e.type === 'muzzle');
    const projectiles = ctx.effects.filter(e => e.type === 'projectile');
    expect(muzzles.length).toBeGreaterThanOrEqual(1);
    expect(projectiles.length).toBeGreaterThanOrEqual(1);
  });

  it('muzzle effect originates from structure center', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
    // PBOX is BSIZE_11; C++ CenterOffset[BSIZE_11] is 0x00800080,
    // i.e. half a cell from the building's upper-left coordinate.
    const expectedX = 10 * CELL_SIZE + CELL_SIZE / 2;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE / 2;
    expect(muzzle!.x).toBe(expectedX);
    expect(muzzle!.y).toBe(expectedY);
  });
});
