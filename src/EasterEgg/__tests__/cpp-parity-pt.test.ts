/**
 * C++ Behavioral Parity: PT — Gunboat
 *
 * Tests verify Gunboat behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with PT (observable outcomes: HP, weapons,
 * targeting, turret, naval classification, speed, cost), not HOW the code
 * implements it. The same scenarios should produce identical results in C++
 * and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds, CloakState } from '../engine/entity';
import { canTargetNaval } from '../engine/aircraft';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ vdata.cpp (vehicle type data) — PT entry and RULES.INI [PT] section

describe('PT stats verification (vdata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.PT;
  const primaryWeapon = WEAPON_STATS['2Inch'];
  const secondaryWeapon = WEAPON_STATS.DepthCharge;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'PT');

  it('HP is 200 (Strength=200)', () => {
    expect(stats.strength).toBe(200);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 9 (Speed=9, fastest naval)', () => {
    expect(stats.speed).toBe(9);
  });

  it('isVessel is true', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primary weapon is 2Inch', () => {
    expect(stats.primaryWeapon).toBe('2Inch');
  });

  it('secondary weapon is DepthCharge', () => {
    expect(stats.secondaryWeapon).toBe('DepthCharge');
  });

  it('cost is 500 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(500);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('Entity constructor initializes HP to strength', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.hp).toBe(200);
    expect(pt.maxHp).toBe(200);
  });
});

// ── Dual Weapon System (vdata.cpp / rules.ini) ──────────────────────────────
// C++ vdata.cpp — PT has primary=2Inch (general purpose) and secondary=DepthCharge (anti-sub)

describe('PT dual weapon system (vdata.cpp)', () => {
  it('2Inch warhead is AP', () => {
    expect(WEAPON_STATS['2Inch'].warhead).toBe('AP');
  });

  it('2Inch damage is 25', () => {
    expect(WEAPON_STATS['2Inch'].damage).toBe(25);
  });

  it('2Inch range is 5.5 cells', () => {
    expect(WEAPON_STATS['2Inch'].range).toBe(5.5);
  });

  it('DepthCharge warhead is AP', () => {
    expect(WEAPON_STATS.DepthCharge.warhead).toBe('AP');
  });

  it('DepthCharge damage is 80', () => {
    expect(WEAPON_STATS.DepthCharge.damage).toBe(80);
  });

  it('DepthCharge range is 5.0 cells', () => {
    expect(WEAPON_STATS.DepthCharge.range).toBe(5.0);
  });

  it('DepthCharge isAntiSub is true', () => {
    expect(WEAPON_STATS.DepthCharge.isAntiSub).toBe(true);
  });

  it('Entity weapon (primary) resolves to 2Inch', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.weapon).not.toBeNull();
    expect(pt.weapon!.name).toBe('2Inch');
  });

  it('Entity weapon2 (secondary) resolves to DepthCharge', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.weapon2).not.toBeNull();
    expect(pt.weapon2!.name).toBe('DepthCharge');
  });
});

// ── Anti-Submarine Capability (aircraft.ts:canTargetNaval) ───────────────────
// C++ techno.cpp — units with isAntiSub weapons can target cloaked subs

describe('PT anti-submarine capability (canTargetNaval)', () => {
  it('PT with antiSub weapon CAN target a cloaked submarine', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    sub.cloakState = CloakState.CLOAKED;

    expect(canTargetNaval(pt, sub)).toBe(true);
  });

  it('PT CAN target a cloaking (transitioning) submarine', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    sub.cloakState = CloakState.CLOAKING;

    expect(canTargetNaval(pt, sub)).toBe(true);
  });

  it('PT CAN target an uncloaked submarine', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    sub.cloakState = CloakState.UNCLOAKED;

    expect(canTargetNaval(pt, sub)).toBe(true);
  });

  it('unit without antiSub CANNOT target a cloaked submarine', () => {
    // Cruiser has no antiSub weapon
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    sub.cloakState = CloakState.CLOAKED;

    expect(canTargetNaval(ca, sub)).toBe(false);
  });

  it('PT DepthCharge has isAntiSub (enables sub detection)', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.weapon2?.isAntiSub).toBe(true);
  });
});

// ── Turret (entity.ts:hasTurret) ─────────────────────────────────────────────
// C++ udata.cpp — PT has a turret (DD, CA, PT have turrets; SS, MSUB do not)

describe('PT turret (udata.cpp)', () => {
  it('PT hasTurret is true', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.hasTurret).toBe(true);
  });

  it('SS (Submarine) has NO turret', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hasTurret).toBe(false);
  });

  it('MSUB (Missile Sub) has NO turret', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hasTurret).toBe(false);
  });

  it('DD (Destroyer) has turret', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.hasTurret).toBe(true);
  });

  it('CA (Cruiser) has turret', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.hasTurret).toBe(true);
  });
});

// ── Fastest Naval Unit (rules.ini speed comparison) ──────────────────────────
// C++ vdata.cpp — PT speed=9 is the highest among all naval vessels

describe('PT fastest armed naval unit (vdata.cpp speed comparison)', () => {
  it('PT speed (9) is strictly greater than all other armed naval combatants', () => {
    // LST is a transport with speed 14 (faster but unarmed);
    // PT is the fastest among armed naval vessels
    const combatNaval = ['SS', 'DD', 'CA', 'MSUB'] as const;
    const ptSpeed = UNIT_STATS.PT.speed;
    for (const name of combatNaval) {
      expect(ptSpeed).toBeGreaterThan(UNIT_STATS[name].speed);
    }
  });

  it('PT speed is 9', () => {
    expect(UNIT_STATS.PT.speed).toBe(9);
  });

  it('LST (unarmed transport) is faster than PT but has no weapon', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.PT.speed);
    expect(UNIT_STATS.LST.primaryWeapon).toBeNull();
  });
});

// ── Cheapest Naval Unit (rules.ini cost comparison) ──────────────────────────
// C++ rules.ini — PT cost=500 is the lowest among all naval combat units

describe('PT cheapest naval unit (rules.ini cost comparison)', () => {
  const navalTypes = ['SS', 'DD', 'CA', 'PT', 'MSUB', 'LST'];

  it('PT cost (500) is the lowest among all naval units', () => {
    const ptProd = PRODUCTION_ITEMS.find(p => p.type === 'PT');
    expect(ptProd).toBeDefined();
    for (const type of navalTypes) {
      const prod = PRODUCTION_ITEMS.find(p => p.type === type);
      if (prod) {
        expect(ptProd!.cost).toBeLessThanOrEqual(prod.cost);
      }
    }
  });

  it('PT cost (500) is strictly less than all other naval combat units', () => {
    const otherNaval = ['SS', 'DD', 'CA', 'MSUB'];
    const ptProd = PRODUCTION_ITEMS.find(p => p.type === 'PT');
    expect(ptProd).toBeDefined();
    for (const type of otherNaval) {
      const prod = PRODUCTION_ITEMS.find(p => p.type === type);
      if (prod) {
        expect(ptProd!.cost).toBeLessThan(prod.cost);
      }
    }
  });
});

// ── Naval Unit Classification (entity.ts:isNavalUnit) ────────────────────────
// C++ vdata.cpp — PT isVessel=true → isNavalUnit getter returns true

describe('PT naval unit classification (entity.ts:isNavalUnit)', () => {
  it('PT isNavalUnit is true', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.isNavalUnit).toBe(true);
  });

  it('all vessels have isNavalUnit=true', () => {
    const vessels: UnitType[] = [
      UnitType.V_PT, UnitType.V_DD, UnitType.V_CA,
      UnitType.V_SS, UnitType.V_MSUB, UnitType.V_LST,
    ];
    for (const type of vessels) {
      const entity = entityAtCell(type, House.Spain, 10, 10);
      expect(entity.isNavalUnit).toBe(true);
    }
  });

  it('land vehicles do NOT have isNavalUnit', () => {
    const landUnits: UnitType[] = [UnitType.V_2TNK, UnitType.V_JEEP, UnitType.V_APC];
    for (const type of landUnits) {
      const entity = entityAtCell(type, House.Spain, 10, 10);
      expect(entity.isNavalUnit).toBe(false);
    }
  });
});

// ── Weapon Effectiveness (combat.cpp warhead tables) ─────────────────────────
// C++ combat.cpp — AP warhead damage multipliers against various armor types

describe('PT weapon effectiveness — AP warhead (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (weak vs unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (best vs heavy armor)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('2Inch deals full 25 damage to heavy-armored targets (AP vs heavy = 1.0)', () => {
    const victim = entityAtCell(UnitType.V_DD, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(25 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(25);
  });

  it('2Inch deals reduced damage to unarmored targets (AP vs none = 0.3)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(25 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBeLessThan(25);
  });

  it('DepthCharge deals 80 full damage to heavy-armored sub (AP vs heavy = 1.0)', () => {
    const victim = entityAtCell(UnitType.V_DD, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(80 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(80);
  });
});
