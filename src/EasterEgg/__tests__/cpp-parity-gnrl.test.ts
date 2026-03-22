/**
 * C++ Behavioral Parity Tests — GNRL (General Stavros)
 *
 * General Stavros is a scenario-only VIP infantry unit. He uses the E1 sprite,
 * has 80 HP (durable for a VIP), and wields a Pistol that deals 1 damage with
 * SA warhead — making him essentially harmless in combat.
 *
 * C++ source: infantry.cpp, udata.cpp GNRL entry, RULES.INI [Pistol]
 */

import { describe, it, expect } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, CIVILIAN_UNIT_TYPES,
  UnitType, SpeedClass, PRONE_DAMAGE_BIAS, getWarheadMultiplier,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { House } from '../engine/types';

// ---------- helpers ----------
const gnrlStats = UNIT_STATS.GNRL;
const pistolStats = WEAPON_STATS.Pistol;

function spawnGNRL(x = 100, y = 100, house = House.Greece): Entity {
  resetEntityIds();
  return new Entity(UnitType.I_GNRL, house, x, y);
}

// === 1. UNIT_STATS: raw stat values match C++ RULES.INI ===

describe('GNRL — UNIT_STATS match C++ udata.cpp / RULES.INI', () => {
  it('exists in UNIT_STATS', () => {
    expect(gnrlStats).toBeDefined();
  });

  it('type = I_GNRL', () => {
    expect(gnrlStats.type).toBe(UnitType.I_GNRL);
  });

  it('name = Stavros', () => {
    expect(gnrlStats.name).toBe('Stavros');
  });

  it('strength (HP) = 80', () => {
    expect(gnrlStats.strength).toBe(80);
  });

  it('armor = none', () => {
    expect(gnrlStats.armor).toBe('none');
  });

  it('speed = 5', () => {
    expect(gnrlStats.speed).toBe(5);
  });

  it('speedClass = FOOT (infantry)', () => {
    expect(gnrlStats.speedClass).toBe(SpeedClass.FOOT);
  });

  it('sight = 3', () => {
    expect(gnrlStats.sight).toBe(3);
  });

  it('rot = 8 (infantry instant rotation)', () => {
    expect(gnrlStats.rot).toBe(8);
  });

  it('isInfantry = true', () => {
    expect(gnrlStats.isInfantry).toBe(true);
  });

  it('primaryWeapon = Pistol', () => {
    expect(gnrlStats.primaryWeapon).toBe('Pistol');
  });

  it('crushable = true', () => {
    expect(gnrlStats.crushable).toBe(true);
  });

  it('uses E1 sprite (image = "e1")', () => {
    expect(gnrlStats.image).toBe('e1');
  });
});

// === 2. WEAPON_STATS — Pistol ===

describe('GNRL — Pistol weapon stats match C++ RULES.INI', () => {
  it('Pistol exists in WEAPON_STATS', () => {
    expect(pistolStats).toBeDefined();
  });

  it('damage = 1 (token damage — essentially harmless)', () => {
    expect(pistolStats.damage).toBe(1);
  });

  it('ROF = 7', () => {
    expect(pistolStats.rof).toBe(7);
  });

  it('range = 1.75 cells', () => {
    expect(pistolStats.range).toBe(1.75);
  });

  it('warhead = SA (Small Arms)', () => {
    expect(pistolStats.warhead).toBe('SA');
  });

  it('projSpeed = 100 (rules.ini [Pistol] Speed=100)', () => {
    expect(pistolStats.projSpeed).toBe(100);
  });
});

// === 3. SA warhead at 1 damage — nearly useless combat ===

describe('GNRL — SA warhead effectiveness at 1 damage', () => {
  it('SA vs none (unarmored) = 1.0 multiplier', () => {
    expect(WARHEAD_VS_ARMOR.SA[0]).toBe(1.0);
  });

  it('SA vs wood = 0.5 multiplier', () => {
    expect(WARHEAD_VS_ARMOR.SA[1]).toBe(0.5);
  });

  it('SA vs light = 0.6 multiplier', () => {
    expect(WARHEAD_VS_ARMOR.SA[2]).toBe(0.6);
  });

  it('SA vs heavy = 0.25 multiplier', () => {
    expect(WARHEAD_VS_ARMOR.SA[3]).toBe(0.25);
  });

  it('SA vs concrete = 0.25 multiplier', () => {
    expect(WARHEAD_VS_ARMOR.SA[4]).toBe(0.25);
  });

  it('effective damage vs unarmored = floor(1 * 1.0) = 1 per shot', () => {
    // Best case: 1 damage * 1.0 mult = 1 damage. Essentially harmless.
    const eff = Math.floor(pistolStats.damage * getWarheadMultiplier('SA', 'none'));
    expect(eff).toBe(1);
  });

  it('effective damage vs heavy armor = floor(1 * 0.25) = 0 per shot', () => {
    // Worst case: 1 damage * 0.25 = 0.25, floors to 0. Literally zero damage.
    const eff = Math.floor(pistolStats.damage * getWarheadMultiplier('SA', 'heavy'));
    expect(eff).toBe(0);
  });

  it('shots to kill a 50 HP E1 (unarmored) = 50 shots', () => {
    // At 1 damage per shot, Stavros needs 50 shots to kill a basic rifleman.
    // ROF 7 means ~350 ticks = ~23 seconds at 15 FPS. Truly token damage.
    const e1Hp = UNIT_STATS.E1.strength;
    expect(e1Hp).toBe(50);
    const dmgPerShot = Math.max(1, Math.floor(pistolStats.damage * getWarheadMultiplier('SA', 'none')));
    expect(dmgPerShot).toBe(1);
    expect(Math.ceil(e1Hp / dmgPerShot)).toBe(50);
  });
});

// === 4. Durability — 80 HP VIP ===

describe('GNRL — durable VIP (80 HP)', () => {
  it('Entity constructor sets hp = 80', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.hp).toBe(80);
    expect(gnrl.maxHp).toBe(80);
  });

  it('survives 79 individual 1-damage hits', () => {
    const gnrl = spawnGNRL();
    for (let i = 0; i < 79; i++) {
      gnrl.takeDamage(1, 'SA');
    }
    expect(gnrl.alive).toBe(true);
    expect(gnrl.hp).toBe(1);
  });

  it('dies on the 80th hit', () => {
    const gnrl = spawnGNRL();
    for (let i = 0; i < 80; i++) {
      gnrl.takeDamage(1, 'SA');
    }
    expect(gnrl.alive).toBe(false);
    expect(gnrl.hp).toBe(0);
  });

  it('more durable than standard riflemen (E1 = 50 HP)', () => {
    // Stavros has 80 HP, E1 has 50 HP. As a VIP he is sturdier than a basic rifleman.
    expect(gnrlStats.strength).toBe(80);
    expect(UNIT_STATS.E1.strength).toBe(50);
    expect(gnrlStats.strength).toBeGreaterThan(UNIT_STATS.E1.strength);
  });

  it('more durable than civilians (C1 = 25 HP)', () => {
    expect(gnrlStats.strength).toBeGreaterThan(UNIT_STATS.C1.strength);
  });
});

// === 5. Not a civilian — but IS a civilian evacuation VIP ===

describe('GNRL — civilian status and CIVILIAN_UNIT_TYPES', () => {
  it('Entity.isCivilian returns false (GNRL is not C1-C10)', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.isCivilian).toBe(false);
  });

  it('GNRL IS in CIVILIAN_UNIT_TYPES (evacuation VIP set)', () => {
    // CIVILIAN_UNIT_TYPES includes GNRL for helicopter evacuation logic
    // (C++ _Counts_As_Civ_Evac: VIPs always evacuate per aircraft.cpp:116-159)
    expect(CIVILIAN_UNIT_TYPES.has('GNRL')).toBe(true);
  });

  it('isCivilian vs CIVILIAN_UNIT_TYPES distinction is correct', () => {
    // Entity.isCivilian only checks C1-C10 types (true civilians).
    // CIVILIAN_UNIT_TYPES is a broader set that includes VIPs (EINSTEIN, GNRL, CHAN)
    // used for evacuation/transport priority and threat scoring penalty.
    const gnrl = spawnGNRL();
    expect(gnrl.isCivilian).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has(gnrl.type)).toBe(true);
  });
});

// === 6. Crushable / Fear / Prone — standard infantry behaviors ===

describe('GNRL — crushable, fear, and prone (standard infantry)', () => {
  it('is crushable by vehicles', () => {
    expect(gnrlStats.crushable).toBe(true);
  });

  it('starts with 0 fear', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.fear).toBe(0);
  });

  it('starts not prone', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.isProne).toBe(false);
  });

  it('taking damage raises fear above FEAR_ANXIOUS threshold', () => {
    const gnrl = spawnGNRL();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 200, 200);
    gnrl.takeDamage(10, 'SA', attacker);
    // C++ infantry.cpp:442-457 — damage sets fear to at least FEAR_SCARED (100)
    expect(gnrl.fear).toBeGreaterThanOrEqual(Entity.FEAR_ANXIOUS);
  });

  it('fear reaches FEAR_SCARED (100) on first damage', () => {
    const gnrl = spawnGNRL();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 200, 200);
    gnrl.takeDamage(5, 'SA', attacker);
    // Entity.takeDamage: if fear < FEAR_SCARED, set to FEAR_SCARED
    expect(gnrl.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone infantry take half damage (PRONE_DAMAGE_BIAS = 0.5)', () => {
    const gnrl = spawnGNRL();
    gnrl.isProne = true;
    // 20 damage * 0.5 = 10, but Math.max(1, Math.round(20 * 0.5)) = 10
    gnrl.takeDamage(20, 'SA');
    expect(gnrl.hp).toBe(80 - 10);
  });

  it('prone damage always deals at least 1 (minimum clamp)', () => {
    const gnrl = spawnGNRL();
    gnrl.isProne = true;
    // 1 damage * 0.5 = 0.5, Math.round = 1, Math.max(1, 1) = 1
    gnrl.takeDamage(1, 'SA');
    expect(gnrl.hp).toBe(79);
  });

  it('PRONE_DAMAGE_BIAS = 0.5 (C++ rules.cpp:202)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });
});

// === 7. Entity construction and weapon binding ===

describe('GNRL — Entity construction', () => {
  it('weapon is bound to Pistol stats from WEAPON_STATS', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.weapon).not.toBeNull();
    expect(gnrl.weapon!.name).toBe('Pistol');
    expect(gnrl.weapon!.damage).toBe(1);
    expect(gnrl.weapon!.warhead).toBe('SA');
  });

  it('no secondary weapon', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.weapon2).toBeNull();
  });

  it('isInfantry stat propagates from UNIT_STATS', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.stats.isInfantry).toBe(true);
  });

  it('is not an aircraft, vehicle, or naval unit', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.isAirUnit).toBe(false);
    expect(gnrl.isNavalUnit).toBe(false);
    expect(gnrl.isAnt).toBe(false);
  });

  it('instant rotation (rot = 8 means infantry snap)', () => {
    const gnrl = spawnGNRL();
    // rot >= 8 means infantry snap-rotates instantly (entity.ts tickRotation)
    expect(gnrl.stats.rot).toBeGreaterThanOrEqual(8);
  });

  it('has no turret (infantry never have turrets)', () => {
    const gnrl = spawnGNRL();
    expect(gnrl.hasTurret).toBe(false);
  });
});
