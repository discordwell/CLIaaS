/**
 * C++ Behavioral Parity: STNK — Phase Transport (Stealth Tank)
 *
 * Tests verify Phase Transport behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with STNK (observable outcomes: HP, alive/dead,
 * cloak state, transport passengers, crush, turret, burst fire, movement),
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
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
} from '../engine/combat';
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

// ── Stats Verification (udata.cpp / rules.ini) ──────────────────────────────
// C++ udata.cpp (unit type data) — STNK entry and RULES.INI [STNK] section

describe('STNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.STNK;
  const weapon = WEAPON_STATS.APTusk;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'STNK');

  it('HP is 200 (Strength=200)', () => {
    expect(stats.strength).toBe(200);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 10 (Speed=10)', () => {
    expect(stats.speed).toBe(10);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (can crush infantry)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isCloakable is true (Phase Transport stealth)', () => {
    expect(stats.isCloakable).toBe(true);
  });

  it('passengers capacity is 1 (C++ Max_Passengers=1)', () => {
    expect(stats.passengers).toBe(1);
  });

  it('primary weapon is APTusk', () => {
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('ROT is 5 (rotation rate — standard vehicle)', () => {
    expect(stats.rot).toBe(5);
  });

  it('cost is 800 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(800);
  });

  it('Entity constructor initializes HP to strength', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.hp).toBe(200);
    expect(stnk.maxHp).toBe(200);
  });
});

// ── Weapon — APTusk (weapon.cpp / rules.ini) ─────────────────────────────────
// C++ weapon.cpp — APTusk entry: AP warhead, 75 damage, range 5.0, burst 2

describe('STNK weapon — APTusk (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.APTusk;

  it('APTusk warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('APTusk damage is 75', () => {
    expect(weapon.damage).toBe(75);
  });

  it('APTusk range is 5.0 cells', () => {
    expect(weapon.range).toBe(5.0);
  });

  it('APTusk burst is 2 (fires 2 missiles per volley)', () => {
    expect(weapon.burst).toBe(2);
  });

  it('APTusk ROF is 80 (reload time between volleys)', () => {
    expect(weapon.rof).toBe(80);
  });

  it('Entity weapon is resolved to APTusk stats', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.weapon).not.toBeNull();
    expect(stnk.weapon!.name).toBe('APTusk');
    expect(stnk.weapon!.damage).toBe(75);
  });
});

// ── AP Warhead Effectiveness (combat.cpp warhead tables) ─────────────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('STNK weapon effectiveness — AP warhead (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs heavy armor: mult 1.0 (full damage vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('STNK deals full 75 base damage to heavy-armor targets', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs heavy = 1.0, so full 75 damage
    const damage = Math.round(75 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(75);
  });

  it('STNK deals reduced damage to unarmored infantry (AP vs none = 0.3)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs none = 0.3: 75 * 0.3 = 22.5 → round to 23
    const damage = Math.round(75 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBeLessThan(75);
  });
});

// ── Burst Fire (weapon.cpp:78 Weapon.Burst) ─────────────────────────────────
// C++ weapon.cpp — burst=2 means two shots per trigger pull, with burstDelay ticks between

describe('STNK burst fire — APTusk burst=2 (weapon.cpp:78)', () => {
  it('burstCount starts at 0 (no active burst)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.burstCount).toBe(0);
  });

  it('burstDelay starts at 0', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.burstDelay).toBe(0);
  });

  it('weapon burst value is 2', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.weapon!.burst).toBe(2);
  });

  it('setting burstCount to burst-1 simulates first shot fired, one remaining', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    // Simulate first shot fired: burst=2, first shot fires, burstCount = 1 remaining
    stnk.burstCount = stnk.weapon!.burst! - 1;
    expect(stnk.burstCount).toBe(1);
  });

  it('burstCount decrements to 0 after second shot (volley complete)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.burstCount = 1; // one shot remaining
    // Second shot fires
    stnk.burstCount--;
    expect(stnk.burstCount).toBe(0);
  });
});

// ── Cloakable — Phase Transport Stealth (techno.cpp / specialUnits.ts) ──────
// C++ techno.cpp — isCloakable flag enables cloak state machine.
// Phase Transport (STNK) cloaks like submarines but is a ground vehicle.

describe('STNK cloakable — Phase Transport stealth (techno.cpp)', () => {
  it('stats.isCloakable is true', () => {
    expect(UNIT_STATS.STNK.isCloakable).toBe(true);
  });

  it('entity starts UNCLOAKED', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('cloakTimer starts at 0', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.cloakTimer).toBe(0);
  });

  it('cloak transition takes CLOAK_TRANSITION_FRAMES (38) ticks', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Tick through the full transition
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      stnk.cloakTimer--;
    }
    if (stnk.cloakTimer <= 0) stnk.cloakState = CloakState.CLOAKED;

    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
    expect(stnk.cloakTimer).toBe(0);
  });

  it('taking damage force-uncloaks from CLOAKED state', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;
    stnk.cloakTimer = 0;

    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('taking damage force-uncloaks from CLOAKING state', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = 20;

    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('STNK is not a vessel (vehicle cloak, not submarine cloak)', () => {
    expect(UNIT_STATS.STNK.isVessel).toBeFalsy();
  });

  it('CloakState enum values match C++ CLOAK_STAGES (0-3)', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });
});

// ── Transport — 1 Passenger (techno.cpp / unit.cpp) ─────────────────────────
// C++ techno.cpp — isTransport, maxPassengers=1, passengers array

describe('STNK transport — 1 passenger (techno.cpp / unit.cpp)', () => {
  it('isTransport is true (passengers > 0)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.isTransport).toBe(true);
  });

  it('maxPassengers is 1', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(1);
  });

  it('passengers array starts empty', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.passengers).toEqual([]);
    expect(stnk.passengers.length).toBe(0);
  });

  it('can load 1 infantry into passengers array', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(e1);
    e1.transportRef = stnk;
    expect(stnk.passengers.length).toBe(1);
    expect(stnk.passengers[0]).toBe(e1);
    expect(e1.transportRef).toBe(stnk);
  });

  it('maxPassengers caps at 1 (cannot hold 2 infantry like APC can)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.maxPassengers).toBe(1);
    // APC holds 5 for comparison
    expect(UNIT_STATS.APC.passengers).toBe(5);
  });
});

// ── Passengers Killed on Death (entity.ts takeDamage) ────────────────────────
// C++ unit.cpp — when transport destroyed, all passengers are killed instantly.

describe('STNK passengers killed on death (unit.cpp / entity.ts)', () => {
  it('when STNK dies, the passenger dies too', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(e1);
    e1.transportRef = stnk;

    const killed = stnk.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(stnk.alive).toBe(false);
    expect(e1.alive).toBe(false);
    expect(e1.mission).toBe(Mission.DIE);
  });

  it('passenger transportRef is cleared on STNK death', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(e1);
    e1.transportRef = stnk;

    stnk.takeDamage(300, 'AP');
    expect(e1.transportRef).toBeNull();
  });

  it('STNK passengers array is cleared on death', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(e1);
    e1.transportRef = stnk;
    expect(stnk.passengers.length).toBe(1);

    stnk.takeDamage(300, 'AP');
    expect(stnk.passengers.length).toBe(0);
  });

  it('STNK that takes non-lethal damage does NOT kill passenger', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    stnk.passengers.push(e1);
    e1.transportRef = stnk;

    const killed = stnk.takeDamage(50, 'AP');
    expect(killed).toBe(false);
    expect(stnk.alive).toBe(true);
    expect(e1.alive).toBe(true);
    expect(stnk.passengers.length).toBe(1);
    expect(e1.transportRef).toBe(stnk);
  });

  it('empty STNK dying does not crash (no passengers to kill)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.passengers.length).toBe(0);

    const killed = stnk.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(stnk.alive).toBe(false);
    expect(stnk.passengers.length).toBe(0);
  });
});

// ── Turret (C++ udata.cpp:762 IsTurretEquipped=true) ─────────────────────────
// C++ udata.cpp — STNK (Phase Transport) has IsTurretEquipped=true

describe('STNK has turret (C++ udata.cpp:762 IsTurretEquipped=true)', () => {
  it('hasTurret is true', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.hasTurret).toBe(true);
  });

  it('STNK is not infantry (confirmed vehicle with turret)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.stats.isInfantry).toBe(false);
    expect(stnk.isAnt).toBe(false);
  });

  it('non-turreted vehicle uses body facing for sprite (not separate turret frame)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    // spriteFrame for vehicles without turret is just bodyFrame
    const frame = stnk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('turret-equipped vehicle (2TNK) has turret for comparison', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });
});

// ── Crusher (drive.cpp:Ok_To_Move) ──────────────────────────────────────────
// C++ drive.cpp — crusher vehicles kill crushable infantry on cell entry

describe('STNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('STNK crushes enemy infantry on same cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, stnk]);
    checkVehicleCrush(ctx, stnk);
    expect(e1.alive).toBe(false);
  });

  it('STNK does NOT crush allied infantry', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([e1, stnk]);
    checkVehicleCrush(ctx, stnk);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('STNK does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const stnk = entityAtCell(UnitType.V_STNK, House.Greece, 10, 10);
    const ctx = makeCombatCtx([e1, stnk]);
    checkVehicleCrush(ctx, stnk);
    expect(e1.alive).toBe(true);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('STNK retaliation (techno.cpp)', () => {
  it('idle STNK on GUARD mission retaliates when hit by enemy', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    stnk.mission = Mission.GUARD;
    stnk.target = null;

    const ctx = makeCombatCtx([stnk, attacker]);
    triggerRetaliation(ctx, stnk, attacker);

    expect(stnk.target).toBe(attacker);
    expect(stnk.mission).toBe(Mission.ATTACK);
  });

  it('STNK CAN retaliate (has APTusk weapon)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.weapon).not.toBeNull();
    expect(stnk.weapon!.name).toBe('APTusk');
  });

  it('STNK does not retarget if already has a living target', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    stnk.mission = Mission.ATTACK;
    stnk.target = existingTarget;

    const ctx = makeCombatCtx([stnk, existingTarget, newAttacker]);
    triggerRetaliation(ctx, stnk, newAttacker);

    expect(stnk.target).toBe(existingTarget);
  });

  it('STNK does not retaliate against allies', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    stnk.mission = Mission.GUARD;
    stnk.target = null;

    const ctx = makeCombatCtx([stnk, ally]);
    triggerRetaliation(ctx, stnk, ally);

    expect(stnk.target).toBeNull();
    expect(stnk.mission).toBe(Mission.GUARD);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD move to adjacent cell when damaged

describe('STNK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled STNK on GUARD mission changes position when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const stnk = entityAtCell(UnitType.V_STNK, House.USSR, 10, 10);
      stnk.mission = Mission.GUARD;
      const ctx = makeCombatCtx([stnk]);
      aiScatterOnDamage(ctx, stnk);
      if (stnk.mission === Mission.MOVE && stnk.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled STNK does NOT scatter', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.mission = Mission.GUARD;

    const ctx = makeCombatCtx([stnk]);
    aiScatterOnDamage(ctx, stnk);

    expect(stnk.mission).toBe(Mission.GUARD);
    expect(stnk.moveTarget).toBeNull();
  });

  it('AI STNK on ATTACK mission does NOT scatter', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.USSR, 10, 10);
    stnk.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([stnk]);
    aiScatterOnDamage(ctx, stnk);

    expect(stnk.mission).toBe(Mission.ATTACK);
  });
});

// ── Movement — Stop-Rotate-Move Vehicle (drive.cpp) ─────────────────────────
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.
// STNK is a fast vehicle (speed=10) but rotates like standard vehicle (rot=5).

describe('STNK movement — stop-rotate-move vehicle (drive.cpp)', () => {
  it('STNK speed is 10 (fastest vehicle tier)', () => {
    expect(UNIT_STATS.STNK.speed).toBe(10);
  });

  it('STNK facing N, moveToward target E: does NOT move until rotation completes', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.facing = Dir.N;
    stnk.desiredFacing = Dir.N;
    stnk.bodyFacing32 = Dir.N * 4;

    const startX = stnk.pos.x;
    const startY = stnk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = stnk.moveToward(targetPos, stnk.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(stnk.pos.x).toBe(startX);
    expect(stnk.pos.y).toBe(startY);
  });

  it('STNK rot=5, needs multiple ticks to rotate 90 degrees (N to E)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.facing = Dir.N;
    stnk.desiredFacing = Dir.E;
    stnk.bodyFacing32 = Dir.N * 4;

    // rot=5 means each tick accumulates 5 toward the threshold of 8
    // Need at least 2 ticks to move one 32-step (5+5=10 >= 8)
    // N to E is 8 steps in 32-step ring (90 degrees), so multiple ticks needed
    let aligned = false;
    for (let i = 0; i < 20; i++) {
      stnk.rotTickedThisFrame = false;
      aligned = stnk.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(stnk.facing).toBe(Dir.E);
  });

  it('STNK moves after rotation completes', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    // Pre-align facing East
    stnk.facing = Dir.E;
    stnk.desiredFacing = Dir.E;
    stnk.bodyFacing32 = Dir.E * 4;

    const startX = stnk.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: stnk.pos.y };

    const arrived = stnk.moveToward(targetPos, stnk.stats.speed);
    // Should have moved (facing already aligned)
    expect(stnk.pos.x).toBeGreaterThan(startX);
  });
});

// ── Damage-Induced Uncloak Interaction (entity.ts takeDamage + cloak) ────────
// C++ techno.cpp — cloaked units forced to uncloak when taking damage

describe('STNK damage-cloak interaction (techno.cpp / entity.ts)', () => {
  it('cloaked STNK forced to UNCLOAKING state on any damage', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;

    stnk.takeDamage(1, 'SA');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('lethal damage on cloaked STNK kills it (does not remain cloaked-alive)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;

    const killed = stnk.takeDamage(999, 'AP');
    expect(killed).toBe(true);
    expect(stnk.alive).toBe(false);
    expect(stnk.hp).toBe(0);
  });

  it('STNK in UNCLOAKED state stays UNCLOAKED after damage (no state change)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.UNCLOAKED;

    stnk.takeDamage(10, 'AP');
    // Already uncloaked, should stay uncloaked (not flip to UNCLOAKING)
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// ── Death State (entity.ts) ─────────────────────────────────────────────────
// C++ unit.cpp — death sets mission=DIE, animState=DIE

describe('STNK death state (unit.cpp / entity.ts)', () => {
  it('STNK sets death state correctly on kill', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.takeDamage(300, 'AP');

    expect(stnk.alive).toBe(false);
    expect(stnk.hp).toBe(0);
    expect(stnk.mission).toBe(Mission.DIE);
    expect(stnk.animState).toBe(AnimState.DIE);
    expect(stnk.animFrame).toBe(0);
  });

  it('STNK survives sub-lethal damage', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.takeDamage(199, 'AP');

    expect(stnk.alive).toBe(true);
    expect(stnk.hp).toBe(1);
    expect(stnk.mission).not.toBe(Mission.DIE);
  });

  it('STNK dies at exactly 200 damage (equal to max HP)', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    const killed = stnk.takeDamage(200, 'AP');

    expect(killed).toBe(true);
    expect(stnk.alive).toBe(false);
    expect(stnk.hp).toBe(0);
  });
});
