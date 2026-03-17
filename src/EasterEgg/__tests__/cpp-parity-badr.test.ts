/**
 * C++ Behavioral Parity: BADR — Badger Bomber
 *
 * Tests verify Badger bomber behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with BADR (observable outcomes: HP, stats,
 * ammo, weapon properties, passenger capacity, aircraft state), not HOW the
 * code implements it. The same scenarios should produce identical results in
 * C++ and TypeScript.
 *
 * NOTE: Fixed-wing attack run phases (facing/AA targeting) are tested in
 * cpp-parity-aircraft.test.ts — NOT duplicated here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Verification (udata.cpp / rules.ini / aadata.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR stats verification (udata.cpp / rules.ini / aadata.cpp)', () => {
  const stats = UNIT_STATS.BADR;

  it('HP is 60 (Strength=60)', () => {
    expect(stats.strength).toBe(60);
  });

  it('armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('speed is 16 (Speed=16 — same as Yak)', () => {
    expect(stats.speed).toBe(16);
  });

  it('isAircraft is true', () => {
    expect(stats.isAircraft).toBe(true);
  });

  it('isFixedWing is true', () => {
    expect(stats.isFixedWing).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('maxAmmo is 5 (drops 5 bombs per sortie)', () => {
    expect(stats.maxAmmo).toBe(5);
  });

  it('passengers is 5 (carries paratroopers)', () => {
    expect(stats.passengers).toBe(5);
  });

  it('cost is 10 (scenario-only, near-free)', () => {
    expect(stats.cost).toBe(10);
  });

  it('owner is soviet', () => {
    expect(stats.owner).toBe('soviet');
  });

  it('sight is 0 (no autonomous vision — scripted unit)', () => {
    expect(stats.sight).toBe(0);
  });

  it('Entity constructor initializes HP to strength', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.hp).toBe(60);
    expect(badr.maxHp).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Weapon — ParaBomb (weapon.cpp / rules.ini)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR weapon — ParaBomb (weapon.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.BADR;
  const weapon = WEAPON_STATS.ParaBomb;

  it('primary weapon is ParaBomb', () => {
    expect(stats.primaryWeapon).toBe('ParaBomb');
  });

  it('no secondary weapon (single weapon bomber)', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('ParaBomb damage is 300 (massive — devastating per bomb)', () => {
    expect(weapon.damage).toBe(300);
  });

  it('ParaBomb warhead is HE', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('ParaBomb range is 4.5 cells', () => {
    expect(weapon.range).toBe(4.5);
  });

  it('ParaBomb ROF is 4 (rapid bomb drops)', () => {
    expect(weapon.rof).toBe(4);
  });

  it('ParaBomb isDropping is true (vertical drop trajectory)', () => {
    expect(weapon.isDropping).toBe(true);
  });

  it('ParaBomb isParachuted is true (parachute visual during descent)', () => {
    expect(weapon.isParachuted).toBe(true);
  });

  it('Entity constructor assigns weapon correctly', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.weapon).not.toBeNull();
    expect(badr.weapon!.name).toBe('ParaBomb');
    expect(badr.weapon2).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HE Warhead Effectiveness (combat.cpp warhead tables)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR HE warhead — anti-infantry/anti-building role (combat.cpp warhead tables)', () => {
  it('HE vs none armor: mult 0.9 (good vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('HE vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('HE vs heavy armor: mult 0.25 (poor vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs concrete: mult 1.0 (full damage — anti-structure role)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('ParaBomb deals 270 effective damage to unarmored infantry (300 * 0.9)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(300 * WARHEAD_VS_ARMOR.HE[armorIndex('none')]);
    expect(damage).toBe(270); // 300 * 0.9 = 270
    victim.takeDamage(damage, 'HE');
    // E1 has 50 HP — 270 damage is instant death
    expect(victim.alive).toBe(false);
  });

  it('ParaBomb deals 75 effective damage to heavy-armor tank (300 * 0.25)', () => {
    const victim = entityAtCell(UnitType.V_3TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(300 * WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]);
    expect(damage).toBe(75); // 300 * 0.25 = 75
    victim.takeDamage(damage, 'HE');
    expect(hpBefore - victim.hp).toBe(75);
    // 3TNK has 600 HP — survives one bomb hit
    expect(victim.alive).toBe(true);
  });

  it('ParaBomb deals full 300 damage to concrete buildings (300 * 1.0)', () => {
    const damage = Math.round(300 * WARHEAD_VS_ARMOR.HE[armorIndex('concrete')]);
    expect(damage).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Massive Bomb Damage — 5 bombs at 300 each (gameplay consequence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR massive bomb damage — 5 bombs per sortie (gameplay consequence)', () => {
  it('total sortie damage potential is 1500 (5 x 300)', () => {
    const totalDamage = 5 * WEAPON_STATS.ParaBomb.damage;
    expect(totalDamage).toBe(1500);
  });

  it('ParaBomb per-bomb damage (300) exceeds Maverick damage (50) by 6x', () => {
    expect(WEAPON_STATS.ParaBomb.damage).toBe(300);
    expect(WEAPON_STATS.Maverick.damage).toBe(50);
    expect(WEAPON_STATS.ParaBomb.damage / WEAPON_STATS.Maverick.damage).toBe(6);
  });

  it('a single ParaBomb one-shots any infantry unit (270 vs 50 HP max)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const damage = Math.round(300 * WARHEAD_VS_ARMOR.HE[armorIndex('none')]);
    e1.takeDamage(damage, 'HE');
    expect(e1.alive).toBe(false);
  });

  it('5 ParaBombs deal 375 effective damage to heavy armor (enough to scratch a Mammoth)', () => {
    // 5 x (300 * 0.25) = 5 x 75 = 375 effective damage vs heavy
    const totalEffective = 5 * Math.round(300 * WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]);
    expect(totalEffective).toBe(375);
    // Mammoth Tank (3TNK) has 400 HP — 375 damage takes it to 25 HP (critical!)
    const mammoth = entityAtCell(UnitType.V_3TNK, House.Spain, 11, 10);
    expect(mammoth.hp).toBe(400);
    for (let i = 0; i < 5; i++) {
      mammoth.takeDamage(75, 'HE');
    }
    expect(mammoth.hp).toBe(25);
    expect(mammoth.alive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ammo — 5 bombs per sortie (aircraft.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR ammo — 5 bombs per sortie (aircraft.cpp)', () => {
  it('constructor initializes ammo to maxAmmo (5)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.ammo).toBe(5);
    expect(badr.maxAmmo).toBe(5);
  });

  it('ammo decrements from 5 to 0 in 5 steps', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.ammo).toBe(5);
    for (let i = 4; i >= 0; i--) {
      badr.ammo--;
      expect(badr.ammo).toBe(i);
    }
    expect(badr.ammo).toBe(0);
  });

  it('BADR has more ammo than MIG (5 vs 3)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 10, 10);
    expect(badr.maxAmmo).toBe(5);
    expect(mig.maxAmmo).toBe(3);
    expect(badr.maxAmmo).toBeGreaterThan(mig.maxAmmo);
  });

  it('BADR has fewer ammo than Yak (5 vs 15)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    expect(badr.maxAmmo).toBe(5);
    expect(yak.maxAmmo).toBe(15);
    expect(badr.maxAmmo).toBeLessThan(yak.maxAmmo);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Capability — passengers=5 (udata.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR transport capability — passengers=5 (udata.cpp)', () => {
  it('isTransport is true (passengers > 0)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isTransport).toBe(true);
  });

  it('maxPassengers is 5', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.maxPassengers).toBe(5);
  });

  it('same passenger capacity as Chinook (TRAN)', () => {
    expect(UNIT_STATS.BADR.passengers).toBe(5);
    expect(UNIT_STATS.TRAN.passengers).toBe(5);
  });

  it('passengers array starts empty', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.passengers).toHaveLength(0);
  });

  it('destroying BADR kills all passengers', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    // Load 3 paratroopers
    const troopers = [
      entityAtCell(UnitType.I_E1, House.USSR, 10, 10),
      entityAtCell(UnitType.I_E1, House.USSR, 10, 10),
      entityAtCell(UnitType.I_E1, House.USSR, 10, 10),
    ];
    for (const t of troopers) {
      badr.passengers.push(t);
      t.transportRef = badr;
    }
    expect(badr.passengers).toHaveLength(3);

    // Kill the bomber
    badr.takeDamage(badr.hp, 'HE');
    expect(badr.alive).toBe(false);

    // All passengers die when transport is destroyed
    for (const t of troopers) {
      expect(t.alive).toBe(false);
      expect(t.mission).toBe(Mission.DIE);
    }
    expect(badr.passengers).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Aircraft State Machine (aircraft.cpp — starts landed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR aircraft state machine (aircraft.cpp)', () => {
  it('starts in landed state', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.aircraftState).toBe('landed');
  });

  it('starts with flightAltitude = 0 (on the ground)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.flightAltitude).toBe(0);
  });

  it('attackRunPhase defaults to flyToTarget', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.attackRunPhase).toBe('flyToTarget');
  });

  it('circleBreakTimer starts at 0', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.circleBreakTimer).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario-Only Unit — Not In Production (rules.ini)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR scenario-only — not in production (rules.ini)', () => {
  it('BADR is NOT in PRODUCTION_ITEMS', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'BADR');
    expect(prodItem).toBeUndefined();
  });

  it('cost=10 marks it as scenario-only (near-free for scripted spawning)', () => {
    expect(UNIT_STATS.BADR.cost).toBe(10);
  });

  it('U2 spy plane is also scenario-only with cost=10', () => {
    expect(UNIT_STATS.U2.cost).toBe(10);
    const u2Prod = PRODUCTION_ITEMS.find(p => p.type === 'U2');
    expect(u2Prod).toBeUndefined();
  });

  it('no landingBuilding — BADR does not land at any structure', () => {
    expect(UNIT_STATS.BADR.landingBuilding).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixed-Wing Properties (aadata.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR fixed-wing properties (aadata.cpp)', () => {
  it('isFixedWing returns true', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isFixedWing).toBe(true);
  });

  it('isAirUnit returns true', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isAirUnit).toBe(true);
  });

  it('isHelicopter returns false (fixed-wing, not helo)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isHelicopter).toBe(false);
  });

  it('hasTurret is false (aircraft have no turret)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.hasTurret).toBe(false);
  });

  it('isNavalUnit returns false', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isNavalUnit).toBe(false);
  });

  it('is not rotor-equipped (fixed-wing has no rotor overlay)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    expect(badr.isRotorEquipped).toBe(false);
  });

  it('is not crushable (aircraft fly above ground)', () => {
    expect(UNIT_STATS.BADR.crushable).toBeFalsy();
  });

  it('is not a crusher', () => {
    expect(UNIT_STATS.BADR.crusher).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BADR vs Other Aircraft — Comparative Stats (rules.ini balance)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR vs other aircraft — comparative stats (rules.ini balance)', () => {
  it('BADR has same HP as Yak (60 vs 60)', () => {
    expect(UNIT_STATS.BADR.strength).toBe(60);
    expect(UNIT_STATS.YAK.strength).toBe(60);
  });

  it('BADR has more HP than MIG (60 vs 50)', () => {
    expect(UNIT_STATS.BADR.strength).toBeGreaterThan(UNIT_STATS.MIG.strength);
  });

  it('BADR has same speed as Yak (16 vs 16)', () => {
    expect(UNIT_STATS.BADR.speed).toBe(UNIT_STATS.YAK.speed);
  });

  it('BADR is slower than MIG (16 vs 20)', () => {
    expect(UNIT_STATS.BADR.speed).toBeLessThan(UNIT_STATS.MIG.speed);
  });

  it('BADR has same armor class as MIG and Yak (all light)', () => {
    expect(UNIT_STATS.BADR.armor).toBe('light');
    expect(UNIT_STATS.MIG.armor).toBe('light');
    expect(UNIT_STATS.YAK.armor).toBe('light');
  });

  it('BADR per-bomb damage (300) vastly exceeds MIG Maverick damage (50)', () => {
    const badrDmg = WEAPON_STATS.ParaBomb.damage;
    const migDmg = WEAPON_STATS.Maverick.damage;
    expect(badrDmg).toBe(300);
    expect(migDmg).toBe(50);
    expect(badrDmg).toBeGreaterThan(migDmg * 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BADR Movement — Fixed-Wing Always Moves Forward (aircraft.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('BADR movement — aircraft moveToward (drive.cpp/aircraft.cpp)', () => {
  it('BADR moves toward target without stopping to rotate (unlike vehicles)', () => {
    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    badr.facing = Dir.N;
    badr.desiredFacing = Dir.N;
    badr.bodyFacing32 = Dir.N * 4;

    const startX = badr.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: badr.pos.y }; // due East

    // Aircraft should move toward target even when facing is not aligned
    badr.moveToward(targetPos, badr.stats.speed);

    const distMoved = Math.sqrt((badr.pos.x - startX) ** 2 + (badr.pos.y - badr.pos.y) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('vehicle stops to rotate but BADR does not', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const badr = entityAtCell(UnitType.V_BADR, House.USSR, 10, 10);
    badr.facing = Dir.N;
    badr.desiredFacing = Dir.N;
    badr.bodyFacing32 = Dir.N * 4;

    const targetPos = { x: 10 * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 3, y: 10 * CELL_SIZE + CELL_SIZE / 2 }; // due East

    const tankStartX = tank.pos.x;
    const badrStartX = badr.pos.x;

    tank.moveToward(targetPos, tank.stats.speed);
    badr.moveToward(targetPos, badr.stats.speed);

    // Tank should NOT have moved (still rotating)
    expect(tank.pos.x).toBe(tankStartX);
    // BADR SHOULD have moved (aircraft never stop to rotate)
    expect(badr.pos.x).not.toBe(badrStartX);
  });
});
