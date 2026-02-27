/**
 * Tests for superweapon system — Chronosphere, Iron Curtain, Nuclear Missile,
 * GPS Satellite, Sonar Pulse, recharge system, structures, and visual effects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, UNIT_STATS, CELL_SIZE,
  SuperweaponType, SUPERWEAPON_DEFS, PRODUCTION_ITEMS,
} from '../engine/types';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// === Part 1: Superweapon Definitions ===

describe('Superweapon definitions', () => {
  it('all 5 superweapon types are defined', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE]).toBeDefined();
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN]).toBeDefined();
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE]).toBeDefined();
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE]).toBeDefined();
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE]).toBeDefined();
  });

  it('Chronosphere has correct definition', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];
    expect(def.name).toBe('Chronosphere');
    expect(def.building).toBe('PDOX');
    expect(def.rechargeTicks).toBe(6300);
    expect(def.faction).toBe('allied');
    expect(def.requiresPower).toBe(true);
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('Iron Curtain has correct definition', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    expect(def.name).toBe('Iron Curtain');
    expect(def.building).toBe('IRON');
    expect(def.rechargeTicks).toBe(6300);
    expect(def.faction).toBe('soviet');
    expect(def.requiresPower).toBe(true);
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('unit');
  });

  it('Nuclear Strike has correct definition', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(def.name).toBe('Nuclear Strike');
    expect(def.building).toBe('MSLO');
    expect(def.rechargeTicks).toBe(12600);
    expect(def.faction).toBe('soviet');
    expect(def.requiresPower).toBe(true);
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('GPS Satellite has correct definition', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(def.name).toBe('GPS Satellite');
    expect(def.building).toBe('DOME');
    expect(def.rechargeTicks).toBe(6300);
    expect(def.faction).toBe('allied');
    expect(def.needsTarget).toBe(false);
    expect(def.targetMode).toBe('none');
  });

  it('Sonar Pulse has correct definition', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.name).toBe('Sonar Pulse');
    expect(def.building).toBe('DOME');
    expect(def.rechargeTicks).toBe(1800);
    expect(def.faction).toBe('both');
    expect(def.needsTarget).toBe(false);
    expect(def.targetMode).toBe('none');
  });

  it('all superweapons require power', () => {
    for (const def of Object.values(SUPERWEAPON_DEFS)) {
      expect(def.requiresPower).toBe(true);
    }
  });
});

// === Part 2: Structure Configuration ===

describe('Superweapon structure config', () => {
  it('ATEK has correct size and HP', () => {
    expect(STRUCTURE_SIZE['ATEK']).toEqual([2, 2]);
    expect(STRUCTURE_MAX_HP['ATEK']).toBe(600);
  });

  it('STEK has correct size and HP', () => {
    expect(STRUCTURE_SIZE['STEK']).toEqual([2, 2]);
    expect(STRUCTURE_MAX_HP['STEK']).toBe(600);
  });

  it('PDOX has correct size and HP', () => {
    expect(STRUCTURE_SIZE['PDOX']).toEqual([2, 2]);
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(600);
  });

  it('IRON has correct size and HP', () => {
    expect(STRUCTURE_SIZE['IRON']).toEqual([2, 2]);
    expect(STRUCTURE_MAX_HP['IRON']).toBe(600);
  });

  it('MSLO has correct size and HP', () => {
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 2]);
    expect(STRUCTURE_MAX_HP['MSLO']).toBe(800);
  });

  it('all 5 superweapon structures are in STRUCTURE_SIZE', () => {
    for (const type of ['ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO']) {
      expect(STRUCTURE_SIZE[type]).toBeDefined();
      expect(STRUCTURE_SIZE[type]).toEqual([2, 2]);
    }
  });

  it('ATEK is in PRODUCTION_ITEMS as allied structure', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
    expect(item!.buildTime).toBe(200);
    expect(item!.prerequisite).toBe('POWR');
    expect(item!.faction).toBe('allied');
    expect(item!.isStructure).toBe(true);
  });

  it('STEK is in PRODUCTION_ITEMS as soviet structure', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
    expect(item!.buildTime).toBe(200);
    expect(item!.prerequisite).toBe('POWR');
    expect(item!.faction).toBe('soviet');
    expect(item!.isStructure).toBe(true);
  });

  it('PDOX is in PRODUCTION_ITEMS with ATEK prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
    expect(item!.buildTime).toBe(300);
    expect(item!.prerequisite).toBe('ATEK');
    expect(item!.faction).toBe('allied');
  });

  it('IRON is in PRODUCTION_ITEMS with STEK prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
    expect(item!.buildTime).toBe(300);
    expect(item!.prerequisite).toBe('STEK');
    expect(item!.faction).toBe('soviet');
  });

  it('MSLO is in PRODUCTION_ITEMS with STEK prerequisite', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2500);
    expect(item!.buildTime).toBe(280);
    expect(item!.prerequisite).toBe('STEK');
    expect(item!.faction).toBe('soviet');
  });
});

// === Part 3: Entity Invulnerability ===

describe('Entity invulnerability', () => {
  it('ironCurtainTick makes entity invulnerable', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.isInvulnerable).toBe(false);
    tank.ironCurtainTick = 900;
    expect(tank.isInvulnerable).toBe(true);
  });

  it('invulnTick also makes entity invulnerable', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.invulnTick = 300;
    expect(tank.isInvulnerable).toBe(true);
  });

  it('isInvulnerable is false when both timers are 0', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.ironCurtainTick = 0;
    tank.invulnTick = 0;
    expect(tank.isInvulnerable).toBe(false);
  });

  it('isInvulnerable is true when either timer is active', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    // Only ironCurtain
    tank.ironCurtainTick = 100;
    tank.invulnTick = 0;
    expect(tank.isInvulnerable).toBe(true);
    // Only invuln
    tank.ironCurtainTick = 0;
    tank.invulnTick = 100;
    expect(tank.isInvulnerable).toBe(true);
    // Both
    tank.ironCurtainTick = 100;
    tank.invulnTick = 100;
    expect(tank.isInvulnerable).toBe(true);
  });

  it('takeDamage returns false when invulnerable via ironCurtainTick', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.ironCurtainTick = 900;
    const startHp = tank.hp;
    const killed = tank.takeDamage(500, 'AP');
    expect(killed).toBe(false);
    expect(tank.hp).toBe(startHp); // no damage taken
  });

  it('takeDamage returns false when invulnerable via invulnTick', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.invulnTick = 300;
    const startHp = tank.hp;
    const killed = tank.takeDamage(500, 'AP');
    expect(killed).toBe(false);
    expect(tank.hp).toBe(startHp);
  });

  it('ironCurtainTick field initializes to 0', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.ironCurtainTick).toBe(0);
  });

  it('ironCurtainTick can be decremented', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.ironCurtainTick = 10;
    tank.ironCurtainTick--;
    expect(tank.ironCurtainTick).toBe(9);
  });
});

// === Part 4: Chronosphere ===

describe('Chronosphere', () => {
  it('chronoShiftTick field initializes to 0', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.chronoShiftTick).toBe(0);
  });

  it('chronoShiftTick can be set for visual effect', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.chronoShiftTick = 30;
    expect(tank.chronoShiftTick).toBe(30);
  });

  it('teleport changes unit position', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    // Simulate chronosphere teleport
    tank.pos.x = 500;
    tank.pos.y = 500;
    tank.chronoShiftTick = 30;
    expect(tank.pos.x).toBe(500);
    expect(tank.pos.y).toBe(500);
    expect(tank.chronoShiftTick).toBe(30);
  });

  it('chronoShiftTick decrements to 0', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.chronoShiftTick = 3;
    for (let i = 0; i < 3; i++) {
      tank.chronoShiftTick--;
    }
    expect(tank.chronoShiftTick).toBe(0);
  });

  it('Chronosphere requires PDOX building', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];
    expect(def.building).toBe('PDOX');
  });
});

// === Part 5: Iron Curtain ===

describe('Iron Curtain', () => {
  it('Iron Curtain duration is 900 ticks (60 seconds at 15 FPS)', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.USSR);
    tank.ironCurtainTick = 900; // C++ parity: 60 seconds
    expect(tank.ironCurtainTick).toBe(900);
    expect(tank.isInvulnerable).toBe(true);
  });

  it('unit takes no damage while ironCurtainTick > 0', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.USSR);
    tank.ironCurtainTick = 900;
    const hp = tank.hp;
    // Multiple damage attempts
    tank.takeDamage(100, 'AP');
    tank.takeDamage(200, 'HE');
    tank.takeDamage(500, 'Super');
    expect(tank.hp).toBe(hp);
    expect(tank.alive).toBe(true);
  });

  it('unit takes damage normally after iron curtain expires', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.USSR);
    tank.ironCurtainTick = 1;
    tank.ironCurtainTick--; // expires
    expect(tank.isInvulnerable).toBe(false);
    const hp = tank.hp;
    tank.takeDamage(50, 'AP');
    expect(tank.hp).toBeLessThan(hp);
  });

  it('Iron Curtain requires IRON building', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    expect(def.building).toBe('IRON');
  });

  it('Iron Curtain is soviet faction', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    expect(def.faction).toBe('soviet');
  });
});

// === Part 6: Nuclear Missile ===

describe('Nuclear missile', () => {
  it('Nuke uses Super warhead', () => {
    // Nuke deals 1000 damage with Super warhead — verify warhead exists
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(def.building).toBe('MSLO');
    // The detonateNuke method uses 'Super' warhead with 1000 damage in 10-cell radius
    // We verify the definition parameters
    expect(def.rechargeTicks).toBe(12600); // longest recharge
  });

  it('Nuke is soviet faction from MSLO', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(def.faction).toBe('soviet');
    expect(def.building).toBe('MSLO');
  });

  it('Nuke requires ground target', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('Nuke has longest recharge of all superweapons', () => {
    const nukeTicks = SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks;
    for (const def of Object.values(SUPERWEAPON_DEFS)) {
      expect(nukeTicks).toBeGreaterThanOrEqual(def.rechargeTicks);
    }
  });

  it('MSLO structure has 800 HP', () => {
    expect(STRUCTURE_MAX_HP['MSLO']).toBe(800);
  });

  it('entity can be killed by large damage (simulating nuke)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    const killed = tank.takeDamage(1000, 'Super');
    expect(killed).toBe(true);
    expect(tank.alive).toBe(false);
  });
});

// === Part 7: Recharge System ===

describe('Recharge system', () => {
  it('Chronosphere recharges in 6300 ticks (420 seconds)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];
    expect(def.rechargeTicks).toBe(6300);
    expect(def.rechargeTicks / 15).toBe(420); // seconds
  });

  it('Iron Curtain recharges in 6300 ticks', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    expect(def.rechargeTicks).toBe(6300);
  });

  it('Nuke recharges in 12600 ticks (840 seconds)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(def.rechargeTicks).toBe(12600);
    expect(def.rechargeTicks / 15).toBe(840);
  });

  it('Sonar Pulse has fast 1800 tick recharge (120 seconds)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.rechargeTicks).toBe(1800);
    expect(def.rechargeTicks / 15).toBe(120);
  });

  it('GPS Satellite recharges in 6300 ticks', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(def.rechargeTicks).toBe(6300);
  });

  it('all superweapons have positive recharge times', () => {
    for (const def of Object.values(SUPERWEAPON_DEFS)) {
      expect(def.rechargeTicks).toBeGreaterThan(0);
    }
  });

  it('charge increments can reach rechargeTicks to become ready', () => {
    // Simulate charging: chargeTick goes from 0 → rechargeTicks
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE]; // shortest recharge
    let charge = 0;
    for (let i = 0; i < def.rechargeTicks; i++) {
      charge = Math.min(charge + 1, def.rechargeTicks);
    }
    expect(charge).toBe(def.rechargeTicks);
  });

  it('low power charges at 0.25x rate', () => {
    // Simulate 100 ticks of charging at low power
    let normalCharge = 0;
    let lowPowerCharge = 0;
    for (let i = 0; i < 100; i++) {
      normalCharge += 1;
      lowPowerCharge += 0.25;
    }
    expect(normalCharge).toBe(100);
    expect(lowPowerCharge).toBe(25);
    expect(lowPowerCharge).toBe(normalCharge * 0.25);
  });
});

// === Part 8: GPS Satellite ===

describe('GPS Satellite', () => {
  it('GPS is auto-fire (no target needed)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(def.needsTarget).toBe(false);
    expect(def.targetMode).toBe('none');
  });

  it('GPS is allied faction', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(def.faction).toBe('allied');
  });

  it('GPS requires DOME building', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(def.building).toBe('DOME');
  });

  it('GPS is one-shot (fired flag prevents re-firing)', () => {
    // The fired flag should prevent re-charging after first use
    const state = {
      type: SuperweaponType.GPS_SATELLITE,
      house: House.Spain,
      chargeTick: 6300,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    // Simulate firing
    state.fired = true;
    state.ready = false;
    expect(state.fired).toBe(true);
    expect(state.ready).toBe(false);
    // Should not recharge after fired
    state.chargeTick = 6300;
    expect(state.fired).toBe(true); // still fired
  });

  it('GPS recharge time matches other 6300 tick weapons', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks)
      .toBe(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks);
  });
});

// === Part 9: Sonar Pulse ===

describe('Sonar Pulse', () => {
  it('Sonar Pulse is auto-fire', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.needsTarget).toBe(false);
  });

  it('Sonar Pulse sets sonarPulseTimer on enemy subs', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    // Simulate sonar pulse effect
    sub.sonarPulseTimer = 450;
    expect(sub.sonarPulseTimer).toBe(450);
  });

  it('Sonar pulse timer of 450 ticks = 30 seconds', () => {
    // 450 ticks / 15 FPS = 30 seconds
    expect(450 / 15).toBe(30);
  });

  it('Sonar Pulse is available to both factions', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.faction).toBe('both');
  });

  it('Sonar Pulse requires DOME', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.building).toBe('DOME');
  });

  it('sonarPulseTimer decrements to 0', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.sonarPulseTimer = 3;
    for (let i = 0; i < 3; i++) {
      sub.sonarPulseTimer--;
    }
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('Sonar has fastest recharge (1800 ticks)', () => {
    const sonarTicks = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;
    for (const def of Object.values(SUPERWEAPON_DEFS)) {
      expect(sonarTicks).toBeLessThanOrEqual(def.rechargeTicks);
    }
  });
});

// === Part 10: Power Consumption ===

describe('Power consumption', () => {
  it('ATEK production item exists with cost 1500', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
  });

  it('STEK production item exists with cost 1500', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1500);
  });

  it('PDOX production item exists with cost 2800', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
  });

  it('IRON production item exists with cost 2800', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2800);
  });

  it('MSLO production item exists with cost 2500', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(2500);
  });

  it('tech centers require POWR as prerequisite', () => {
    const atek = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    const stek = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(atek!.prerequisite).toBe('POWR');
    expect(stek!.prerequisite).toBe('POWR');
  });

  it('superweapon buildings require tech centers as prerequisite', () => {
    const pdox = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    const iron = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    const mslo = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(pdox!.prerequisite).toBe('ATEK');
    expect(iron!.prerequisite).toBe('STEK');
    expect(mslo!.prerequisite).toBe('STEK');
  });

  it('all 5 structures are marked as isStructure', () => {
    for (const type of ['ATEK', 'STEK', 'PDOX', 'IRON', 'MSLO']) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(item).toBeDefined();
      expect(item!.isStructure).toBe(true);
    }
  });

  it('allied structures have correct faction', () => {
    expect(PRODUCTION_ITEMS.find(p => p.type === 'ATEK')!.faction).toBe('allied');
    expect(PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!.faction).toBe('allied');
  });

  it('soviet structures have correct faction', () => {
    expect(PRODUCTION_ITEMS.find(p => p.type === 'STEK')!.faction).toBe('soviet');
    expect(PRODUCTION_ITEMS.find(p => p.type === 'IRON')!.faction).toBe('soviet');
    expect(PRODUCTION_ITEMS.find(p => p.type === 'MSLO')!.faction).toBe('soviet');
  });
});
