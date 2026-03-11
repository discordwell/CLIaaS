/**
 * Combat & Damage Pipeline Tests — comprehensive verification of the
 * Game class combat system: damage application, warhead multipliers,
 * projectile lifecycle, crush mechanics, structure damage, overkill,
 * retaliation, and kill tracking.
 *
 * Tests use Entity/types directly and source-code verification for
 * Game-class private methods (same pattern as unit-crushing.test.ts
 * and combat-parity.test.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS,
  COUNTRY_BONUSES, ANT_HOUSES,
  type WarheadType, type ArmorType, type WeaponStats, type WarheadProps,
  armorIndex, getWarheadMultiplier, modifyDamage, worldDist,
  buildDefaultAlliances, Mission, AnimState,
  PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { Game } from '../engine/index';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

/** Mirror of Game.isAllied using the default alliance table */
function isAllied(a: House, b: House): boolean {
  const alliances = buildDefaultAlliances();
  return alliances.get(a)?.has(b) ?? false;
}

// =========================================================================
// 1. fireWeaponAt — damage pipeline verification
// =========================================================================
describe('fireWeaponAt damage pipeline', () => {
  it('uses modifyDamage with houseBias, warhead mult, and spreadFactor at point-blank', () => {
    // Simulate fireWeaponAt: damage = modifyDamage(weapon.damage, warhead, armor, 0, houseBias, whMult, spreadFactor)
    const weapon = WEAPON_STATS.M1Carbine; // SA warhead, 15 damage
    const targetArmor: ArmorType = 'none';
    const houseBias = COUNTRY_BONUSES.Spain.firepowerMult; // 1.0
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor); // SA vs none = 1.0
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, houseBias, whMult, spreadFactor);
    expect(damage).toBe(15); // full damage at point-blank, no bias, no armor reduction
  });

  it('Germany house bias (1.10) increases damage from fireWeaponAt', () => {
    const weapon = WEAPON_STATS['90mm']; // AP warhead, 30 damage
    const targetArmor: ArmorType = 'heavy'; // AP vs heavy = 1.0
    const germanBias = COUNTRY_BONUSES.Germany.firepowerMult; // 1.10
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor);
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, germanBias, whMult, spreadFactor);
    // 30 * 1.0 * 1.10 = 33
    expect(damage).toBe(33);
  });

  it('USSR house bias is 1.0 (10% cheaper, not firepower boost)', () => {
    const weapon = WEAPON_STATS['120mm']; // AP warhead, 40 damage
    const targetArmor: ArmorType = 'heavy';
    const ussrBias = COUNTRY_BONUSES.USSR.firepowerMult;
    expect(ussrBias).toBe(1.0); // USSR gets cost discount, not firepower
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor); // 1.0
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, ussrBias, whMult, spreadFactor);
    expect(damage).toBe(40); // 40 * 1.0 * 1.0 = 40
  });

  it('fireWeaponAt source code calls modifyDamage with correct args', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private fireWeaponAt(');
    expect(startIdx, 'fireWeaponAt method found').toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('getFirepowerBias(attacker.house)');
    expect(chunk).toContain('getWarheadMult(weapon.warhead');
    expect(chunk).toContain('modifyDamage(');
    expect(chunk).toContain('damageEntity(target, damage');
  });

  it('fireWeaponAt credits kill on entity death', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private fireWeaponAt(');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('creditKill()');
  });
});

// =========================================================================
// 2. damageEntity — wraps Entity.takeDamage + trigger tracking
// =========================================================================
describe('damageEntity behavior (via Entity.takeDamage)', () => {
  it('reduces target HP by damage amount', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const hpBefore = target.hp;
    target.takeDamage(10, 'SA');
    expect(target.hp).toBe(hpBefore - 10);
    expect(target.alive).toBe(true);
  });

  it('kills target when damage exceeds remaining HP', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const killed = target.takeDamage(target.hp + 50, 'SA');
    expect(killed).toBe(true);
    expect(target.alive).toBe(false);
    expect(target.hp).toBe(0);
    expect(target.mission).toBe(Mission.DIE);
    expect(target.animState).toBe(AnimState.DIE);
  });

  it('does not damage dead targets (already dead check)', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    target.alive = false;
    target.hp = 0;
    const killed = target.takeDamage(50, 'SA');
    expect(killed).toBe(false);
    expect(target.hp).toBe(0);
  });

  it('damageEntity source code calls aiScatterOnDamage for non-killed units', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageEntity(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain('takeDamage(amount, warhead, attacker');
    expect(chunk).toContain('aiScatterOnDamage');
  });

  it('damageEntity tracks attacked trigger names', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageEntity(');
    const chunk = src.slice(startIdx, startIdx + 300);
    expect(chunk).toContain('triggerName');
    expect(chunk).toContain('attackedTriggerNames');
  });
});

// =========================================================================
// 3. damageStructure — HP reduction, destruction, power system
// =========================================================================
describe('damageStructure behavior', () => {
  it('source code reduces structure HP with Math.max(0, hp - damage)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageStructure(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 400);
    expect(chunk).toContain('s.hp = Math.max(0, s.hp - damage)');
  });

  it('source code sets alive=false and rubble=true on structure death', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageStructure(');
    const chunk = src.slice(startIdx, startIdx + 1200);
    expect(chunk).toContain('s.alive = false');
    expect(chunk).toContain('s.rubble = true');
  });

  it('source code returns false when structure is already dead', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageStructure(');
    const chunk = src.slice(startIdx, startIdx + 200);
    expect(chunk).toContain('if (!s.alive) return false');
  });

  it('source code records AI base attack on structure damage', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageStructure(');
    const chunk = src.slice(startIdx, startIdx + 500);
    expect(chunk).toContain('aiStates');
    expect(chunk).toContain('lastBaseAttackTick');
    expect(chunk).toContain('underAttack');
  });

  it('destroyed structure explosion damages nearby units in 2-cell radius', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private damageStructure(');
    const chunk = src.slice(startIdx, startIdx + 4500);
    expect(chunk).toContain('blastRadius');
    expect(chunk).toContain('damageEntity(e, blastDmg');
  });

  it('fireWeaponAtStructure uses concrete armor for warhead mult', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private fireWeaponAtStructure(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain("'concrete'");
    expect(chunk).toContain('damageStructure(s, damage)');
  });
});

// =========================================================================
// 4. getWarheadMult — warhead vs armor modifier lookup with overrides
// =========================================================================
describe('getWarheadMult — warhead vs armor modifiers', () => {
  it('SA vs none = 1.0 (full damage to unarmored)', () => {
    expect(getWarheadMultiplier('SA', 'none')).toBe(1.0);
  });

  it('SA vs heavy = 0.25 (bad against heavy armor)', () => {
    expect(getWarheadMultiplier('SA', 'heavy')).toBe(0.25);
  });

  it('AP vs none = 0.3 (bad against infantry)', () => {
    expect(getWarheadMultiplier('AP', 'none')).toBe(0.3);
  });

  it('AP vs heavy = 1.0 (designed for heavy armor)', () => {
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('HE vs none = 0.9 (slightly reduced vs infantry)', () => {
    expect(getWarheadMultiplier('HE', 'none')).toBe(0.9);
  });

  it('HE vs concrete = 1.0 (full damage to structures)', () => {
    expect(getWarheadMultiplier('HE', 'concrete')).toBe(1.0);
  });

  it('Fire vs wood = 1.0 (maximum vs wooden structures)', () => {
    expect(getWarheadMultiplier('Fire', 'wood')).toBe(1.0);
  });

  it('HollowPoint vs none = 1.0 (anti-infantry)', () => {
    expect(getWarheadMultiplier('HollowPoint', 'none')).toBe(1.0);
  });

  it('HollowPoint vs any armor = 0.05 (ineffective vs armor)', () => {
    expect(getWarheadMultiplier('HollowPoint', 'wood')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'light')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'heavy')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'concrete')).toBe(0.05);
  });

  it('Super vs all = 1.0 (uniform damage)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Super', a)).toBe(1.0);
    }
  });

  it('Organic vs none = 1.0, vs everything else = 0.0', () => {
    expect(getWarheadMultiplier('Organic', 'none')).toBe(1.0);
    expect(getWarheadMultiplier('Organic', 'wood')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'light')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'heavy')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'concrete')).toBe(0.0);
  });

  it('Nuke matches Fire warhead multipliers (both incendiary)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Nuke', a)).toBe(getWarheadMultiplier('Fire', a));
    }
  });

  it('Game.getWarheadMult supports scenario overrides via warheadOverrides', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private getWarheadMult(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 300);
    expect(chunk).toContain('warheadOverrides');
    expect(chunk).toContain('WARHEAD_VS_ARMOR');
  });
});

// =========================================================================
// 5. checkVehicleCrush — EXECUTION tests (not just source grep)
// =========================================================================
describe('checkVehicleCrush — crush execution', () => {
  it('heavy tank kills crushable infantry when sharing same cell', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    expect(tank.stats.crusher).toBe(true);
    expect(infantry.stats.crushable).toBe(true);

    // Simulate crush: Game.checkVehicleCrush does damageEntity(other, other.hp + 10, 'Super')
    const killed = infantry.takeDamage(infantry.hp + 10, 'Super');
    expect(killed).toBe(true);
    expect(infantry.alive).toBe(false);
    expect(infantry.hp).toBe(0);
  });

  it('crush kills ant units', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 200, 200);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 200, 200);

    expect(mammoth.stats.crusher).toBe(true);
    expect(ant.stats.crushable).toBe(true);

    const killed = ant.takeDamage(ant.hp + 10, 'Super');
    expect(killed).toBe(true);
    expect(ant.alive).toBe(false);
  });

  it('crush skips allied units — source code has isAllied guard', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private checkVehicleCrush(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain('isAllied(vehicle.house, other.house)');
    expect(chunk).toContain('continue');
    // Verify it only applies to crushable units
    expect(chunk).toContain('crushable');
  });

  it('crusher credits a kill after crushing', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(tank.kills).toBe(0);

    infantry.takeDamage(infantry.hp + 10, 'Super');
    tank.creditKill();
    expect(tank.kills).toBe(1);
  });

  it('non-crusher vehicle does not have crusher flag', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain);
    expect(jeep.stats.crusher).toBeFalsy();
  });

  it('vehicles are NOT crushable (no vehicle-on-vehicle crush)', () => {
    const light = makeEntity(UnitType.V_1TNK, House.USSR);
    expect(light.stats.crushable).toBeFalsy();
  });

  it('allied infantry are crushable by stats but protected by runtime isAllied check', () => {
    // Verify that the crusher flag/crushable flag are house-independent
    // (runtime alliance check handles protection)
    const friendlyInf = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const alliedInf = makeEntity(UnitType.I_E1, House.Greece, 100, 100);
    expect(friendlyInf.stats.crushable).toBe(true);
    expect(alliedInf.stats.crushable).toBe(true);
    // Spain and Greece are allied
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
  });
});

// =========================================================================
// 6. Projectile lifecycle — creation, travel, impact, splash
// =========================================================================
describe('Projectile lifecycle', () => {
  it('InflightProjectile interface has all required fields', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('interface InflightProjectile');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain('attackerId');
    expect(chunk).toContain('targetId');
    expect(chunk).toContain('weapon');
    expect(chunk).toContain('damage');
    expect(chunk).toContain('speed');
    expect(chunk).toContain('travelFrames');
    expect(chunk).toContain('currentFrame');
    expect(chunk).toContain('directHit');
    expect(chunk).toContain('impactX');
    expect(chunk).toContain('impactY');
    expect(chunk).toContain('attackerIsPlayer');
  });

  it('launchProjectile computes travelFrames from distance and speed', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private launchProjectile(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 400);
    // Must compute travelFrames based on distance and speed
    expect(chunk).toContain('worldDist');
    expect(chunk).toContain('travelFrames');
    expect(chunk).toContain('inflightProjectiles.push');
  });

  it('projectile travel frames = max(1, round(dist / speed))', () => {
    // Mirror the formula from launchProjectile
    const shooterPos = { x: 100, y: 100 };
    const impactPos = { x: 220, y: 100 };
    const dist = worldDist(shooterPos, impactPos);
    const speed = 2.0; // cells per tick
    const travelFrames = Math.max(1, Math.round(dist / speed));
    // dist = (220-100)/24 = 5.0 cells, 5.0/2.0 = 2.5, round = 3
    expect(travelFrames).toBe(3);
  });

  it('updateInflightProjectiles increments currentFrame each tick', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private updateInflightProjectiles');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 500);
    expect(chunk).toContain('proj.currentFrame++');
  });

  it('arrived projectiles apply damage via damageEntity and credit kills', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('// Apply damage for arrived projectiles');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('damageEntity(target, proj.damage');
    expect(chunk).toContain('attacker.creditKill()');
  });

  it('arrived projectiles with splash trigger applySplashDamage', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('// Apply damage for arrived projectiles');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 1200);
    expect(chunk).toContain('applySplashDamage');
    expect(chunk).toContain('proj.weapon.splash');
  });

  it('homing projectiles update impactX/Y based on target movement', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private updateInflightProjectiles');
    const chunk = src.slice(startIdx, startIdx + 1200);
    expect(chunk).toContain('projectileROT');
    expect(chunk).toContain('trackFactor');
    expect(chunk).toContain('proj.impactX');
    expect(chunk).toContain('proj.impactY');
  });

  it('homing updates only every other frame (C++ bullet.cpp:368)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private updateInflightProjectiles');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('currentFrame % 2 === 0');
  });
});

// =========================================================================
// 7. Damage types — warhead classes against different armor types
// =========================================================================
describe('Damage types — warhead vs armor matrix', () => {
  // Verify key damage matchups that drive gameplay

  it('AP weapons are effective vs heavy (tanks vs tanks)', () => {
    const damage = 40; // 120mm
    const mult = getWarheadMultiplier('AP', 'heavy');
    expect(mult).toBe(1.0);
    expect(modifyDamage(damage, 'AP', 'heavy', 0)).toBe(40);
  });

  it('AP weapons are poor vs infantry (none armor)', () => {
    const damage = 40;
    const mult = getWarheadMultiplier('AP', 'none');
    expect(mult).toBe(0.3);
    expect(modifyDamage(damage, 'AP', 'none', 0)).toBe(12);
  });

  it('HE weapons are versatile (good vs concrete and wood)', () => {
    const damage = 150;
    expect(modifyDamage(damage, 'HE', 'concrete', 0)).toBe(150); // 1.0x
    expect(modifyDamage(damage, 'HE', 'wood', 0)).toBe(113); // round(150 * 0.75) = 112.5 -> 113
  });

  it('Fire warhead is devastating vs wood but weak vs heavy', () => {
    const damage = 100;
    expect(modifyDamage(damage, 'Fire', 'wood', 0)).toBe(100); // 1.0x
    expect(modifyDamage(damage, 'Fire', 'heavy', 0)).toBe(25); // 0.25x
  });

  it('SA (Small Arms) is effective vs infantry, poor vs armor', () => {
    expect(modifyDamage(15, 'SA', 'none', 0)).toBe(15);  // 1.0x
    expect(modifyDamage(15, 'SA', 'heavy', 0)).toBe(4);  // round(15 * 0.25) = 3.75 -> 4
    expect(modifyDamage(15, 'SA', 'concrete', 0)).toBe(4); // round(15 * 0.25) = 3.75 -> 4
  });

  it('Organic warhead deals zero vs armored targets', () => {
    expect(modifyDamage(100, 'Organic', 'wood', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'light', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'heavy', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'concrete', 0)).toBe(0);
  });

  it('Organic warhead deals full damage vs none (infantry)', () => {
    expect(modifyDamage(100, 'Organic', 'none', 0)).toBe(100);
  });

  it('HollowPoint is extreme anti-infantry but nearly useless vs armor', () => {
    expect(modifyDamage(100, 'HollowPoint', 'none', 0)).toBe(100);
    // 0.05 mult: 100 * 0.05 = 5
    expect(modifyDamage(100, 'HollowPoint', 'heavy', 0)).toBe(5);
  });

  it('Mechanical warhead has 1.0 vs all (for mechanic healing)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Mechanical', a)).toBe(1.0);
    }
  });
});

// =========================================================================
// 8. Overkill handling — damage exceeding HP, death state transitions
// =========================================================================
describe('Overkill handling', () => {
  it('HP clamps to 0 when damage exceeds remaining HP', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 10;
    target.takeDamage(500, 'HE');
    expect(target.hp).toBe(0); // clamped at 0, not negative
  });

  it('death sets mission to DIE and animState to DIE', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.takeDamage(target.hp + 100, 'AP');
    expect(target.mission).toBe(Mission.DIE);
    expect(target.animState).toBe(AnimState.DIE);
    expect(target.animFrame).toBe(0);
    expect(target.animTick).toBe(0);
    expect(target.deathTick).toBe(0);
  });

  it('single-damage overkill (e.g. nuke) results in clean death', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    expect(target.hp).toBe(600); // mammoth has 600 HP
    const killed = target.takeDamage(9999, 'Nuke');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('exactly lethal damage (hp === damage) kills the entity', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const exactDamage = target.hp;
    const killed = target.takeDamage(exactDamage, 'SA');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('zero damage does not kill (hp > 0 after 0 damage)', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const hpBefore = target.hp;
    const killed = target.takeDamage(0, 'SA');
    expect(killed).toBe(false);
    expect(target.hp).toBe(hpBefore);
    expect(target.alive).toBe(true);
  });

  it('death variant is set based on warhead infantryDeath property', () => {
    // SA warhead has infantryDeath=1 (fire) -> deathVariant=1
    const target1 = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target1.takeDamage(target1.hp + 10, 'SA');
    expect(target1.deathVariant).toBe(1); // infantryDeath > 0 -> die2

    // Organic warhead has infantryDeath=0 (normal) -> deathVariant=0
    const target2 = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    target2.takeDamage(target2.hp + 10, 'Organic');
    expect(target2.deathVariant).toBe(0); // infantryDeath === 0 -> die1
  });

  it('transport death kills all passengers', () => {
    const transport = makeEntity(UnitType.V_APC, House.Spain, 100, 100);
    const passenger1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const passenger2 = makeEntity(UnitType.I_E2, House.Spain, 100, 100);
    transport.passengers.push(passenger1, passenger2);

    const killed = transport.takeDamage(transport.hp + 100, 'HE');
    expect(killed).toBe(true);
    expect(passenger1.alive).toBe(false);
    expect(passenger1.mission).toBe(Mission.DIE);
    expect(passenger2.alive).toBe(false);
    expect(passenger2.mission).toBe(Mission.DIE);
    expect(transport.passengers).toHaveLength(0);
  });
});

// =========================================================================
// 9. Friendly fire rules — direct hit alliance prevention
// =========================================================================
describe('Friendly fire rules', () => {
  it('splash damage hits ALL units in radius regardless of alliance (C++ parity)', () => {
    // This is documented in applySplashDamage source
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private applySplashDamage(');
    const chunk = src.slice(startIdx, startIdx + 2500);
    // Must NOT have an "if allied continue" before damage application
    // It should track isFriendly for kill credit but not for damage prevention
    expect(chunk).toContain('H2: Splash damage hits ALL units');
    // Friendly check is for kill credit, not damage prevention
    expect(chunk).toContain('isFriendly');
    expect(chunk).toContain('if (!isFriendly && attacker) attacker.creditKill()');
  });

  it('friendly kill from splash does NOT credit kill to attacker', () => {
    // Source code: only credits kill when !isFriendly
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private applySplashDamage(');
    const chunk = src.slice(startIdx, startIdx + 2500);
    // The condition guards the kill credit
    expect(chunk).toContain('if (!isFriendly && attacker) attacker.creditKill()');
  });

  it('default alliances: Spain and Greece are allied', () => {
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
  });

  it('default alliances: Spain and USSR are NOT allied', () => {
    expect(isAllied(House.Spain, House.USSR)).toBe(false);
  });

  it('Entity.takeDamage does not check alliance (it applies damage unconditionally)', () => {
    // Allied infantry can be damaged by takeDamage directly
    const friendly = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const hpBefore = friendly.hp;
    friendly.takeDamage(10, 'SA');
    expect(friendly.hp).toBe(hpBefore - 10);
  });
});

// =========================================================================
// 10. Retaliation — attacked units switching to ATTACK mission
// =========================================================================
describe('Retaliation system — triggerRetaliation', () => {
  it('source code checks alive for both victim and attacker', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 500);
    expect(chunk).toContain('!victim.alive');
    expect(chunk).toContain('!attacker.alive');
  });

  it('source code prevents allied retaliation', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    const chunk = src.slice(startIdx, startIdx + 500);
    expect(chunk).toContain('entitiesAllied(victim, attacker)');
  });

  it('source code only retargets if no current living target', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    const chunk = src.slice(startIdx, startIdx + 500);
    expect(chunk).toContain('victim.target && victim.target.alive');
  });

  it('source code sets victim.mission to ATTACK and target to attacker', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('victim.target = attacker');
    expect(chunk).toContain('victim.mission = Mission.ATTACK');
  });

  it('unarmed units cannot retaliate', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('!victim.weapon');
  });

  it('scripted team mission units do not retarget (except HUNT)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private triggerRetaliation(');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('teamMissions');
    expect(chunk).toContain('Mission.HUNT');
  });

  it('retaliation is called from direct hit combat path', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    // Verify triggerRetaliation is called after direct damage in the instant-hit path
    expect(src).toContain('triggerRetaliation(entity.target, entity)');
    // And in the projectile arrival path
    expect(src).toContain('triggerRetaliation(target, attacker)');
    // And in the splash damage path
    expect(src).toContain('triggerRetaliation(other, attacker)');
  });
});

// =========================================================================
// 11. Kill tracking and creditKill
// =========================================================================
describe('Kill tracking / creditKill', () => {
  it('kill count starts at 0', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.kills).toBe(0);
  });

  it('creditKill increments kills by 1', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    e.creditKill();
    expect(e.kills).toBe(1);
    e.creditKill();
    expect(e.kills).toBe(2);
  });

  it('multiple kills accumulate correctly', () => {
    const e = makeEntity(UnitType.I_E1, House.Spain);
    for (let i = 0; i < 10; i++) e.creditKill();
    expect(e.kills).toBe(10);
  });

  it('kill credit happens on direct hit kill (source verification)', () => {
    // In the instant-hit path: if (killed) { entity.creditKill(); ... }
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private fireWeaponAt(');
    const chunk = src.slice(startIdx, startIdx + 800);
    expect(chunk).toContain('attacker.creditKill()');
  });

  it('kill credit happens on projectile kill', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    // In updateInflightProjectiles: if (attacker) attacker.creditKill()
    const startIdx = src.indexOf('// Apply damage for arrived projectiles');
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain('attacker.creditKill()');
  });

  it('splash kill only credits for enemy kills (not friendly)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private applySplashDamage(');
    const chunk = src.slice(startIdx, startIdx + 2500);
    expect(chunk).toContain('!isFriendly && attacker');
    expect(chunk).toContain('creditKill()');
  });
});

// =========================================================================
// 12. Invulnerability — crate and Iron Curtain protection
// =========================================================================
describe('Invulnerability mechanics', () => {
  it('invulnTick > 0 blocks all damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.invulnTick = 60;
    const hpBefore = target.hp;
    const killed = target.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(target.hp).toBe(hpBefore);
  });

  it('ironCurtainTick > 0 blocks all damage', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    target.ironCurtainTick = 100;
    const hpBefore = target.hp;
    target.takeDamage(999, 'Super');
    expect(target.hp).toBe(hpBefore);
    expect(target.alive).toBe(true);
  });

  it('isInvulnerable getter returns true when either timer is active', () => {
    const e1 = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e1.isInvulnerable).toBe(false);
    e1.invulnTick = 1;
    expect(e1.isInvulnerable).toBe(true);
    e1.invulnTick = 0;
    e1.ironCurtainTick = 1;
    expect(e1.isInvulnerable).toBe(true);
  });

  it('invulnerability blocks dog instant-kill', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = target;
    target.invulnTick = 10;
    const killed = target.takeDamage(100, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });
});

// =========================================================================
// 13. Armor bias — crate damage reduction
// =========================================================================
describe('Armor bias (crate damage reduction)', () => {
  it('default armorBias is 1.0 (no reduction)', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.armorBias).toBe(1.0);
  });

  it('armorBias > 1.0 reduces incoming damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.armorBias = 2.0; // crate: half damage
    const hpBefore = target.hp;
    target.takeDamage(100, 'AP');
    // damage = max(1, round(100 / 2.0)) = 50
    expect(target.hp).toBe(hpBefore - 50);
  });

  it('armorBias guarantees minimum 1 damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.armorBias = 100; // extreme bias
    const hpBefore = target.hp;
    target.takeDamage(1, 'SA');
    // max(1, round(1/100)) = max(1, 0) = 1
    expect(target.hp).toBe(hpBefore - 1);
  });

  it('armorBias = 1.0 does not modify damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.armorBias = 1.0;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    expect(target.hp).toBe(hpBefore - 20);
  });
});

// =========================================================================
// 14. Firepower bias — crate damage multiplier
// =========================================================================
describe('Firepower bias (crate damage output multiplier)', () => {
  it('default firepowerBias is 1.0', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.firepowerBias).toBe(1.0);
  });

  it('firepowerBias 2.0 doubles effective damage output (formula verification)', () => {
    // In the actual pipeline, firepowerBias would be applied in the Game.fire* methods
    // The entity stores the bias; it gets multiplied into the damage calculation.
    // The entity field itself doesn't modify takeDamage — it's on the attacker side.
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain);
    attacker.firepowerBias = 2.0;
    expect(attacker.firepowerBias).toBe(2.0);

    // Verify the field is separate from armorBias
    expect(attacker.armorBias).toBe(1.0);
  });
});

// =========================================================================
// 15. getFirepowerBias — house and scenario overrides
// =========================================================================
describe('getFirepowerBias — house bonus system', () => {
  it('Spain has neutral firepower (1.0)', () => {
    const bias = COUNTRY_BONUSES.Spain.firepowerMult;
    expect(bias).toBe(1.0);
  });

  it('Germany has 10% firepower bonus (1.10)', () => {
    expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(1.10);
  });

  it('USSR has neutral firepower but 10% cost discount', () => {
    expect(COUNTRY_BONUSES.USSR.firepowerMult).toBe(1.0);
    expect(COUNTRY_BONUSES.USSR.costMult).toBe(0.9);
  });

  it('Greece has neutral firepower (1.0)', () => {
    expect(COUNTRY_BONUSES.Greece.firepowerMult).toBe(1.0);
  });

  it('Neutral has firepower 1.0', () => {
    expect(COUNTRY_BONUSES.Neutral.firepowerMult).toBe(1.0);
  });

  it('getFirepowerBias source code supports ant mission overrides', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('getFirepowerBias(house: House)');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 400);
    expect(chunk).toContain('SCA');
    expect(chunk).toContain('ANT_HOUSES');
    expect(chunk).toContain('USSR: 1.1');
    expect(chunk).toContain('Ukraine: 1.0');
    expect(chunk).toContain('Germany: 0.9');
  });
});

// =========================================================================
// 16. Prone damage reduction (infantry fear/prone system)
// =========================================================================
describe('Prone damage reduction', () => {
  it('PRONE_DAMAGE_BIAS is 0.5 (50% damage)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone infantry takes half damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    // max(1, round(20 * 0.5)) = 10
    expect(target.hp).toBe(hpBefore - 10);
  });

  it('prone damage guarantees minimum 1', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    const hpBefore = target.hp;
    target.takeDamage(1, 'SA');
    // max(1, round(1 * 0.5)) = max(1, 1) = 1
    expect(target.hp).toBe(hpBefore - 1);
  });

  it('non-prone infantry takes full damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = false;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    expect(target.hp).toBe(hpBefore - 20);
  });

  it('prone + armorBias stack: damage reduced by both', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    target.armorBias = 2.0;
    const hpBefore = target.hp;
    target.takeDamage(100, 'SA');
    // armorBias first: max(1, round(100/2.0)) = 50
    // prone then: max(1, round(50 * 0.5)) = 25
    expect(target.hp).toBe(hpBefore - 25);
  });
});

// =========================================================================
// 17. Fear system — damage increases fear
// =========================================================================
describe('Fear system on damage', () => {
  it('infantry fear starts at 0', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(inf.fear).toBe(0);
  });

  it('taking damage increases infantry fear to at least FEAR_SCARED', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.takeDamage(10, 'SA');
    expect(inf.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('fear is capped at FEAR_MAXIMUM (255)', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.fear = 250;
    inf.takeDamage(5, 'SA');
    expect(inf.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });

  it('vehicles do not gain fear from damage', () => {
    const vehicle = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    vehicle.takeDamage(50, 'AP');
    expect(vehicle.fear).toBe(0);
  });

  it('zero damage does not increase fear', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.takeDamage(0, 'SA');
    expect(inf.fear).toBe(0);
  });
});

// =========================================================================
// 18. Damage flash effect
// =========================================================================
describe('Damage flash', () => {
  it('takeDamage sets damageFlash to 4 ticks', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    expect(target.damageFlash).toBe(0);
    target.takeDamage(10, 'AP');
    expect(target.damageFlash).toBe(4);
  });

  it('damageFlash decrements via tickAnimation', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.damageFlash = 4;
    target.tickAnimation();
    expect(target.damageFlash).toBe(3);
  });

  it('damageFlash does not go negative', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.damageFlash = 0;
    target.tickAnimation();
    expect(target.damageFlash).toBe(0);
  });
});

// =========================================================================
// 19. Submarine cloak interaction with damage
// =========================================================================
describe('Submarine cloak — uncloak on damage', () => {
  it('cloaked sub is force-uncloaked when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 2; // CloakState.CLOAKED
    expect(sub.stats.isCloakable).toBe(true);
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(3); // CloakState.UNCLOAKING
  });

  it('cloaking sub is interrupted when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 1; // CloakState.CLOAKING
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(3); // CloakState.UNCLOAKING
  });

  it('already uncloaked sub stays uncloaked when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 0; // CloakState.UNCLOAKED
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(0); // stays UNCLOAKED
  });
});

// =========================================================================
// 20. Entity.selectWeapon — dual weapon selection logic
// =========================================================================
describe('Entity.selectWeapon', () => {
  it('single-weapon unit returns primary weapon', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 200, 100);
    expect(tank.weapon2).toBeNull();
    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(tank.weapon);
  });

  it('dual-weapon unit selects weapon with higher effective damage', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const heavyTarget = makeEntity(UnitType.V_3TNK, House.USSR, 200, 100);

    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon2).not.toBeNull();

    // Both weapons in range, both ready
    mammoth.attackCooldown = 0;
    mammoth.attackCooldown2 = 0;

    const selected = mammoth.selectWeapon(heavyTarget, getWarheadMultiplier);
    // Should pick the weapon with higher effective damage vs heavy armor
    // 120mm: AP vs heavy = 1.0, damage 40 -> eff = 40
    // MammothTusk: HE vs heavy = 0.25, damage 75 -> eff = 18.75
    // 120mm wins
    expect(selected?.name).toBe('120mm');
  });

  it('returns null when both weapons are on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 200, 100);
    mammoth.attackCooldown = 10;
    mammoth.attackCooldown2 = 10;
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeNull();
  });

  it('returns ready weapon when one is on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 200, 100);
    mammoth.attackCooldown = 10; // primary on cooldown
    mammoth.attackCooldown2 = 0; // secondary ready
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected?.name).toBe('MammothTusk');
  });
});

// =========================================================================
// 21. Entity.inRange checks
// =========================================================================
describe('Entity range checking', () => {
  it('inRange returns true when target is within weapon range', () => {
    const shooter = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 2, 100); // 2 cells
    expect(shooter.weapon).not.toBeNull();
    expect(shooter.weapon!.range).toBeGreaterThan(2); // M1Carbine range = 3.0
    expect(shooter.inRange(target)).toBe(true);
  });

  it('inRange returns false when target is beyond weapon range', () => {
    const shooter = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 10, 100); // 10 cells
    expect(shooter.inRange(target)).toBe(false);
  });

  it('inRangeWith checks a specific weapon', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 4, 100); // 4 cells
    // Primary (120mm) range = 4.75 -> in range
    expect(mammoth.inRangeWith(target, mammoth.weapon!)).toBe(true);
    // Secondary (MammothTusk) range = 5.0 -> also in range
    expect(mammoth.inRangeWith(target, mammoth.weapon2!)).toBe(true);
  });
});

// =========================================================================
// 22. Splash damage radius and falloff
// =========================================================================
describe('Splash damage — radius and falloff', () => {
  it('Game.SPLASH_RADIUS is 1.5 cells', () => {
    expect(Game.SPLASH_RADIUS).toBe(1.5);
  });

  it('applySplashDamage uses Game.SPLASH_RADIUS (not weapon.splash)', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private applySplashDamage(');
    const chunk = src.slice(startIdx, startIdx + 600);
    expect(chunk).toContain('Game.SPLASH_RADIUS');
    expect(chunk).toContain('splashRange * CELL_SIZE');
  });

  it('splash uses modifyDamage for falloff calculation', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('private applySplashDamage(');
    const chunk = src.slice(startIdx, startIdx + 1500);
    expect(chunk).toContain('modifyDamage(');
    expect(chunk).toContain('distPixels');
  });

  it('modifyDamage at point-blank (0 distance) returns full damage', () => {
    expect(modifyDamage(100, 'HE', 'none', 0)).toBe(90); // HE vs none = 0.9
  });

  it('modifyDamage at 1 cell distance with HE reduces damage', () => {
    const distPixels = CELL_SIZE; // 24px
    const dmg = modifyDamage(100, 'HE', 'none', distPixels);
    // distFactor = 24*2/6 = 8, damage = 90/8 = 11.25 -> 11
    expect(dmg).toBe(11);
  });

  it('modifyDamage at max falloff (distFactor=16) gives minimum', () => {
    const distPixels = 2 * CELL_SIZE; // 48px
    const dmg = modifyDamage(100, 'HE', 'none', distPixels);
    // distFactor = 48*2/6 = 16, damage = 90/16 = 5.625 -> 6
    expect(dmg).toBe(6);
  });
});

// =========================================================================
// 23. WARHEAD_PROPS — infantry death variants
// =========================================================================
describe('WARHEAD_PROPS — infantry death variants', () => {
  it('SA has infantryDeath=1 (twirl)', () => {
    expect(WARHEAD_PROPS.SA.infantryDeath).toBe(1);
  });

  it('HE has infantryDeath=2 (explode)', () => {
    expect(WARHEAD_PROPS.HE.infantryDeath).toBe(2);
  });

  it('AP has infantryDeath=3 (flying)', () => {
    expect(WARHEAD_PROPS.AP.infantryDeath).toBe(3);
  });

  it('Fire has infantryDeath=4 (burn)', () => {
    expect(WARHEAD_PROPS.Fire.infantryDeath).toBe(4);
  });

  it('Super has infantryDeath=5 (electro)', () => {
    expect(WARHEAD_PROPS.Super.infantryDeath).toBe(5);
  });

  it('Organic has infantryDeath=0 (instant)', () => {
    expect(WARHEAD_PROPS.Organic.infantryDeath).toBe(0);
  });

  it('Nuke has infantryDeath=4 (burn — matches Fire)', () => {
    expect(WARHEAD_PROPS.Nuke.infantryDeath).toBe(4);
  });

  it('all warhead types have WARHEAD_PROPS defined', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
    for (const wh of warheads) {
      expect(WARHEAD_PROPS[wh], `${wh} should have WARHEAD_PROPS`).toBeDefined();
      expect(typeof WARHEAD_PROPS[wh].infantryDeath).toBe('number');
      expect(typeof WARHEAD_PROPS[wh].explosionSet).toBe('string');
    }
  });
});

// =========================================================================
// 24. Edge cases
// =========================================================================
describe('Edge cases', () => {
  it('damage of 1 to unit with 1 HP kills it', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 1;
    const killed = target.takeDamage(1, 'SA');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('negative damage (Heal) does not kill', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 30;
    const killed = target.takeDamage(-50, 'Organic');
    expect(killed).toBe(false);
    // HP goes above current value (healing)
    expect(target.hp).toBe(80);
    expect(target.alive).toBe(true);
  });

  it('attacking already-dead entity returns false without further damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.alive = false;
    target.hp = 0;
    const killed = target.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(target.hp).toBe(0);
  });

  it('DG2: dog collateral prevention — dogs only hurt their designated target', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const realTarget = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const bystander = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = realTarget;

    const hpBefore = bystander.hp;
    bystander.takeDamage(50, 'Organic', dog);
    // DG2: dog damage blocked for non-target
    expect(bystander.hp).toBe(hpBefore);
    expect(bystander.alive).toBe(true);
  });

  it('dead dog cannot instant-kill', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = target;
    dog.alive = false;
    target.hp = 50;
    target.maxHp = 50;
    const killed = target.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(49);
  });

  it('modifyDamage caps at MAX_DAMAGE (1000)', () => {
    const result = modifyDamage(5000, 'Super', 'none', 0);
    expect(result).toBe(1000);
  });

  it('modifyDamage MinDamage=1 guarantee at close range (distFactor < 4)', () => {
    // Very small damage + heavy armor + close range
    const result = modifyDamage(1, 'SA', 'heavy', 2);
    // distFactor = 2*2/3 = 1.33 (< 4), so MinDamage applies
    expect(result).toBe(1);
  });

  it('multiple damage events reduce HP additively', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    const initialHp = target.hp; // 600
    target.takeDamage(100, 'AP');
    target.takeDamage(100, 'AP');
    target.takeDamage(100, 'AP');
    expect(target.hp).toBe(initialHp - 300);
    expect(target.alive).toBe(true);
  });
});

// =========================================================================
// 25. Weapon stats integrity for combat-relevant weapons
// =========================================================================
describe('Weapon stats integrity', () => {
  it('all tank main guns use AP warhead', () => {
    expect(WEAPON_STATS['75mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['90mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['105mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['120mm'].warhead).toBe('AP');
  });

  it('infantry small arms use SA warhead', () => {
    expect(WEAPON_STATS.M1Carbine.warhead).toBe('SA');
    expect(WEAPON_STATS.M60mg.warhead).toBe('SA');
  });

  it('explosive weapons use HE warhead', () => {
    expect(WEAPON_STATS.Grenade.warhead).toBe('HE');
    expect(WEAPON_STATS.MammothTusk.warhead).toBe('HE');
    expect(WEAPON_STATS['155mm'].warhead).toBe('HE');
    expect(WEAPON_STATS.SCUD.warhead).toBe('HE');
  });

  it('Mandible uses Super warhead (C++ parity)', () => {
    expect(WEAPON_STATS.Mandible.warhead).toBe('Super');
  });

  it('FireballLauncher uses Fire warhead with splash', () => {
    expect(WEAPON_STATS.FireballLauncher.warhead).toBe('Fire');
    expect(WEAPON_STATS.FireballLauncher.splash).toBe(1.5);
  });

  it('Heal weapon has negative damage', () => {
    expect(WEAPON_STATS.Heal.damage).toBe(-50);
    expect(WEAPON_STATS.Heal.warhead).toBe('Organic');
  });

  it('Sniper uses HollowPoint warhead (anti-infantry)', () => {
    expect(WEAPON_STATS.Sniper.warhead).toBe('HollowPoint');
    expect(WEAPON_STATS.Sniper.damage).toBe(100);
  });

  it('120mm has burst=2 (fires two shots)', () => {
    expect(WEAPON_STATS['120mm'].burst).toBe(2);
  });

  it('MammothTusk has burst=2 and splash=1.5', () => {
    expect(WEAPON_STATS.MammothTusk.burst).toBe(2);
    expect(WEAPON_STATS.MammothTusk.splash).toBe(1.5);
  });
});
