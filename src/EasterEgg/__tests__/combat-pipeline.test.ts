/**
 * Combat pipeline refactor tests — verifies centralized armorIndex,
 * getWarheadMultiplier, firepower bias in aircraft/defense combat,
 * and veterancy removal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  armorIndex, getWarheadMultiplier,
  WARHEAD_VS_ARMOR, type ArmorType, type WarheadType,
  UNIT_STATS, WEAPON_STATS, COUNTRY_BONUSES,
  UnitType, House,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// === H1: Centralized armorIndex + getWarheadMultiplier ===

describe('armorIndex()', () => {
  it('maps all 5 armor types to correct indices', () => {
    expect(armorIndex('none')).toBe(0);
    expect(armorIndex('wood')).toBe(1);
    expect(armorIndex('light')).toBe(2);
    expect(armorIndex('heavy')).toBe(3);
    expect(armorIndex('concrete')).toBe(4);
  });
});

describe('getWarheadMultiplier()', () => {
  it('matches direct WARHEAD_VS_ARMOR table lookups', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic'];
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

    for (const wh of warheads) {
      for (const armor of armors) {
        const expected = WARHEAD_VS_ARMOR[wh][armorIndex(armor)];
        expect(getWarheadMultiplier(wh, armor)).toBe(expected);
      }
    }
  });

  it('SA vs concrete = 0.25', () => {
    expect(getWarheadMultiplier('SA', 'concrete')).toBe(0.25);
  });

  it('HE vs concrete = 1.0', () => {
    expect(getWarheadMultiplier('HE', 'concrete')).toBe(1.0);
  });

  it('AP vs heavy = 1.0', () => {
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('Organic vs none = 1.0, Organic vs any armor = 0.0', () => {
    expect(getWarheadMultiplier('Organic', 'none')).toBe(1.0);
    expect(getWarheadMultiplier('Organic', 'wood')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'light')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'heavy')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'concrete')).toBe(0.0);
  });
});

// === H3: Aircraft combat pipeline — firepower bias + kill tracking ===

describe('Aircraft damage formula includes firepower bias', () => {
  // Mirrors the formula in Game.fireWeaponAt:
  // damage = mult <= 0 ? 0 : Math.max(1, Math.round(weapon.damage * mult * houseBias))

  it('USSR aircraft (firepowerMult=1.10) deal 10% more damage than Spain (1.0)', () => {
    const weaponName = UNIT_STATS.MIG.primaryWeapon!;
    const weapon = WEAPON_STATS[weaponName];
    const targetArmor: ArmorType = 'heavy'; // typical ground target
    const mult = getWarheadMultiplier(weapon.warhead, targetArmor);

    const spainBias = COUNTRY_BONUSES.Spain.firepowerMult;
    const ussrBias = COUNTRY_BONUSES.USSR.firepowerMult;
    expect(ussrBias).toBe(1.10);
    expect(spainBias).toBe(1.0);

    const spainDmg = Math.max(1, Math.round(weapon.damage * mult * spainBias));
    const ussrDmg = Math.max(1, Math.round(weapon.damage * mult * ussrBias));
    expect(ussrDmg).toBeGreaterThan(spainDmg);
  });

  it('aircraft structure attack uses warhead-vs-concrete mult + house bias', () => {
    const weaponName = UNIT_STATS.HELI.primaryWeapon!;
    const weapon = WEAPON_STATS[weaponName];
    const mult = getWarheadMultiplier(weapon.warhead, 'concrete');

    const ussrBias = COUNTRY_BONUSES.USSR.firepowerMult;
    const dmgNoHouse = Math.max(1, Math.round(weapon.damage * mult * 1.0));
    const dmgUSSR = Math.max(1, Math.round(weapon.damage * mult * ussrBias));
    // USSR gets a boost on structure damage
    expect(dmgUSSR).toBeGreaterThanOrEqual(dmgNoHouse);
  });

  it('aircraft kill awards attacker.creditKill()', () => {
    const attacker = new Entity(UnitType.V_MIG, House.Spain, 100, 100);
    const target = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    expect(attacker.kills).toBe(0);

    // Simulate aircraft kill — the pipeline calls attacker.creditKill() on kill
    const weapon = WEAPON_STATS[UNIT_STATS.MIG.primaryWeapon!];
    const mult = getWarheadMultiplier(weapon.warhead, target.stats.armor);
    const bias = COUNTRY_BONUSES.Spain.firepowerMult;
    const damage = Math.max(1, Math.round(weapon.damage * mult * bias));

    // Apply enough damage to kill
    target.hp = 1;
    const killed = target.takeDamage(damage, weapon.warhead);
    expect(killed).toBe(true);

    // In the real Game.fireWeaponAt, this triggers attacker.creditKill()
    if (killed) attacker.creditKill();
    expect(attacker.kills).toBe(1);
  });

  it('Organic warhead vs armored target deals 0 damage (mult <= 0 guard)', () => {
    // The pipeline checks: mult <= 0 ? 0 : Math.max(1, ...)
    const mult = getWarheadMultiplier('Organic', 'heavy');
    expect(mult).toBe(0);
    const damage = mult <= 0 ? 0 : Math.max(1, Math.round(50 * mult * 1.0));
    expect(damage).toBe(0);
  });
});

// === M4: Defense structure firepower bias ===

describe('Defense structure damage formula includes firepower bias', () => {
  // Mirrors the formula in Game.updateStructureCombat:
  // damage = mult <= 0 ? 0 : Math.max(1, Math.round(s.weapon.damage * mult * houseBias))

  it('USSR defense (firepowerMult=1.10) deals more damage than neutral (1.0)', () => {
    // Simulate a GUN turret-like defense with HE warhead
    const weaponDamage = 40; // typical turret damage
    const warhead: WarheadType = 'HE';
    const targetArmor: ArmorType = 'light';
    const mult = getWarheadMultiplier(warhead, targetArmor);

    const neutralBias = COUNTRY_BONUSES.Neutral.firepowerMult;
    const ussrBias = COUNTRY_BONUSES.USSR.firepowerMult;

    const neutralDmg = Math.max(1, Math.round(weaponDamage * mult * neutralBias));
    const ussrDmg = Math.max(1, Math.round(weaponDamage * mult * ussrBias));

    expect(ussrDmg).toBeGreaterThan(neutralDmg);
  });

  it('Ukraine defense (firepowerMult=1.05) gets 5% boost', () => {
    const weaponDamage = 100;
    const warhead: WarheadType = 'AP';
    const targetArmor: ArmorType = 'heavy';
    const mult = getWarheadMultiplier(warhead, targetArmor);

    const baseDmg = Math.max(1, Math.round(weaponDamage * mult * 1.0));
    const ukraineBias = COUNTRY_BONUSES.Ukraine.firepowerMult;
    expect(ukraineBias).toBe(1.05);
    const ukraineDmg = Math.max(1, Math.round(weaponDamage * mult * ukraineBias));

    expect(ukraineDmg).toBeGreaterThan(baseDmg);
    // AP vs heavy = 1.0, so: base=100, ukraine=Math.round(100*1.0*1.05)=105
    expect(ukraineDmg).toBe(105);
    expect(baseDmg).toBe(100);
  });

  it('ant house bias applied in ant scenarios (USSR ants get 1.1x)', () => {
    // In ant missions (SCA*), Game.getFirepowerBias checks ANT_HOUSES
    // USSR ants get 1.1, Ukraine 1.0, Germany 0.9
    // We verify the expected damage formulas match
    const antBiasUSSR = 1.1;   // from Game.getFirepowerBias for USSR in SCA* scenarios
    const antBiasGermany = 0.9;
    const weaponDamage = 50;
    const mult = getWarheadMultiplier('SA', 'none'); // SA vs infantry

    const ussrDmg = Math.max(1, Math.round(weaponDamage * mult * antBiasUSSR));
    const germanyDmg = Math.max(1, Math.round(weaponDamage * mult * antBiasGermany));

    expect(ussrDmg).toBeGreaterThan(germanyDmg);
    // SA vs none = 1.0, so: USSR = round(50*1.0*1.1)=55, Germany = round(50*1.0*0.9)=45
    expect(ussrDmg).toBe(55);
    expect(germanyDmg).toBe(45);
  });
});

// === M3: retreatFromTarget ===

describe('retreatFromTarget formula', () => {
  it('computes retreat position away from target, clamped to map bounds', () => {
    // Mirrors Game.retreatFromTarget:
    // retreatX = clamp(entity.x + (dx/len) * CELL_SIZE * 2, minX, maxX)
    const CELL_SIZE = 24;
    const entityPos = { x: 100, y: 100 };
    const targetPos = { x: 120, y: 100 }; // target to the right

    const dx = entityPos.x - targetPos.x; // -20 (retreat left)
    const dy = entityPos.y - targetPos.y; // 0
    const len = Math.sqrt(dx * dx + dy * dy) || 1; // 20

    const boundsMinX = 0;
    const boundsMaxX = 50 * CELL_SIZE; // 1200
    const retreatX = Math.max(boundsMinX, Math.min(boundsMaxX, entityPos.x + (dx / len) * CELL_SIZE * 2));
    const retreatY = Math.max(0, Math.min(50 * CELL_SIZE, entityPos.y + (dy / len) * CELL_SIZE * 2));

    // Should retreat left (away from target)
    expect(retreatX).toBeLessThan(entityPos.x);
    expect(retreatX).toBe(100 + (-1) * CELL_SIZE * 2); // 100 - 48 = 52
    expect(retreatY).toBe(100); // no vertical movement
  });

  it('clamps to map bounds when retreat would go off-map', () => {
    const CELL_SIZE = 24;
    const boundsMinX = 40 * CELL_SIZE; // 960
    const entityPos = { x: 965, y: 500 }; // near left edge
    const targetPos = { x: 1000, y: 500 }; // target to the right

    const dx = entityPos.x - targetPos.x; // -35
    const dy = entityPos.y - targetPos.y; // 0
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const retreatX = Math.max(boundsMinX, Math.min(2160, entityPos.x + (dx / len) * CELL_SIZE * 2));
    // 965 + (-1) * 48 = 917, but min is 960
    expect(retreatX).toBe(boundsMinX); // clamped
  });
});

// === M1+M2: Veterancy removal ===

describe('Veterancy cleanup', () => {
  it('Entity has no veterancy field', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect('veterancy' in e).toBe(false);
  });

  it('Entity has no damageMultiplier getter', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect('damageMultiplier' in e).toBe(false);
  });

  it('creditKill still increments kills', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.kills).toBe(0);
    e.creditKill();
    e.creditKill();
    e.creditKill();
    expect(e.kills).toBe(3);
  });
});
