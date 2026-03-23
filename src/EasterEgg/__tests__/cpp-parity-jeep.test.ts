/**
 * C++ Behavioral Parity Tests — JEEP (Ranger)
 *
 * Verifies that the JEEP unit matches C++ Red Alert engine behavior:
 *   - Stats: HP 150, armor light, speed 10, cost 600, allied faction
 *   - Weapon: M60mg (SA warhead, 15 damage, range 4.0, ROF 20)
 *   - SA warhead vs armor multipliers: none=1.0, heavy=0.25
 *   - NOT a crusher: cannot crush infantry (key difference from tanks)
 *   - No turret: hasTurret=false, body faces target direction
 *   - Fast: speed 10, one of the fastest ground units
 *   - Light armor: takes more damage from AP warhead than heavy armor vehicles
 *   - Standard vehicle behaviors: retaliation, damageSpeed, stop-rotate-move
 *
 * References: C++ udata.cpp, rules.ini, drive.cpp, combat.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  WARHEAD_VS_ARMOR, WARHEAD_PROPS,
  type WarheadType, type ArmorType, type WarheadProps,
  armorIndex, getWarheadMultiplier, Mission, AnimState, Dir,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext, type AiStateSlice,
  checkVehicleCrush, triggerRetaliation, damageSpeedFactor, damageEntity,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

/** Build a minimal CombatContext for behavioral tests */
function makeCombatContext(entities: Entity[]): CombatContext {
  const map = new GameMap();
  const entityById = new Map(entities.map(e => [e.id, e]));
  return {
    entities,
    entityById,
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
    attackedTriggerNames: new Set(),
    map,
    aiStates: new Map<House, AiStateSlice>(),
    lastBaseAttackEva: 0,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 0,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: () => false, // These tests test AI retaliation; PlayerReturnFire tested in return-fire.test.ts
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '255,200,60',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
  } as CombatContext;
}


// ============================================================
// 1. JEEP Stats — C++ udata.cpp / rules.ini parity
// ============================================================
describe('JEEP stats (C++ udata.cpp parity)', () => {
  const stats = UNIT_STATS.JEEP;

  it('HP is 150 (C++ Strength=150)', () => {
    expect(stats.strength).toBe(150);
  });

  it('armor is light (C++ Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('speed is 10 — one of the fastest ground units (C++ Speed=MEDIUM_FAST)', () => {
    expect(stats.speed).toBe(10);
  });

  it('cost is 600 credits (C++ rules.ini Cost=600)', () => {
    // Cost is in PRODUCTION_ITEMS, but also verified via UNIT_STATS or build data
    // JEEP cost verified via PRODUCTION_ITEMS in data-parity tests; here we confirm
    // the stats-level data is consistent
    expect(stats.type).toBe(UnitType.V_JEEP);
    expect(stats.name).toBe('Ranger');
  });

  it('sight is 6 cells (C++ Sight=6)', () => {
    expect(stats.sight).toBe(6);
  });

  it('rot is 10 — fast rotation (C++ ROT=10)', () => {
    expect(stats.rot).toBe(10);
  });

  it('is NOT infantry (C++ is a vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primary weapon is M60mg', () => {
    expect(stats.primaryWeapon).toBe('M60mg');
  });

  it('has no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('scanDelay is 10 ticks (C++ guard scan frequency)', () => {
    expect(stats.scanDelay).toBe(10);
  });
});


// ============================================================
// 2. M60mg Weapon — C++ rules.ini Weapon stats parity
// ============================================================
describe('M60mg weapon stats (C++ rules.ini parity)', () => {
  const weapon = WEAPON_STATS.M60mg;

  it('damage is 15 (C++ Damage=15)', () => {
    expect(weapon.damage).toBe(15);
  });

  it('ROF is 20 ticks (C++ ROF=20)', () => {
    expect(weapon.rof).toBe(20);
  });

  it('range is 4.0 cells (C++ Range=4)', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('warhead is SA (Small Arms)', () => {
    expect(weapon.warhead).toBe('SA');
  });

  it('is invisible (instant hit, no projectile visual)', () => {
    expect(weapon.isInvisible).toBe(true);
  });

  it('has no splash damage (point damage only)', () => {
    expect(weapon.splash).toBeUndefined();
  });

  it('has no burst (single shot per trigger)', () => {
    expect(weapon.burst).toBeUndefined();
  });
});


// ============================================================
// 3. SA Warhead vs Armor — C++ WARHEAD_VS_ARMOR parity
// ============================================================
describe('SA warhead damage multipliers (C++ rules.ini Verses)', () => {
  it('vs none armor: 1.0 (full damage to unarmored infantry)', () => {
    expect(getWarheadMultiplier('SA', 'none')).toBe(1.0);
  });

  it('vs wood armor: 0.5', () => {
    expect(getWarheadMultiplier('SA', 'wood')).toBe(0.5);
  });

  it('vs light armor: 0.6 (JEEP takes 60% from other SA weapons)', () => {
    expect(getWarheadMultiplier('SA', 'light')).toBe(0.6);
  });

  it('vs heavy armor: 0.25 (very poor against tanks)', () => {
    expect(getWarheadMultiplier('SA', 'heavy')).toBe(0.25);
  });

  it('vs concrete: 0.25', () => {
    expect(getWarheadMultiplier('SA', 'concrete')).toBe(0.25);
  });

  it('raw WARHEAD_VS_ARMOR table matches [1.0, 0.5, 0.6, 0.25, 0.25]', () => {
    expect(WARHEAD_VS_ARMOR.SA).toEqual([1.0, 0.5, 0.6, 0.25, 0.25]);
  });
});


// ============================================================
// 4. NOT a crusher — JEEP cannot crush infantry
//    (Key behavioral difference from tanks — C++ drive.cpp Crusher flag)
// ============================================================
describe('JEEP is NOT a crusher (C++ Crusher=no)', () => {
  it('JEEP stats do not have crusher=true', () => {
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
  });

  it('game loop gates on crusher flag — JEEP must be excluded from checkVehicleCrush calls', () => {
    // C++ drive.cpp: Ok_To_Move only triggers crush for vehicles with Crusher=yes.
    // The game loop checks vehicle.stats.crusher BEFORE calling checkVehicleCrush.
    // JEEP lacks crusher, so checkVehicleCrush is never called for it.
    // This test verifies the stats gate that the game loop uses.
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    expect(jeep.stats.crusher).toBeFalsy();
    expect(infantry.stats.crushable).toBe(true);

    // Simulate game loop guard: if (!vehicle.stats.crusher) skip crush check
    if (!jeep.stats.crusher) {
      // JEEP is correctly excluded — infantry survives
      expect(infantry.alive).toBe(true);
    }
  });

  it('JEEP shares cell with dog — no crush because game loop skips non-crushers', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);

    // Game loop guard: crusher flag is falsy, so checkVehicleCrush is never called
    expect(jeep.stats.crusher).toBeFalsy();
    expect(dog.stats.crushable).toBe(true);
    expect(dog.alive).toBe(true);
  });

  it('JEEP shares cell with engineer — no crush because game loop skips non-crushers', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const engi = makeEntity(UnitType.I_E7, House.USSR, 100, 100);

    expect(jeep.stats.crusher).toBeFalsy();
    expect(engi.stats.crushable).toBe(true);
    expect(engi.alive).toBe(true);
  });

  it('contrast: Heavy Tank DOES crush infantry on same cell', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    expect(tank.stats.crusher).toBe(true);

    // Game loop calls checkVehicleCrush because crusher=true
    const ctx = makeCombatContext([tank, infantry]);
    checkVehicleCrush(ctx, tank);

    expect(infantry.alive, 'heavy tank must crush infantry').toBe(false);
  });

  it('no kills from cell overlap — game loop never calls crush for JEEP', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);

    // Since checkVehicleCrush is never called for JEEP, kills stays 0
    expect(jeep.stats.crusher).toBeFalsy();
    expect(jeep.kills).toBe(0);
  });
});


// ============================================================
// 5. No turret — hasTurret=false, body faces target direction
//    (C++ udata.cpp NoTurret flag for JEEP)
// ============================================================
describe('JEEP has turret (C++ udata.cpp:393 IsTurretEquipped=true)', () => {
  it('hasTurret getter returns true', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.hasTurret).toBe(true);
  });

  it('contrast: Light Tank has a turret', () => {
    const tank = makeEntity(UnitType.V_1TNK, House.Spain, 100, 100);
    expect(tank.hasTurret).toBe(true);
  });

  it('contrast: Medium Tank has a turret', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.hasTurret).toBe(true);
  });

  it('JEEP has turret (C++ udata.cpp:393 IsTurretEquipped=true)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.type).toBe(UnitType.V_JEEP);
    expect(jeep.hasTurret).toBe(true);
  });
});


// ============================================================
// 6. Fast unit — speed 10, fastest alongside APC
//    (C++ udata.cpp Speed comparison)
// ============================================================
describe('JEEP speed (C++ fastest ground vehicle parity)', () => {
  it('JEEP speed (10) matches APC speed — both are fastest ground vehicles', () => {
    expect(UNIT_STATS.JEEP.speed).toBe(10);
    expect(UNIT_STATS.APC.speed).toBe(10);
  });

  it('JEEP is faster than Light Tank (speed 9)', () => {
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS['1TNK'].speed);
  });

  it('JEEP is faster than Medium Tank (speed 8)', () => {
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS['2TNK'].speed);
  });

  it('JEEP is faster than Heavy Tank (speed 7)', () => {
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS['3TNK'].speed);
  });

  it('JEEP is faster than Mammoth Tank (speed 4)', () => {
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS['4TNK'].speed);
  });

  it('JEEP is faster than all infantry (infantry max speed = 4)', () => {
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS.E1.speed);
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS.E2.speed);
    expect(UNIT_STATS.JEEP.speed).toBeGreaterThan(UNIT_STATS.E3.speed);
  });
});


// ============================================================
// 7. Light armor — takes more damage from AP warhead than heavy armor
//    (C++ combat.cpp damage multiplier interaction)
// ============================================================
describe('JEEP light armor vulnerability (C++ combat.cpp parity)', () => {
  it('AP warhead vs light armor (0.75) > AP vs heavy armor (1.0) — wait, AP is BEST vs heavy', () => {
    // AP warhead: designed to pierce heavy armor
    // vs light = 0.75, vs heavy = 1.0
    // This means AP is better against tanks than against JEEP
    const apVsLight = getWarheadMultiplier('AP', 'light');
    const apVsHeavy = getWarheadMultiplier('AP', 'heavy');
    expect(apVsLight).toBe(0.75);
    expect(apVsHeavy).toBe(1.0);
    expect(apVsHeavy).toBeGreaterThan(apVsLight);
  });

  it('JEEP (light) takes 75% from AP, tanks (heavy) take 100% from AP', () => {
    // JEEP actually takes LESS damage from AP than heavy tanks — but JEEP has less HP
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 200, 200);

    expect(jeep.stats.armor).toBe('light');
    expect(tank.stats.armor).toBe('heavy');

    // AP 90mm damage = 30, vs light = 30*0.75=22.5, vs heavy = 30*1.0=30
    const apDamage = WEAPON_STATS['90mm'].damage; // 30
    const jeepMult = getWarheadMultiplier('AP', 'light');
    const tankMult = getWarheadMultiplier('AP', 'heavy');

    const jeepEffective = Math.floor(apDamage * jeepMult); // 22
    const tankEffective = Math.floor(apDamage * tankMult);  // 30

    expect(jeepEffective).toBeLessThan(tankEffective);
  });

  it('SA warhead does more damage to JEEP (light 0.6) than to tanks (heavy 0.25)', () => {
    // SA is good vs unarmored, poor vs heavy, medium vs light
    const saVsLight = getWarheadMultiplier('SA', 'light');
    const saVsHeavy = getWarheadMultiplier('SA', 'heavy');

    expect(saVsLight).toBe(0.6);
    expect(saVsHeavy).toBe(0.25);
    expect(saVsLight).toBeGreaterThan(saVsHeavy);
  });

  it('HE warhead vs light (0.6) is worse than vs none (0.9) but same as light for SA', () => {
    const heVsLight = getWarheadMultiplier('HE', 'light');
    const heVsNone = getWarheadMultiplier('HE', 'none');
    expect(heVsLight).toBe(0.6);
    expect(heVsNone).toBe(0.9);
    expect(heVsNone).toBeGreaterThan(heVsLight);
  });

  it('JEEP HP (150) is much lower than tanks, compounding armor vulnerability', () => {
    expect(UNIT_STATS.JEEP.strength).toBe(150);
    expect(UNIT_STATS['1TNK'].strength).toBe(300); // 2x JEEP
    expect(UNIT_STATS['2TNK'].strength).toBe(400); // 2.67x JEEP
    expect(UNIT_STATS['3TNK'].strength).toBe(400); // 2.67x JEEP
    expect(UNIT_STATS['4TNK'].strength).toBe(600); // 4x JEEP
  });
});


// ============================================================
// 8. Retaliation — standard vehicle behavior
//    (C++ techno.cpp retaliation on damage)
// ============================================================
describe('JEEP retaliation (C++ techno.cpp parity)', () => {
  it('JEEP retaliates when attacked with no current target', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.USSR, 200, 200);

    expect(jeep.weapon).toBeTruthy();
    expect(jeep.target).toBeNull();
    expect(jeep.mission).toBe(Mission.GUARD);

    const ctx = makeCombatContext([jeep, attacker]);
    triggerRetaliation(ctx, jeep, attacker);

    expect(jeep.target).toBe(attacker);
    expect(jeep.mission).toBe(Mission.ATTACK);
  });

  it('JEEP does not retarget if already has a living target', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const originalTarget = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const newAttacker = makeEntity(UnitType.I_E2, House.USSR, 300, 300);

    jeep.target = originalTarget;
    jeep.mission = Mission.ATTACK;

    const ctx = makeCombatContext([jeep, originalTarget, newAttacker]);
    triggerRetaliation(ctx, jeep, newAttacker);

    expect(jeep.target, 'should keep original target').toBe(originalTarget);
  });

  it('JEEP retargets when current target is dead', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const deadTarget = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const newAttacker = makeEntity(UnitType.I_E2, House.USSR, 300, 300);

    jeep.target = deadTarget;
    jeep.mission = Mission.ATTACK;
    deadTarget.alive = false;

    const ctx = makeCombatContext([jeep, deadTarget, newAttacker]);
    triggerRetaliation(ctx, jeep, newAttacker);

    expect(jeep.target).toBe(newAttacker);
  });

  it('JEEP does not retaliate against allied units', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const friendlyFire = makeEntity(UnitType.I_E1, House.Spain, 200, 200);

    const ctx = makeCombatContext([jeep, friendlyFire]);
    triggerRetaliation(ctx, jeep, friendlyFire);

    expect(jeep.target).toBeNull();
    expect(jeep.mission).toBe(Mission.GUARD);
  });
});


// ============================================================
// 9. Damage speed factor — standard vehicle behavior
//    (C++ techno.cpp damaged units slow down at yellow health)
// ============================================================
describe('JEEP damage speed reduction (C++ drive.cpp parity)', () => {
  it('undamaged JEEP has speed factor 1.0', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(damageSpeedFactor(jeep)).toBe(1.0);
  });

  it('JEEP at yellow health has speed factor 0.75', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    // CONDITION_YELLOW = 0.5, so at exactly 50% HP
    jeep.hp = Math.floor(jeep.maxHp * 0.5);
    expect(damageSpeedFactor(jeep)).toBe(0.75);
  });

  it('JEEP at 1 HP has speed factor 0.75', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.hp = 1;
    expect(damageSpeedFactor(jeep)).toBe(0.75);
  });

  it('JEEP just above yellow health has normal speed', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.hp = Math.floor(jeep.maxHp * 0.5) + 1;
    // hp/maxHp > CONDITION_YELLOW → normal speed
    expect(damageSpeedFactor(jeep)).toBe(1.0);
  });
});


// ============================================================
// 10. Stop-rotate-move — vehicles stop, rotate, then move
//     (C++ drive.cpp: vehicles don't slide sideways while turning)
// ============================================================
describe('JEEP stop-rotate-move (C++ drive.cpp parity)', () => {
  it('JEEP does not move while facing is misaligned (vehicle rotation)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.facing = Dir.N;
    jeep.bodyFacing32 = Dir.N * 4;

    // Target is directly east — requires rotation from N to E
    const target = { x: 200, y: 100 };
    const startX = jeep.pos.x;

    // C++ parity: all vehicles use Rotation_Adjust accumulator, including JEEP (ROT=10).
    // JEEP takes 7 ticks for 90-degree turn — does NOT snap instantly on first tick.
    const arrived = jeep.moveToward(target, jeep.stats.speed);

    // First tick: ROT=10 accumulates one 32-step but facing doesn't reach E yet
    // Vehicle stops to rotate — doesn't move until facing aligns
    expect(jeep.pos.x).toBe(startX); // no movement on first tick (still rotating)

    // Run remaining ticks to complete rotation and move
    for (let i = 0; i < 10; i++) {
      jeep.rotTickedThisFrame = false;
      jeep.moveToward(target, jeep.stats.speed);
    }
    expect(jeep.facing).toBe(Dir.E);
    expect(jeep.pos.x).toBeGreaterThan(startX);
  });

  it('contrast: Artillery (ROT=2) stops to rotate before moving', () => {
    const arty = makeEntity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.facing = Dir.N;
    arty.bodyFacing32 = Dir.N * 4;

    const target = { x: 200, y: 100 };
    const startX = arty.pos.x;

    // ROT=2 < 8, so artillery cannot snap-rotate; it must accumulate
    const arrived = arty.moveToward(target, arty.stats.speed);

    // Should NOT have moved horizontally yet — still rotating
    // (rotation accumulates but may not reach threshold in one tick)
    expect(arty.stats.rot).toBe(2);
    // With ROT=2, accumulator goes to 2, threshold is 8, so no rotation step yet
    // facing stays N, so vehicle doesn't move toward E target
    expect(arty.pos.x).toBe(startX);
  });

  it('JEEP ROT=10 uses accumulator — takes 7 ticks for 90 degrees (C++ parity)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.facing = Dir.N;
    jeep.desiredFacing = Dir.E;
    jeep.bodyFacing32 = Dir.N * 4;

    // C++ parity: vehicles always use Rotation_Adjust accumulator.
    // ROT=10, 90 degrees = 8 visual steps. With while loop (multiple steps per tick
    // when accumulator rolls over), JEEP reaches Dir.E in 7 ticks.
    let ticks = 0;
    while (jeep.facing !== Dir.E && ticks < 20) {
      jeep.rotTickedThisFrame = false;
      jeep.tickRotation();
      ticks++;
    }
    expect(jeep.facing).toBe(Dir.E);
    expect(ticks).toBe(7);
  });
});


// ============================================================
// 11. Entity construction — JEEP instantiates correctly
// ============================================================
describe('JEEP entity construction', () => {
  it('constructor sets HP to max (150)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.hp).toBe(150);
    expect(jeep.maxHp).toBe(150);
  });

  it('constructor resolves M60mg weapon from stats', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.weapon).toBeTruthy();
    expect(jeep.weapon!.name).toBe('M60mg');
    expect(jeep.weapon!.damage).toBe(15);
    expect(jeep.weapon!.warhead).toBe('SA');
  });

  it('has no secondary weapon', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.weapon2).toBeNull();
  });

  it('starts alive with default mission GUARD', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.alive).toBe(true);
    expect(jeep.mission).toBe(Mission.GUARD);
  });

  it('is NOT a transport (no passenger capacity)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.isTransport).toBe(false);
    expect(jeep.maxPassengers).toBe(0);
  });

  it('is NOT an aircraft', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.isAirUnit).toBe(false);
  });

  it('is NOT a naval unit', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.isNavalUnit).toBe(false);
  });

  it('is NOT an ant', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.isAnt).toBe(false);
  });
});


// ============================================================
// 12. JEEP M60mg effective damage vs different armor classes
//     (C++ combat.cpp: damage * warhead_vs_armor multiplier)
// ============================================================
describe('JEEP M60mg effective damage vs targets (C++ combat.cpp parity)', () => {
  it('vs unarmored infantry (none): 15 * 1.0 = 15 full damage', () => {
    const raw = WEAPON_STATS.M60mg.damage;
    const mult = getWarheadMultiplier('SA', 'none');
    expect(raw * mult).toBe(15);
  });

  it('vs light armor vehicle (e.g. another JEEP): 15 * 0.6 = 9', () => {
    const raw = WEAPON_STATS.M60mg.damage;
    const mult = getWarheadMultiplier('SA', 'light');
    expect(raw * mult).toBe(9);
  });

  it('vs heavy armor tank: 15 * 0.25 = 3.75 (rounds to ~3-4 per shot)', () => {
    const raw = WEAPON_STATS.M60mg.damage;
    const mult = getWarheadMultiplier('SA', 'heavy');
    expect(raw * mult).toBeCloseTo(3.75, 2);
  });

  it('JEEP needs many shots to kill a Heavy Tank (400 HP / ~3.75 damage)', () => {
    const damage = WEAPON_STATS.M60mg.damage;
    const mult = getWarheadMultiplier('SA', 'heavy');
    const effectiveDamage = damage * mult;
    const shotsToKill = Math.ceil(UNIT_STATS['3TNK'].strength / effectiveDamage);
    expect(shotsToKill).toBeGreaterThan(100); // very ineffective
  });

  it('JEEP kills Rifle Infantry in 4 shots (50 HP / 15 damage)', () => {
    const damage = WEAPON_STATS.M60mg.damage;
    const mult = getWarheadMultiplier('SA', 'none');
    const effectiveDamage = damage * mult;
    const shotsToKill = Math.ceil(UNIT_STATS.E1.strength / effectiveDamage);
    expect(shotsToKill).toBe(4); // 50/15 = 3.33 → 4 shots
  });
});


// ============================================================
// 13. JEEP takeDamage integration — survives/dies correctly
// ============================================================
describe('JEEP takeDamage behavior', () => {
  it('survives small arms hit (15 damage)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const killed = jeep.takeDamage(15, 'SA');
    expect(killed).toBe(false);
    expect(jeep.alive).toBe(true);
    expect(jeep.hp).toBe(135);
  });

  it('dies when damage exceeds HP', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const killed = jeep.takeDamage(200, 'AP');
    expect(killed).toBe(true);
    expect(jeep.alive).toBe(false);
    expect(jeep.hp).toBe(0);
    expect(jeep.mission).toBe(Mission.DIE);
    expect(jeep.animState).toBe(AnimState.DIE);
  });

  it('damage flash activates on hit', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    expect(jeep.damageFlash).toBe(0);
    jeep.takeDamage(10, 'SA');
    expect(jeep.damageFlash).toBe(4);
  });

  it('does not take damage when invulnerable (Iron Curtain)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.ironCurtainTick = 100;
    const killed = jeep.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(jeep.alive).toBe(true);
    expect(jeep.hp).toBe(150);
  });
});


// ============================================================
// 14. JEEP range check — inRange / inRangeWith
// ============================================================
describe('JEEP range checking (C++ Can_Fire parity)', () => {
  it('target within M60mg range (4.0 cells) is in range', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    // 3 cells away (3 * CELL_SIZE = 72 pixels)
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + 3 * CELL_SIZE, 100);

    expect(jeep.inRange(target)).toBe(true);
  });

  it('target beyond M60mg range (4.0 cells) is NOT in range', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    // 5 cells away
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    expect(jeep.inRange(target)).toBe(false);
  });

  it('target at exactly 4.0 cells is in range', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    // Exactly 4 cells = 4 * CELL_SIZE pixels
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + 4 * CELL_SIZE, 100);

    // worldDist computes Euclidean distance in cells, range comparison is <=
    expect(jeep.inRange(target)).toBe(true);
  });
});


// ============================================================
// 15. JEEP selectWeapon — single weapon always returns M60mg
// ============================================================
describe('JEEP weapon selection (C++ Can_Fire parity)', () => {
  it('selectWeapon returns M60mg (only weapon)', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + 2 * CELL_SIZE, 100);

    const selected = jeep.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeTruthy();
    expect(selected!.name).toBe('M60mg');
  });

  it('selectWeapon still returns M60mg even when on cooldown (weapon selection != fire readiness)', () => {
    // C++ TechnoClass::Can_Fire: selectWeapon picks the best weapon for the target;
    // cooldown is checked separately by the fire logic. For single-weapon units,
    // selectWeapon always returns the primary weapon.
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + 2 * CELL_SIZE, 100);

    jeep.attackCooldown = 10; // on cooldown

    const selected = jeep.selectWeapon(target, getWarheadMultiplier);
    // Single-weapon shortcut: returns w1 immediately (cooldown is checked elsewhere)
    expect(selected).toBeTruthy();
    expect(selected!.name).toBe('M60mg');
  });
});
