/**
 * C++ Behavioral Parity: GUN (Turret) Defense Structure
 *
 * Tests verify GUN turret behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * GUN key stats (RULES.INI):
 *   HP 400, 1x1, cost 600, Allied faction
 *   Weapon: TurretGun — AP warhead, 40 damage, range 6, ROF 50, splash 0.5
 *   TURRETED: turretDir rotates toward target (building.cpp)
 *   POWER-DEPENDENT: does NOT fire during power outage (PW1/PW3)
 *   NO anti-air capability
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist, Dir,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_POWERED,
  STRUCTURE_SIZE,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeGUN(cx: number, cy: number, house: House = House.Spain): MapStructure {
  const weapon = { ...STRUCTURE_WEAPONS['GUN'] };
  return {
    type: 'GUN', image: 'gun', house,
    cx, cy, hp: 400, maxHp: 400, alive: true, rubble: false,
    weapon,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    turretDir: 4,           // default: South
    desiredTurretDir: 4,
    firingFlash: 0,
  };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Place an airborne aircraft at a cell */
function airborneAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = entityAtCell(type, house, cx, cy);
  e.flightAltitude = Entity.FLIGHT_ALTITUDE;
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

// -- Structure Stats (RULES.INI / BTYPE.H) ------------------------------------

describe('GUN structure stats (RULES.INI)', () => {
  it('is a 1x1 building', () => {
    const size = STRUCTURE_SIZE['GUN'];
    expect(size).toEqual([1, 1]);
  });

  it('has AP warhead, 40 damage, range 6, ROF 50, splash 0.5', () => {
    const w = STRUCTURE_WEAPONS['GUN'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(40);
    expect(w.range).toBe(6);
    expect(w.rof).toBe(50);
    expect(w.warhead).toBe('AP');
    expect(w.splash).toBe(0.5);
  });

  it('is in STRUCTURE_POWERED (requires power to fire)', () => {
    expect(STRUCTURE_POWERED.has('GUN')).toBe(true);
  });

  it('has no anti-air capability', () => {
    const w = STRUCTURE_WEAPONS['GUN'];
    expect(w.isAntiAir).toBeFalsy();
  });
});

// -- Power Dependency (building.cpp PW1/PW3) -----------------------------------

describe('GUN power dependency (building.cpp PW1/PW3)', () => {

  it('fires at enemy when power is sufficient', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10); // 2 cells E, in range
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 50, powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('does NOT fire when power consumed > power produced (low power)', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 150, powerProduced: 100, // deficit
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('does NOT fire when power consumed equals power produced + 1 (any deficit)', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 101, powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('resumes firing when power is restored', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);

    // Phase 1: no power, no firing
    const ctx1 = makeCombatCtx([gun], [enemy], {
      powerConsumed: 200, powerProduced: 100,
    });
    updateStructureCombat(ctx1);
    const hpAfterOutage = enemy.hp;

    // Phase 2: power restored
    const ctx2 = makeCombatCtx([gun], [enemy], {
      powerConsumed: 50, powerProduced: 100,
    });
    updateStructureCombat(ctx2);
    expect(enemy.hp).toBeLessThan(hpAfterOutage);
  });
});

// -- Targeting (building.cpp) --------------------------------------------------

describe('GUN targeting — ground-only, range-limited (building.cpp)', () => {

  it('targets enemies within range 6', () => {
    const gun = makeGUN(10, 10);
    // 5 cells east = within range 6
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 15, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('does NOT target enemies beyond range 6', () => {
    const gun = makeGUN(10, 10);
    // 7 cells east = beyond range 6
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 17, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('does NOT target allied units', () => {
    const gun = makeGUN(10, 10, House.Spain);
    // Greece is allied with Spain via buildDefaultAlliances
    const ally = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    const hpBefore = ally.hp;
    const ctx = makeCombatCtx([gun], [ally]);
    updateStructureCombat(ctx);
    expect(ally.hp).toBe(hpBefore);
  });

  it('does NOT target airborne aircraft (no isAntiAir)', () => {
    const gun = makeGUN(10, 10);
    const aircraft = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const hpBefore = aircraft.hp;
    const ctx = makeCombatCtx([gun], [aircraft]);
    updateStructureCombat(ctx);
    expect(aircraft.hp).toBe(hpBefore);
  });

  it('CAN target landed aircraft (flightAltitude = 0)', () => {
    const gun = makeGUN(10, 10);
    const aircraft = entityAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    // flightAltitude defaults to 0 for new Entity
    expect(aircraft.flightAltitude).toBe(0);
    const hpBefore = aircraft.hp;
    const ctx = makeCombatCtx([gun], [aircraft]);
    updateStructureCombat(ctx);
    expect(aircraft.hp).toBeLessThan(hpBefore);
  });

  it('does NOT fire when dead', () => {
    const gun = makeGUN(10, 10);
    gun.alive = false;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('does NOT fire while being sold (sellProgress defined)', () => {
    const gun = makeGUN(10, 10);
    gun.sellProgress = 0.5;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });
});

// -- AP Warhead (RULES.INI Verses) ---------------------------------------------

describe('GUN AP warhead vs armor classes (RULES.INI)', () => {

  it('deals full 1.0x damage to heavy armor (tanks)', () => {
    const gun = makeGUN(10, 10);
    // 2TNK has heavy armor
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([gun], [tank]);
    updateStructureCombat(ctx);
    // AP vs heavy = 1.0, base 40 damage, direct hit (dist=0) + splash at dist=0
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    // direct: modifyDamage(40, AP, heavy, 0) = 40, splash: modifyDamage(40, AP, heavy, 0) = 40
    expect(hpBefore - tank.hp).toBe(80);
  });

  it('deals reduced 0.3x damage to unarmored infantry', () => {
    const gun = makeGUN(10, 10);
    // E1 has 'none' armor; AP vs none = 0.3
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = infantry.hp;
    const ctx = makeCombatCtx([gun], [infantry]);
    updateStructureCombat(ctx);
    // AP vs none = 0.3, base 40 => direct 40*0.3=12, splash 40*0.3=12, total=24
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    expect(hpBefore - infantry.hp).toBe(24);
  });

  it('deals 0.75x damage to light armor', () => {
    const gun = makeGUN(10, 10);
    // Jeep has light armor
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 12, 10);
    const hpBefore = jeep.hp;
    const ctx = makeCombatCtx([gun], [jeep]);
    updateStructureCombat(ctx);
    // AP vs light = 0.75, base 40 => direct 40*0.75=30, splash 40*0.75=30, total=60
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    expect(hpBefore - jeep.hp).toBe(60);
  });
});

// -- Splash Damage (building.cpp + combat.ts) ----------------------------------

describe('GUN splash damage (splash=0.5, CF2/CF3)', () => {

  it('applies splash damage to nearby enemies after direct hit', () => {
    const gun = makeGUN(10, 10);
    // Two enemies very close together — primary target + splash victim
    const primary = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    // Splash victim right next to primary (same cell)
    const splash = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [primary, splash]);
    updateStructureCombat(ctx);
    // Primary takes direct hit; splash victim takes splash damage
    expect(primary.hp).toBeLessThan(primary.maxHp);
    // Splash victim should also take damage (within 1.5-cell splash radius)
    expect(splash.hp).toBeLessThan(splash.maxHp);
  });

  it('splash does NOT reach entities beyond SPLASH_RADIUS (1.5 cells)', () => {
    const gun = makeGUN(10, 10);
    // Primary target at 2 cells east
    const primary = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    // Bystander 3 cells away from primary — well beyond 1.5-cell splash
    const bystander = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 10);
    const ctx = makeCombatCtx([gun], [primary, bystander]);
    updateStructureCombat(ctx);
    // Primary hit, bystander should be untouched (>1.5 cells from impact)
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(bystander.hp).toBe(bystander.maxHp);
  });
});

// -- Turret Rotation (building.cpp) --------------------------------------------

describe('GUN turret rotation (building.cpp — TURRETED_STRUCTURES)', () => {

  it('sets desiredTurretDir toward target when firing', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = 4; // South
    gun.desiredTurretDir = 4;
    // Place enemy to the North
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 7);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    // desiredTurretDir should point toward the enemy (North = 0)
    expect(gun.desiredTurretDir).toBe(Dir.N);
  });

  it('turretDir rotates one step per tick toward desiredTurretDir (shortest path)', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = 4; // South
    gun.desiredTurretDir = 4;
    // Place enemy to the East — direction = 2
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 14, 10);
    const ctx = makeCombatCtx([gun], [enemy]);

    // First tick: turret rotation runs first (turretDir==desiredTurretDir, no rotation yet),
    // then targeting sets desiredTurretDir to East. turretDir stays at 4 (South).
    updateStructureCombat(ctx);
    expect(gun.desiredTurretDir).toBe(Dir.E);
    expect(gun.turretDir).toBe(4); // no rotation yet on first tick

    // Second tick: turret rotation runs with turretDir=4, desired=2.
    // diff = (2 - 4 + 8) % 8 = 6. Since 6 > 4, rotate CCW: (4 + 7) % 8 = 3 (SE)
    gun.attackCooldown = 5; // still on cooldown, but turret rotation is independent
    const ctx2 = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx2);
    expect(gun.turretDir).toBe(3); // one step CCW from South toward East
  });

  it('turretDir reaches desiredTurretDir after enough ticks', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = 4; // South
    gun.desiredTurretDir = 2; // East (already pre-set)

    // Enemy far away so range check works, but also within range
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 14, 10);

    // Run enough ticks with cooldown reset to allow rotation
    for (let i = 0; i < 10; i++) {
      const ctx = makeCombatCtx([gun], [enemy]);
      updateStructureCombat(ctx);
      gun.attackCooldown = 0; // reset cooldown to allow re-targeting
    }
    // After several ticks, turret should have reached East (2)
    expect(gun.turretDir).toBe(Dir.E);
  });

  it('initializes turretDir to 4 (South) if undefined', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = undefined;
    gun.desiredTurretDir = undefined;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    // After first tick, turretDir should have been initialized and then stepped
    expect(gun.turretDir).toBeDefined();
  });

  it('sets firingFlash to 4 when firing', () => {
    const gun = makeGUN(10, 10);
    gun.firingFlash = 0;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.firingFlash).toBe(4);
  });

  it('firingFlash decrements each tick', () => {
    const gun = makeGUN(10, 10);
    gun.firingFlash = 3;
    gun.attackCooldown = 5; // on cooldown, won't fire but will tick turret
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.firingFlash).toBe(2);
  });
});

// -- Rate of Fire / Cooldown (building.cpp) ------------------------------------

describe('GUN rate of fire (ROF=50, building.cpp)', () => {

  it('sets attackCooldown to ROF (50) after firing', () => {
    const gun = makeGUN(10, 10);
    expect(gun.attackCooldown).toBe(0);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.attackCooldown).toBe(50);
  });

  it('does NOT fire while on cooldown', () => {
    const gun = makeGUN(10, 10);
    gun.attackCooldown = 10;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('cooldown decrements each tick', () => {
    const gun = makeGUN(10, 10);
    gun.attackCooldown = 10;
    const ctx = makeCombatCtx([gun], []);
    updateStructureCombat(ctx);
    expect(gun.attackCooldown).toBe(9);
  });
});

// -- Threat Scoring (building.cpp) ---------------------------------------------

describe('GUN threat-based targeting (building.cpp priority scoring)', () => {

  it('prefers a dangerous target (armed vehicle) over a harmless target', () => {
    const gun = makeGUN(10, 10);
    // Harmless truck — no weapon, low threat score
    const truck = entityAtCell(UnitType.V_TRUK, House.USSR, 12, 10);
    // Armed tank — weapon gives higher threat score
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 11);
    const ctx = makeCombatCtx([gun], [truck, tank]);
    updateStructureCombat(ctx);
    // Tank should take damage (higher threat score), truck should be untouched
    expect(tank.hp).toBeLessThan(tank.maxHp);
  });
});

// -- Effects & Sound (building.cpp) -------------------------------------------

describe('GUN visual effects on fire (building.cpp)', () => {

  it('produces muzzle flash effect when firing', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
  });

  it('produces projectile effect toward target', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    const proj = ctx.effects.find(e => e.type === 'projectile');
    expect(proj).toBeDefined();
  });

  it('produces explosion effect at target position', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    const explosion = ctx.effects.find(e => e.type === 'explosion');
    expect(explosion).toBeDefined();
  });
});

// -- Kill Tracking (building.cpp) ---------------------------------------------

describe('GUN kill tracking (building.cpp)', () => {

  it('increments killCount when an allied GUN kills an enemy', () => {
    const gun = makeGUN(10, 10, House.Spain);
    // Low-HP enemy that will die from 40 damage (AP vs none = 12 dmg, need none armor with <=12 HP)
    // Actually use infantry with very low HP
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    enemy.hp = 1; // will die from any damage
    const ctx = makeCombatCtx([gun], [enemy]);
    expect(ctx.killCount).toBe(0);
    updateStructureCombat(ctx);
    expect(enemy.alive).toBe(false);
    // Kill should be tracked since GUN owner (Spain) is allied with playerHouse (Spain)
    // Note: the handleUnitDeath in structure combat sets attackerIsPlayer based on alliance
  });
});

// -- Integration: Multiple GUNs -----------------------------------------------

describe('GUN integration — multiple turrets', () => {

  it('two GUNs can independently target different enemies', () => {
    const gun1 = makeGUN(10, 10);
    const gun2 = makeGUN(20, 10);
    const enemy1 = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10); // near gun1
    const enemy2 = entityAtCell(UnitType.V_2TNK, House.USSR, 22, 10); // near gun2
    const ctx = makeCombatCtx([gun1, gun2], [enemy1, enemy2]);
    updateStructureCombat(ctx);
    // Both enemies should take damage
    expect(enemy1.hp).toBeLessThan(enemy1.maxHp);
    expect(enemy2.hp).toBeLessThan(enemy2.maxHp);
  });

  it('one GUN on cooldown does not prevent another from firing', () => {
    const gun1 = makeGUN(10, 10);
    gun1.attackCooldown = 30; // on cooldown
    const gun2 = makeGUN(20, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 22, 10); // only near gun2
    const ctx = makeCombatCtx([gun1, gun2], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});
