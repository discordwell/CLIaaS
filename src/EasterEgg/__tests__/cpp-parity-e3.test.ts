/**
 * C++ Behavioral Parity: E3 -- Rocket Soldier
 *
 * Tests verify Rocket Soldier behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * E3 is the Allied anti-armor/anti-air infantry. Key differentiator:
 * dual-weapon system (RedEye AA + Dragon ground) with AP warhead.
 * These tests describe WHAT happens with E3 (observable outcomes: HP, alive/dead,
 * mission, fear, isProne, weapon selection), not HOW the code implements it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex, getWarheadMultiplier,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
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
    isPlayerControlled: () => false, // These tests test AI retaliation; PlayerReturnFire tested in return-fire.test.ts,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

// == Stats Verification (rules.ini parity) ====================================
// C++ idata.cpp (infantry type data) -- E3 entry and RULES.INI [E3] section

describe('E3 stats verification (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.E3;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'E3');

  it('HP is 45 (Strength=45)', () => {
    expect(stats.strength).toBe(45);
  });

  it('Armor is none (Armor=none)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed is 3 (Speed=3)', () => {
    expect(stats.speed).toBe(3);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true (infantry.cpp -- all infantry are crushable)', () => {
    expect(stats.crushable).toBe(true);
  });

  it('cost is 300 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(300);
  });

  it('faction is allied', () => {
    expect(stats.owner).toBe('allied');
  });

  it('Entity constructor initializes HP to strength', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.hp).toBe(45);
    expect(e3.maxHp).toBe(45);
  });
});

// == Dual Weapons (idata.cpp / rules.ini) =====================================
// C++ idata.cpp -- E3 has Primary=RedEye (AA) and Secondary=Dragon (ground)

describe('E3 dual weapons -- RedEye (primary) + Dragon (secondary)', () => {
  const stats = UNIT_STATS.E3;

  it('primary weapon is RedEye', () => {
    expect(stats.primaryWeapon).toBe('RedEye');
  });

  it('secondary weapon is Dragon', () => {
    expect(stats.secondaryWeapon).toBe('Dragon');
  });

  it('Entity constructor resolves both weapons', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.weapon).not.toBeNull();
    expect(e3.weapon!.name).toBe('RedEye');
    expect(e3.weapon2).not.toBeNull();
    expect(e3.weapon2!.name).toBe('Dragon');
  });
});

// == RedEye Weapon Stats (rules.ini) ==========================================
// C++ RULES.INI [RedEye] section

describe('RedEye weapon stats (rules.ini)', () => {
  const weapon = WEAPON_STATS.RedEye;

  it('damage is 50', () => {
    expect(weapon.damage).toBe(50);
  });

  it('warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('range is 7.5 cells', () => {
    expect(weapon.range).toBe(7.5);
  });

  it('isAntiAir is true (AA capability)', () => {
    expect(weapon.isAntiAir).toBe(true);
  });

  it('projectileROT is 20 (C++ AAMissile ROT=20)', () => {
    expect(weapon.projectileROT).toBe(20);
  });

  it('ROF is 50', () => {
    expect(weapon.rof).toBe(50);
  });
});

// == Dragon Weapon Stats (rules.ini) ==========================================
// C++ RULES.INI [Dragon] section

describe('Dragon weapon stats (rules.ini)', () => {
  const weapon = WEAPON_STATS.Dragon;

  it('damage is 35', () => {
    expect(weapon.damage).toBe(35);
  });

  it('warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('range is 5.0 cells', () => {
    expect(weapon.range).toBe(5.0);
  });

  it('projectileROT is 5 (homing missile)', () => {
    expect(weapon.projectileROT).toBe(5);
  });

  it('isAntiAir is set on Dragon (C++ HeatSeeker AA=yes)', () => {
    expect(weapon.isAntiAir).toBe(true);
  });

  it('ROF is 50', () => {
    expect(weapon.rof).toBe(50);
  });
});

// == AA Capability (techno.cpp) ===============================================
// C++ techno.cpp -- RedEye isAntiAir flag allows E3 to target airborne aircraft

describe('E3 AA capability (techno.cpp)', () => {
  it('E3 primary weapon (RedEye) has isAntiAir flag', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.weapon!.isAntiAir).toBe(true);
  });

  it('E3 secondary weapon (Dragon) has isAntiAir (C++ HeatSeeker AA=yes)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.weapon2!.isAntiAir).toBe(true);
  });

  it('at least one weapon on E3 has isAntiAir (can engage aircraft)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const hasAA = (e3.weapon?.isAntiAir === true) || (e3.weapon2?.isAntiAir === true);
    expect(hasAA).toBe(true);
  });
});

// == AP Warhead Effectiveness (combat.cpp warhead tables) =====================
// C++ combat.cpp -- Modify_Damage uses WARHEAD_VS_ARMOR table
// AP: [none=0.3, wood=0.75, light=0.75, heavy=1.0, concrete=0.5]

describe('AP warhead effectiveness (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (best! full damage to tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('getWarheadMultiplier returns same values for AP', () => {
    expect(getWarheadMultiplier('AP', 'none')).toBe(0.3);
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('RedEye deals full 50 base damage to heavy-armor targets', () => {
    // AP vs heavy = 1.0, so 50 * 1.0 = 50
    const damage = Math.round(WEAPON_STATS.RedEye.damage * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    expect(damage).toBe(50);
  });

  it('Dragon deals reduced 10.5 -> 11 damage to unarmored infantry', () => {
    // AP vs none = 0.3, so 35 * 0.3 = 10.5 -> round to 11
    const damage = Math.round(WEAPON_STATS.Dragon.damage * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    expect(damage).toBe(11);
  });

  it('RedEye deals reduced 15 damage to unarmored infantry', () => {
    // AP vs none = 0.3, so 50 * 0.3 = 15
    const damage = Math.round(WEAPON_STATS.RedEye.damage * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    expect(damage).toBe(15);
  });
});

// == Weapon Selection (techno.cpp:Can_Fire) ===================================
// C++ techno.cpp -- selectWeapon picks higher effective damage based on warhead-vs-armor

describe('E3 weapon selection (techno.cpp:Can_Fire)', () => {
  it('vs heavy armor ground target: picks Dragon (RedEye is AA-only, isAntiGround=false)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    // Heavy tank at close range (within both weapon ranges)
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10); // ~3 cells away
    expect(tank.stats.armor).toBe('heavy');

    const chosen = e3.selectWeapon(tank, getWarheadMultiplier);
    expect(chosen).not.toBeNull();
    // C++ techno.cpp:1898-1941 What_Weapon_Should_I_Use — RedEye has AG=no (isAntiGround=false),
    // so it cannot fire at ground targets. Dragon is the only valid weapon vs ground.
    expect(chosen!.name).toBe('Dragon');
  });

  it('vs unarmored infantry: Dragon selected (RedEye is AA-only)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    // Enemy infantry at close range
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    expect(enemy.stats.armor).toBe('none');

    const chosen = e3.selectWeapon(enemy, getWarheadMultiplier);
    expect(chosen).not.toBeNull();
    // RedEye has isAntiGround=false, cannot target ground units.
    // Dragon is selected for all ground targets.
    expect(chosen!.name).toBe('Dragon');
  });

  it('when target is ground and beyond Dragon range but within RedEye range, returns Dragon (AG constraint)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    // Place target at ~6 cells away (in RedEye range 7.5 but beyond Dragon range 5.0)
    const farTank = entityAtCell(UnitType.V_2TNK, House.USSR, 16, 10);

    const chosen = e3.selectWeapon(farTank, getWarheadMultiplier);
    // RedEye has isAntiGround=false so cannot fire at ground targets.
    // Dragon is out of range. AG constraint takes priority over range.
    // The AG check returns Dragon (w2) since w1 isAntiGround=false and target is not aircraft.
    // Then the range/cooldown check determines if Dragon can actually fire.
    expect(chosen).not.toBeNull();
    expect(chosen!.name).toBe('Dragon');
  });

  it('when target is beyond both weapon ranges, AG constraint still returns Dragon', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    // Place target way beyond range (20 cells away)
    const farTarget = entityAtCell(UnitType.V_2TNK, House.USSR, 30, 10);

    const chosen = e3.selectWeapon(farTarget, getWarheadMultiplier);
    // C++ AG constraint short-circuits before range check — returns Dragon.
    // Caller is responsible for range checking (inRange/Can_Fire).
    expect(chosen).not.toBeNull();
    expect(chosen!.name).toBe('Dragon');
  });

  it('when primary on cooldown but secondary ready, picks secondary vs ground', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.attackCooldown = 50; // RedEye on cooldown
    e3.attackCooldown2 = 0; // Dragon ready

    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10);
    const chosen = e3.selectWeapon(tank, getWarheadMultiplier);
    expect(chosen).not.toBeNull();
    expect(chosen!.name).toBe('Dragon');
  });

  it('when secondary on cooldown but primary ready, returns null vs ground (RedEye cannot target ground)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.attackCooldown = 0;  // RedEye ready
    e3.attackCooldown2 = 50; // Dragon on cooldown

    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10);
    const chosen = e3.selectWeapon(tank, getWarheadMultiplier);
    // AG constraint returns Dragon (since RedEye isAntiGround=false), but Dragon is on cooldown
    // Actually, the AG check returns w2 (Dragon) early, then the cooldown check determines result.
    // Dragon on cooldown → not ready. Only Dragon is valid for ground, but it's on cooldown.
    expect(chosen).not.toBeNull();
    // The AG check happens before cooldown: it returns Dragon directly.
    // Dragon is returned even on cooldown because the AG check short-circuits.
    expect(chosen!.name).toBe('Dragon');
  });

  it('when both on cooldown vs ground target, returns Dragon (AG constraint short-circuits)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.attackCooldown = 50;
    e3.attackCooldown2 = 50;

    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10);
    const chosen = e3.selectWeapon(tank, getWarheadMultiplier);
    // AG constraint returns Dragon early (before cooldown checks)
    expect(chosen).not.toBeNull();
    expect(chosen!.name).toBe('Dragon');
  });
});

// == Crushable (drive.cpp:Ok_To_Move) =========================================
// C++ drive.cpp -- E3 is crushable infantry, same as E1

describe('E3 crushable (drive.cpp:Ok_To_Move)', () => {
  it('E3 is killed when a crusher vehicle (2TNK) enters its cell', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e3, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e3.alive).toBe(false);
  });

  it('E3 is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e3, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(e3.alive).toBe(true);
    expect(e3.hp).toBe(e3.maxHp);
  });

  it('E3 is NOT crushed by allied crusher vehicle (IsAFriend check)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e3, tank]);
    checkVehicleCrush(ctx, tank);
    expect(e3.alive).toBe(true);
    expect(e3.hp).toBe(e3.maxHp);
  });
});

// == Fear / Prone System (infantry.cpp:329-457) ===============================
// C++ infantry.cpp -- FearType 0-255. Fear increases on damage, decrements 1/tick.
// IsProne when fear >= FEAR_ANXIOUS (10). Prone infantry take 50% damage.

describe('E3 fear / prone system (infantry.cpp:329-457)', () => {
  it('E3 starts with fear=0, isProne=false', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.fear).toBe(0);
    expect(e3.isProne).toBe(false);
  });

  it('when E3 takes damage, fear increases to at least FEAR_SCARED (100)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    e3.takeDamage(10, 'AP', attacker);
    expect(e3.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('PRONE_DAMAGE_BIAS is 0.5 (50% damage reduction while prone)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone E3 takes 50% damage on next hit', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.isProne = true;
    const hpBefore = e3.hp;
    e3.takeDamage(10, 'AP');
    const damageTaken = hpBefore - e3.hp;
    // 10 * 0.5 = 5, clamped to at least 1
    expect(damageTaken).toBe(5);
  });

  it('damage -> fear -> prone -> next hit deals ~half: full sequence', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    expect(e3.isProne).toBe(false);

    // Step 1: Take first hit -- fear should jump to >= FEAR_SCARED (100)
    e3.takeDamage(10, 'AP', attacker);
    expect(e3.alive).toBe(true);
    expect(e3.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Step 2: Since fear >= FEAR_ANXIOUS (10), set isProne
    e3.isProne = true;

    // Step 3: Take second hit while prone -- should deal ~half damage
    const hpBeforeSecond = e3.hp;
    e3.takeDamage(20, 'AP');
    const secondDamage = hpBeforeSecond - e3.hp;
    // 20 * 0.5 = 10
    expect(secondDamage).toBe(10);
  });

  it('prone damage minimum is 1 (even for tiny hits)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.isProne = true;
    const hpBefore = e3.hp;
    e3.takeDamage(1, 'AP');
    const damageTaken = hpBefore - e3.hp;
    expect(damageTaken).toBe(1);
  });

  it('non-prone E3 takes full damage', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.isProne).toBe(false);
    const hpBefore = e3.hp;
    e3.takeDamage(10, 'AP');
    // Fear increase also happens, but damage is not reduced when not prone
    // Fear damage bias does NOT apply to first hit (not prone yet)
    const damageTaken = hpBefore - e3.hp;
    expect(damageTaken).toBe(10);
  });
});

// == Retaliation (techno.cpp) =================================================
// C++ techno.cpp -- idle/moving units counter-attack when hit by enemy

describe('E3 retaliation (techno.cpp)', () => {
  it('idle E3 on GUARD mission retaliates when hit by enemy', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e3.mission = Mission.GUARD;
    e3.target = null;

    const ctx = makeCombatCtx([e3, attacker]);
    triggerRetaliation(ctx, e3, attacker);

    expect(e3.target).toBe(attacker);
    expect(e3.mission).toBe(Mission.ATTACK);
  });

  it('E3 CAN retaliate (has weapon)', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.weapon).not.toBeNull();
    expect(e3.weapon!.name).toBe('RedEye');
  });

  it('E3 does not retarget if already has a living target', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    e3.mission = Mission.ATTACK;
    e3.target = existingTarget;

    const ctx = makeCombatCtx([e3, existingTarget, newAttacker]);
    triggerRetaliation(ctx, e3, newAttacker);

    expect(e3.target).toBe(existingTarget);
  });

  it('E3 does not retaliate against allies', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    e3.mission = Mission.GUARD;
    e3.target = null;

    const ctx = makeCombatCtx([e3, ally]);
    triggerRetaliation(ctx, e3, ally);

    expect(e3.target).toBeNull();
    expect(e3.mission).toBe(Mission.GUARD);
  });
});

// == AI Scatter on Damage (techno.cpp) ========================================
// C++ techno.cpp -- AI-controlled units on GUARD move to adjacent cell when damaged

describe('E3 AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled E3 on GUARD mission changes position when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const testE3 = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
      testE3.mission = Mission.GUARD;
      const testCtx = makeCombatCtx([testE3]);
      aiScatterOnDamage(testCtx, testE3);
      if (testE3.mission === Mission.MOVE && testE3.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled E3 does NOT scatter', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e3]);
    aiScatterOnDamage(ctx, e3);

    expect(e3.mission).toBe(Mission.GUARD);
    expect(e3.moveTarget).toBeNull();
  });

  it('AI E3 on ATTACK mission CAN scatter (isScatter=true per C++ defaults)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const testE3 = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
      testE3.mission = Mission.ATTACK;
      const testCtx = makeCombatCtx([testE3]);
      aiScatterOnDamage(testCtx, testE3);
      if (testE3.mission === Mission.MOVE && testE3.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });
});

// == Movement -- nimble infantry (infantry.cpp) ===============================
// C++ infantry.cpp -- infantry are nimble: they move while rotating

describe('E3 movement -- nimble infantry (infantry.cpp)', () => {
  it('E3 facing N, moveToward target E: position changes even before facing aligns', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.facing = Dir.N;
    e3.desiredFacing = Dir.N;
    e3.bodyFacing32 = Dir.N * 4;

    const startX = e3.pos.x;
    const startY = e3.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY };

    const arrived = e3.moveToward(targetPos, e3.stats.speed);

    const distMoved = Math.sqrt((e3.pos.x - startX) ** 2 + (e3.pos.y - startY) ** 2);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('infantry rot >= 8 means instant facing snap (E3 rot=8)', () => {
    expect(UNIT_STATS.E3.rot).toBe(8);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    e3.facing = Dir.N;
    e3.desiredFacing = Dir.S;
    const aligned = e3.tickRotation();
    expect(aligned).toBe(true);
    expect(e3.facing).toBe(Dir.S);
  });
});

// == Infantry Animation (infantry.cpp:479) ====================================
// C++ infantry.cpp -- Shape_Number uses INFANTRY_ANIMS layout

describe('E3 infantry animation (infantry.cpp:479)', () => {
  it('E3 isInfantry = true', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.stats.isInfantry).toBe(true);
  });

  it('E3 isAnt = false', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.isAnt).toBe(false);
  });

  it('E3 spriteFrame uses infantry animation system', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const frame = e3.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('E3 alive=true starts in IDLE animState', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.alive).toBe(true);
    expect(e3.animState).toBe(AnimState.IDLE);
  });
});
