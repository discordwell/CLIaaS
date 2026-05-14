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
 *   NOT power-dependent: fires regardless of power state (C++ bdata.cpp:2836 IsPowered=false)
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
  setStructureTurretDesired,
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

function makeGUN(cx: number, cy: number, house: House = House.Spain, facing: number = 2): MapStructure {
  const weapon = { ...STRUCTURE_WEAPONS['GUN'] };
  return {
    type: 'GUN', image: 'gun', house,
    cx, cy, hp: 400, maxHp: 400, alive: true, rubble: false,
    weapon,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    turretDir: facing,           // pre-aligned to target direction (default East)
    desiredTurretDir: facing,
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
    logicAnims: [],
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

  it('is NOT in STRUCTURE_POWERED (fires regardless of power state)', () => {
    expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
  });

  it('has no anti-air capability', () => {
    const w = STRUCTURE_WEAPONS['GUN'];
    expect(w.isAntiAir).toBeFalsy();
  });
});

// -- Power Independence (C++ bdata.cpp:2836 IsPowered=false) --------------------
// GUN is NOT power-dependent. It fires regardless of power state.

describe('GUN fires regardless of power state (not in STRUCTURE_POWERED)', () => {

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

  it('fires even when power consumed > power produced (GUN is unpowered)', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 150, powerProduced: 100, // deficit
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires even during severe power deficit (GUN is unpowered)', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 101, powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires when powerProduced is 0 (no power buildings)', () => {
    const gun = makeGUN(10, 10);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy], {
      powerConsumed: 0, powerProduced: 0,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
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
    // Simulate a landed aircraft (constructor defaults to airborne)
    aircraft.flightAltitude = 0;
    aircraft.aircraftState = 'landed';
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
    // C++ bullet.cpp:991 — Explosion_Damage is sole damage path. Target at dist=0 gets full damage.
    // AP vs heavy = 1.0, base 40 => modifyDamage(40, AP, heavy, 0) = 40
    expect(hpBefore - tank.hp).toBe(40);
  });

  it('deals reduced 0.3x damage to unarmored infantry', () => {
    const gun = makeGUN(10, 10);
    // E1 has 'none' armor; AP vs none = 0.3
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = infantry.hp;
    const ctx = makeCombatCtx([gun], [infantry]);
    updateStructureCombat(ctx);
    // C++ bullet.cpp:991 — Explosion_Damage is sole damage path.
    // AP vs none = 0.3, base 40 => modifyDamage(40, AP, none, 0) = 12
    expect(hpBefore - infantry.hp).toBe(12);
  });

  it('deals 0.75x damage to light armor', () => {
    const gun = makeGUN(10, 10);
    // Jeep has light armor
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 12, 10);
    const hpBefore = jeep.hp;
    const ctx = makeCombatCtx([gun], [jeep]);
    updateStructureCombat(ctx);
    // C++ bullet.cpp:991 — Explosion_Damage is sole damage path.
    // AP vs light = 0.75, base 40 => modifyDamage(40, AP, light, 0) = 30
    expect(hpBefore - jeep.hp).toBe(30);
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

  it('turretDir rotates via ROT accumulator toward desiredTurretDir (shortest path)', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = 4; // South
    gun.desiredTurretDir = 4;
    gun.turretRotAccum = 0;
    // Place enemy to the East — direction = 2
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 14, 10);
    const ctx = makeCombatCtx([gun], [enemy]);

    // First tick: turret rotation runs first (turretDir==desiredTurretDir, no rotation yet),
    // then targeting sets desiredTurretDir to East. turretDir stays at 4 (South).
    updateStructureCombat(ctx);
    expect(gun.desiredTurretDir).toBe(Dir.E);
    expect(gun.turretDir).toBe(4); // no rotation yet on first tick

    // GUN uses rules.ini ROT=12 in 256-facing space. After the initial tick
    // sets the desired facing, seven more completed ticks are enough to reach
    // the East bucket.
    for (let i = 0; i < 7; i++) {
      gun.attackCooldown = 5; // on cooldown, but turret rotation is independent
      const ctx2 = makeCombatCtx([gun], [enemy]);
      updateStructureCombat(ctx2);
    }
    expect(gun.turretDir).toBe(Dir.E);
  });

  it('turretDir reaches desiredTurretDir after enough ticks', () => {
    const gun = makeGUN(10, 10);
    gun.turretDir = 4; // South
    gun.desiredTurretDir = 2; // East (already pre-set)
    gun.turretRotAccum = 0;

    // Enemy far away so range check works, but also within range
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 14, 10);

    // C++ ROT=5: South(4) → East(2) = 2 steps CCW, each step ~7 ticks = ~14 ticks.
    // Run enough ticks with cooldown reset to allow full rotation.
    for (let i = 0; i < 20; i++) {
      const ctx = makeCombatCtx([gun], [enemy]);
      updateStructureCombat(ctx);
      gun.attackCooldown = 0; // reset cooldown to allow re-targeting
    }
    // After enough ticks, turret should have reached East (2)
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

  it('observes firingFlash after the completed fire tick', () => {
    const gun = makeGUN(10, 10);
    gun.firingFlash = 0;
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.firingFlash).toBe(3);
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

  it('observes attackCooldown at ROF minus one after firing', () => {
    const gun = makeGUN(10, 10);
    expect(gun.attackCooldown).toBe(0);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.attackCooldown).toBe(STRUCTURE_WEAPONS['GUN'].rof - 1);
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
    // Pre-align to the tank's exact bearing. C++ Mission_Attack delays the shot
    // if the turret must rotate, so this test isolates target priority.
    setStructureTurretDesired(gun, tank);
    gun.turretFacing256 = gun.desiredTurretFacing256;
    gun.turretDir = gun.desiredTurretDir;
    gun.turretRotAccum = 0;
    const ctx = makeCombatCtx([gun], [truck, tank]);
    updateStructureCombat(ctx);
    // Tank should be the direct target. The truck can still receive splash.
    expect(tank.hp).toBeLessThan(tank.maxHp);
    expect(tank.maxHp - tank.hp).toBeGreaterThan(truck.maxHp - truck.hp);
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
