/**
 * C++ Behavioral Parity: DTRK — Demo Truck
 *
 * Tests verify Demo Truck behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with DTRK (observable outcomes: HP, alive/dead,
 * hasTurret, crusher, fuseTimer, weapon stats), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
} from '../engine/combat';
import { DEMO_TRUCK_FUSE_TICKS } from '../engine/specialUnits';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — DTRK entry and RULES.INI [DTRK] section

describe('DTRK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.DTRK;
  const weapon = WEAPON_STATS.Democharge;

  it('HP is 110 (Strength=110)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 8 (Speed=8)', () => {
    expect(stats.speed).toBe(8);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('primary weapon is Democharge', () => {
    expect(stats.primaryWeapon).toBe('Democharge');
  });

  it('Entity constructor initializes HP to strength', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.hp).toBe(110);
    expect(dtrk.maxHp).toBe(110);
  });

  it('Entity constructor resolves Democharge weapon', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.weapon).not.toBeNull();
    expect(dtrk.weapon!.name).toBe('Democharge');
  });
});

// ── Weapon — Democharge (rules.ini [Democharge]) ─────────────────────────────
// C++ rules.ini — Democharge weapon definition: Nuke warhead, 500 damage, range 1.75

describe('Democharge weapon stats (rules.ini [Democharge])', () => {
  const weapon = WEAPON_STATS.Democharge;

  it('damage is 500', () => {
    expect(weapon.damage).toBe(500);
  });

  it('warhead is Nuke', () => {
    expect(weapon.warhead).toBe('Nuke');
  });

  it('range is 1.75 cells (point-blank detonation)', () => {
    expect(weapon.range).toBe(1.75);
  });

  it('weapon name is Democharge', () => {
    expect(weapon.name).toBe('Democharge');
  });
});

// ── Nuke Warhead (combat.cpp warhead tables) ─────────────────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table
// Nuke warhead has same verses as Fire: 90%,100%,60%,25%,50%

describe('Nuke warhead effectiveness (combat.cpp warhead tables)', () => {
  it('Nuke vs none armor: mult 0.9 (90% to unarmored)', () => {
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('none')];
    expect(mult).toBe(0.9);
  });

  it('Nuke vs wood armor: mult 1.0 (full damage to wood structures)', () => {
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('wood')];
    expect(mult).toBe(1.0);
  });

  it('Nuke vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('Nuke vs heavy armor: mult 0.25 (poor vs heavy tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('Nuke vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('Nuke verses match Fire warhead exactly (rules.ini parity)', () => {
    const nukeVerses = WARHEAD_VS_ARMOR.Nuke;
    const fireVerses = WARHEAD_VS_ARMOR.Fire;
    expect(nukeVerses).toEqual(fireVerses);
  });

  it('Democharge deals 500 * 0.9 = 450 base damage to unarmored infantry', () => {
    const baseDamage = WEAPON_STATS.Democharge.damage;
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('none')];
    const effectiveDamage = Math.round(baseDamage * mult);
    expect(effectiveDamage).toBe(450);
  });

  it('Democharge deals 500 * 0.25 = 125 base damage to heavy armor', () => {
    const baseDamage = WEAPON_STATS.Democharge.damage;
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('heavy')];
    const effectiveDamage = Math.round(baseDamage * mult);
    expect(effectiveDamage).toBe(125);
  });
});

// ── fuseTimer (unit.cpp / specialUnits.ts) ────────────────────────────────────
// C++ unit.cpp — Demo Truck has a 45-tick fuse countdown before detonation

describe('DTRK fuseTimer (unit.cpp fuse countdown)', () => {
  it('fuseTimer field initializes to 0 on construction', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.fuseTimer).toBe(0);
  });

  it('DEMO_TRUCK_FUSE_TICKS constant is 45', () => {
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
  });

  it('fuseTimer can be armed to DEMO_TRUCK_FUSE_TICKS (45)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.fuseTimer = DEMO_TRUCK_FUSE_TICKS;
    expect(dtrk.fuseTimer).toBe(45);
  });

  it('fuseTimer decrements correctly on each tick', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.fuseTimer = DEMO_TRUCK_FUSE_TICKS;
    // Simulate countdown
    for (let i = 0; i < 45; i++) {
      expect(dtrk.fuseTimer).toBe(45 - i);
      dtrk.fuseTimer--;
    }
    expect(dtrk.fuseTimer).toBe(0);
  });

  it('fuseTimer is NOT shared between entities (instance field)', () => {
    const dtrk1 = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const dtrk2 = entityAtCell(UnitType.V_DTRK, House.USSR, 12, 10);
    dtrk1.fuseTimer = 45;
    expect(dtrk2.fuseTimer).toBe(0);
  });
});

// ── No Turret (udata.cpp turret exclusion list) ──────────────────────────────
// C++ udata.cpp — DTRK is in the hasTurret exclusion list (no rotating turret)

describe('DTRK has no turret (udata.cpp hasTurret exclusion)', () => {
  it('hasTurret is false for DTRK', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.hasTurret).toBe(false);
  });

  it('hasTurret is true for a normal turreted vehicle (2TNK) for contrast', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('DTRK is in the explicit exclusion list alongside other non-turreted vehicles', () => {
    // All these vehicles should lack turrets per C++ udata.cpp
    const nonTurreted = [
      UnitType.V_APC, UnitType.V_HARV, UnitType.V_MCV, UnitType.V_ARTY,
      UnitType.V_JEEP, UnitType.V_TRUK, UnitType.V_MRJ,
      UnitType.V_STNK, UnitType.V_CTNK, UnitType.V_TTNK, UnitType.V_QTNK,
      UnitType.V_DTRK, UnitType.V_V2RL, UnitType.V_MNLY,
    ];
    for (const type of nonTurreted) {
      const e = entityAtCell(type, House.USSR, 10, 10);
      expect(e.hasTurret, `${type} should have hasTurret=false`).toBe(false);
    }
  });
});

// ── Not a Crusher (udata.cpp crusher flag) ────────────────────────────────────
// C++ udata.cpp — DTRK does NOT have crusher flag (cannot crush infantry)

describe('DTRK is not a crusher (udata.cpp crusher flag)', () => {
  it('DTRK stats do not have crusher flag', () => {
    expect(UNIT_STATS.DTRK.crusher).toBeFalsy();
  });

  it('DTRK does not crush infantry on same cell', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([dtrk, infantry]);
    checkVehicleCrush(ctx, dtrk);
    expect(infantry.alive).toBe(true);
    expect(infantry.hp).toBe(infantry.maxHp);
  });

  it('Heavy tank (2TNK) is a crusher for contrast', () => {
    expect(UNIT_STATS['2TNK'].crusher).toBe(true);
  });

  it('crusher tank kills infantry on same cell, DTRK does not', () => {
    // Tank crushes
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const inf1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx1 = makeCombatCtx([tank, inf1]);
    checkVehicleCrush(ctx1, tank);
    expect(inf1.alive).toBe(false);

    // DTRK does NOT crush
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 12, 10);
    const inf2 = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const ctx2 = makeCombatCtx([dtrk, inf2]);
    checkVehicleCrush(ctx2, dtrk);
    expect(inf2.alive).toBe(true);
  });
});

// ── Suicide Unit Behavior (unit.cpp) ──────────────────────────────────────────
// C++ unit.cpp — DTRK is a suicide unit: drives into target and detonates

describe('DTRK suicide unit behavior (unit.cpp)', () => {
  it('DTRK is a vehicle (not infantry)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.stats.isInfantry).toBe(false);
  });

  it('DTRK starts alive on GUARD mission', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.alive).toBe(true);
    expect(dtrk.mission).toBe(Mission.GUARD);
  });

  it('DTRK can be assigned ATTACK mission with a target', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    dtrk.mission = Mission.ATTACK;
    dtrk.target = target;
    expect(dtrk.mission).toBe(Mission.ATTACK);
    expect(dtrk.target).toBe(target);
  });

  it('DTRK takes damage normally (is not invulnerable)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const hpBefore = dtrk.hp;
    dtrk.takeDamage(30, 'AP');
    expect(dtrk.hp).toBe(hpBefore - 30);
  });

  it('DTRK dies when HP reaches 0', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.takeDamage(110, 'AP');
    expect(dtrk.alive).toBe(false);
    expect(dtrk.hp).toBe(0);
    expect(dtrk.mission).toBe(Mission.DIE);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — DTRK has a weapon, so it can retaliate when hit

describe('DTRK retaliation (techno.cpp)', () => {
  it('DTRK has a weapon (Democharge) — can retaliate', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.weapon).not.toBeNull();
    expect(dtrk.weapon!.name).toBe('Democharge');
  });

  it('idle DTRK on GUARD retaliates when hit by enemy', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    dtrk.mission = Mission.GUARD;
    dtrk.target = null;

    const ctx = makeCombatCtx([dtrk, attacker]);
    triggerRetaliation(ctx, dtrk, attacker);

    expect(dtrk.target).toBe(attacker);
    expect(dtrk.mission).toBe(Mission.ATTACK);
  });

  it('DTRK does not retarget if already has a living target', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    dtrk.mission = Mission.ATTACK;
    dtrk.target = existingTarget;

    const ctx = makeCombatCtx([dtrk, existingTarget, newAttacker]);
    triggerRetaliation(ctx, dtrk, newAttacker);

    expect(dtrk.target).toBe(existingTarget);
  });

  it('DTRK does not retaliate against allies', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 11, 10); // Ukraine allied with USSR
    dtrk.mission = Mission.GUARD;
    dtrk.target = null;

    const ctx = makeCombatCtx([dtrk, ally]);
    triggerRetaliation(ctx, dtrk, ally);

    expect(dtrk.target).toBeNull();
    expect(dtrk.mission).toBe(Mission.GUARD);
  });
});

// ── Vehicle Movement (drive.cpp) ──────────────────────────────────────────────
// C++ drive.cpp — DTRK is a vehicle: stops to rotate before moving (not nimble like infantry)

describe('DTRK vehicle movement — stop-rotate-move (drive.cpp)', () => {
  it('DTRK facing N, moveToward target E: does NOT move until rotation completes', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.facing = Dir.N;
    dtrk.desiredFacing = Dir.N;
    dtrk.bodyFacing32 = Dir.N * 4;

    const startX = dtrk.pos.x;
    const startY = dtrk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = dtrk.moveToward(targetPos, dtrk.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(dtrk.pos.x).toBe(startX);
    expect(dtrk.pos.y).toBe(startY);
  });

  it('DTRK rot=5 (needs multiple ticks to complete 90-degree turn)', () => {
    expect(UNIT_STATS.DTRK.rot).toBe(5);
    // 90 degrees = 8 steps in 32-step ring. At rot=5, accumulator needs 8 per step.
    // 5 per tick → ceil(8/5)=2 ticks per step, 8 steps × 2 = ~16 ticks for 90°
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.facing = Dir.N;
    dtrk.desiredFacing = Dir.E;
    dtrk.bodyFacing32 = Dir.N * 4;

    // After 1 tick, should NOT have reached E
    dtrk.rotTickedThisFrame = false;
    dtrk.tickRotation();
    expect(dtrk.facing).not.toBe(Dir.E);
  });
});

// ── PRODUCTION_ITEMS (aftrmath.ini) ──────────────────────────────────────────
// DTRK is buildable in Aftermath expansion (requires MSLO prerequisite)

describe('DTRK production (aftrmath.ini)', () => {
  it('DTRK is in PRODUCTION_ITEMS (Aftermath buildable unit)', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DTRK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(2400);
    expect(prodItem!.prerequisite).toBe('MSLO');
  });
});

// ── Sprite Frame / Animation (unit.cpp) ──────────────────────────────────────
// C++ unit.cpp — DTRK uses standard vehicle 32-frame body rotation

describe('DTRK sprite animation (unit.cpp)', () => {
  it('DTRK isInfantry=false, isAnt=false (uses vehicle sprite system)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.stats.isInfantry).toBe(false);
    expect(dtrk.isAnt).toBe(false);
  });

  it('DTRK spriteFrame returns a valid frame number', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const frame = dtrk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('DTRK starts in IDLE animState', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.alive).toBe(true);
    expect(dtrk.animState).toBe(AnimState.IDLE);
  });
});

// ── Damage Application (combat.cpp) ──────────────────────────────────────────
// C++ combat.cpp — Verify damage application to and from DTRK targets

describe('DTRK damage application (combat.cpp)', () => {
  it('DTRK (light armor) takes 60% damage from SA warhead (E1 fire)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const baseDamage = 15; // E1 M1Carbine damage
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')]; // 0.6
    const effectiveDamage = Math.round(baseDamage * mult); // 9
    const hpBefore = dtrk.hp;
    dtrk.takeDamage(effectiveDamage, 'SA');
    expect(hpBefore - dtrk.hp).toBe(9);
  });

  it('DTRK (light armor) takes 75% damage from AP warhead', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('DTRK can be killed by accumulated damage (110 HP)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.hp).toBe(110);
    // 4 hits of 30 = 120 > 110
    dtrk.takeDamage(30, 'AP');
    dtrk.takeDamage(30, 'AP');
    dtrk.takeDamage(30, 'AP');
    expect(dtrk.alive).toBe(true);
    expect(dtrk.hp).toBe(20);
    dtrk.takeDamage(30, 'AP');
    expect(dtrk.alive).toBe(false);
    expect(dtrk.hp).toBe(0);
  });
});
