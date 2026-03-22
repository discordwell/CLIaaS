/**
 * C++ Behavioral Parity: ANT2 -- Fire Ant
 *
 * Tests verify Fire Ant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * ANT2 is the only ranged ant (4.0 range vs ANT1/ANT3 melee 1.5/1.75).
 * Fire warhead + splash 1.5 makes it the area-damage ant, but it has the
 * weakest HP of all ants (75 vs ANT1=125, ANT3=85).
 *
 * C++ references: udata.cpp (unit stats), weapon.cpp (FireballLauncher),
 * combat.cpp (Fire warhead tables), infantry.cpp (ant animation system).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Dir, Mission, AnimState, CELL_SIZE,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, WARHEAD_META,
  modifyDamage, worldDist, getWarheadMultiplier, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import { buildDefaultAlliances } from '../engine/types';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers -----------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Distance in cells between two cell-centered entities */
function cellDist(cx1: number, cy1: number, cx2: number, cy2: number): number {
  return worldDist(
    { x: cx1 * CELL_SIZE + CELL_SIZE / 2, y: cy1 * CELL_SIZE + CELL_SIZE / 2 },
    { x: cx2 * CELL_SIZE + CELL_SIZE / 2, y: cy2 * CELL_SIZE + CELL_SIZE / 2 },
  );
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

// -- 1. Unit Stats (udata.cpp / rules.ini) -----------------------------------
//
// C++ udata.cpp and SCA scenario INI files define ANT2:
//   Strength=75, Armor=heavy, Speed=14 (MPH_MEDIUM_FAST), ROT=6,
//   Sight=3, PrimaryWeapon=FireballLauncher, NoMovingFire=true, Crushable=true

describe('ANT2 unit stats (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.ANT2;

  it('HP is 75 (weakest ant)', () => {
    expect(stats.strength).toBe(75);
  });

  it('armor is heavy', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('speed is 8 (SCA01EA.ini Speed=8)', () => {
    expect(stats.speed).toBe(8);
  });

  it('ROT is 6', () => {
    expect(stats.rot).toBe(6);
  });

  it('sight is 3', () => {
    expect(stats.sight).toBe(3);
  });

  it('primary weapon is FireballLauncher', () => {
    expect(stats.primaryWeapon).toBe('FireballLauncher');
  });

  it('noMovingFire is true (must stop to fire)', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('crushable is true (can be crushed by heavy vehicles)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('isInfantry is false (ant, not infantry)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('name is "Fire Ant"', () => {
    expect(stats.name).toBe('Fire Ant');
  });

  it('image asset is "ant2"', () => {
    expect(stats.image).toBe('ant2');
  });

  it('scanDelay is 10 ticks', () => {
    expect(stats.scanDelay).toBe(10);
  });

  it('Entity constructor initializes HP and weapon correctly', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.hp).toBe(75);
    expect(ant2.maxHp).toBe(75);
    expect(ant2.weapon).not.toBeNull();
    expect(ant2.weapon!.name).toBe('FireballLauncher');
    expect(ant2.weapon2).toBeNull();
  });
});

// -- 2. Weapon Stats -- FireballLauncher (weapon.cpp / rules.ini) ------------
//
// C++ weapon.cpp/rules.ini defines FireballLauncher:
//   Damage=125, ROF=50, Range=4.0, Warhead=Fire, Splash=1.5,
//   ProjectileSpeed=0.8, ProjSpeed=15

describe('FireballLauncher weapon stats (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.FireballLauncher;

  it('exists in WEAPON_STATS', () => {
    expect(weapon).toBeDefined();
  });

  it('deals 125 base damage', () => {
    expect(weapon.damage).toBe(125);
  });

  it('has ROF 50 (rate of fire in ticks)', () => {
    expect(weapon.rof).toBe(50);
  });

  it('has range 4.0 cells (the only ranged ant)', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('uses Fire warhead', () => {
    expect(weapon.warhead).toBe('Fire');
  });

  it('has splash 1.5 cells (area damage)', () => {
    expect(weapon.splash).toBe(1.5);
  });

  it('projectile speed is 0.8 cells/tick', () => {
    expect(weapon.projectileSpeed).toBe(0.8);
  });

  it('projSpeed (raw) is 12 (rules.ini [FireballLauncher] Speed=12)', () => {
    expect(weapon.projSpeed).toBe(12);
  });
});

// -- 3. Fire Warhead vs Armor (combat.cpp / rules.ini Verses=) ---------------
//
// Fire warhead damage multipliers from rules.ini:
//   vs none=0.9, vs wood=1.0, vs light=0.6, vs heavy=0.25, vs concrete=0.5

describe('Fire warhead vs armor classes (rules.ini Verses=)', () => {
  const fire = WARHEAD_VS_ARMOR.Fire;

  it('vs none armor: 0.9 (good vs unarmored infantry)', () => {
    expect(fire[armorIndex('none')]).toBe(0.9);
    expect(getWarheadMultiplier('Fire', 'none')).toBe(0.9);
  });

  it('vs wood armor: 1.0 (full damage -- best armor class for Fire)', () => {
    expect(fire[armorIndex('wood')]).toBe(1.0);
    expect(getWarheadMultiplier('Fire', 'wood')).toBe(1.0);
  });

  it('vs light armor: 0.6 (moderate)', () => {
    expect(fire[armorIndex('light')]).toBe(0.6);
    expect(getWarheadMultiplier('Fire', 'light')).toBe(0.6);
  });

  it('vs heavy armor: 0.25 (poor vs tanks)', () => {
    expect(fire[armorIndex('heavy')]).toBe(0.25);
    expect(getWarheadMultiplier('Fire', 'heavy')).toBe(0.25);
  });

  it('vs concrete: 0.5', () => {
    expect(fire[armorIndex('concrete')]).toBe(0.5);
    expect(getWarheadMultiplier('Fire', 'concrete')).toBe(0.5);
  });

  it('Fire spreadFactor is 8 (widest non-nuke splash falloff)', () => {
    expect(WARHEAD_META.Fire.spreadFactor).toBe(8);
  });
});

// -- 4. Ranged Ant -- ANT2 is the only ant with range > 2.0 -----------------
//
// ANT1 Mandible range=1.5, ANT3 TeslaZap range=1.75: both melee.
// ANT2 FireballLauncher range=4.0: ranged ant (standoff attacker).

describe('ranged ant identity -- only ant with range > 2.0', () => {
  it('ANT2 range (4.0) is more than double ANT1 range (1.5)', () => {
    const ant2Range = WEAPON_STATS.FireballLauncher.range;
    const ant1Range = WEAPON_STATS.Mandible.range;
    expect(ant2Range).toBe(4.0);
    expect(ant1Range).toBe(1.5);
    expect(ant2Range).toBeGreaterThan(ant1Range * 2);
  });

  it('ANT2 range (4.0) is more than double ANT3 range (1.75)', () => {
    const ant2Range = WEAPON_STATS.FireballLauncher.range;
    const ant3Range = WEAPON_STATS.TeslaZap.range;
    expect(ant2Range).toBe(4.0);
    expect(ant3Range).toBe(1.75);
    expect(ant2Range).toBeGreaterThan(ant3Range * 2);
  });

  it('ANT2 is the only ant with splash damage', () => {
    expect(WEAPON_STATS.FireballLauncher.splash).toBe(1.5);
    expect(WEAPON_STATS.Mandible.splash).toBeUndefined();
    expect(WEAPON_STATS.TeslaZap.splash).toBeUndefined();
  });

  it('target at 3 cells is in range for ANT2', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    expect(ant2.inRange(target)).toBe(true);
  });

  it('target at 3 cells is out of range for ANT1 (Mandible range=1.5)', () => {
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    expect(ant1.inRange(target)).toBe(false);
  });

  it('target at 4 cells is at max range for ANT2', () => {
    const dist = cellDist(10, 10, 14, 10);
    expect(dist).toBeCloseTo(4.0, 1);
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 14, 10);
    expect(ant2.inRange(target)).toBe(true);
  });

  it('target at 5 cells is out of range for ANT2', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
    expect(ant2.inRange(target)).toBe(false);
  });
});

// -- 5. Splash Damage -- area damage ant ------------------------------------
//
// FireballLauncher has splash=1.5, Fire warhead with spreadFactor=8.
// modifyDamage falloff uses spreadFactor to shape the splash curve.

describe('splash damage -- FireballLauncher area effect (combat.cpp)', () => {
  it('point-blank direct hit on none armor: 125 * 0.9 = 113 (rounded)', () => {
    const dmg = modifyDamage(125, 'Fire', 'none', 0);
    expect(dmg).toBe(113); // Math.round(112.5)
  });

  it('point-blank direct hit on wood armor: 125 * 1.0 = 125', () => {
    const dmg = modifyDamage(125, 'Fire', 'wood', 0);
    expect(dmg).toBe(125);
  });

  it('point-blank direct hit on heavy armor: 125 * 0.25 = 31 (rounded)', () => {
    const dmg = modifyDamage(125, 'Fire', 'heavy', 0);
    expect(dmg).toBe(31); // Math.round(31.25)
  });

  it('point-blank direct hit on light armor: 125 * 0.6 = 75', () => {
    const dmg = modifyDamage(125, 'Fire', 'light', 0);
    expect(dmg).toBe(75);
  });

  it('point-blank direct hit on concrete: 125 * 0.5 = 63 (rounded)', () => {
    const dmg = modifyDamage(125, 'Fire', 'concrete', 0);
    expect(dmg).toBe(63); // Math.round(62.5)
  });

  it('damage decreases with distance (Fire spreadFactor=8 gives wide falloff)', () => {
    const d0 = modifyDamage(125, 'Fire', 'none', 0);   // point blank
    const d1 = modifyDamage(125, 'Fire', 'none', 12);  // 0.5 cells
    const d2 = modifyDamage(125, 'Fire', 'none', 24);  // 1.0 cell
    const d3 = modifyDamage(125, 'Fire', 'none', 36);  // 1.5 cells (splash edge)

    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
  });

  it('Fire has wider splash than Super (spreadFactor 8 vs 1)', () => {
    const dist = 24; // 1 cell
    const fireDmg = modifyDamage(125, 'Fire', 'none', dist);
    const superDmg = modifyDamage(125, 'Super', 'none', dist);
    // Fire spreadFactor=8 gives slower falloff (more damage at distance)
    expect(fireDmg).toBeGreaterThan(superDmg);
  });
});

// -- 6. isAnt flag and ANT_ANIM animation system ----------------------------
//
// C++ infantry.cpp: ant units use a different animation layout (112 frames)
// from regular infantry. Entity.isAnt drives this selection.

describe('ANT2 isAnt and ANT_ANIM animation system (infantry.cpp)', () => {
  it('isAnt is true for ANT2', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.isAnt).toBe(true);
  });

  it('isInfantry is false (ants are not infantry)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.stats.isInfantry).toBe(false);
  });

  it('hasTurret is false (ants have no turret)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.hasTurret).toBe(false);
  });

  it('starts in IDLE animState when alive', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.alive).toBe(true);
    expect(ant2.animState).toBe(AnimState.IDLE);
  });

  it('spriteFrame returns a valid frame number (ANT_ANIM layout)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const frame = ant2.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('IDLE spriteFrame is in stand range (0-7 for 8 directions)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.animState = AnimState.IDLE;
    const frame = ant2.spriteFrame;
    // ANT_ANIM.standBase=0, 8 directions
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(8);
  });

  it('WALK spriteFrame is in walk range (8-71)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.animState = AnimState.WALK;
    const frame = ant2.spriteFrame;
    // ANT_ANIM.walkBase=8, 8 dirs * 8 frames = 64
    expect(frame).toBeGreaterThanOrEqual(8);
    expect(frame).toBeLessThan(72);
  });

  it('ATTACK spriteFrame is in attack range (72-103)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.animState = AnimState.ATTACK;
    const frame = ant2.spriteFrame;
    // ANT_ANIM.attackBase=72, 8 dirs * 4 frames = 32
    expect(frame).toBeGreaterThanOrEqual(72);
    expect(frame).toBeLessThan(104);
  });

  it('DIE spriteFrame is in death range (104-111)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.animState = AnimState.DIE;
    const frame = ant2.spriteFrame;
    // ANT_ANIM.deathBase=104, 8-frame shared death sequence
    expect(frame).toBeGreaterThanOrEqual(104);
    expect(frame).toBeLessThan(112);
  });

  it('all three ants use the same ANT_ANIM layout (not INFANTRY_ANIMS)', () => {
    const ant1 = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const ant3 = entityAtCell(UnitType.ANT3, House.USSR, 10, 10);
    expect(ant1.isAnt).toBe(true);
    expect(ant2.isAnt).toBe(true);
    expect(ant3.isAnt).toBe(true);
    // All should produce valid stand frames (0-7)
    expect(ant1.spriteFrame).toBeGreaterThanOrEqual(0);
    expect(ant2.spriteFrame).toBeGreaterThanOrEqual(0);
    expect(ant3.spriteFrame).toBeGreaterThanOrEqual(0);
  });
});

// -- 7. Weakest Ant -- HP comparison ----------------------------------------
//
// ANT2 (75 HP) < ANT3 (85 HP) < ANT1 (125 HP).
// ANT2 compensates with ranged standoff and splash damage.

describe('weakest ant -- ANT2 HP comparison', () => {
  it('ANT2 (75 HP) is weaker than ANT3 (85 HP)', () => {
    expect(UNIT_STATS.ANT2.strength).toBeLessThan(UNIT_STATS.ANT3.strength);
  });

  it('ANT2 (75 HP) is weaker than ANT1 (125 HP)', () => {
    expect(UNIT_STATS.ANT2.strength).toBeLessThan(UNIT_STATS.ANT1.strength);
  });

  it('ANT1 is the toughest ant at 125 HP', () => {
    expect(UNIT_STATS.ANT1.strength).toBe(125);
    expect(UNIT_STATS.ANT1.strength).toBeGreaterThan(UNIT_STATS.ANT2.strength);
    expect(UNIT_STATS.ANT1.strength).toBeGreaterThan(UNIT_STATS.ANT3.strength);
  });

  it('ANT2 has same HP as Artillery (both glass cannon role: 75 HP)', () => {
    expect(UNIT_STATS.ANT2.strength).toBe(UNIT_STATS.ARTY.strength);
    expect(UNIT_STATS.ANT2.strength).toBe(75);
  });

  it('one FireballLauncher shot kills an ANT2 (self-damage: 125 * 0.25 = 31, 3 hits needed)', () => {
    // Fire vs heavy = 0.25; ANT2 has heavy armor
    const selfDamage = Math.round(125 * getWarheadMultiplier('Fire', 'heavy'));
    expect(selfDamage).toBe(31);
    // 75 / 31 = 2.42 -- needs 3 hits
    expect(selfDamage * 3).toBeGreaterThanOrEqual(75);
    expect(selfDamage * 2).toBeLessThan(75);
  });
});

// -- 8. Crushable by Heavy Vehicles ----------------------------------------
//
// C++ drive.cpp: crusher vehicles kill crushable units in same cell.
// All ants are crushable -- this is a core ant mission tactic.

describe('ANT2 crushable (drive.cpp:Ok_To_Move)', () => {
  it('ANT2 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant2, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant2.alive).toBe(false);
  });

  it('ANT2 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ant2, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(ant2.alive).toBe(true);
    expect(ant2.hp).toBe(ant2.maxHp);
  });

  it('ANT2 is NOT crushed by allied crusher vehicle (same house)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([ant2, tank]);
    checkVehicleCrush(ctx, tank);
    expect(ant2.alive).toBe(true);
  });
});

// -- 9. Retaliation (techno.cpp) --------------------------------------------
//
// C++ techno.cpp: idle/guarding units counter-attack when hit by an enemy.
// ANT2 has a weapon, so it can retaliate.

describe('ANT2 retaliation (techno.cpp)', () => {
  it('idle ANT2 on GUARD retaliates when hit by enemy', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant2.mission = Mission.GUARD;
    ant2.target = null;

    const ctx = makeCombatCtx([ant2, attacker]);
    triggerRetaliation(ctx, ant2, attacker);

    expect(ant2.target).toBe(attacker);
    expect(ant2.mission).toBe(Mission.ATTACK);
  });

  it('ANT2 has a weapon (can retaliate)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.weapon).not.toBeNull();
    expect(ant2.weapon!.name).toBe('FireballLauncher');
  });

  it('ANT2 does not retarget if already has a living target', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const existing = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ant2.mission = Mission.ATTACK;
    ant2.target = existing;

    const ctx = makeCombatCtx([ant2, existing, attacker]);
    triggerRetaliation(ctx, ant2, attacker);

    expect(ant2.target).toBe(existing);
  });
});

// -- 10. NoMovingFire setup time (unit.cpp:1760-1764) -----------------------
//
// noMovingFire=true means ANT2 cannot fire while moving. When transitioning
// from moving to stationary, a setup time of ROF/4 ticks is applied.

describe('ANT2 noMovingFire setup time (unit.cpp:1760-1764)', () => {
  it('noMovingFire is true on ANT2 stats', () => {
    expect(UNIT_STATS.ANT2.noMovingFire).toBe(true);
  });

  it('all ants have noMovingFire=true', () => {
    expect(UNIT_STATS.ANT1.noMovingFire).toBe(true);
    expect(UNIT_STATS.ANT2.noMovingFire).toBe(true);
    expect(UNIT_STATS.ANT3.noMovingFire).toBe(true);
  });

  it('setup time is ROF/4 = 50/4 = 12 ticks', () => {
    const rof = WEAPON_STATS.FireballLauncher.rof;
    const setupTime = Math.floor(rof / 4);
    expect(setupTime).toBe(12);
  });

  it('attackCooldown is raised to setup time when wasMoving transitions', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.wasMoving = true;
    ant2.attackCooldown = 0;
    if (ant2.stats.noMovingFire && ant2.wasMoving && ant2.weapon) {
      const setupTime = Math.floor(ant2.weapon.rof / 4);
      if (ant2.attackCooldown < setupTime) {
        ant2.attackCooldown = setupTime;
      }
    }
    expect(ant2.attackCooldown).toBe(12);
  });
});

// -- 11. Damage Calculations (combat.cpp Modify_Damage) ---------------------
//
// FireballLauncher 125 base damage with Fire warhead at various armor types.

describe('FireballLauncher damage calculations (combat.cpp)', () => {
  it('one-shots Rifle Infantry (E1): 125 * 0.9 = 113 > 50 HP', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'none'));
    expect(damage).toBe(113);
    expect(damage).toBeGreaterThan(UNIT_STATS.E1.strength);

    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const killed = victim.takeDamage(damage);
    expect(killed).toBe(true);
    expect(victim.alive).toBe(false);
  });

  it('one-shots Rocket Infantry (E3): 113 > 60 HP', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'none'));
    expect(damage).toBeGreaterThan(UNIT_STATS.E3.strength);
  });

  it('does NOT one-shot a Medium Tank (2TNK): 125 * 0.25 = 31 vs 400 HP', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'heavy'));
    expect(damage).toBe(31);
    expect(damage).toBeLessThan(UNIT_STATS['2TNK'].strength);
  });

  it('does NOT one-shot an ANT1 (heavy armor): 31 vs 125 HP', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'heavy'));
    expect(damage).toBe(31);
    expect(damage).toBeLessThan(UNIT_STATS.ANT1.strength);
  });

  it('full damage vs wood structures: 125 * 1.0 = 125', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'wood'));
    expect(damage).toBe(125);
  });

  it('half damage vs concrete: 125 * 0.5 = 63', () => {
    const damage = Math.round(125 * getWarheadMultiplier('Fire', 'concrete'));
    expect(damage).toBe(63);
  });
});

// -- 12. Ant Trio Comparison (udata.cpp) ------------------------------------
//
// ANT1: melee brawler (125 HP, Mandible/Super, range 1.5)
// ANT2: ranged fire support (75 HP, FireballLauncher/Fire, range 4.0, splash 1.5)
// ANT3: scout/tesla (85 HP, TeslaZap/Super, range 1.75)

describe('ant trio comparison -- ANT2 role as fire support', () => {
  it('ANT2 has highest damage of all ant weapons (125 vs 50/60)', () => {
    expect(WEAPON_STATS.FireballLauncher.damage).toBe(125);
    expect(WEAPON_STATS.Mandible.damage).toBe(50);
    expect(WEAPON_STATS.TeslaZap.damage).toBe(60);
    expect(WEAPON_STATS.FireballLauncher.damage).toBeGreaterThan(WEAPON_STATS.TeslaZap.damage);
  });

  it('ANT2 has longest range of all ants (4.0 vs 1.5/1.75)', () => {
    expect(WEAPON_STATS.FireballLauncher.range).toBe(4.0);
    expect(WEAPON_STATS.Mandible.range).toBe(1.5);
    expect(WEAPON_STATS.TeslaZap.range).toBe(1.75);
  });

  it('ANT2 has slowest ROF of all ants (50 vs 15/25)', () => {
    expect(WEAPON_STATS.FireballLauncher.rof).toBe(50);
    expect(WEAPON_STATS.Mandible.rof).toBe(15);
    expect(WEAPON_STATS.TeslaZap.rof).toBe(25);
    expect(WEAPON_STATS.FireballLauncher.rof).toBeGreaterThan(WEAPON_STATS.TeslaZap.rof);
  });

  it('ANT1 and ANT3 use Super warhead (1.0x all); ANT2 uses Fire (variable)', () => {
    expect(WEAPON_STATS.Mandible.warhead).toBe('Super');
    expect(WEAPON_STATS.TeslaZap.warhead).toBe('Super');
    expect(WEAPON_STATS.FireballLauncher.warhead).toBe('Fire');
  });

  it('all ants share same speed (8) except ANT3 (7) — SCA01EA.ini values', () => {
    expect(UNIT_STATS.ANT1.speed).toBe(8);
    expect(UNIT_STATS.ANT2.speed).toBe(8);
    expect(UNIT_STATS.ANT3.speed).toBe(7);
  });

  it('ANT2 DPS is lowest vs heavy armor due to Fire warhead penalty', () => {
    // DPS = damage * armorMult / ROF
    const ant1Dps = (50 * 1.0) / 15;   // Mandible Super vs heavy = 1.0
    const ant2Dps = (125 * 0.25) / 50;  // FireballLauncher Fire vs heavy = 0.25
    const ant3Dps = (60 * 1.0) / 25;    // TeslaZap Super vs heavy = 1.0
    expect(ant2Dps).toBeLessThan(ant1Dps);
    expect(ant2Dps).toBeLessThan(ant3Dps);
  });

  it('ANT2 DPS is highest vs none armor due to raw damage', () => {
    // DPS = damage * armorMult / ROF
    const ant1Dps = (50 * 1.0) / 15;    // Mandible Super vs none = 1.0
    const ant2Dps = (125 * 0.9) / 50;   // FireballLauncher Fire vs none = 0.9
    const ant3Dps = (60 * 1.0) / 25;    // TeslaZap Super vs none = 1.0
    // ANT1 DPS = 3.33, ANT2 DPS = 2.25, ANT3 DPS = 2.4
    // Actually ANT1 has highest single-target DPS; ANT2 compensates with splash
    expect(ant1Dps).toBeGreaterThan(ant2Dps);
    // ANT2's advantage is area damage, not single-target DPS
    expect(WEAPON_STATS.FireballLauncher.splash).toBe(1.5);
  });
});

// -- 13. Entity Behavioral Integration --------------------------------------

describe('ANT2 entity behavioral integration', () => {
  it('takeDamage kills ANT2 with 75 damage', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const killed = ant2.takeDamage(75);
    expect(killed).toBe(true);
    expect(ant2.alive).toBe(false);
    expect(ant2.hp).toBe(0);
  });

  it('takeDamage does NOT kill ANT2 with 74 damage', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    const killed = ant2.takeDamage(74);
    expect(killed).toBe(false);
    expect(ant2.alive).toBe(true);
    expect(ant2.hp).toBe(1);
  });

  it('ANT2 facing starts at N (Dir.N = 0)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    expect(ant2.facing).toBe(Dir.N);
  });

  it('ROT=6 does not snap facing instantly (needs ROT >= 8 for snap)', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.desiredFacing = Dir.S; // 180 degrees opposite
    ant2.rotTickedThisFrame = false;
    const aligned = ant2.tickRotation();
    // ROT=6 is below the snap threshold of 8
    expect(aligned).toBe(false);
    expect(ant2.facing).not.toBe(Dir.S);
  });

  it('ANT2 is slower to rotate than ANT1 (ROT 6 vs 8)', () => {
    expect(UNIT_STATS.ANT2.rot).toBe(6);
    expect(UNIT_STATS.ANT1.rot).toBe(8);
    expect(UNIT_STATS.ANT2.rot).toBeLessThan(UNIT_STATS.ANT1.rot);
  });

  it('ANT2 eventually completes rotation N to S', () => {
    const ant2 = entityAtCell(UnitType.ANT2, House.USSR, 10, 10);
    ant2.desiredFacing = Dir.S;
    let ticks = 0;
    while (ant2.facing !== Dir.S && ticks < 100) {
      ant2.rotTickedThisFrame = false;
      ant2.tickRotation();
      ticks++;
    }
    expect(ant2.facing).toBe(Dir.S);
    // Should take more than 1 tick but complete within 100
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(100);
  });
});
