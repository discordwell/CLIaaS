/**
 * C++ Behavioral Parity: MSUB — Missile Submarine (Aftermath)
 *
 * Tests verify Missile Submarine behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MSUB (observable outcomes: HP, alive/dead,
 * cloak state, targeting, turret, burst fire, warhead effectiveness, range),
 * not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from '../engine/entity';
import {
  type CombatContext,
  triggerRetaliation,
  aiScatterOnDamage,
} from '../engine/combat';
import { canTargetNaval } from '../engine/aircraft';
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
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
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

// == Stats Verification (vdata.cpp / rules.ini) ===============================
// C++ vdata.cpp (vessel type data) -- MSUB entry and RULES.INI [MSUB] section

describe('MSUB stats verification (vdata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MSUB;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MSUB');

  it('HP is 150 (Strength=150)', () => {
    expect(stats.strength).toBe(150);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 5 (Speed=5)', () => {
    expect(stats.speed).toBe(5);
  });

  it('isVessel is true (naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('isInfantry is false (vessel)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('isCloakable is true (submarine stealth)', () => {
    expect(stats.isCloakable).toBe(true);
  });

  it('primary weapon is SubSCUD', () => {
    expect(stats.primaryWeapon).toBe('SubSCUD');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('ROT is 7 (rotation rate)', () => {
    expect(stats.rot).toBe(7);
  });

  it('sight is 6', () => {
    expect(stats.sight).toBe(6);
  });

  it('cost is 1650 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1650);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hp).toBe(150);
    expect(msub.maxHp).toBe(150);
  });

  it('Entity isNavalUnit is true', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.isNavalUnit).toBe(true);
  });
});

// == Weapon -- SubSCUD (weapon.cpp / rules.ini) ===============================
// C++ weapon.cpp -- SubSCUD entry: HE warhead, 400 damage, range 14.0, burst 2

describe('MSUB weapon -- SubSCUD (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.SubSCUD;

  it('SubSCUD warhead is HE', () => {
    expect(weapon.warhead).toBe('HE');
  });

  it('SubSCUD damage is 400', () => {
    expect(weapon.damage).toBe(400);
  });

  it('SubSCUD range is 14.0 cells', () => {
    expect(weapon.range).toBe(14.0);
  });

  it('SubSCUD burst is 2 (fires 2 missiles per volley)', () => {
    expect(weapon.burst).toBe(2);
  });

  it('SubSCUD ROF is 120 (reload time between volleys)', () => {
    expect(weapon.rof).toBe(120);
  });

  it('SubSCUD projectileROT is 5 (homing missile)', () => {
    expect(weapon.projectileROT).toBe(5);
  });

  it('SubSCUD projectileSpeed is 2.0', () => {
    expect(weapon.projectileSpeed).toBe(2.0);
  });

  it('SubSCUD is NOT isSubSurface (not a torpedo -- can target land)', () => {
    expect(weapon.isSubSurface).toBeUndefined();
  });

  it('Entity weapon is resolved to SubSCUD stats', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon).not.toBeNull();
    expect(msub.weapon!.name).toBe('SubSCUD');
    expect(msub.weapon!.damage).toBe(400);
  });

  it('Entity has no secondary weapon', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon2).toBeNull();
  });
});

// == SubSCUD vs SS TorpTube: Land Targeting Difference ========================
// C++ weapon.cpp -- TorpTube has isSubSurface=true (torpedo-only, naval targets only).
// SubSCUD does NOT have isSubSurface -- MSUB can target land AND naval.

describe('MSUB vs SS: SubSCUD can target land units unlike TorpTube (weapon.cpp)', () => {
  const torpTube = WEAPON_STATS.TorpTube;
  const subSCUD = WEAPON_STATS.SubSCUD;

  it('SS TorpTube IS isSubSurface (torpedo, naval-only)', () => {
    expect(torpTube.isSubSurface).toBe(true);
  });

  it('MSUB SubSCUD is NOT isSubSurface (missile, can hit land)', () => {
    expect(subSCUD.isSubSurface).toBeFalsy();
  });

  it('canTargetNaval: SS with torpedo-only weapon cannot target land unit', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    const landUnit = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    // SS has TorpTube (isSubSurface) and no secondary -- cannot target non-vessel
    expect(canTargetNaval(ss, landUnit)).toBe(false);
  });

  it('canTargetNaval: MSUB with SubSCUD CAN target land unit', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const landUnit = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    // MSUB has SubSCUD (NOT isSubSurface) -- can target anything
    expect(canTargetNaval(msub, landUnit)).toBe(true);
  });

  it('canTargetNaval: MSUB can target naval unit', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 12, 10);
    expect(canTargetNaval(msub, dd)).toBe(true);
  });

  it('canTargetNaval: MSUB can target infantry (structures aside)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    expect(canTargetNaval(msub, inf)).toBe(true);
  });
});

// == HE Warhead Effectiveness (combat.cpp warhead tables) =====================
// C++ combat.cpp -- Modify_Damage uses WARHEAD_VS_ARMOR table

describe('MSUB weapon effectiveness -- HE warhead (combat.cpp warhead tables)', () => {
  it('HE vs none armor: mult 0.9 (good vs infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('HE vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('HE vs heavy armor: mult 0.25 (poor vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs concrete: mult 1.0 (great vs structures)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('MSUB deals 400 * 1.0 = 400 effective damage vs concrete (structure-killer)', () => {
    const baseDamage = 400;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('concrete')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(400);
  });

  it('MSUB deals 400 * 0.25 = 100 effective damage vs heavy armor', () => {
    const baseDamage = 400;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(100);
  });

  it('MSUB deals 400 * 0.6 = 240 effective damage vs light armor', () => {
    const baseDamage = 400;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(240);
  });

  it('MSUB deals 400 * 0.9 = 360 effective damage vs unarmored infantry', () => {
    const baseDamage = 400;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    const effective = Math.round(baseDamage * mult);
    expect(effective).toBe(360);
  });
});

// == Massive Range -- 14.0 Cells (vdata.cpp / rules.ini) ======================
// C++ rules.ini -- SubSCUD range=14 cells. Outranges everything except Cruiser (8Inch).

describe('MSUB massive range -- 14.0 cells (rules.ini)', () => {
  it('SubSCUD range is 14.0 cells', () => {
    expect(WEAPON_STATS.SubSCUD.range).toBe(14.0);
  });

  it('MSUB outranges Destroyer Stinger (range 9.0)', () => {
    expect(WEAPON_STATS.SubSCUD.range).toBeGreaterThan(WEAPON_STATS.Stinger.range);
  });

  it('MSUB outranges SS TorpTube (range 9.0)', () => {
    expect(WEAPON_STATS.SubSCUD.range).toBeGreaterThan(WEAPON_STATS.TorpTube.range);
  });

  it('MSUB outranges Cruiser 8Inch (range 22.0) — FALSE, 8Inch has 22.0 vs SubSCUD 14.0', () => {
    // CA's 8Inch actually outranges MSUB's SubSCUD (22.0 vs 14.0)
    expect(WEAPON_STATS['8Inch'].range).toBeGreaterThan(WEAPON_STATS.SubSCUD.range);
  });

  it('target at 13 cells is in range', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 5, 10);
    const target = entityAtCell(UnitType.V_DD, House.Spain, 18, 10);
    // 13 cells apart, SubSCUD range is 14.0
    expect(msub.inRange(target)).toBe(true);
  });

  it('target at 15 cells is out of range', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 5, 10);
    const target = entityAtCell(UnitType.V_DD, House.Spain, 20, 10);
    // 15 cells apart, SubSCUD range is 14.0
    expect(msub.inRange(target)).toBe(false);
  });
});

// == Burst Fire (weapon.cpp:78 Weapon.Burst) ==================================
// C++ weapon.cpp -- burst=2 means two shots per trigger pull

describe('MSUB burst fire -- SubSCUD burst=2 (weapon.cpp:78)', () => {
  it('burstCount starts at 0 (no active burst)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.burstCount).toBe(0);
  });

  it('burstDelay starts at 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.burstDelay).toBe(0);
  });

  it('weapon burst value is 2', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon!.burst).toBe(2);
  });

  it('setting burstCount to burst-1 simulates first shot fired, one remaining', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.burstCount = msub.weapon!.burst! - 1;
    expect(msub.burstCount).toBe(1);
  });

  it('burstCount decrements to 0 after second shot (volley complete)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.burstCount = 1; // one shot remaining
    msub.burstCount--;
    expect(msub.burstCount).toBe(0);
  });
});

// == Cloaking -- Submarine Stealth (techno.cpp / entity.ts) ===================
// C++ techno.cpp -- isCloakable flag enables cloak state machine.
// MSUB cloaks like SS -- same state machine (UNCLOAKED -> CLOAKING -> CLOAKED -> UNCLOAKING).

describe('MSUB cloaking -- submarine stealth (techno.cpp)', () => {
  it('stats.isCloakable is true', () => {
    expect(UNIT_STATS.MSUB.isCloakable).toBe(true);
  });

  it('entity starts UNCLOAKED', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('cloakTimer starts at 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.cloakTimer).toBe(0);
  });

  it('sonarPulseTimer starts at 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.sonarPulseTimer).toBe(0);
  });

  it('cloak transition takes CLOAK_TRANSITION_FRAMES (38) ticks', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKING;
    msub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      msub.cloakTimer--;
    }
    if (msub.cloakTimer <= 0) msub.cloakState = CloakState.CLOAKED;

    expect(msub.cloakState).toBe(CloakState.CLOAKED);
    expect(msub.cloakTimer).toBe(0);
  });

  it('taking damage force-uncloaks from CLOAKED state', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;
    msub.cloakTimer = 0;

    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(msub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('taking damage force-uncloaks from CLOAKING state', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKING;
    msub.cloakTimer = 20;

    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(msub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('CloakState enum values match C++ CLOAK_STAGES (0-3)', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('SONAR_PULSE_DURATION is 225 frames (15 seconds at 15 FPS)', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('MSUB is a vessel (submarine cloak, not vehicle cloak like STNK)', () => {
    expect(UNIT_STATS.MSUB.isVessel).toBe(true);
  });
});

// == canTargetNaval -- Cloaked MSUB Visibility (aircraft.ts) ===================
// C++ techno.cpp -- cloaked subs invisible to non-antiSub, visible to antiSub (DD)

describe('MSUB cloaked visibility -- canTargetNaval (techno.cpp / aircraft.ts)', () => {
  it('cloaked MSUB is invisible to non-antiSub unit (e.g. Cruiser)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.CLOAKED;

    expect(canTargetNaval(ca, msub)).toBe(false);
  });

  it('cloaked MSUB is invisible when CLOAKING (transition state)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.CLOAKING;

    expect(canTargetNaval(ca, msub)).toBe(false);
  });

  it('cloaked MSUB IS visible to antiSub unit (Destroyer)', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.CLOAKED;

    // DD has Stinger (primary) and DepthCharge (secondary, isAntiSub)
    expect(dd.weapon2?.isAntiSub).toBe(true);
    expect(canTargetNaval(dd, msub)).toBe(true);
  });

  it('uncloaked MSUB is visible to everyone', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.UNCLOAKED;

    expect(canTargetNaval(ca, msub)).toBe(true);
  });

  it('UNCLOAKING MSUB is visible to everyone (not cloaked or cloaking)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.UNCLOAKING;

    expect(canTargetNaval(ca, msub)).toBe(true);
  });

  it('Gunboat (PT) with DepthCharge can see cloaked MSUB', () => {
    const pt = entityAtCell(UnitType.V_PT, House.Spain, 10, 10);
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 12, 10);
    msub.cloakState = CloakState.CLOAKED;

    // PT has DepthCharge as secondary (isAntiSub)
    expect(canTargetNaval(pt, msub)).toBe(true);
  });
});

// == No Turret (vdata.cpp exclusion list) =====================================
// C++ vdata.cpp -- MSUB is in the non-turreted exclusion list in entity.ts

describe('MSUB no turret (vdata.cpp exclusion list)', () => {
  it('hasTurret is false', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hasTurret).toBe(false);
  });

  it('MSUB is not infantry (confirmed vessel without turret)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.stats.isInfantry).toBe(false);
    expect(msub.isAnt).toBe(false);
  });

  it('non-turreted vessel uses body facing for sprite (not separate turret frame)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const frame = msub.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('Destroyer (DD) HAS turret for comparison', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.hasTurret).toBe(true);
  });

  it('SS also has no turret (same as MSUB)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hasTurret).toBe(false);
  });
});

// == MSUB vs SS Comparison (Aftermath expansion content) ======================
// MSUB is the Aftermath-expansion upgrade to the SS. Key differences documented.

describe('MSUB vs SS comparison (Aftermath expansion)', () => {
  const msubStats = UNIT_STATS.MSUB;
  const ssStats = UNIT_STATS.SS;

  it('MSUB has higher HP than SS (150 vs 120)', () => {
    expect(msubStats.strength).toBe(150);
    expect(ssStats.strength).toBe(120);
    expect(msubStats.strength).toBeGreaterThan(ssStats.strength);
  });

  it('MSUB has higher damage than SS (400 vs 90)', () => {
    expect(WEAPON_STATS.SubSCUD.damage).toBe(400);
    expect(WEAPON_STATS.TorpTube.damage).toBe(90);
  });

  it('MSUB has longer range than SS (14.0 vs 9.0)', () => {
    expect(WEAPON_STATS.SubSCUD.range).toBe(14.0);
    expect(WEAPON_STATS.TorpTube.range).toBe(9.0);
  });

  it('both are cloakable vessels', () => {
    expect(msubStats.isCloakable).toBe(true);
    expect(ssStats.isCloakable).toBe(true);
    expect(msubStats.isVessel).toBe(true);
    expect(ssStats.isVessel).toBe(true);
  });

  it('both have light armor', () => {
    expect(msubStats.armor).toBe('light');
    expect(ssStats.armor).toBe('light');
  });

  it('MSUB costs more than SS (1650 vs 950)', () => {
    const msubProd = PRODUCTION_ITEMS.find(p => p.type === 'MSUB');
    const ssProd = PRODUCTION_ITEMS.find(p => p.type === 'SS');
    expect(msubProd!.cost).toBe(1650);
    expect(ssProd!.cost).toBe(950);
    expect(msubProd!.cost).toBeGreaterThan(ssProd!.cost);
  });

  it('SS torpedo is submarine-only (isSubSurface), MSUB missile is NOT', () => {
    expect(WEAPON_STATS.TorpTube.isSubSurface).toBe(true);
    expect(WEAPON_STATS.SubSCUD.isSubSurface).toBeFalsy();
  });

  it('MSUB has same speed as SS (both speed 5... wait, SS is 6)', () => {
    // SS is actually speed 6, MSUB is speed 5
    expect(msubStats.speed).toBe(5);
    expect(ssStats.speed).toBe(6);
    expect(msubStats.speed).toBeLessThan(ssStats.speed);
  });
});

// == Damage-Induced Uncloak Interaction (entity.ts takeDamage + cloak) ========
// C++ techno.cpp -- cloaked units forced to uncloak when taking damage

describe('MSUB damage-cloak interaction (techno.cpp / entity.ts)', () => {
  it('cloaked MSUB forced to UNCLOAKING state on any damage', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;

    msub.takeDamage(1, 'SA');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('lethal damage on cloaked MSUB kills it (does not remain cloaked-alive)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;

    const killed = msub.takeDamage(999, 'AP');
    expect(killed).toBe(true);
    expect(msub.alive).toBe(false);
    expect(msub.hp).toBe(0);
  });

  it('MSUB in UNCLOAKED state stays UNCLOAKED after damage (no state change)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKED;

    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('MSUB in UNCLOAKING state stays UNCLOAKING after additional damage', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKING;
    msub.cloakTimer = 20;

    msub.takeDamage(10, 'AP');
    // Already uncloaking -- stays in that state (timer resets to full)
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
  });
});

// == Death State (entity.ts) ==================================================
// C++ unit.cpp -- death sets mission=DIE, animState=DIE

describe('MSUB death state (unit.cpp / entity.ts)', () => {
  it('MSUB sets death state correctly on kill', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.takeDamage(300, 'HE');

    expect(msub.alive).toBe(false);
    expect(msub.hp).toBe(0);
    expect(msub.mission).toBe(Mission.DIE);
    expect(msub.animState).toBe(AnimState.DIE);
    expect(msub.animFrame).toBe(0);
  });

  it('MSUB survives sub-lethal damage', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.takeDamage(149, 'HE');

    expect(msub.alive).toBe(true);
    expect(msub.hp).toBe(1);
    expect(msub.mission).not.toBe(Mission.DIE);
  });

  it('MSUB dies at exactly 150 damage (equal to max HP)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const killed = msub.takeDamage(150, 'HE');

    expect(killed).toBe(true);
    expect(msub.alive).toBe(false);
    expect(msub.hp).toBe(0);
  });

  it('invulnerable MSUB (Iron Curtain) takes no damage', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.ironCurtainTick = 100; // Iron Curtain active

    const killed = msub.takeDamage(999, 'AP');
    expect(killed).toBe(false);
    expect(msub.alive).toBe(true);
    expect(msub.hp).toBe(150);
  });
});

// == Retaliation (techno.cpp) =================================================
// C++ techno.cpp -- idle/moving units counter-attack when hit by enemy

describe('MSUB retaliation (techno.cpp)', () => {
  it('idle MSUB on GUARD mission retaliates when hit by enemy', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    msub.mission = Mission.GUARD;
    msub.target = null;

    const ctx = makeCombatCtx([msub, attacker]);
    triggerRetaliation(ctx, msub, attacker);

    expect(msub.target).toBe(attacker);
    expect(msub.mission).toBe(Mission.ATTACK);
  });

  it('MSUB CAN retaliate (has SubSCUD weapon)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon).not.toBeNull();
    expect(msub.weapon!.name).toBe('SubSCUD');
  });

  it('MSUB does not retarget if already has a living target', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.V_DD, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    msub.mission = Mission.ATTACK;
    msub.target = existingTarget;

    const ctx = makeCombatCtx([msub, existingTarget, newAttacker]);
    triggerRetaliation(ctx, msub, newAttacker);

    expect(msub.target).toBe(existingTarget);
  });

  it('MSUB does not retaliate against allies', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.V_DD, House.Ukraine, 11, 10);
    msub.mission = Mission.GUARD;
    msub.target = null;

    const ctx = makeCombatCtx([msub, ally]);
    triggerRetaliation(ctx, msub, ally);

    expect(msub.target).toBeNull();
    expect(msub.mission).toBe(Mission.GUARD);
  });
});

// == AI Scatter on Damage (techno.cpp) ========================================
// C++ techno.cpp -- AI-controlled units on GUARD move to adjacent cell when damaged

describe('MSUB AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MSUB on GUARD mission changes position when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
      msub.mission = Mission.GUARD;
      const ctx = makeCombatCtx([msub]);
      aiScatterOnDamage(ctx, msub);
      if (msub.mission === Mission.MOVE && msub.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MSUB does NOT scatter', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.Spain, 10, 10);
    msub.mission = Mission.GUARD;

    const ctx = makeCombatCtx([msub]);
    aiScatterOnDamage(ctx, msub);

    expect(msub.mission).toBe(Mission.GUARD);
    expect(msub.moveTarget).toBeNull();
  });

  it('AI MSUB on ATTACK mission does NOT scatter', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([msub]);
    aiScatterOnDamage(ctx, msub);

    expect(msub.mission).toBe(Mission.ATTACK);
  });
});

// == Movement -- Stop-Rotate-Move Vessel (drive.cpp) ==========================
// C++ drive.cpp -- vessels stop, rotate to face destination, THEN move.
// MSUB is slow (speed=5) but rotates decently (rot=7).

describe('MSUB movement -- stop-rotate-move vessel (drive.cpp)', () => {
  it('MSUB speed is 5', () => {
    expect(UNIT_STATS.MSUB.speed).toBe(5);
  });

  it('MSUB facing N, moveToward target E: does NOT move until rotation completes', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.facing = Dir.N;
    msub.desiredFacing = Dir.N;
    msub.bodyFacing32 = Dir.N * 4;

    const startX = msub.pos.x;
    const startY = msub.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY };

    const arrived = msub.moveToward(targetPos, msub.stats.speed);

    expect(arrived).toBe(false);
    expect(msub.pos.x).toBe(startX);
    expect(msub.pos.y).toBe(startY);
  });

  it('MSUB rot=7, needs fewer ticks than rot=5 to rotate (faster rotation)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.facing = Dir.N;
    msub.desiredFacing = Dir.E;
    msub.bodyFacing32 = Dir.N * 4;

    let ticksMSUB = 0;
    let aligned = false;
    for (let i = 0; i < 30; i++) {
      msub.rotTickedThisFrame = false;
      aligned = msub.tickRotation();
      ticksMSUB++;
      if (aligned) break;
    }
    expect(aligned).toBe(true);

    // Compare with a rot=5 vehicle doing the same rotation
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.facing = Dir.N;
    stnk.desiredFacing = Dir.E;
    stnk.bodyFacing32 = Dir.N * 4;

    let ticksSTNK = 0;
    let alignedSTNK = false;
    for (let i = 0; i < 30; i++) {
      stnk.rotTickedThisFrame = false;
      alignedSTNK = stnk.tickRotation();
      ticksSTNK++;
      if (alignedSTNK) break;
    }
    expect(alignedSTNK).toBe(true);
    expect(ticksMSUB).toBeLessThanOrEqual(ticksSTNK);
  });

  it('MSUB moves after rotation completes', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.facing = Dir.E;
    msub.desiredFacing = Dir.E;
    msub.bodyFacing32 = Dir.E * 4;

    const startX = msub.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: msub.pos.y };

    const arrived = msub.moveToward(targetPos, msub.stats.speed);
    expect(msub.pos.x).toBeGreaterThan(startX);
  });
});

// == Not a Crusher (no treads) ================================================
// MSUB is a naval vessel -- no crusher capability (unlike tanks/STNK)

describe('MSUB is not a crusher (naval vessel)', () => {
  it('MSUB stats do not have crusher flag', () => {
    expect(UNIT_STATS.MSUB.crusher).toBeFalsy();
  });

  it('MSUB is not a transport (no passengers capacity)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.isTransport).toBe(false);
    expect(msub.maxPassengers).toBe(0);
  });
});
