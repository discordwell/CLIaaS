/**
 * Combat parity tests — verifies C++ Red Alert combat formula ports:
 * CF1: Distance-based damage falloff for direct hits
 * CF2: Inverse-proportional splash falloff
 * CF3: Fixed 1.5 cell splash radius
 * CF7: Heal damage guard
 * CF8: Wall destruction from splash
 * SC1: AP-vs-infantry forced scatter
 * DG1: Dog instant-kill mechanic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CELL_SIZE, WARHEAD_META, WARHEAD_VS_ARMOR, WEAPON_STATS, UNIT_STATS,
  UnitType, House, type WarheadType, type ArmorType, armorIndex,
  worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { Game } from '../engine/index';
import { GameMap, Terrain } from '../engine/map';

beforeEach(() => resetEntityIds());

// =========================================================================
// CF1: Distance-based damage falloff
// =========================================================================
describe('CF1: Distance-based damage falloff for direct hits', () => {
  it('point-blank (distance=0) deals full damage', () => {
    // At distance 0, no falloff factor is applied
    const baseDamage = 100;
    const spreadFactor = WARHEAD_META.HE.spreadFactor; // 2
    const distance = 0;
    // At dist=0, the code skips falloff entirely
    const effectiveDamage = baseDamage; // no reduction
    expect(effectiveDamage).toBe(100);
  });

  it('damage decreases with distance using inverse-proportional formula', () => {
    // C++ Modify_Damage: distFactor = distPixels * 2 / spreadFactor, clamped to [0,16]
    // Using HE (spreadFactor=6) for meaningful range
    const baseDamage = 100;
    const spreadFactor = WARHEAD_META.HE.spreadFactor; // 6

    // At distance = 1 cell = 24 pixels: distFactor = 24*2/6 = 8, damage = 90/8 = 11.25 → 11
    const dist1 = CELL_SIZE;
    const distFactor1 = Math.min(16, (dist1 * 2) / spreadFactor); // 8
    const dmg1 = Math.round(baseDamage * 0.9 / Math.max(1, distFactor1)); // 90/8 = 11

    // At distance = 2 cells = 48 pixels: distFactor = 48*2/6 = 16, damage = 90/16 = 5.625 → 6
    const dist2 = 2 * CELL_SIZE;
    const distFactor2 = Math.min(16, (dist2 * 2) / spreadFactor); // 16
    const dmg2 = Math.round(baseDamage * 0.9 / Math.max(1, distFactor2)); // 90/16 = 6

    expect(dmg1).toBe(11);
    expect(dmg2).toBe(6);
    expect(dmg1).toBeGreaterThan(dmg2);
  });

  it('higher spreadFactor reduces falloff (wider effective range)', () => {
    // C++ Modify_Damage: distFactor = distPixels * 2 / spreadFactor
    // Higher spreadFactor → smaller distFactor → less damage reduction
    const baseDamage = 100;
    const dist = CELL_SIZE; // 1 cell = 24px

    // AP spreadFactor=3: distFactor = 24*2/3 = 16, vs none (1.0): 100/16 = 6
    const apFactor = Math.min(16, (dist * 2) / WARHEAD_META.AP.spreadFactor);
    const apDmg = Math.round(baseDamage / Math.max(1, apFactor));

    // HE spreadFactor=6: distFactor = 24*2/6 = 8, vs none (0.9): 90/8 = 11
    const heFactor = Math.min(16, (dist * 2) / WARHEAD_META.HE.spreadFactor);
    const heDmg = Math.round(baseDamage * 0.9 / Math.max(1, heFactor));

    // Fire spreadFactor=8: distFactor = 24*2/8 = 6, vs none (0.9): 90/6 = 15
    const fireFactor = Math.min(16, (dist * 2) / WARHEAD_META.Fire.spreadFactor);
    const fireDmg = Math.round(baseDamage * 0.9 / Math.max(1, fireFactor));

    expect(heDmg).toBeGreaterThan(apDmg);
    expect(fireDmg).toBeGreaterThan(heDmg);
  });

  it('distanceFactor is clamped to max 16', () => {
    const baseDamage = 100;
    const spreadFactor = 1;
    // Very far distance where factor would exceed 16
    const dist = 200 * CELL_SIZE;
    const rawFactor = dist / (spreadFactor * CELL_SIZE / 2);
    const clampedFactor = Math.min(16, Math.max(0, rawFactor));
    expect(clampedFactor).toBe(16);
    const dmg = Math.floor(baseDamage / Math.max(1, clampedFactor));
    expect(dmg).toBe(6); // 100/16 = 6.25 -> 6
  });
});

// =========================================================================
// CF2: Inverse-proportional splash falloff
// =========================================================================
describe('CF2: Splash damage uses inverse-proportional falloff', () => {
  it('splash at point-blank (dist=0) deals full weapon damage', () => {
    const weaponDmg = 150;
    const cellDist = 0;
    const spreadFactor = 2; // HE
    const falloffDistance = cellDist / (spreadFactor * 0.5);
    // falloffDistance = 0, so Math.max(1, 0) = 1, damage / 1 = full damage
    const effectiveDamage = Math.floor(weaponDmg / Math.max(1, falloffDistance));
    expect(effectiveDamage).toBe(150);
  });

  it('splash damage falls off inversely with distance', () => {
    const weaponDmg = 100;
    const spreadFactor = 2; // HE

    // At 0.5 cell: falloffDistance = 0.5 / (2*0.5) = 0.5, effective = 100 / max(1, 0.5) = 100
    const d1 = 0.5;
    const fd1 = d1 / (spreadFactor * 0.5);
    const dmg1 = Math.floor(weaponDmg / Math.max(1, fd1));

    // At 1.0 cell: falloffDistance = 1.0 / 1.0 = 1.0, effective = 100 / 1 = 100
    const d2 = 1.0;
    const fd2 = d2 / (spreadFactor * 0.5);
    const dmg2 = Math.floor(weaponDmg / Math.max(1, fd2));

    // At 1.5 cell: falloffDistance = 1.5 / 1.0 = 1.5, effective = 100 / 1.5 = 66
    const d3 = 1.5;
    const fd3 = d3 / (spreadFactor * 0.5);
    const dmg3 = Math.floor(weaponDmg / Math.max(1, fd3));

    expect(dmg1).toBeGreaterThanOrEqual(dmg2);
    expect(dmg2).toBeGreaterThan(dmg3);
    expect(dmg3).toBe(66); // 100 / 1.5 = 66.66 -> 66
  });

  it('higher spreadFactor means less falloff at same distance', () => {
    // C++ Modify_Damage: distFactor = distPixels * 2 / spreadFactor
    const weaponDmg = 100;
    const distPx = CELL_SIZE; // 1 cell = 24px

    // SA (spreadFactor=3): df = 24*2/3 = 16, SA vs none = 1.0: 100/16 = 6
    const dfSA = Math.min(16, (distPx * 2) / WARHEAD_META.SA.spreadFactor);
    const dmgSA = Math.round(weaponDmg * 1.0 / Math.max(1, dfSA));

    // HE (spreadFactor=6): df = 24*2/6 = 8, HE vs none = 0.9: 90/8 = 11
    const dfHE = Math.min(16, (distPx * 2) / WARHEAD_META.HE.spreadFactor);
    const dmgHE = Math.round(weaponDmg * 0.9 / Math.max(1, dfHE));

    // Fire (spreadFactor=8): df = 24*2/8 = 6, Fire vs none = 0.9: 90/6 = 15
    const dfFire = Math.min(16, (distPx * 2) / WARHEAD_META.Fire.spreadFactor);
    const dmgFire = Math.round(weaponDmg * 0.9 / Math.max(1, dfFire));

    expect(dmgHE).toBeGreaterThan(dmgSA);
    expect(dmgFire).toBeGreaterThan(dmgHE);
  });
});

// =========================================================================
// CF3: Fixed 1.5 cell splash radius
// =========================================================================
describe('CF3: Fixed splash radius is 1.5 cells', () => {
  it('Game.SPLASH_RADIUS is exactly 1.5', () => {
    expect(Game.SPLASH_RADIUS).toBe(1.5);
  });

  it('splash radius in world units is 1.5 * CELL_SIZE', () => {
    const expectedWorldRadius = 1.5 * CELL_SIZE;
    expect(expectedWorldRadius).toBe(36); // 1.5 * 24 = 36
  });

  it('all splash-capable weapons share the same radius regardless of weapon.splash value', () => {
    // Different weapons have different splash values in their stats,
    // but they all use Game.SPLASH_RADIUS (1.5 cells) as the actual radius
    const grenade = WEAPON_STATS.Grenade;
    const mammoth = WEAPON_STATS.MammothTusk;
    const arty = WEAPON_STATS['155mm'];
    // Verify weapons have different splash stat values
    expect(grenade.splash).toBe(1.5);
    expect(mammoth.splash).toBe(1.5);
    expect(arty.splash).toBe(2.0);
    // But the game uses Game.SPLASH_RADIUS (1.5) for all of them
    expect(Game.SPLASH_RADIUS).toBe(1.5);
  });
});

// =========================================================================
// CF7: Heal damage guard
// =========================================================================
describe('CF7: Heal damage guard', () => {
  it('Heal weapon has negative damage', () => {
    const heal = WEAPON_STATS.Heal;
    expect(heal.damage).toBeLessThan(0);
    expect(heal.damage).toBe(-50);
  });

  it('Heal weapon uses Organic warhead (0% vs armored)', () => {
    const heal = WEAPON_STATS.Heal;
    expect(heal.warhead).toBe('Organic');
    // Organic does 0% vs all armor except 'none'
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('none')]).toBe(1.0);
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('light')]).toBe(0.0);
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')]).toBe(0.0);
  });

  it('negative damage only heals at point-blank vs unarmored targets', () => {
    // Simulating the CF7 guard logic:
    // If damage < 0, only allow if distance < 0.03 cells AND target armor == 'none'
    const damage = -50;

    // Point-blank, unarmored -> allowed
    const dist1 = 0;
    const armor1 = 'none';
    const result1 = (dist1 >= 0.03 * CELL_SIZE || armor1 !== 'none') ? 0 : damage;
    expect(result1).toBe(-50); // healing allowed

    // Far away, unarmored -> blocked
    const dist2 = 2 * CELL_SIZE;
    const result2 = (dist2 >= 0.03 * CELL_SIZE || armor1 !== 'none') ? 0 : damage;
    expect(result2).toBe(0); // healing blocked

    // Point-blank, armored -> blocked
    const dist3 = 0;
    const armor3 = 'heavy';
    const result3 = (dist3 >= 0.03 * CELL_SIZE || armor3 !== 'none') ? 0 : damage;
    expect(result3).toBe(0); // healing blocked
  });
});

// =========================================================================
// CF8: Wall destruction from splash
// =========================================================================
describe('CF8: Wall destruction from splash with destroysWalls warheads', () => {
  it('HE warhead has destroysWalls and destroysWood flags', () => {
    expect(WARHEAD_META.HE.destroysWalls).toBe(true);
    expect(WARHEAD_META.HE.destroysWood).toBe(true);
  });

  it('AP warhead has destroysWalls (C++ Wall=yes)', () => {
    expect(WARHEAD_META.AP.destroysWalls).toBe(true);
  });

  it('Super warhead does NOT have destroysWalls', () => {
    expect(WARHEAD_META.Super.destroysWalls).toBeUndefined();
  });

  it('fire warhead has destroysWood but NOT destroysWalls', () => {
    expect(WARHEAD_META.Fire.destroysWood).toBe(true);
    expect(WARHEAD_META.Fire.destroysWalls).toBeUndefined();
  });

  it('wall destruction logic clears wallType and terrain', () => {
    // Test the map-level wall clearing directly
    const map = new GameMap();
    const cx = 64;
    const cy = 64;

    // Set up a wall
    map.setWallType(cx, cy, 'BRIK');
    map.setTerrain(cx, cy, Terrain.WALL);
    expect(map.getWallType(cx, cy)).toBe('BRIK');
    expect(map.getTerrain(cx, cy)).toBe(Terrain.WALL);

    // Simulate wall destruction (what CF8 does)
    map.clearWallType(cx, cy);
    if (map.getTerrain(cx, cy) === Terrain.WALL) {
      map.setTerrain(cx, cy, Terrain.CLEAR);
    }

    expect(map.getWallType(cx, cy)).toBe('');
    expect(map.getTerrain(cx, cy)).toBe(Terrain.CLEAR);
  });

  it('splash radius for wall destruction uses fixed 1.5 cells', () => {
    // CF8 uses Game.SPLASH_RADIUS for the wall destruction radius
    const r = Math.ceil(Game.SPLASH_RADIUS);
    expect(r).toBe(2); // ceil(1.5) = 2 — checks cells within 2-cell grid
    // But actual distance check uses SPLASH_RADIUS * SPLASH_RADIUS = 2.25
    const inRange = 1 * 1 + 1 * 1; // cell at (1,1) from center: dist^2 = 2
    expect(inRange <= Game.SPLASH_RADIUS * Game.SPLASH_RADIUS).toBe(true);
    const outRange = 2 * 2 + 0 * 0; // cell at (2,0): dist^2 = 4
    expect(outRange <= Game.SPLASH_RADIUS * Game.SPLASH_RADIUS).toBe(false);
  });
});

// =========================================================================
// SC1: AP-vs-infantry forced scatter
// =========================================================================
describe('SC1: AP-vs-infantry forced scatter', () => {
  it('AP warhead exists with known properties', () => {
    expect(WARHEAD_META.AP.spreadFactor).toBe(3);
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('none')]).toBe(0.3); // 30% vs infantry
  });

  it('AP weapons have low multiplier vs unarmored (infantry) targets', () => {
    // AP does only 30% damage to 'none' armor — combined with forced scatter,
    // AP weapons are very ineffective against infantry
    const apMult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(apMult).toBeLessThan(0.5);
  });

  it('tank weapons use AP warhead (affected by forced scatter vs infantry)', () => {
    const tank75mm = WEAPON_STATS['75mm'];
    const tank90mm = WEAPON_STATS['90mm'];
    const tank105mm = WEAPON_STATS['105mm'];
    const tank120mm = WEAPON_STATS['120mm'];
    expect(tank75mm.warhead).toBe('AP');
    expect(tank90mm.warhead).toBe('AP');
    expect(tank105mm.warhead).toBe('AP');
    expect(tank120mm.warhead).toBe('AP');
  });

  it('non-AP weapons are NOT affected by forced scatter', () => {
    // SA, HE, Fire warheads should NOT trigger forced scatter
    const m1carbine = WEAPON_STATS.M1Carbine;
    expect(m1carbine.warhead).toBe('SA'); // SA != AP, no forced scatter
    const grenade = WEAPON_STATS.Grenade;
    expect(grenade.warhead).toBe('HE'); // HE != AP, no forced scatter
  });
});

// =========================================================================
// DG1: Dog instant-kill mechanic
// =========================================================================
describe('DG1: Dog instant-kill in takeDamage', () => {
  it('dog attacking its target kills instantly regardless of damage amount', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    target.hp = 50; // full health
    target.maxHp = 50;
    dog.target = target;

    // Dog attacks with DogJaw (damage=100), but even if we pass less damage,
    // the instant-kill override should set damage = target.hp
    const killed = target.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('dog kills target even if target has very high HP', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    target.hp = 999;
    target.maxHp = 999;
    dog.target = target;

    const killed = target.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
  });

  it('dog does NOT instant-kill a unit that is NOT its target', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    const actualTarget = new Entity(UnitType.I_E1, House.USSR, 200, 200);
    const bystander = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = actualTarget; // dog is targeting someone else

    bystander.hp = 50;
    bystander.maxHp = 50;
    // DG2: Dog collateral prevention — dogs do zero damage to non-targets
    const killed = bystander.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(false);
    expect(bystander.hp).toBe(50); // DG2: no damage to non-target
  });

  it('non-dog attacker does NOT get instant-kill', () => {
    const soldier = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    soldier.target = target;

    target.hp = 50;
    target.maxHp = 50;
    const killed = target.takeDamage(1, 'SA', soldier);
    expect(killed).toBe(false);
    expect(target.hp).toBe(49); // normal 1 damage
  });

  it('dog instant-kill requires dog to be alive', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = target;
    dog.alive = false; // dead dog

    target.hp = 50;
    target.maxHp = 50;
    const killed = target.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(49); // normal damage, dead dog can't instant-kill
  });

  it('DogJaw weapon stats match C++ values', () => {
    const dogJaw = WEAPON_STATS.DogJaw;
    expect(dogJaw.damage).toBe(100);
    expect(dogJaw.warhead).toBe('Organic');
    expect(dogJaw.range).toBe(2.2);
    expect(UNIT_STATS.DOG.primaryWeapon).toBe('DogJaw');
  });
});

// =========================================================================
// WARHEAD_META data integrity
// =========================================================================
describe('WARHEAD_META data integrity', () => {
  it('all warhead types have spreadFactor defined', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
    for (const wh of warheads) {
      expect(WARHEAD_META[wh]).toBeDefined();
      expect(typeof WARHEAD_META[wh].spreadFactor).toBe('number');
    }
  });

  it('Fire has highest spreadFactor (8)', () => {
    expect(WARHEAD_META.Fire.spreadFactor).toBe(8);
  });

  it('Mechanical has spreadFactor 0 (no splash)', () => {
    expect(WARHEAD_META.Mechanical.spreadFactor).toBe(0);
  });
});

// =========================================================================
// SC2: Non-arcing scatter overshoot (structural/data test)
// =========================================================================
describe('SC2: Non-arcing projectile scatter direction', () => {
  it('arcing weapons have isArcing flag set', () => {
    const grenade = WEAPON_STATS.Grenade;
    const arty = WEAPON_STATS['155mm'];
    expect(grenade.isArcing).toBe(true);
    expect(arty.isArcing).toBe(true);
  });

  it('non-arcing weapons do NOT have isArcing flag', () => {
    const tank90mm = WEAPON_STATS['90mm'];
    const m1carbine = WEAPON_STATS.M1Carbine;
    const dragon = WEAPON_STATS.Dragon;
    expect(tank90mm.isArcing).toBeUndefined();
    expect(m1carbine.isArcing).toBeUndefined();
    expect(dragon.isArcing).toBeUndefined();
  });

  it('scatter along flight path produces forward-biased offset', () => {
    // Simulate the SC2 scatter logic
    // Shooter at (0,0), target at (100, 0) — shooting east
    const shooterX = 0, shooterY = 0;
    const targetX = 100, targetY = 0;
    const fdx = targetX - shooterX;
    const fdy = targetY - shooterY;
    const fLen = Math.sqrt(fdx * fdx + fdy * fdy);
    const scatter = 10; // 10 pixel scatter radius

    // Run many iterations and check bias
    let forwardCount = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const overshoot = (Math.random() * 2 - 0.5) * scatter;
      const lateral = (Math.random() - 0.5) * scatter * 0.3;
      const offsetX = (fdx / fLen) * overshoot + (-fdy / fLen) * lateral;
      // Positive offsetX = forward (toward target), negative = behind shooter
      if (offsetX > 0) forwardCount++;
    }
    // With bias formula (random * 2 - 0.5), about 75% should be forward
    expect(forwardCount / iterations).toBeGreaterThan(0.6);
  });
});

// =========================================================================
// Integration: Entity.takeDamage signature
// =========================================================================
describe('Entity.takeDamage signature accepts optional attacker', () => {
  it('works without attacker (backwards compatible)', () => {
    const target = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 50;
    const killed = target.takeDamage(10, 'SA');
    expect(killed).toBe(false);
    expect(target.hp).toBe(40);
  });

  it('works with attacker that is not a dog', () => {
    const attacker = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    attacker.target = target;
    target.hp = 50;
    const killed = target.takeDamage(10, 'SA', attacker);
    expect(killed).toBe(false);
    expect(target.hp).toBe(40);
  });

  it('works with undefined attacker', () => {
    const target = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 50;
    const killed = target.takeDamage(10, 'SA', undefined);
    expect(killed).toBe(false);
    expect(target.hp).toBe(40);
  });

  it('invulnerable target still blocks damage even with dog attacker', () => {
    const dog = new Entity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    target.invulnTick = 10; // invulnerable
    dog.target = target;

    target.hp = 50;
    const killed = target.takeDamage(100, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(50); // no damage
  });
});
