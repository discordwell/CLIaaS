/**
 * C++ Behavioral Parity: QTNK — M.A.D. Tank
 *
 * Tests verify M.A.D. Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with QTNK (observable outcomes: HP, alive/dead,
 * mission, deploy state, timer, position changes), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
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
import {
  MAD_TANK_CHARGE_TICKS,
  MAD_TANK_DAMAGE,
  MAD_TANK_RADIUS,
} from '../engine/specialUnits';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

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

// ── Stats Verification (rules.ini parity) ────────────────────────────────────
// C++ udata.cpp (unit type data) — QTNK entry and RULES.INI [QTNK] section

describe('QTNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.QTNK;

  it('HP is 300 (Strength=300)', () => {
    expect(stats.strength).toBe(300);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 3 (Speed=3) — slowest vehicle tier', () => {
    expect(stats.speed).toBe(3);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (C++ IsGapper=false, IsCrusher=true)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primaryWeapon is null — no weapon, deploys/detonates instead', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('rot is 5 (ROT=5, standard vehicle rotation)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 6 (Sight=6)', () => {
    expect(stats.sight).toBe(6);
  });

  it('Entity constructor initializes HP to strength (300)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.hp).toBe(300);
    expect(qtnk.maxHp).toBe(300);
  });
});

// ── No Weapon (udata.cpp) ─────────────────────────────────────────────────────
// C++ udata.cpp — QTNK has PrimaryWeapon=NULL. It deploys and self-destructs instead.

describe('QTNK has no weapon — deploys instead (udata.cpp)', () => {
  it('Entity.weapon is null (no primaryWeapon)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.weapon).toBeNull();
  });

  it('Entity.weapon2 is null (no secondaryWeapon)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.weapon2).toBeNull();
  });

  it('retaliates against infantry by auto-crush (crusher, no weapon)', () => {
    // C++ unit.cpp:1124-1161: Take_Damage checks Should_Crush_It before Can_Fire.
    // QTNK is a crusher with no weapon — it retaliates by moving to crush infantry.
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    qtnk.mission = Mission.GUARD;
    qtnk.target = null;

    const ctx = makeCombatCtx([qtnk, attacker]);
    triggerRetaliation(ctx, qtnk, attacker);

    // QTNK has crusher=true, no weapon — auto-crush path fires
    expect(qtnk.target).toBe(attacker);
    expect(qtnk.mission).toBe(Mission.MOVE);
  });

  it('inRange always returns false (no weapon range to check)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 10); // same cell
    expect(qtnk.inRange(target)).toBe(false);
  });
});

// ── No Turret (unit.cpp turret exclusion list) ────────────────────────────────
// C++ unit.cpp — QTNK is in the turretless vehicle exclusion list

describe('QTNK has no turret (unit.cpp exclusion list)', () => {
  it('hasTurret is false', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.hasTurret).toBe(false);
  });

  it('bodyFacing32 initializes from facing (visual rotation uses body only)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.bodyFacing32).toBe(qtnk.facing * 4);
  });
});

// ── Deploy Fields (entity.ts — MAD Tank deployment state) ─────────────────────
// Entity has isDeployed and deployTimer fields for MAD Tank deployment

describe('QTNK deploy fields (entity.ts / unit.cpp:2667)', () => {
  it('isDeployed defaults to false', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.isDeployed).toBe(false);
  });

  it('deployTimer defaults to 0', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.deployTimer).toBe(0);
  });

  it('isDeployed can be set to true (simulating deployment)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.isDeployed = true;
    expect(qtnk.isDeployed).toBe(true);
  });

  it('deployTimer can be set to MAD_TANK_CHARGE_TICKS (120)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.deployTimer = MAD_TANK_CHARGE_TICKS;
    expect(qtnk.deployTimer).toBe(120);
  });

  it('MAD_TANK_CHARGE_TICKS constant is 120 (8 seconds at 15 FPS, aftrmath.ini QuakeDelay=120)', () => {
    expect(MAD_TANK_CHARGE_TICKS).toBe(120);
  });

  it('MAD_TANK_DAMAGE constant is 600', () => {
    expect(MAD_TANK_DAMAGE).toBe(600);
  });

  it('MAD_TANK_RADIUS constant is 20 cells (aftrmath.ini MTankDistance=20)', () => {
    expect(MAD_TANK_RADIUS).toBe(20);
  });
});

// ── Crusher (drive.cpp:Ok_To_Move) ────────────────────────────────────────────
// C++ drive.cpp — QTNK has crusher=true, kills crushable infantry on entry

describe('QTNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('QTNK crushes enemy infantry when entering their cell', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10); // same cell
    const ctx = makeCombatCtx([e1, qtnk]);
    checkVehicleCrush(ctx, qtnk);
    expect(e1.alive).toBe(false);
  });

  it('QTNK does NOT crush allied infantry', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e1, qtnk]);
    checkVehicleCrush(ctx, qtnk);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('QTNK crusher stat is explicitly true', () => {
    expect(UNIT_STATS.QTNK.crusher).toBe(true);
  });
});

// ── Slowest Vehicle (rules.ini speed comparison) ──────────────────────────────
// C++ rules.ini — QTNK speed=3, tied for slowest vehicle in the game

describe('QTNK slowest vehicle (rules.ini speed comparison)', () => {
  it('speed 3 is slower than Medium Tank (speed 10)', () => {
    expect(UNIT_STATS.QTNK.speed).toBeLessThan(UNIT_STATS['2TNK'].speed);
  });

  it('speed 3 is slower than Heavy Tank (speed 7)', () => {
    expect(UNIT_STATS.QTNK.speed).toBeLessThan(UNIT_STATS['3TNK'].speed);
  });

  it('speed 3 is slower than Mammoth Tank (speed 4)', () => {
    expect(UNIT_STATS.QTNK.speed).toBeLessThan(UNIT_STATS['4TNK'].speed);
  });

  it('speed 3 — no standard vehicle has lower speed', () => {
    const vehicleTypes = Object.keys(UNIT_STATS).filter(
      k => !UNIT_STATS[k].isInfantry && !UNIT_STATS[k].isAircraft && !UNIT_STATS[k].isVessel
    );
    for (const vtype of vehicleTypes) {
      const vstats = UNIT_STATS[vtype];
      if (vstats.speed > 0) {
        expect(vstats.speed).toBeGreaterThanOrEqual(UNIT_STATS.QTNK.speed);
      }
    }
  });
});

// ── Heavy Armor Durability (combat.cpp warhead tables) ────────────────────────
// C++ combat.cpp — QTNK has heavy armor (300 HP). Warhead-vs-armor tables
// make it highly resistant to small arms, moderately resistant to AP/HE.

describe('QTNK heavy armor durability (combat.cpp warhead tables)', () => {
  it('SA vs heavy armor: mult 0.25 (rifles barely scratch)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs heavy armor: mult 0.25 (explosive reduced)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('AP vs heavy armor: mult 1.0 (anti-armor penetrates fully)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('QTNK takes reduced SA damage: 15 * 0.25 = 4 (rounded)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const hpBefore = qtnk.hp;
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    qtnk.takeDamage(damage, 'SA');
    expect(hpBefore - qtnk.hp).toBe(damage);
    expect(damage).toBe(4);
  });

  it('QTNK survives many rifle hits (300 HP / 4 damage = 75 hits)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    // Apply 70 hits — should survive
    for (let i = 0; i < 70; i++) {
      qtnk.takeDamage(damage, 'SA');
    }
    expect(qtnk.alive).toBe(true);
    expect(qtnk.hp).toBe(300 - 70 * damage);
  });

  it('300 HP with heavy armor: Entity starts at full health', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.hp).toBe(300);
    expect(qtnk.maxHp).toBe(300);
    expect(qtnk.alive).toBe(true);
  });
});

// ── Damage Speed Factor (drive.cpp) ──────────────────────────────────────────
// C++ drive.cpp — damaged vehicles move slower. QTNK at speed 3 is even slower
// when damaged below CONDITION_YELLOW threshold.

describe('QTNK damage speed factor (drive.cpp)', () => {
  it('full-health QTNK: damageSpeedFactor = 1.0', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(damageSpeedFactor(qtnk)).toBe(1.0);
  });

  it('heavily damaged QTNK: damageSpeedFactor = 0.75', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    // Bring below CONDITION_YELLOW (0.5 of maxHp)
    qtnk.hp = Math.floor(qtnk.maxHp * 0.25);
    expect(damageSpeedFactor(qtnk)).toBe(0.75);
  });

  it('at exactly 50% HP: damageSpeedFactor = 0.75 (at threshold boundary)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.hp = Math.floor(qtnk.maxHp * 0.5); // CONDITION_YELLOW
    expect(damageSpeedFactor(qtnk)).toBe(0.75);
  });

  it('at 51% HP: damageSpeedFactor = 1.0 (above threshold)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.hp = Math.ceil(qtnk.maxHp * 0.51);
    expect(damageSpeedFactor(qtnk)).toBe(1.0);
  });
});

// ── Vehicle Movement: Stop-Rotate-Move (drive.cpp) ──────────────────────────
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.
// QTNK follows this behavior (unlike infantry which move while rotating).

describe('QTNK stop-rotate-move (drive.cpp)', () => {
  it('QTNK facing N toward target E: does NOT move until rotation completes', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.facing = Dir.N;
    qtnk.desiredFacing = Dir.N;
    qtnk.bodyFacing32 = Dir.N * 4;

    const startX = qtnk.pos.x;
    const startY = qtnk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate first
    const arrived = qtnk.moveToward(targetPos, qtnk.stats.speed);

    // Vehicle should NOT have moved (still rotating)
    expect(arrived).toBe(false);
    expect(qtnk.pos.x).toBe(startX);
    expect(qtnk.pos.y).toBe(startY);
  });

  it('QTNK rot=5 requires multiple ticks to rotate 90 degrees', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.facing = Dir.N;
    qtnk.desiredFacing = Dir.E; // 90 degrees clockwise
    qtnk.bodyFacing32 = Dir.N * 4;

    // Single rotation tick should NOT snap instantly (rot=5 < 8)
    const aligned = qtnk.tickRotation();
    expect(aligned).toBe(false);
    // After first tick, facing should still be mid-rotation
    expect(qtnk.facing).not.toBe(Dir.E);
  });

  it('QTNK eventually completes rotation after enough ticks', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.facing = Dir.N;
    qtnk.desiredFacing = Dir.E;
    qtnk.bodyFacing32 = Dir.N * 4;

    // Tick until rotation completes (should take several ticks with rot=5)
    let aligned = false;
    for (let i = 0; i < 50; i++) {
      qtnk.rotTickedThisFrame = false; // reset per-frame guard
      aligned = qtnk.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(qtnk.facing).toBe(Dir.E);
  });

  it('QTNK moves after rotation completes (arrived at close target)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    // Already facing the right direction
    qtnk.facing = Dir.E;
    qtnk.desiredFacing = Dir.E;
    qtnk.bodyFacing32 = Dir.E * 4;

    const startX = qtnk.pos.x;
    const targetPos = { x: startX + 2, y: qtnk.pos.y }; // very close target

    const arrived = qtnk.moveToward(targetPos, qtnk.stats.speed);
    // speed 3 >= distance 2, should arrive (within lepton quantization tolerance)
    expect(arrived).toBe(true);
    // Lepton quantization: pos.x = leptonX * LP, may not exactly equal targetPos.x
    expect(qtnk.pos.x).toBeCloseTo(targetPos.x, 1);
  });
});

// ── AI Scatter on Damage (techno.cpp) ────────────────────────────────────────
// C++ techno.cpp — AI-controlled units on GUARD scatter when damaged

describe('QTNK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled QTNK on GUARD mission scatters when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
      qtnk.mission = Mission.GUARD;
      const ctx = makeCombatCtx([qtnk]);
      aiScatterOnDamage(ctx, qtnk);
      if (qtnk.mission === Mission.MOVE && qtnk.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled QTNK does NOT scatter', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.Spain, 10, 10);
    qtnk.mission = Mission.GUARD;

    const ctx = makeCombatCtx([qtnk]);
    aiScatterOnDamage(ctx, qtnk);

    expect(qtnk.mission).toBe(Mission.GUARD);
    expect(qtnk.moveTarget).toBeNull();
  });
});

// ── Death / takeDamage (techno.cpp) ──────────────────────────────────────────
// C++ techno.cpp — QTNK dies when HP reaches 0 (normal death, not deployment)

describe('QTNK death by damage (techno.cpp)', () => {
  it('QTNK dies when HP reaches 0', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const killed = qtnk.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(qtnk.alive).toBe(false);
    expect(qtnk.hp).toBe(0);
    expect(qtnk.mission).toBe(Mission.DIE);
    expect(qtnk.animState).toBe(AnimState.DIE);
  });

  it('QTNK survives damage that does not reduce HP to 0', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const killed = qtnk.takeDamage(299, 'AP');
    expect(killed).toBe(false);
    expect(qtnk.alive).toBe(true);
    expect(qtnk.hp).toBe(1);
  });

  it('QTNK is invulnerable during Iron Curtain', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.ironCurtainTick = 100;
    const killed = qtnk.takeDamage(9999, 'AP');
    expect(killed).toBe(false);
    expect(qtnk.alive).toBe(true);
    expect(qtnk.hp).toBe(300);
  });
});

// ── Vehicle Animation (unit.cpp) ─────────────────────────────────────────────
// C++ unit.cpp — QTNK uses vehicle sprite system (32-frame body rotation)

describe('QTNK vehicle animation (unit.cpp)', () => {
  it('QTNK isInfantry = false', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.stats.isInfantry).toBe(false);
  });

  it('QTNK isAnt = false', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.isAnt).toBe(false);
  });

  it('QTNK spriteFrame returns valid number (vehicle body rotation)', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const frame = qtnk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('QTNK starts in IDLE animState', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.alive).toBe(true);
    expect(qtnk.animState).toBe(AnimState.IDLE);
  });

  it('QTNK is not an aircraft and not naval', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    expect(qtnk.isAirUnit).toBe(false);
    expect(qtnk.isNavalUnit).toBe(false);
  });
});

// ── Not Crushable (vehicle — only infantry are crushable) ────────────────────
// C++ infantry.cpp — only infantry have crushable=true. Vehicles are never crushable.

describe('QTNK is not crushable (vehicles cannot be crushed)', () => {
  it('QTNK crushable stat is falsy (vehicles are not crushable)', () => {
    expect(UNIT_STATS.QTNK.crushable).toBeFalsy();
  });

  it('another crusher vehicle does not crush QTNK', () => {
    const qtnk = entityAtCell(UnitType.V_QTNK, House.Spain, 10, 10);
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([qtnk, mammoth]);
    checkVehicleCrush(ctx, mammoth);
    // QTNK is not crushable (it's a vehicle), so it survives
    expect(qtnk.alive).toBe(true);
    expect(qtnk.hp).toBe(qtnk.maxHp);
  });
});
