/**
 * C++ Behavioral Parity: MGG -- Mobile Gap Generator
 *
 * Tests verify Mobile Gap Generator behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with MGG (observable outcomes: HP, alive/dead,
 * mission, position changes, crusher behavior, no weapon, no turret, sibling to MRJ),
 * not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WARHEAD_VS_ARMOR, CONDITION_YELLOW,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
  damageSpeedFactor,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

beforeEach(() => resetEntityIds());

// -- Helpers -----------------------------------------------------------------

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

// -- Stats Verification (udata.cpp / rules.ini) ------------------------------
// C++ udata.cpp (unit type data) -- MGG entry and RULES.INI [MGG] section

describe('MGG stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.MGG;

  it('HP is 110 (Strength=110)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 9 (Speed=9)', () => {
    expect(stats.speed).toBe(9);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (C++ udata.cpp:265 IsCrusher=true)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('ROT is 5 (rotation rate)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 4', () => {
    expect(stats.sight).toBe(4);
  });

  it('faction is allied (owner=allied)', () => {
    expect(stats.owner).toBe('allied');
  });

  it('cost is 600 credits (from UNIT_STATS)', () => {
    expect(stats.cost).toBe(600);
  });

  it('Entity constructor initializes HP to strength', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.hp).toBe(110);
    expect(mgg.maxHp).toBe(110);
  });
});

// -- No Weapon: Support Vehicle (udata.cpp) -----------------------------------
// C++ udata.cpp -- MGG has primaryWeapon: null (support vehicle, cannot attack)

describe('MGG no weapon -- support vehicle (udata.cpp)', () => {
  it('primaryWeapon is null in UNIT_STATS', () => {
    expect(UNIT_STATS.MGG.primaryWeapon).toBeNull();
  });

  it('Entity resolves weapon to null', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.weapon).toBeNull();
  });

  it('no secondary weapon', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.weapon2).toBeNull();
  });

  it('cannot retaliate when attacked (no weapon to fire back)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mgg.mission = Mission.GUARD;
    mgg.target = null;

    const ctx = makeCombatCtx([mgg, attacker]);
    triggerRetaliation(ctx, mgg, attacker);

    // Unarmed vehicle should not acquire a target
    expect(mgg.target).toBeNull();
    expect(mgg.mission).toBe(Mission.GUARD);
  });

  it('inRange always returns false (no weapon means no range)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // 1 cell away
    expect(mgg.inRange(target)).toBe(false);
  });
});

// -- No Turret (unit.cpp) -----------------------------------------------------
// C++ unit.cpp -- MGG is in the exclusion list for hasTurret (support vehicles)

describe('MGG no turret (unit.cpp)', () => {
  it('hasTurret is false (in exclusion list)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.hasTurret).toBe(false);
  });

  it('MRJ also has no turret (same exclusion group)', () => {
    const mrj = entityAtCell(UnitType.V_MRJ, House.Spain, 10, 10);
    expect(mrj.hasTurret).toBe(false);
  });
});

// -- Sibling to MRJ (udata.cpp comparison) ------------------------------------
// C++ udata.cpp -- MGG and MRJ share nearly identical stats: same HP, armor,
// speed, cost, and faction. Both are unarmed allied support vehicles.

describe('MGG vs MRJ sibling comparison (udata.cpp)', () => {
  const mggStats = UNIT_STATS.MGG;
  const mrjStats = UNIT_STATS.MRJ;

  it('same HP: both 110', () => {
    expect(mggStats.strength).toBe(110);
    expect(mrjStats.strength).toBe(110);
    expect(mggStats.strength).toBe(mrjStats.strength);
  });

  it('same armor: both light', () => {
    expect(mggStats.armor).toBe('light');
    expect(mrjStats.armor).toBe('light');
    expect(mggStats.armor).toBe(mrjStats.armor);
  });

  it('same speed: both 9', () => {
    expect(mggStats.speed).toBe(9);
    expect(mrjStats.speed).toBe(9);
    expect(mggStats.speed).toBe(mrjStats.speed);
  });

  it('same cost: both 600', () => {
    expect(mggStats.cost).toBe(600);
    expect(mrjStats.cost).toBe(600);
    expect(mggStats.cost).toBe(mrjStats.cost);
  });

  it('same faction: both allied', () => {
    expect(mggStats.owner).toBe('allied');
    expect(mrjStats.owner).toBe('allied');
    expect(mggStats.owner).toBe(mrjStats.owner);
  });

  it('both unarmed (primaryWeapon null)', () => {
    expect(mggStats.primaryWeapon).toBeNull();
    expect(mrjStats.primaryWeapon).toBeNull();
  });

  it('both MRJ and MGG are crushers (C++ udata.cpp IsCrusher=true for both)', () => {
    expect(mggStats.crusher).toBe(true);
    expect(mrjStats.crusher).toBe(true);
  });

  it('same ROT: both 5', () => {
    expect(mggStats.rot).toBe(5);
    expect(mrjStats.rot).toBe(5);
    expect(mggStats.rot).toBe(mrjStats.rot);
  });

  it('different sight range: MGG 4, MRJ 7', () => {
    expect(mggStats.sight).toBe(4);
    expect(mrjStats.sight).toBe(7);
    expect(mggStats.sight).not.toBe(mrjStats.sight);
  });
});

// -- Crusher Behavior (drive.cpp:Ok_To_Move) ----------------------------------
// C++ drive.cpp -- when a Crusher vehicle enters a cell with Crushable infantry,
// the infantry dies instantly. Only crusher vehicles crush; only crushable targets die.

describe('MGG IS a crusher (C++ udata.cpp:265 IsCrusher=true)', () => {
  it('MGG DOES have crusher flag', () => {
    expect(UNIT_STATS.MGG.crusher).toBe(true);
  });

  it('DOES crush enemy infantry on same cell', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([mgg, infantry]);
    checkVehicleCrush(ctx, mgg);
    expect(infantry.alive).toBe(false);
  });
});

// -- Damage Speed Reduction (drive.cpp:1157-1161) ----------------------------
// C++ drive.cpp -- vehicles at <= 50% HP move at 75% speed

describe('MGG damage speed reduction (drive.cpp:1157-1161)', () => {
  it('full HP: speed factor is 1.0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(damageSpeedFactor(mgg)).toBe(1.0);
  });

  it('at exactly 50% HP: speed factor is 0.75 (CONDITION_YELLOW threshold)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.hp = mgg.maxHp * CONDITION_YELLOW; // 55 (50%)
    expect(damageSpeedFactor(mgg)).toBe(0.75);
  });

  it('at 25% HP (below 50%): speed factor is 0.75', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.hp = Math.floor(mgg.maxHp * 0.25); // ~27
    expect(mgg.hp / mgg.maxHp).toBeLessThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(mgg)).toBe(0.75);
  });

  it('at 51% HP (above threshold): speed factor is 1.0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.hp = Math.ceil(mgg.maxHp * 0.51); // 57
    expect(mgg.hp / mgg.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(mgg)).toBe(1.0);
  });

  it('at 1 HP: speed factor is 0.75', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.hp = 1;
    expect(damageSpeedFactor(mgg)).toBe(0.75);
  });
});

// -- Stop-Rotate-Move (drive.cpp) -------------------------------------------
// C++ drive.cpp -- vehicles stop, rotate to face destination, THEN move.
// Infantry are nimble and can move while rotating. MGG is a vehicle.

describe('MGG stop-rotate-move (drive.cpp)', () => {
  it('facing N, target E: does NOT move until rotation completes', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.facing = Dir.N;
    mgg.desiredFacing = Dir.N;
    mgg.bodyFacing32 = Dir.N * 4;

    const startX = mgg.pos.x;
    const startY = mgg.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick -- vehicle should stop to rotate
    const arrived = mgg.moveToward(targetPos, mgg.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(mgg.pos.x).toBe(startX);
    expect(mgg.pos.y).toBe(startY);
  });

  it('facing E, target E: moves immediately (already aligned)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.facing = Dir.E;
    mgg.desiredFacing = Dir.E;
    mgg.bodyFacing32 = Dir.E * 4;

    const startX = mgg.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: mgg.pos.y };

    mgg.moveToward(targetPos, mgg.stats.speed);

    // Should have moved east
    expect(mgg.pos.x).toBeGreaterThan(startX);
  });

  it('vehicle rotation is gradual (rot=5, not instant like infantry rot=8)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.stats.rot).toBe(5);
    // rot < 8 means gradual 32-step rotation
    expect(mgg.stats.rot).toBeLessThan(8);

    mgg.facing = Dir.N;
    mgg.desiredFacing = Dir.S; // opposite direction
    mgg.bodyFacing32 = Dir.N * 4;
    const aligned = mgg.tickRotation();
    // Should NOT snap instantly (rot=5 < 8)
    expect(aligned).toBe(false);
  });

  it('multiple ticks eventually complete rotation', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.facing = Dir.N;
    mgg.desiredFacing = Dir.E;
    mgg.bodyFacing32 = Dir.N * 4;
    mgg.rotAccumulator = 0;

    // Rotate until aligned (max 50 ticks to prevent infinite loop)
    let aligned = false;
    for (let i = 0; i < 50; i++) {
      mgg.rotTickedThisFrame = false;
      aligned = mgg.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(mgg.facing).toBe(Dir.E);
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp -- AI-controlled unarmed units still scatter when damaged

describe('MGG AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled MGG on GUARD mission scatters when damaged (IQ >= 2)', () => {
    // USSR is not player-controlled, so this is an AI unit
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
      mgg.mission = Mission.GUARD;
      const ctx = makeCombatCtx([mgg]);
      aiScatterOnDamage(ctx, mgg);
      if (mgg.mission === Mission.MOVE && mgg.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled MGG does NOT scatter', () => {
    // Spain is player-controlled
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.mission = Mission.GUARD;

    const ctx = makeCombatCtx([mgg]);
    aiScatterOnDamage(ctx, mgg);

    // Should remain on GUARD, no scatter
    expect(mgg.mission).toBe(Mission.GUARD);
    expect(mgg.moveTarget).toBeNull();
  });

  it('AI MGG on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    mgg.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([mgg]);
    aiScatterOnDamage(ctx, mgg);

    expect(mgg.mission).toBe(Mission.ATTACK);
  });
});

// -- Death / Destruction (techno.cpp) ----------------------------------------
// C++ techno.cpp -- unit death when HP reaches 0

describe('MGG death (techno.cpp)', () => {
  it('dies when HP reaches 0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    const killed = mgg.takeDamage(110, 'AP');
    expect(killed).toBe(true);
    expect(mgg.alive).toBe(false);
    expect(mgg.hp).toBe(0);
  });

  it('mission becomes DIE on death', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    mgg.takeDamage(110, 'AP');
    expect(mgg.mission).toBe(Mission.DIE);
  });

  it('animState becomes DIE on death', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    mgg.takeDamage(110, 'AP');
    expect(mgg.animState).toBe(AnimState.DIE);
  });

  it('survives with 1 HP after taking 109 damage', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    const killed = mgg.takeDamage(109, 'AP');
    expect(killed).toBe(false);
    expect(mgg.alive).toBe(true);
    expect(mgg.hp).toBe(1);
  });

  it('overkill damage clamps HP to 0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    mgg.takeDamage(999, 'AP');
    expect(mgg.hp).toBe(0);
    expect(mgg.alive).toBe(false);
  });

  it('invulnerable MGG takes no damage (Iron Curtain)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.ironCurtainTick = 100; // invulnerable
    const killed = mgg.takeDamage(110, 'AP');
    expect(killed).toBe(false);
    expect(mgg.hp).toBe(110);
    expect(mgg.alive).toBe(true);
  });
});

// -- Damage from Different Warheads (combat.cpp warhead tables) ---------------
// C++ combat.cpp -- MGG has light armor; different warheads do different damage

describe('MGG damage from warheads vs light armor (combat.cpp warhead tables)', () => {
  it('SA vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('HE vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('MGG takes correct damage from AP warhead (light armor)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    const hpBefore = mgg.hp;
    // AP vs light = 0.75, base 30 damage: 30 * 0.75 = 22.5 -> 23 rounded
    const damage = Math.round(30 * WARHEAD_VS_ARMOR.AP[armorIndex('light')]);
    mgg.takeDamage(damage, 'AP');
    expect(hpBefore - mgg.hp).toBe(damage);
  });

  it('MGG takes correct damage from SA warhead (light armor)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.USSR, 10, 10);
    const hpBefore = mgg.hp;
    // SA vs light = 0.6, base 15 damage: 15 * 0.6 = 9
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('light')]);
    mgg.takeDamage(damage, 'SA');
    expect(hpBefore - mgg.hp).toBe(damage);
    expect(damage).toBe(9);
  });
});

// -- Vehicle Animation (unit.cpp) --------------------------------------------
// C++ unit.cpp -- vehicles use 32-frame body rotation via BODY_SHAPE

describe('MGG vehicle animation (unit.cpp)', () => {
  it('isInfantry is false', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.stats.isInfantry).toBe(false);
  });

  it('isAnt is false', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.isAnt).toBe(false);
  });

  it('spriteFrame uses vehicle BODY_SHAPE system (valid frame number)', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    const frame = mgg.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(32); // body frames are 0-31
  });

  it('starts in IDLE animState', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.animState).toBe(AnimState.IDLE);
  });

  it('isAirUnit is false', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.isAirUnit).toBe(false);
  });

  it('isNavalUnit is false', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.isNavalUnit).toBe(false);
  });
});

// -- Crate Bias Effects (entity.ts) ------------------------------------------
// C++ techno.cpp -- crate pickups modify unit stats via bias multipliers

describe('MGG crate bias effects', () => {
  it('default speedBias is 1.0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.speedBias).toBe(1.0);
  });

  it('default armorBias is 1.0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.armorBias).toBe(1.0);
  });

  it('default firepowerBias is 1.0', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    expect(mgg.firepowerBias).toBe(1.0);
  });

  it('armorBias > 1.0 reduces damage taken', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.armorBias = 2.0; // CR2: half damage
    const hpBefore = mgg.hp;
    mgg.takeDamage(30, 'AP');
    const damageTaken = hpBefore - mgg.hp;
    // 30 / 2.0 = 15
    expect(damageTaken).toBe(15);
  });

  it('speedBias multiplies movement distance', () => {
    const mgg = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg.facing = Dir.E;
    mgg.desiredFacing = Dir.E;
    mgg.bodyFacing32 = Dir.E * 4;

    const startX = mgg.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 5, y: mgg.pos.y };

    // Normal speed move
    mgg.moveToward(targetPos, mgg.stats.speed);
    const normalDist = mgg.pos.x - startX;

    // Reset and try with speed crate
    const mgg2 = entityAtCell(UnitType.V_MGG, House.Spain, 10, 10);
    mgg2.facing = Dir.E;
    mgg2.desiredFacing = Dir.E;
    mgg2.bodyFacing32 = Dir.E * 4;
    mgg2.speedBias = 1.5; // crate bonus

    const startX2 = mgg2.pos.x;
    const targetPos2 = { x: startX2 + CELL_SIZE * 5, y: mgg2.pos.y };
    mgg2.moveToward(targetPos2, mgg2.stats.speed);
    const boostedDist = mgg2.pos.x - startX2;

    expect(boostedDist).toBeGreaterThan(normalDist);
  });
});
