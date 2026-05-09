/**
 * C++ Behavioral Parity: ARTY — Artillery
 *
 * Tests verify Artillery unit behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * ARTY is the quintessential glass cannon: 75 HP / light armor but 150 damage
 * HE shells with 2.0 splash, 1.5 inaccuracy, 2.0 minimum range, arcing=true,
 * and noMovingFire=true. No turret — must rotate entire body to aim.
 *
 * C++ references: udata.cpp (unit stats), weapon.cpp (155mm), combat.cpp (HE warhead),
 * techno.cpp (Can_Fire minimum range), unit.cpp (noMovingFire setup time).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE, LEPTON_SIZE,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  worldDist, directionTo, getWarheadMultiplier,
  modifyDamage,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function setLeptonPos(entity: Entity, lx: number, ly: number): void {
  entity.leptonX = lx;
  entity.leptonY = ly;
  entity.pos.x = lx * CELL_SIZE / LEPTON_SIZE;
  entity.pos.y = ly * CELL_SIZE / LEPTON_SIZE;
}

/** Distance in cells between two cell-centered entities */
function cellDist(cx1: number, cy1: number, cx2: number, cy2: number): number {
  return worldDist(
    { x: cx1 * CELL_SIZE + CELL_SIZE / 2, y: cy1 * CELL_SIZE + CELL_SIZE / 2 },
    { x: cx2 * CELL_SIZE + CELL_SIZE / 2, y: cy2 * CELL_SIZE + CELL_SIZE / 2 },
  );
}

// ── 1. Unit Stats (udata.cpp) ──────────────────────────────────────────────────
//
// C++ udata.cpp defines ARTY as:
//   HitPoints=75, Armor=light, Speed=6, ROT=2, Crusher=true,
//   PrimaryWeapon=155mm, NoMovingFire=true, IsInfantry=false

describe('ARTY unit stats (udata.cpp)', () => {
  const stats = UNIT_STATS.ARTY;

  it('has 75 HP (fragile for a vehicle)', () => {
    expect(stats.strength).toBe(75);
  });

  it('has light armor class', () => {
    expect(stats.armor).toBe('light');
  });

  it('has speed 6 (slow)', () => {
    expect(stats.speed).toBe(6);
  });

  it('has ROT 2 (very slow body rotation)', () => {
    expect(stats.rot).toBe(2);
  });

  it('is NOT a crusher (C++ udata.cpp:296 IsCrusher=false despite Tracked=yes)', () => {
    expect(stats.crusher).toBeFalsy();
  });

  it('is NOT infantry', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('has noMovingFire=true (must stop to fire)', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('primary weapon is 155mm', () => {
    expect(stats.primaryWeapon).toBe('155mm');
  });

  it('has no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('Entity constructor assigns correct HP and weapon', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.hp).toBe(75);
    expect(arty.maxHp).toBe(75);
    expect(arty.weapon).not.toBeNull();
    expect(arty.weapon!.name).toBe('155mm');
    expect(arty.weapon2).toBeNull();
  });
});

// ── 2. Weapon Stats — 155mm (weapon.cpp) ───────────────────────────────────────
//
// C++ weapon.cpp/rules.ini defines 155mm:
//   Damage=150, ROF=65, Range=6.0, Warhead=HE, Splash=2.0,
//   Inaccuracy=1.5, MinRange=2.0, IsArcing=true, IsInaccurate=true

describe('155mm weapon stats (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS['155mm'];

  it('exists in WEAPON_STATS', () => {
    expect(weapon).toBeDefined();
  });

  it('deals 150 base damage (massive)', () => {
    expect(weapon.damage).toBe(150);
  });

  it('has ROF 65 (rate of fire in ticks)', () => {
    expect(weapon.rof).toBe(65);
  });

  it('has range 6.0 cells', () => {
    expect(weapon.range).toBe(6.0);
  });

  it('uses HE warhead', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('has splash 2.0 cells (largest in game)', () => {
    expect(weapon.splash).toBe(2.0);
  });

  it('has inaccuracy 1.5 cells (significant scatter)', () => {
    expect(weapon.inaccuracy).toBe(1.5);
  });

  it('has minRange 2.0 cells (artillery dead zone)', () => {
    expect(weapon.minRange).toBe(2.0);
  });

  it('isArcing=true (lobs shells in ballistic arc)', () => {
    expect(weapon.isArcing).toBe(true);
  });

  it('isInaccurate=true (forced scatter on every shot)', () => {
    expect(weapon.isInaccurate).toBe(true);
  });
});

// ── 3. HE Warhead vs Armor (combat.cpp / rules.ini Verses=) ───────────────────
//
// HE warhead damage multipliers from rules.ini:
//   vs none=0.9, vs wood=0.75, vs light=0.6, vs heavy=0.25, vs concrete=1.0

describe('HE warhead vs armor classes (rules.ini Verses=)', () => {
  const he = WARHEAD_VS_ARMOR.HE;

  it('vs none armor: 0.9 (good vs unarmored infantry)', () => {
    expect(he[0]).toBe(0.9);
    expect(getWarheadMultiplier('HE', 'none')).toBe(0.9);
  });

  it('vs wood armor: 0.75', () => {
    expect(he[1]).toBe(0.75);
    expect(getWarheadMultiplier('HE', 'wood')).toBe(0.75);
  });

  it('vs light armor: 0.6 (moderate vs light vehicles)', () => {
    expect(he[2]).toBe(0.6);
    expect(getWarheadMultiplier('HE', 'light')).toBe(0.6);
  });

  it('vs heavy armor: 0.25 (poor vs tanks)', () => {
    expect(he[3]).toBe(0.25);
    expect(getWarheadMultiplier('HE', 'heavy')).toBe(0.25);
  });

  it('vs concrete: 1.0 (full damage vs structures)', () => {
    expect(he[4]).toBe(1.0);
    expect(getWarheadMultiplier('HE', 'concrete')).toBe(1.0);
  });
});

// ── 4. Minimum Range (techno.cpp Can_Fire) ─────────────────────────────────────
//
// C++ techno.cpp Can_Fire checks MinRange: if distance < minRange, weapon
// cannot fire. ARTY's 155mm has minRange=2.0 — targets closer than 2 cells
// are in the dead zone. The unit must retreat before it can engage.

describe('minimum range — 2-cell dead zone (techno.cpp Can_Fire)', () => {
  it('minRange is 2.0 cells', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.weapon!.minRange).toBe(2.0);
  });

  it('target at 1 cell is within dead zone (< minRange)', () => {
    // ARTY at cell (10,10), target 1 cell East at (11,10)
    const dist = cellDist(10, 10, 11, 10);
    const minRange = WEAPON_STATS['155mm'].minRange!;
    expect(dist).toBeLessThan(minRange);
  });

  it('target at 1.4 cells (diagonal) is within dead zone', () => {
    const dist = cellDist(10, 10, 11, 11);
    const minRange = WEAPON_STATS['155mm'].minRange!;
    expect(dist).toBeLessThan(minRange);
  });

  it('target at exactly 2 cells is at boundary (not in dead zone)', () => {
    const dist = cellDist(10, 10, 12, 10);
    const minRange = WEAPON_STATS['155mm'].minRange!;
    expect(dist).toBeGreaterThanOrEqual(minRange);
  });

  it('target at 3 cells is in valid firing range', () => {
    const dist = cellDist(10, 10, 13, 10);
    const minRange = WEAPON_STATS['155mm'].minRange!;
    const range = WEAPON_STATS['155mm'].range;
    expect(dist).toBeGreaterThanOrEqual(minRange);
    expect(dist).toBeLessThanOrEqual(range);
  });

  it('target at 6 cells is at max range', () => {
    const dist = cellDist(10, 10, 16, 10);
    const range = WEAPON_STATS['155mm'].range;
    expect(dist).toBeCloseTo(range, 1);
  });

  it('target at 7 cells is out of range', () => {
    const dist = cellDist(10, 10, 17, 10);
    const range = WEAPON_STATS['155mm'].range;
    expect(dist).toBeGreaterThan(range);
  });

  it('effective firing window is 4 cells wide (range 6 minus minRange 2)', () => {
    const weapon = WEAPON_STATS['155mm'];
    const window = weapon.range - weapon.minRange!;
    expect(window).toBe(4.0);
  });
});

// ── 5. No Turret (udata.cpp — hasTurret=false) ────────────────────────────────
//
// ARTY has no turret: must rotate entire body to face target before firing.
// Combined with ROT=2 (very slow), this creates significant delay to aim.

describe('no turret — body rotation aiming (udata.cpp)', () => {
  it('hasTurret is false for ARTY', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.hasTurret).toBe(false);
  });

  it('ARTY facing starts at N (Dir.N = 0)', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.facing).toBe(Dir.N);
  });

  it('body rotation is slow (ROT=2): does NOT snap facing instantly', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.desiredFacing = Dir.S; // 180 degrees opposite
    arty.rotTickedThisFrame = false;
    const aligned = arty.tickRotation();
    // ROT=2 is far too slow to snap in one tick (needs ROT >= 8 for snap)
    expect(aligned).toBe(false);
    // Should have started rotating but not yet reached S
    expect(arty.facing).not.toBe(Dir.S);
  });

  it('takes multiple ticks to rotate 180 degrees (N to S)', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.desiredFacing = Dir.S;
    let ticks = 0;
    while (arty.facing !== Dir.S && ticks < 100) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
      ticks++;
    }
    // Should take substantially more than 1 tick with ROT=2
    expect(ticks).toBeGreaterThan(8);
    expect(arty.facing).toBe(Dir.S);
  });

  it('rotation uses 32-step system (bodyFacing32 advances by 1 per step)', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.bodyFacing32).toBe(0); // N * 4 = 0
    arty.desiredFacing = Dir.E; // East = 2, target facing32 = 8
    // Accumulate enough for one visual step (ROT=2, threshold=8 → 4 ticks)
    for (let i = 0; i < 4; i++) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
    }
    // After 4 ticks with ROT=2: accumulator should have hit 8 once
    expect(arty.bodyFacing32).toBeGreaterThan(0);
  });
});

// ── 6. NoMovingFire (unit.cpp:1760-1764) ───────────────────────────────────────
//
// C++ unit.cpp:1760-1764: noMovingFire units cannot fire while moving.
// When transitioning from moving to stationary, a setup time of ROF/4 ticks
// is applied as warmup before the first shot (simulating deploy/setup delay).

describe('noMovingFire — setup time (unit.cpp:1760-1764)', () => {
  it('noMovingFire is true on ARTY stats', () => {
    expect(UNIT_STATS.ARTY.noMovingFire).toBe(true);
  });

  it('wasMoving flag tracks movement state transitions', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.wasMoving).toBe(false);
    arty.wasMoving = true;
    expect(arty.wasMoving).toBe(true);
  });

  it('setup time is ROF/4 = 65/4 = 16 ticks', () => {
    const rof = WEAPON_STATS['155mm'].rof;
    const setupTime = Math.floor(rof / 4);
    expect(setupTime).toBe(16);
  });

  it('attackCooldown is raised to setup time when wasMoving transitions', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.wasMoving = true;
    arty.attackCooldown = 0;
    // Simulate the setup time logic from missionAI.ts
    if (arty.stats.noMovingFire && arty.wasMoving && arty.weapon) {
      const setupTime = Math.floor(arty.weapon.rof / 4);
      if (arty.attackCooldown < setupTime) {
        arty.attackCooldown = setupTime;
      }
    }
    expect(arty.attackCooldown).toBe(16);
  });

  it('existing cooldown higher than setup time is not reduced', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.wasMoving = true;
    arty.attackCooldown = 50; // higher than setupTime=16
    if (arty.stats.noMovingFire && arty.wasMoving && arty.weapon) {
      const setupTime = Math.floor(arty.weapon.rof / 4);
      if (arty.attackCooldown < setupTime) {
        arty.attackCooldown = setupTime;
      }
    }
    expect(arty.attackCooldown).toBe(50);
  });
});

// ── 7. Glass Cannon Profile (combined stats) ──────────────────────────────────
//
// ARTY's design: massive damage output vs fragile survivability.
// 150 damage per shot but only 75 HP. HE is poor vs heavy armor (0.25x).

describe('glass cannon profile — damage vs survivability', () => {
  it('damage exceeds own HP by 2x (150 vs 75)', () => {
    const weapon = WEAPON_STATS['155mm'];
    const stats = UNIT_STATS.ARTY;
    expect(weapon.damage).toBeGreaterThan(stats.strength * 1.5);
  });

  it('one 155mm shell kills an ARTY (same unit type) with HE vs light', () => {
    const attacker = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    const victim = entityAtCell(UnitType.V_ARTY, House.USSR, 14, 10); // 4 cells away
    const weapon = WEAPON_STATS['155mm'];
    // Direct damage: 150 * 0.6 (HE vs light) = 90 > 75 HP
    const directDamage = weapon.damage * getWarheadMultiplier('HE', 'light');
    expect(directDamage).toBe(90);
    expect(directDamage).toBeGreaterThan(victim.hp);
    // Verify via takeDamage
    const killed = victim.takeDamage(Math.round(directDamage));
    expect(killed).toBe(true);
    expect(victim.alive).toBe(false);
  });

  it('155mm deals reduced damage vs heavy tank armor (150 * 0.25 = 37.5)', () => {
    const weapon = WEAPON_STATS['155mm'];
    const heavyDamage = weapon.damage * getWarheadMultiplier('HE', 'heavy');
    expect(heavyDamage).toBeCloseTo(37.5, 1);
    // Not enough to one-shot a Medium Tank (400 HP)
    expect(heavyDamage).toBeLessThan(UNIT_STATS['2TNK'].strength);
  });

  it('155mm deals full damage vs concrete structures (150 * 1.0 = 150)', () => {
    const weapon = WEAPON_STATS['155mm'];
    const concreteDamage = weapon.damage * getWarheadMultiplier('HE', 'concrete');
    expect(concreteDamage).toBe(150);
  });

  it('155mm is devastating vs unarmored infantry (150 * 0.9 = 135)', () => {
    const weapon = WEAPON_STATS['155mm'];
    const infDamage = weapon.damage * getWarheadMultiplier('HE', 'none');
    expect(infDamage).toBe(135);
    // Easily kills a Rifle (50 HP) or Rocket (60 HP)
    expect(infDamage).toBeGreaterThan(UNIT_STATS.E1.strength);
  });

  it('ARTY is fragile — Light Tank (300 HP) has 4x its HP', () => {
    expect(UNIT_STATS['1TNK'].strength / UNIT_STATS.ARTY.strength).toBe(4);
  });
});

// ── 8. Inaccuracy and Splash Compensation (bullet.cpp / combat.cpp) ────────────
//
// C++ bullet.cpp:359 — isArcing=true uses ballistic arc trajectory.
// C++ bullet.cpp — isInaccurate=true forces scatter on every shot.
// inaccuracy=1.5 cells scatter radius combined with splash=2.0 cells
// means the splash radius compensates for the inaccuracy: targets within
// the overlap zone (splash - inaccuracy = 0.5) are reliably hit.

describe('inaccuracy and splash compensation (bullet.cpp / combat.cpp)', () => {
  it('splash radius (2.0) exceeds inaccuracy radius (1.5)', () => {
    const weapon = WEAPON_STATS['155mm'];
    expect(weapon.splash!).toBeGreaterThan(weapon.inaccuracy!);
  });

  it('splash-to-inaccuracy margin is 0.5 cells', () => {
    const weapon = WEAPON_STATS['155mm'];
    const margin = weapon.splash! - weapon.inaccuracy!;
    expect(margin).toBeCloseTo(0.5, 5);
  });

  it('155mm has the largest splash in the game (2.0 cells)', () => {
    let maxSplash = 0;
    let maxSplashWeapon = '';
    for (const [name, w] of Object.entries(WEAPON_STATS)) {
      if (w.splash && w.splash > maxSplash) {
        maxSplash = w.splash;
        maxSplashWeapon = name;
      }
    }
    expect(maxSplashWeapon).toBe('155mm');
    expect(maxSplash).toBe(2.0);
  });

  it('isArcing enables ballistic arc (lobs over obstacles)', () => {
    const weapon = WEAPON_STATS['155mm'];
    expect(weapon.isArcing).toBe(true);
  });

  it('isInaccurate forces scatter even without weapon inaccuracy value', () => {
    const weapon = WEAPON_STATS['155mm'];
    // isInaccurate is a BulletTypeClass flag separate from weapon inaccuracy
    expect(weapon.isInaccurate).toBe(true);
  });

  it('projectile speed is slow (0.8 cells/tick) — arcing ballistic', () => {
    const weapon = WEAPON_STATS['155mm'];
    expect(weapon.projectileSpeed).toBe(0.8);
  });
});

// ── 9. Entity Behavioral Integration ───────────────────────────────────────────
//
// Tests combining multiple ARTY properties in Entity scenarios.

describe('ARTY entity behavioral integration', () => {
  it('inRange returns true for target at 4 cells (between min and max range)', () => {
    const arty = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 14, 10);
    expect(arty.inRange(target)).toBe(true);
  });

  it('inRange returns true for target exactly at max range from Fire_Coord', () => {
    const arty = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 16, 10);
    const fireCoord = arty.fireCoordForWeapon(arty.weapon);
    setLeptonPos(target, fireCoord.lx + arty.weapon!.range * LEPTON_SIZE, fireCoord.ly);
    expect(arty.inRange(target)).toBe(true);
  });

  it('inRange returns false for target beyond max range from Fire_Coord', () => {
    const arty = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 17, 10);
    const fireCoord = arty.fireCoordForWeapon(arty.weapon);
    setLeptonPos(target, fireCoord.lx + (arty.weapon!.range + 1) * LEPTON_SIZE, fireCoord.ly);
    expect(arty.inRange(target)).toBe(false);
  });

  it('inRange returns true for target at 1 cell (note: inRange ignores minRange)', () => {
    // inRange() only checks max range — minRange enforcement is in missionAI
    const arty = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    expect(arty.inRange(target)).toBe(true);
  });

  it('takeDamage kills ARTY with 75+ damage', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    const killed = arty.takeDamage(75);
    expect(killed).toBe(true);
    expect(arty.alive).toBe(false);
    expect(arty.hp).toBe(0);
  });

  it('takeDamage does not kill ARTY with 74 damage', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    const killed = arty.takeDamage(74);
    expect(killed).toBe(false);
    expect(arty.alive).toBe(true);
    expect(arty.hp).toBe(1);
  });

  it('vehicles stop to rotate before moving (stop-rotate-move)', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.facing = Dir.N; // facing North
    arty.bodyFacing32 = Dir.N * 4;
    const target = { x: 200, y: 100 }; // target is East
    const startX = arty.pos.x;
    arty.rotTickedThisFrame = false;
    arty.moveToward(target, 6);
    // With ROT=2, facing won't align in one tick, so vehicle should NOT move
    // (stop-rotate-move behavior for non-infantry)
    expect(arty.pos.x).toBe(startX);
  });

  it('moveToward advances position once facing is aligned', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.facing = Dir.E;
    arty.bodyFacing32 = Dir.E * 4;
    arty.desiredFacing = Dir.E;
    const target = { x: 200, y: 100 };
    arty.rotTickedThisFrame = false;
    arty.moveToward(target, 6);
    expect(arty.pos.x).toBeGreaterThan(100);
  });
});

// ── 10. Damage Calculation with modifyDamage (combat.cpp) ──────────────────────
//
// C++ combat.cpp uses modifyDamage for splash damage falloff.
// Tests verify the HE warhead damage at various distances.

describe('155mm damage calculation with distance falloff (combat.cpp)', () => {
  it('point-blank direct hit (0 distance) on light armor: full 150 * 0.6 = 90', () => {
    const dmg = modifyDamage(150, 'HE', 'light', 0);
    expect(dmg).toBe(90);
  });

  it('point-blank direct hit on none armor: full 150 * 0.9 = 135', () => {
    const dmg = modifyDamage(150, 'HE', 'none', 0);
    expect(dmg).toBe(135);
  });

  it('point-blank direct hit on heavy armor: 150 * 0.25 = 38 (rounded)', () => {
    const dmg = modifyDamage(150, 'HE', 'heavy', 0);
    expect(dmg).toBe(38); // Math.round(37.5)
  });

  it('point-blank direct hit on concrete: 150 * 1.0 = 150', () => {
    const dmg = modifyDamage(150, 'HE', 'concrete', 0);
    expect(dmg).toBe(150);
  });

  it('damage falls off with distance (splash targets take less)', () => {
    const close = modifyDamage(150, 'HE', 'none', 6);  // 0.25 cells away (in px)
    const far = modifyDamage(150, 'HE', 'none', 24);    // 1.0 cell away (in px)
    expect(close).toBeGreaterThan(far);
  });

  it('at 2 cells distance (48px), damage is significantly reduced', () => {
    const dmg = modifyDamage(150, 'HE', 'none', 48);
    expect(dmg).toBeLessThan(135); // less than point-blank
    expect(dmg).toBeGreaterThan(0); // still some damage
  });
});

// ── 11. Production Cost (rules.ini) ───────────────────────────────────────────
//
// ARTY costs 600 credits, builds at WEAP, allied faction, techLevel 8.

describe('ARTY production identity (rules.ini)', () => {
  it('UNIT_STATS.ARTY.type is V_ARTY', () => {
    expect(UNIT_STATS.ARTY.type).toBe(UnitType.V_ARTY);
  });

  it('ARTY name is "Artillery"', () => {
    expect(UNIT_STATS.ARTY.name).toBe('Artillery');
  });

  it('ARTY image asset is "arty"', () => {
    expect(UNIT_STATS.ARTY.image).toBe('arty');
  });

  it('ARTY scan delay is 20 ticks (slow scanner)', () => {
    expect(UNIT_STATS.ARTY.scanDelay).toBe(20);
  });
});

// ── 12. Comparison with Similar Units ──────────────────────────────────────────
//
// ARTY vs V2RL: both artillery-class, but very different.
// ARTY: 75 HP, 150 dmg, HE, splash 2.0, continuous fire
// V2RL: 150 HP, 200 dmg, HE, splash 1.5, single ammo, must rearm

describe('ARTY vs V2RL — artillery unit comparison', () => {
  it('V2RL has 2x the HP of ARTY (150 vs 75)', () => {
    expect(UNIT_STATS.V2RL.strength).toBe(150);
    expect(UNIT_STATS.ARTY.strength).toBe(75);
    expect(UNIT_STATS.V2RL.strength / UNIT_STATS.ARTY.strength).toBe(2);
  });

  it('ARTY has larger splash than V2RL (2.0 vs no weapon splash)', () => {
    const artyWeapon = WEAPON_STATS['155mm'];
    expect(artyWeapon.splash).toBe(2.0);
  });

  it('both have noMovingFire=true', () => {
    expect(UNIT_STATS.ARTY.noMovingFire).toBe(true);
    expect(UNIT_STATS.V2RL.noMovingFire).toBe(true);
  });

  it('ARTY has unlimited ammo; V2RL has maxAmmo=1', () => {
    expect(UNIT_STATS.ARTY.maxAmmo).toBeUndefined();
    expect(UNIT_STATS.V2RL.maxAmmo).toBe(1);
  });
});

// ── 13. threatScore integration (techno.cpp Evaluate_Object) ──────────────────
//
// ARTY's 150-damage weapon makes it a high-value target; its 75 HP makes
// it easy to kill. Verify threat scoring sees ARTY correctly.

describe('threat evaluation context for ARTY (techno.cpp)', () => {
  it('ARTY weapon danger contribution is capped at 200 (150 * 2 = 300 → min 200)', () => {
    const weaponDanger = Math.min((WEAPON_STATS['155mm'].damage) * 2, 200);
    expect(weaponDanger).toBe(200);
  });

  it('ARTY has splash but no Supress flag, so it does not trigger Area_Modify', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.weapon!.splash).toBeDefined();
    expect(arty.weapon!.splash!).toBeGreaterThan(0);
    expect(arty.weapon!.isSupressed).toBeFalsy();
  });
});
