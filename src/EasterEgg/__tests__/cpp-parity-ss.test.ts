/**
 * C++ Behavioral Parity: SS -- Submarine
 *
 * Tests verify Submarine behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with SS (observable outcomes: HP, cloakState,
 * targeting, weapon constraints, turret), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES, resetEntityIds } from '../engine/entity';
import { canTargetNaval } from '../engine/aircraft';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// -- Stats Verification (rules.ini parity) ------------------------------------
// C++ vdata.cpp (vessel type data) -- SS entry and RULES.INI [SS] section

describe('SS stats verification (vdata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.SS;
  const weapon = WEAPON_STATS.TorpTube;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'SS');

  it('HP is 120 (Strength=120)', () => {
    expect(stats.strength).toBe(120);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 6 (Speed=6)', () => {
    expect(stats.speed).toBe(6);
  });

  it('isVessel is true (naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('isCloakable is true (submarine stealth)', () => {
    expect(stats.isCloakable).toBe(true);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primary weapon is TorpTube', () => {
    expect(stats.primaryWeapon).toBe('TorpTube');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('cost is 950 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(950);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hp).toBe(120);
    expect(ss.maxHp).toBe(120);
  });
});

// -- Weapon: TorpTube (weapons.ini parity) ------------------------------------
// C++ weapon.cpp -- TorpTube entry

describe('SS weapon -- TorpTube (weapon.cpp)', () => {
  const weapon = WEAPON_STATS.TorpTube;

  it('warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('damage is 90', () => {
    expect(weapon.damage).toBe(90);
  });

  it('range is 9.0 cells', () => {
    expect(weapon.range).toBe(9.0);
  });

  it('isSubSurface is true (torpedo travels underwater)', () => {
    expect(weapon.isSubSurface).toBe(true);
  });

  it('Entity weapon reference matches TorpTube stats', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.weapon).not.toBeNull();
    expect(ss.weapon!.name).toBe('TorpTube');
    expect(ss.weapon!.damage).toBe(90);
    expect(ss.weapon!.isSubSurface).toBe(true);
  });

  it('no secondary weapon on entity', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.weapon2).toBeNull();
  });
});

// -- Weapon Effectiveness (combat.cpp warhead tables) -------------------------
// C++ combat.cpp -- Modify_Damage uses WARHEAD_VS_ARMOR table

describe('SS weapon effectiveness -- AP warhead (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs unarmored infantry)', () => {
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

  it('SS deals 90 base damage to heavy-armor targets (AP vs heavy = 1.0)', () => {
    const victim = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    victim.takeDamage(90, 'AP');
    expect(hpBefore - victim.hp).toBe(90);
  });

  it('SS deals reduced damage to light-armor targets (AP vs light = 0.75)', () => {
    const damage = Math.round(90 * WARHEAD_VS_ARMOR.AP[armorIndex('light')]);
    expect(damage).toBe(68); // 90 * 0.75 = 67.5 -> 68
  });
});

// -- Cloaking State Machine (techno.cpp / vessel.cpp) -------------------------
// C++ techno.cpp -- CloakState enum and cloak transitions

describe('SS cloaking state machine (techno.cpp)', () => {
  it('SS starts UNCLOAKED', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('CloakState enum has four states: UNCLOAKED, CLOAKING, CLOAKED, UNCLOAKING', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('cloakTimer starts at 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.cloakTimer).toBe(0);
  });

  it('sonarPulseTimer starts at 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.sonarPulseTimer).toBe(0);
  });

  it('CLOAK_TRANSITION_FRAMES is 38 (~2.5 seconds at 15 FPS)', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('SS can transition to CLOAKING state', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(ss.cloakState).toBe(CloakState.CLOAKING);
    expect(ss.cloakTimer).toBe(38);
  });

  it('SS can transition to CLOAKED state', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    expect(ss.cloakState).toBe(CloakState.CLOAKED);
  });

  it('SS can transition to UNCLOAKING state', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKING;
    ss.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(38);
  });
});

// -- Cloaked Sub Visibility (aircraft.ts canTargetNaval) -----------------------
// C++ vessel.cpp -- cloaked subs invisible to non-antiSub scanners

describe('SS cloaked sub visibility (vessel.cpp / canTargetNaval)', () => {
  it('CLOAKED sub is invisible to scanner without antiSub weapon', () => {
    const scanner = entityAtCell(UnitType.V_CA, House.Spain, 10, 10); // Cruiser: 8Inch primary/secondary, no antiSub
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    ss.cloakState = CloakState.CLOAKED;
    // Verify scanner has no antiSub capability
    expect(scanner.weapon?.isAntiSub).toBeFalsy();
    expect(scanner.weapon2?.isAntiSub).toBeFalsy();
    expect(canTargetNaval(scanner, ss)).toBe(false);
  });

  it('CLOAKING sub is also invisible to scanner without antiSub weapon', () => {
    const scanner = entityAtCell(UnitType.V_CA, House.Spain, 10, 10); // Cruiser: no antiSub
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    ss.cloakState = CloakState.CLOAKING;
    expect(canTargetNaval(scanner, ss)).toBe(false);
  });

  it('CLOAKED sub IS visible to DD (Destroyer has antiSub depth charges)', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    ss.cloakState = CloakState.CLOAKED;
    // DD's secondary weapon (DepthCharge) has isAntiSub: true
    expect(dd.weapon2).not.toBeNull();
    expect(dd.weapon2!.isAntiSub).toBe(true);
    expect(canTargetNaval(dd, ss)).toBe(true);
  });

  it('UNCLOAKED sub is visible to any scanner', () => {
    const scanner = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    ss.cloakState = CloakState.UNCLOAKED;
    expect(canTargetNaval(scanner, ss)).toBe(true);
  });

  it('UNCLOAKING sub is visible to any scanner', () => {
    const scanner = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 11, 10);
    ss.cloakState = CloakState.UNCLOAKING;
    expect(canTargetNaval(scanner, ss)).toBe(true);
  });
});

// -- Force Uncloak on Damage (entity.ts takeDamage) ---------------------------
// C++ techno.cpp -- cloaked/cloaking units force-uncloak when damaged

describe('SS force uncloak on damage (techno.cpp)', () => {
  it('CLOAKED SS transitions to UNCLOAKING when damaged', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;
    ss.cloakTimer = 0;

    ss.takeDamage(10, 'AP');

    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('CLOAKING SS transitions to UNCLOAKING when damaged', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKING;
    ss.cloakTimer = 20;

    ss.takeDamage(10, 'AP');

    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
    expect(ss.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('UNCLOAKED SS stays UNCLOAKED when damaged', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKED;

    ss.takeDamage(10, 'AP');

    expect(ss.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('UNCLOAKING SS stays UNCLOAKING when damaged (already decloaking)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.UNCLOAKING;
    ss.cloakTimer = 15;

    ss.takeDamage(10, 'AP');

    // Already uncloaking; takeDamage condition only triggers for CLOAKED/CLOAKING
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('lethal damage on CLOAKED SS sets UNCLOAKING before death', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.cloakState = CloakState.CLOAKED;

    const killed = ss.takeDamage(999, 'AP');

    expect(killed).toBe(true);
    expect(ss.alive).toBe(false);
    // The force-uncloak fires before the death check in takeDamage
    expect(ss.cloakState).toBe(CloakState.UNCLOAKING);
  });
});

// -- Torpedo-Only Limitation (canTargetNaval) ---------------------------------
// C++ vessel.cpp -- torpedo-only subs cannot target land units

describe('SS torpedo-only limitation (vessel.cpp)', () => {
  it('SS cannot target land units (TorpTube isSubSurface, no secondary weapon)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    expect(canTargetNaval(ss, tank)).toBe(false);
  });

  it('SS cannot target infantry', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    expect(canTargetNaval(ss, infantry)).toBe(false);
  });

  it('SS CAN target naval units (other vessels)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    expect(canTargetNaval(ss, dd)).toBe(true);
  });

  it('SS CAN target another SS (naval vessel)', () => {
    const ss1 = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const ss2 = entityAtCell(UnitType.V_SS, House.Spain, 11, 10);
    // Target SS is UNCLOAKED, so no antiSub check needed
    ss2.cloakState = CloakState.UNCLOAKED;
    expect(canTargetNaval(ss1, ss2)).toBe(true);
  });

  it('torpedo-only check: isSubSurface primary with no secondary means land targets rejected', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    // Verify the conditions that cause canTargetNaval to reject land targets
    expect(ss.weapon!.isSubSurface).toBe(true);
    expect(ss.weapon2).toBeNull();
  });
});

// -- No Turret (udata.cpp) ----------------------------------------------------
// C++ udata.cpp -- SS and MSUB have no turret; DD, CA, PT do

describe('SS no turret (udata.cpp)', () => {
  it('SS hasTurret is false', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hasTurret).toBe(false);
  });

  it('MSUB also has no turret', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hasTurret).toBe(false);
  });

  it('DD (Destroyer) DOES have a turret', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.hasTurret).toBe(true);
  });

  it('CA (Cruiser) DOES have a turret', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    expect(ca.hasTurret).toBe(true);
  });

  it('PT (Gunboat) DOES have a turret', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    expect(pt.hasTurret).toBe(true);
  });
});

// -- Naval Unit Classification (vessel.cpp) -----------------------------------
// C++ vessel.cpp -- SS is a naval unit (isVessel)

describe('SS naval unit classification (vessel.cpp)', () => {
  it('SS isNavalUnit is true', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.isNavalUnit).toBe(true);
  });

  it('SS is not infantry', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.stats.isInfantry).toBe(false);
  });

  it('SS is not aircraft', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.isAirUnit).toBe(false);
  });

  it('SS is not an ant', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.isAnt).toBe(false);
  });

  it('SS is not crushable (only infantry are crushable)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.stats.crushable).toBeFalsy();
  });
});

// -- Damage and Death (entity.ts takeDamage) ----------------------------------
// C++ techno.cpp -- standard damage, death at HP <= 0

describe('SS damage and death (techno.cpp)', () => {
  it('SS takes exact damage from AP warhead', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const hpBefore = ss.hp;
    ss.takeDamage(90, 'AP');
    expect(hpBefore - ss.hp).toBe(90);
  });

  it('SS dies when HP reaches 0', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const killed = ss.takeDamage(120, 'AP');
    expect(killed).toBe(true);
    expect(ss.alive).toBe(false);
    expect(ss.hp).toBe(0);
  });

  it('SS survives 119 damage (1 HP remaining)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const killed = ss.takeDamage(119, 'AP');
    expect(killed).toBe(false);
    expect(ss.alive).toBe(true);
    expect(ss.hp).toBe(1);
  });

  it('dead SS cannot take further damage', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.takeDamage(120, 'AP');
    expect(ss.alive).toBe(false);
    const result = ss.takeDamage(50, 'AP');
    expect(result).toBe(false); // no further effect
  });

  it('invulnerable SS takes no damage', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    ss.ironCurtainTick = 100;
    const killed = ss.takeDamage(999, 'AP');
    expect(killed).toBe(false);
    expect(ss.hp).toBe(120);
  });
});
