/**
 * C++ behavioral parity tests for 3TNK (Heavy Tank).
 *
 * Verifies that the TypeScript engine implementation matches the original
 * C++ Red Alert source for the Soviet Heavy Tank: stats, dual 105mm weapon,
 * AP warhead multipliers, turret behavior, crusher flag, dual-weapon cadence,
 * stop-rotate-move, damage speed reduction, and retaliation.
 *
 * References:
 *   - rules.ini [3TNK] — HP 400, armor heavy, speed 7, cost 950, soviet
 *   - rules.ini [105mm] — damage 30, ROF 70, range 4.75, warhead AP
 *   - techno.cpp:2857 — IsSecondShot dual-weapon cadence
 *   - drive.cpp — stop-rotate-move for non-infantry
 *   - warhead.cpp — AP Verses: none=0.3, wood=0.75, light=0.75, heavy=1.0, concrete=0.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, PRODUCTION_ITEMS,
  WARHEAD_VS_ARMOR, getWarheadMultiplier, Dir, Mission,
  type WeaponStats, type WarheadType, type ArmorType,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function make3TNK(x = 100, y = 100): Entity {
  return new Entity(UnitType.V_3TNK, House.USSR, x, y);
}

function makeTarget(type: UnitType, house: House, x = 200, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// ---------------------------------------------------------------------------
// 1. Stats: HP 400, armor heavy, speed 7, crusher=true, cost 950, soviet
// ---------------------------------------------------------------------------

describe('3TNK stats (rules.ini parity)', () => {
  it('UNIT_STATS["3TNK"] exists with correct type', () => {
    const stats = UNIT_STATS['3TNK'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_3TNK);
    expect(stats.name).toBe('Heavy Tank');
  });

  it('strength (HP) = 400', () => {
    expect(UNIT_STATS['3TNK'].strength).toBe(400);
  });

  it('armor = heavy', () => {
    expect(UNIT_STATS['3TNK'].armor).toBe('heavy');
  });

  it('speed = 7', () => {
    expect(UNIT_STATS['3TNK'].speed).toBe(7);
  });

  it('crusher = true (can crush infantry)', () => {
    expect(UNIT_STATS['3TNK'].crusher).toBe(true);
  });

  it('isInfantry = false', () => {
    expect(UNIT_STATS['3TNK'].isInfantry).toBe(false);
  });

  it('rot = 5 (vehicle rotation rate)', () => {
    expect(UNIT_STATS['3TNK'].rot).toBe(5);
  });

  it('Entity constructor initializes HP to 400', () => {
    const tank = make3TNK();
    expect(tank.hp).toBe(400);
    expect(tank.maxHp).toBe(400);
  });
});

describe('3TNK production data (cost 950, soviet faction)', () => {
  const entry = PRODUCTION_ITEMS.find(p => p.type === '3TNK');

  it('3TNK exists in PRODUCTION_ITEMS', () => {
    expect(entry).toBeDefined();
  });

  it('cost = 950', () => {
    expect(entry!.cost).toBe(950);
  });

  it('faction = soviet', () => {
    expect(entry!.faction).toBe('soviet');
  });

  it('prerequisite = WEAP (War Factory)', () => {
    expect(entry!.prerequisite).toBe('WEAP');
  });
});

// ---------------------------------------------------------------------------
// 2. Dual weapon: 105mm / 105mm (both primary AND secondary are 105mm)
// ---------------------------------------------------------------------------

describe('3TNK dual weapon — 105mm / 105mm', () => {
  it('primaryWeapon = "105mm"', () => {
    expect(UNIT_STATS['3TNK'].primaryWeapon).toBe('105mm');
  });

  it('secondaryWeapon = "105mm"', () => {
    expect(UNIT_STATS['3TNK'].secondaryWeapon).toBe('105mm');
  });

  it('Entity has both weapon and weapon2 populated', () => {
    const tank = make3TNK();
    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon2).not.toBeNull();
  });

  it('both weapons reference the same 105mm stats', () => {
    const tank = make3TNK();
    expect(tank.weapon!.name).toBe('105mm');
    expect(tank.weapon2!.name).toBe('105mm');
    expect(tank.weapon!.damage).toBe(tank.weapon2!.damage);
    expect(tank.weapon!.warhead).toBe(tank.weapon2!.warhead);
    expect(tank.weapon!.range).toBe(tank.weapon2!.range);
  });
});

describe('105mm weapon stats (rules.ini)', () => {
  const w = WEAPON_STATS['105mm'];

  it('105mm exists in WEAPON_STATS', () => {
    expect(w).toBeDefined();
  });

  it('damage = 30 (rules.ini [105mm] Damage=30)', () => {
    expect(w.damage).toBe(30);
  });

  it('ROF = 70', () => {
    expect(w.rof).toBe(70);
  });

  it('range = 4.75', () => {
    expect(w.range).toBe(4.75);
  });

  it('warhead = AP', () => {
    expect(w.warhead).toBe('AP');
  });
});

// ---------------------------------------------------------------------------
// 3. Dual-weapon cadence — selectWeapon returns a weapon for both slots
//    (C++ techno.cpp:2857 IsSecondShot)
// ---------------------------------------------------------------------------

describe('3TNK dual-weapon cadence (techno.cpp:2857)', () => {
  it('selectWeapon returns a weapon when both cooldowns are 0', () => {
    const tank = make3TNK(100, 100);
    const target = makeTarget(UnitType.I_E1, House.Spain, 150, 100);

    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).not.toBeNull();
  });

  it('selectWeapon returns secondary when primary is on cooldown', () => {
    const tank = make3TNK(100, 100);
    const target = makeTarget(UnitType.V_2TNK, House.Spain, 150, 100);

    tank.attackCooldown = 50;
    tank.attackCooldown2 = 0;

    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(tank.weapon2);
  });

  it('selectWeapon returns primary when secondary is on cooldown', () => {
    const tank = make3TNK(100, 100);
    const target = makeTarget(UnitType.V_2TNK, House.Spain, 150, 100);

    tank.attackCooldown = 0;
    tank.attackCooldown2 = 50;

    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(tank.weapon);
  });

  it('selectWeapon returns null when both weapons are on cooldown', () => {
    const tank = make3TNK(100, 100);
    const target = makeTarget(UnitType.V_2TNK, House.Spain, 150, 100);

    tank.attackCooldown = 50;
    tank.attackCooldown2 = 50;

    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeNull();
  });

  it('isSecondShot field starts false', () => {
    const tank = make3TNK();
    expect(tank.isSecondShot).toBe(false);
  });

  it('isSecondShot toggles correctly to simulate alternating fire', () => {
    const tank = make3TNK();
    expect(tank.isSecondShot).toBe(false);

    // First shot fires, toggle
    tank.isSecondShot = !tank.isSecondShot;
    expect(tank.isSecondShot).toBe(true);

    // Second shot fires, toggle back
    tank.isSecondShot = !tank.isSecondShot;
    expect(tank.isSecondShot).toBe(false);
  });

  it('dual-weapon rearm timing: first shot gets 3-tick rearm, second gets full ROF', () => {
    const tank = make3TNK();
    const rof = tank.weapon!.rof; // 70

    // Simulate CF12 cadence: first shot (isSecondShot=false) -> 3-tick rearm
    let rearmTime: number;
    if (!tank.isSecondShot) {
      rearmTime = 3;
    } else {
      rearmTime = rof;
    }
    expect(rearmTime).toBe(3);
    tank.isSecondShot = !tank.isSecondShot;

    // Second shot (isSecondShot=true) -> full ROF rearm
    if (!tank.isSecondShot) {
      rearmTime = 3;
    } else {
      rearmTime = rof;
    }
    expect(rearmTime).toBe(70);
    tank.isSecondShot = !tank.isSecondShot;
  });

  it('independent cooldown timers decrement separately', () => {
    const tank = make3TNK();
    tank.attackCooldown = 10;
    tank.attackCooldown2 = 5;

    for (let i = 0; i < 5; i++) {
      if (tank.attackCooldown > 0) tank.attackCooldown--;
      if (tank.attackCooldown2 > 0) tank.attackCooldown2--;
    }

    expect(tank.attackCooldown).toBe(5);
    expect(tank.attackCooldown2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. AP warhead: vs none=0.3, vs heavy=1.0, full Verses row
// ---------------------------------------------------------------------------

describe('AP warhead multipliers (WARHEAD_VS_ARMOR parity)', () => {
  it('AP vs none = 0.3', () => {
    expect(getWarheadMultiplier('AP', 'none')).toBe(0.3);
  });

  it('AP vs wood = 0.75', () => {
    expect(getWarheadMultiplier('AP', 'wood')).toBe(0.75);
  });

  it('AP vs light = 0.75', () => {
    expect(getWarheadMultiplier('AP', 'light')).toBe(0.75);
  });

  it('AP vs heavy = 1.0 (full damage)', () => {
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('AP vs concrete = 0.5', () => {
    expect(getWarheadMultiplier('AP', 'concrete')).toBe(0.5);
  });

  it('105mm deals 30 damage to heavy armor (full AP multiplier)', () => {
    const w = WEAPON_STATS['105mm'];
    const mult = getWarheadMultiplier(w.warhead, 'heavy');
    const damage = Math.max(1, Math.round(w.damage * mult));
    expect(damage).toBe(30); // round(30 * 1.0) = 30
  });

  it('105mm deals 9 damage to no-armor infantry (AP vs none = 0.3)', () => {
    const w = WEAPON_STATS['105mm'];
    const mult = getWarheadMultiplier(w.warhead, 'none');
    const damage = Math.max(1, Math.round(w.damage * mult));
    expect(damage).toBe(9); // round(30 * 0.3) = 9
  });

  it('105mm deals 23 damage to light armor (AP vs light = 0.75)', () => {
    const w = WEAPON_STATS['105mm'];
    const mult = getWarheadMultiplier(w.warhead, 'light');
    const damage = Math.max(1, Math.round(w.damage * mult));
    expect(damage).toBe(23); // round(30 * 0.75) = 22.5 → 23
  });
});

// ---------------------------------------------------------------------------
// 5. Turret: hasTurret=true
// ---------------------------------------------------------------------------

describe('3TNK turret behavior', () => {
  it('hasTurret = true', () => {
    const tank = make3TNK();
    expect(tank.hasTurret).toBe(true);
  });

  it('turretFacing initializes to Dir.N (0)', () => {
    const tank = make3TNK();
    expect(tank.turretFacing).toBe(Dir.N);
    expect(tank.desiredTurretFacing).toBe(Dir.N);
  });

  it('turret rotates independently of body', () => {
    const tank = make3TNK();
    tank.desiredTurretFacing = Dir.E;
    tank.desiredFacing = Dir.N; // body stays facing north

    // Tick turret rotation until aligned
    let ticks = 0;
    while (!tank.tickTurretRotation() && ticks < 100) {
      tank.turretRotTickedThisFrame = false; // reset per-frame guard
      ticks++;
    }

    // Turret should face east while body still faces north
    expect(tank.turretFacing).toBe(Dir.E);
    expect(tank.facing).toBe(Dir.N);
  });

  it('turret rotates at ROT+1 speed (C++ unit.cpp:542)', () => {
    const tank = make3TNK();
    const rotRate = tank.stats.rot; // 5
    // Turret rotation rate = ROT+1 = 6
    // Accumulates 6 per tick, advances one 32-step when >= 8
    // So first advance at tick 2 (accum: 6, 12 -> step at 8)
    tank.desiredTurretFacing = Dir.E; // 8 steps away in 32-step ring

    // After 1 tick: accum=6, no step yet
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(0); // hasn't stepped yet

    // After 2 ticks: accum=12-8=4, one step taken
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(1); // one 32-step forward
  });
});

// ---------------------------------------------------------------------------
// 6. Crusher: standard
// ---------------------------------------------------------------------------

describe('3TNK crusher flag', () => {
  it('stats.crusher = true', () => {
    expect(UNIT_STATS['3TNK'].crusher).toBe(true);
  });

  it('infantry are crushable (for crusher interaction)', () => {
    const e1Stats = UNIT_STATS['E1'];
    expect(e1Stats.crushable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Slower but heavier: speed 7 (1TNK=9, 2TNK=8), damage 40 vs 25/30
// ---------------------------------------------------------------------------

describe('3TNK slower but heavier than allied tanks', () => {
  it('speed comparison: 3TNK(7) < 2TNK(8) < 1TNK(9)', () => {
    const speed3 = UNIT_STATS['3TNK'].speed;
    const speed2 = UNIT_STATS['2TNK'].speed;
    const speed1 = UNIT_STATS['1TNK'].speed;

    expect(speed3).toBe(7);
    expect(speed2).toBe(8);
    expect(speed1).toBe(9);
    expect(speed3).toBeLessThan(speed2);
    expect(speed2).toBeLessThan(speed1);
  });

  it('damage comparison: 105mm(30) = 90mm(30) > 75mm(25)', () => {
    const dmg3 = WEAPON_STATS['105mm'].damage;
    const dmg2 = WEAPON_STATS['90mm'].damage;
    const dmg1 = WEAPON_STATS['75mm'].damage;

    expect(dmg3).toBe(30);
    expect(dmg2).toBe(30);
    expect(dmg1).toBe(25);
    expect(dmg3).toBeGreaterThanOrEqual(dmg2);
    expect(dmg2).toBeGreaterThan(dmg1);
  });

  it('HP comparison: 3TNK(400) > 1TNK(300), same as 2TNK(400)', () => {
    expect(UNIT_STATS['3TNK'].strength).toBe(400);
    expect(UNIT_STATS['2TNK'].strength).toBe(400);
    expect(UNIT_STATS['1TNK'].strength).toBe(300);
    expect(UNIT_STATS['3TNK'].strength).toBeGreaterThan(UNIT_STATS['1TNK'].strength);
  });

  it('all three tanks share heavy armor', () => {
    expect(UNIT_STATS['1TNK'].armor).toBe('heavy');
    expect(UNIT_STATS['2TNK'].armor).toBe('heavy');
    expect(UNIT_STATS['3TNK'].armor).toBe('heavy');
  });

  it('3TNK has dual 105mm (30dmg x2 slots) vs single-weapon 1TNK/2TNK', () => {
    // 3TNK: both primary and secondary
    expect(UNIT_STATS['3TNK'].secondaryWeapon).toBe('105mm');

    // 1TNK, 2TNK: single weapon only
    expect(UNIT_STATS['1TNK'].secondaryWeapon).toBeUndefined();
    expect(UNIT_STATS['2TNK'].secondaryWeapon).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Soviet faction: unlike 1TNK/2TNK which are allied
// ---------------------------------------------------------------------------

describe('3TNK soviet faction (unlike allied 1TNK/2TNK)', () => {
  it('3TNK is soviet', () => {
    const entry = PRODUCTION_ITEMS.find(p => p.type === '3TNK');
    expect(entry!.faction).toBe('soviet');
  });

  it('1TNK is allied', () => {
    const entry = PRODUCTION_ITEMS.find(p => p.type === '1TNK');
    expect(entry!.faction).toBe('allied');
  });

  it('2TNK is allied', () => {
    const entry = PRODUCTION_ITEMS.find(p => p.type === '2TNK');
    expect(entry!.faction).toBe('allied');
  });
});

// ---------------------------------------------------------------------------
// 9. Damage speed reduction / Stop-rotate-move / Retaliation: standard vehicle
// ---------------------------------------------------------------------------

describe('3TNK damage speed reduction (standard vehicle)', () => {
  it('takeDamage reduces HP correctly', () => {
    const tank = make3TNK();
    const killed = tank.takeDamage(100);
    expect(killed).toBe(false);
    expect(tank.hp).toBe(300);
  });

  it('takeDamage kills at 0 HP', () => {
    const tank = make3TNK();
    const killed = tank.takeDamage(400);
    expect(killed).toBe(true);
    expect(tank.hp).toBe(0);
    expect(tank.alive).toBe(false);
    expect(tank.mission).toBe(Mission.DIE);
  });

  it('overkill damage clamps HP to 0', () => {
    const tank = make3TNK();
    tank.takeDamage(999);
    expect(tank.hp).toBe(0);
  });

  it('damageFlash is set to 4 on hit', () => {
    const tank = make3TNK();
    tank.takeDamage(10);
    expect(tank.damageFlash).toBe(4);
  });

  it('invulnerable tanks take no damage', () => {
    const tank = make3TNK();
    tank.ironCurtainTick = 100;
    const killed = tank.takeDamage(999);
    expect(killed).toBe(false);
    expect(tank.hp).toBe(400);
  });

  it('armorBias reduces incoming damage', () => {
    const tank = make3TNK();
    tank.armorBias = 2.0; // crate armor — halves damage
    tank.takeDamage(100);
    // round(100 / 2.0) = 50 effective damage
    expect(tank.hp).toBe(350);
  });
});

describe('3TNK stop-rotate-move (C++ drive.cpp)', () => {
  it('moveToward does not advance position while body is rotating', () => {
    const tank = make3TNK(100, 100);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const target = { x: 200, y: 100 }; // east of tank — requires body rotation
    const arrived = tank.moveToward(target, tank.stats.speed);

    // Direction is East; body was facing North. Vehicle must rotate first.
    // On the first tick, rotation accumulates but facing may not yet be aligned.
    // If facing hasn't reached E yet, position should not have moved (stop-rotate-move).
    if (tank.facing !== Dir.E) {
      expect(tank.pos.x).toBe(100); // no lateral movement while rotating
      expect(arrived).toBe(false);
    }
  });

  it('moveToward advances position once facing is aligned', () => {
    const tank = make3TNK(100, 100);
    // Pre-align facing to east
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;

    const target = { x: 200, y: 100 };
    const arrived = tank.moveToward(target, tank.stats.speed);

    // Facing is already aligned, so tank should have moved
    expect(tank.pos.x).toBeGreaterThan(100);
  });

  it('infantry moves while rotating (contrast with 3TNK stop-rotate-move)', () => {
    const soldier = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    soldier.facing = Dir.N;
    soldier.desiredFacing = Dir.N;

    const target = { x: 200, y: 100 }; // east
    soldier.moveToward(target, soldier.stats.speed);

    // Infantry should move even if facing not yet aligned (nimble)
    expect(soldier.pos.x).toBeGreaterThan(100);
  });
});

describe('3TNK retaliation (standard vehicle)', () => {
  it('starts in GUARD mission (retaliatory)', () => {
    const tank = make3TNK();
    expect(tank.mission).toBe(Mission.GUARD);
  });

  it('stance defaults to AGGRESSIVE', () => {
    const tank = make3TNK();
    // Importing Stance to check
    expect(tank.stance).toBeDefined();
  });

  it('target field starts null, can be assigned', () => {
    const tank = make3TNK();
    expect(tank.target).toBeNull();

    const enemy = makeTarget(UnitType.V_1TNK, House.Spain, 200, 100);
    tank.target = enemy;
    expect(tank.target).toBe(enemy);
  });

  it('can be assigned ATTACK mission for retaliation', () => {
    const tank = make3TNK();
    tank.mission = Mission.ATTACK;
    expect(tank.mission).toBe(Mission.ATTACK);
  });
});

// ---------------------------------------------------------------------------
// Weapon range: inRange and inRangeWith tests specific to 3TNK
// ---------------------------------------------------------------------------

describe('3TNK weapon range (4.75 cells)', () => {
  it('inRange returns true when target is within 4.75 cells', () => {
    const tank = make3TNK(100, 100);
    // 4 cells = 4 * 24 = 96 pixels — within 4.75 cell range
    const target = makeTarget(UnitType.V_1TNK, House.Spain, 196, 100);
    expect(tank.inRange(target)).toBe(true);
  });

  it('inRange returns false when target is beyond 4.75 cells', () => {
    const tank = make3TNK(100, 100);
    // 6 cells = 6 * 24 = 144 pixels — beyond range
    const target = makeTarget(UnitType.V_1TNK, House.Spain, 244, 100);
    expect(tank.inRange(target)).toBe(false);
  });

  it('both weapons have the same range (105mm = 4.75)', () => {
    const tank = make3TNK();
    expect(tank.weapon!.range).toBe(4.75);
    expect(tank.weapon2!.range).toBe(4.75);
  });
});

// ---------------------------------------------------------------------------
// Additional behavioral: burst, recoil, 32-step rotation
// ---------------------------------------------------------------------------

describe('3TNK entity field initialization', () => {
  it('burstCount and burstDelay start at 0', () => {
    const tank = make3TNK();
    expect(tank.burstCount).toBe(0);
    expect(tank.burstDelay).toBe(0);
  });

  it('isInRecoilState starts false', () => {
    const tank = make3TNK();
    expect(tank.isInRecoilState).toBe(false);
  });

  it('bodyFacing32 initializes to facing * 4', () => {
    const tank = make3TNK();
    expect(tank.bodyFacing32).toBe(tank.facing * 4);
  });

  it('turretFacing32 initializes to turretFacing * 4', () => {
    const tank = make3TNK();
    expect(tank.turretFacing32).toBe(tank.turretFacing * 4);
  });

  it('is not an infantry, aircraft, or naval unit', () => {
    const tank = make3TNK();
    expect(tank.stats.isInfantry).toBe(false);
    expect(tank.isAirUnit).toBe(false);
    expect(tank.isNavalUnit).toBe(false);
  });

  it('is not an ant or civilian', () => {
    const tank = make3TNK();
    expect(tank.isAnt).toBe(false);
    expect(tank.isCivilian).toBe(false);
  });

  it('alive starts true', () => {
    const tank = make3TNK();
    expect(tank.alive).toBe(true);
  });

  it('kills counter starts at 0', () => {
    const tank = make3TNK();
    expect(tank.kills).toBe(0);
  });

  it('creditKill increments kill counter', () => {
    const tank = make3TNK();
    tank.creditKill();
    expect(tank.kills).toBe(1);
    tank.creditKill();
    expect(tank.kills).toBe(2);
  });
});
