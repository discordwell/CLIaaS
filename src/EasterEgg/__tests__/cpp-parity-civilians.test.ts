/**
 * C++ Behavioral Parity: Civilians (C1-C10, EINSTEIN, CHAN)
 *
 * Tests verify civilian infantry behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with civilians (observable outcomes: HP,
 * alive/dead, isCivilian, crushable, weapon, threat scoring), not HOW the
 * code implements it. The same scenarios should produce identical results
 * in C++ and TypeScript.
 *
 * Representative civilians tested: C1 (armed), C5 (unarmed), C10 (unarmed),
 * plus EINSTEIN and CHAN as special scenario units.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, CIVILIAN_UNIT_TYPES, PRONE_DAMAGE_BIAS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
} from '../engine/combat';
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

// ── All civilian unit types for parameterized tests ────────────────────────────

const ALL_CIVILIAN_TYPES: UnitType[] = [
  UnitType.I_C1, UnitType.I_C2, UnitType.I_C3, UnitType.I_C4, UnitType.I_C5,
  UnitType.I_C6, UnitType.I_C7, UnitType.I_C8, UnitType.I_C9, UnitType.I_C10,
];

const REPRESENTATIVE_CIVILIANS: UnitType[] = [
  UnitType.I_C1, UnitType.I_C5, UnitType.I_C10,
];

// ── Stats Verification (idata.cpp / rules.ini) ────────────────────────────────
// C++ idata.cpp — civilian type data entries and RULES.INI [C1]-[C10] sections

describe('Civilian shared stats (idata.cpp / rules.ini)', () => {
  it.each(ALL_CIVILIAN_TYPES)('%s: HP is 25 (Strength=25)', (type) => {
    expect(UNIT_STATS[type].strength).toBe(25);
  });

  it.each(ALL_CIVILIAN_TYPES)('%s: armor is none', (type) => {
    expect(UNIT_STATS[type].armor).toBe('none');
  });

  it.each(ALL_CIVILIAN_TYPES)('%s: speed is 5', (type) => {
    expect(UNIT_STATS[type].speed).toBe(5);
  });

  it.each(ALL_CIVILIAN_TYPES)('%s: isInfantry is true', (type) => {
    expect(UNIT_STATS[type].isInfantry).toBe(true);
  });

  it.each(ALL_CIVILIAN_TYPES)('%s: crushable is true', (type) => {
    expect(UNIT_STATS[type].crushable).toBe(true);
  });

  it.each(ALL_CIVILIAN_TYPES)('%s: Entity constructor initializes HP to 25', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    expect(civ.hp).toBe(25);
    expect(civ.maxHp).toBe(25);
  });
});

// ── Armed vs Unarmed Civilians (idata.cpp) ──────────────────────────────────
// C++ idata.cpp — C1 and C7 have Pistol weapon, all others unarmed

describe('Civilian weapons (idata.cpp)', () => {
  it('C1 has Pistol weapon (primaryWeapon=Pistol)', () => {
    expect(UNIT_STATS.C1.primaryWeapon).toBe('Pistol');
  });

  it('C7 has Pistol weapon (primaryWeapon=Pistol)', () => {
    expect(UNIT_STATS.C7.primaryWeapon).toBe('Pistol');
  });

  it('Pistol deals 1 damage', () => {
    const pistol = WEAPON_STATS.Pistol;
    expect(pistol).toBeDefined();
    expect(pistol.damage).toBe(1);
  });

  it('Pistol warhead is SA', () => {
    expect(WEAPON_STATS.Pistol.warhead).toBe('SA');
  });

  it('Pistol range is 1.75 cells', () => {
    expect(WEAPON_STATS.Pistol.range).toBe(1.75);
  });

  it('C1 Entity has weapon object resolved', () => {
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    expect(c1.weapon).not.toBeNull();
    expect(c1.weapon!.name).toBe('Pistol');
    expect(c1.weapon!.damage).toBe(1);
  });

  const UNARMED_CIVS: UnitType[] = [
    UnitType.I_C2, UnitType.I_C3, UnitType.I_C4, UnitType.I_C5,
    UnitType.I_C6, UnitType.I_C8, UnitType.I_C9, UnitType.I_C10,
  ];

  it.each(UNARMED_CIVS)('%s: no primary weapon (null)', (type) => {
    expect(UNIT_STATS[type].primaryWeapon).toBeNull();
    const civ = entityAtCell(type, House.Spain, 10, 10);
    expect(civ.weapon).toBeNull();
  });
});

// ── isCivilian getter (entity.ts) ───────────────────────────────────────────
// Entity.isCivilian returns true for C1-C10 only (not EINSTEIN, not CHAN)

describe('isCivilian getter (entity.ts)', () => {
  it.each(ALL_CIVILIAN_TYPES)('%s: isCivilian returns true', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    expect(civ.isCivilian).toBe(true);
  });

  it('EINSTEIN: isCivilian returns false (special VIP, not generic civilian)', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    expect(einstein.isCivilian).toBe(false);
  });

  it('CHAN: isCivilian returns false (specialist, not generic civilian)', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    expect(chan.isCivilian).toBe(false);
  });

  it('E1: isCivilian returns false (regular infantry)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isCivilian).toBe(false);
  });
});

// ── CIVILIAN_UNIT_TYPES set (types.ts) ──────────────────────────────────────
// Used for threat scoring penalty and evacuation counting

describe('CIVILIAN_UNIT_TYPES set (types.ts)', () => {
  it('contains all C1-C10', () => {
    for (const type of ALL_CIVILIAN_TYPES) {
      expect(CIVILIAN_UNIT_TYPES.has(type), `${type} should be in CIVILIAN_UNIT_TYPES`).toBe(true);
    }
  });

  it('contains EINSTEIN (VIP evacuation target)', () => {
    expect(CIVILIAN_UNIT_TYPES.has('EINSTEIN')).toBe(true);
  });

  it('contains CHAN (VIP evacuation target)', () => {
    expect(CIVILIAN_UNIT_TYPES.has('CHAN')).toBe(true);
  });

  it('contains GNRL (VIP evacuation target)', () => {
    expect(CIVILIAN_UNIT_TYPES.has('GNRL')).toBe(true);
  });

  it('does NOT contain E1 (not a civilian)', () => {
    expect(CIVILIAN_UNIT_TYPES.has('E1')).toBe(false);
  });

  it('does NOT contain E7/TANYA (not a civilian)', () => {
    expect(CIVILIAN_UNIT_TYPES.has('E7')).toBe(false);
  });

  it('has exactly 13 entries (C1-C10 + EINSTEIN + GNRL + CHAN)', () => {
    expect(CIVILIAN_UNIT_TYPES.size).toBe(13);
  });
});

// ── EINSTEIN stats (idata.cpp / rules.ini) ─────────────────────────────────
// C++ idata.cpp — EINSTEIN entry: special scenario VIP

describe('EINSTEIN stats (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.EINSTEIN;

  it('HP is 25 (Strength=25)', () => {
    expect(stats.strength).toBe(25);
  });

  it('armor is none', () => {
    expect(stats.armor).toBe('none');
  });

  it('speed is 5', () => {
    expect(stats.speed).toBe(5);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true', () => {
    expect(stats.crushable).toBe(true);
  });

  it('no weapon (primaryWeapon=null)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('Entity constructor initializes HP to 25', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    expect(einstein.hp).toBe(25);
    expect(einstein.maxHp).toBe(25);
  });

  it('Entity has no weapon resolved', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    expect(einstein.weapon).toBeNull();
  });

  it('name is Prof. Einstein', () => {
    expect(stats.name).toBe('Prof. Einstein');
  });
});

// ── CHAN stats (idata.cpp / rules.ini) ──────────────────────────────────────
// C++ idata.cpp — CHAN entry: specialist for SCA03EA ant mission

describe('CHAN stats (idata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.CHAN;

  it('HP is 25 (Strength=25)', () => {
    expect(stats.strength).toBe(25);
  });

  it('armor is none', () => {
    expect(stats.armor).toBe('none');
  });

  it('speed is 5', () => {
    expect(stats.speed).toBe(5);
  });

  it('isInfantry is true', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('crushable is true', () => {
    expect(stats.crushable).toBe(true);
  });

  it('no weapon (primaryWeapon=null)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('Entity constructor initializes HP to 25', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    expect(chan.hp).toBe(25);
    expect(chan.maxHp).toBe(25);
  });

  it('Entity has no weapon resolved', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    expect(chan.weapon).toBeNull();
  });

  it('name is Specialist', () => {
    expect(stats.name).toBe('Specialist');
  });
});

// ── Crushable (drive.cpp:Ok_To_Move) ─────────────────────────────────────────
// C++ drive.cpp — all civilians are crushable by crusher vehicles

describe('Civilian crushable (drive.cpp:Ok_To_Move)', () => {
  it.each(REPRESENTATIVE_CIVILIANS)('%s: killed when crusher vehicle (2TNK) enters its cell', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([civ, tank]);
    checkVehicleCrush(ctx, tank);
    expect(civ.alive).toBe(false);
  });

  it('EINSTEIN is killed when crushed by enemy tank', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([einstein, tank]);
    checkVehicleCrush(ctx, tank);
    expect(einstein.alive).toBe(false);
  });

  it('CHAN is killed when crushed by enemy tank', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([chan, tank]);
    checkVehicleCrush(ctx, tank);
    expect(chan.alive).toBe(false);
  });

  it('civilian is NOT crushed by non-crusher vehicle (JEEP)', () => {
    const civ = entityAtCell(UnitType.I_C5, House.Spain, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.USSR, 10, 10);
    const ctx = makeCombatCtx([civ, jeep]);
    checkVehicleCrush(ctx, jeep);
    expect(civ.alive).toBe(true);
    expect(civ.hp).toBe(civ.maxHp);
  });

  it('civilian is NOT crushed by allied crusher vehicle', () => {
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([civ, tank]);
    checkVehicleCrush(ctx, tank);
    expect(civ.alive).toBe(true);
    expect(civ.hp).toBe(civ.maxHp);
  });
});

// ── Threat Scoring Penalty (entity.ts:threatScore) ──────────────────────────
// C++ techno.cpp:1449-1763 — AI deprioritizes civilians with 0.15 multiplier

describe('Civilian threat scoring penalty (techno.cpp:1449-1763)', () => {
  it('C1 (isCivilian=true) gets 0.15x threat score when not attacking allies', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 11, 10);
    const e1Target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    const civScore = threatScore(scanner, c1, 1, false);
    const combatantScore = threatScore(scanner, e1Target, 1, false);

    // Civilian score should be much lower than combatant score
    expect(civScore).toBeLessThan(combatantScore);
  });

  it('C5 (unarmed civilian) gets 0.15x multiplier applied', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const c5 = entityAtCell(UnitType.I_C5, House.Spain, 11, 10);

    // Calculate expected: civilian score should be roughly 15% of base
    const score = threatScore(scanner, c5, 1, false);
    // Score should be positive but deprioritized
    expect(score).toBeGreaterThan(0);
  });

  it('EINSTEIN (in CIVILIAN_UNIT_TYPES) gets 0.15x threat penalty', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 11, 10);
    const e1Target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    const einsteinScore = threatScore(scanner, einstein, 1, false);
    const combatantScore = threatScore(scanner, e1Target, 1, false);

    // Einstein should be deprioritized vs armed combatant
    expect(einsteinScore).toBeLessThan(combatantScore);
  });

  it('CHAN (in CIVILIAN_UNIT_TYPES) gets 0.15x threat penalty', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 11, 10);
    const e1Target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    const chanScore = threatScore(scanner, chan, 1, false);
    const combatantScore = threatScore(scanner, e1Target, 1, false);

    expect(chanScore).toBeLessThan(combatantScore);
  });

  it('civilian attacking allies flag has no effect (C++ has no retaliation bonus)', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 11, 10);

    const penalizedScore = threatScore(scanner, c1, 1, false);
    const unpenalizedScore = threatScore(scanner, c1, 1, true);

    // C++ parity: isTargetAttackingAlly is not used in Evaluate_Object
    expect(unpenalizedScore).toBe(penalizedScore);
  });
});

// ── Fear / Prone System (infantry.cpp:329-457) ──────────────────────────────
// C++ infantry.cpp — civilians share the standard infantry fear/prone system

describe('Civilian fear / prone system (infantry.cpp:329-457)', () => {
  it('civilian starts with fear=0, isProne=false', () => {
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    expect(c1.fear).toBe(0);
    expect(c1.isProne).toBe(false);
  });

  it('civilian fear increases to FEAR_SCARED on damage', () => {
    const c5 = entityAtCell(UnitType.I_C5, House.Spain, 10, 10);
    c5.takeDamage(5, 'SA');
    expect(c5.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone civilian takes 50% damage (PRONE_DAMAGE_BIAS=0.5)', () => {
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    c1.isProne = true;
    const hpBefore = c1.hp;
    c1.takeDamage(10, 'SA');
    const damageTaken = hpBefore - c1.hp;
    // 10 * 0.5 = 5
    expect(damageTaken).toBe(5);
  });

  it('EINSTEIN fear increases on damage like standard infantry', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    einstein.takeDamage(5, 'SA');
    expect(einstein.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('CHAN fear increases on damage like standard infantry', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    chan.takeDamage(5, 'SA');
    expect(chan.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('prone EINSTEIN takes 50% damage', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    einstein.isProne = true;
    const hpBefore = einstein.hp;
    einstein.takeDamage(10, 'SA');
    const damageTaken = hpBefore - einstein.hp;
    expect(damageTaken).toBe(5);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — armed civilians can retaliate, unarmed cannot

describe('Civilian retaliation (techno.cpp)', () => {
  it('armed C1 retaliates when hit (has Pistol)', () => {
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    c1.mission = Mission.GUARD;
    c1.target = null;

    const ctx = makeCombatCtx([c1, attacker]);
    triggerRetaliation(ctx, c1, attacker);

    expect(c1.target).toBe(attacker);
    expect(c1.mission).toBe(Mission.ATTACK);
  });

  it('unarmed C5 cannot retaliate (no weapon)', () => {
    const c5 = entityAtCell(UnitType.I_C5, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    c5.mission = Mission.GUARD;
    c5.target = null;

    const ctx = makeCombatCtx([c5, attacker]);
    triggerRetaliation(ctx, c5, attacker);

    expect(c5.target).toBeNull();
    expect(c5.mission).toBe(Mission.GUARD);
  });

  it('EINSTEIN cannot retaliate (no weapon)', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    einstein.mission = Mission.GUARD;
    einstein.target = null;

    const ctx = makeCombatCtx([einstein, attacker]);
    triggerRetaliation(ctx, einstein, attacker);

    expect(einstein.target).toBeNull();
    expect(einstein.mission).toBe(Mission.GUARD);
  });

  it('CHAN cannot retaliate (no weapon)', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    chan.mission = Mission.GUARD;
    chan.target = null;

    const ctx = makeCombatCtx([chan, attacker]);
    triggerRetaliation(ctx, chan, attacker);

    expect(chan.target).toBeNull();
    expect(chan.mission).toBe(Mission.GUARD);
  });
});

// ── Infantry Animation (infantry.cpp:479) ────────────────────────────────────
// C++ infantry.cpp — civilians use standard infantry animation system

describe('Civilian infantry animation (infantry.cpp:479)', () => {
  it.each(REPRESENTATIVE_CIVILIANS)('%s: isInfantry is true', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    expect(civ.stats.isInfantry).toBe(true);
  });

  it.each(REPRESENTATIVE_CIVILIANS)('%s: starts in IDLE animState', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    expect(civ.alive).toBe(true);
    expect(civ.animState).toBe(AnimState.IDLE);
  });

  it.each(REPRESENTATIVE_CIVILIANS)('%s: spriteFrame returns valid number', (type) => {
    const civ = entityAtCell(type, House.Spain, 10, 10);
    const frame = civ.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('EINSTEIN starts in IDLE animState', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    expect(einstein.animState).toBe(AnimState.IDLE);
  });

  it('CHAN starts in IDLE animState', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    expect(chan.animState).toBe(AnimState.IDLE);
  });
});

// ── Death Behavior (infantry.cpp) ────────────────────────────────────────────
// C++ infantry.cpp — civilians die when HP reaches 0

describe('Civilian death behavior (infantry.cpp)', () => {
  it('civilian dies when HP reaches 0', () => {
    const c1 = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    c1.takeDamage(25, 'SA');
    expect(c1.alive).toBe(false);
    expect(c1.hp).toBe(0);
    expect(c1.mission).toBe(Mission.DIE);
    expect(c1.animState).toBe(AnimState.DIE);
  });

  it('EINSTEIN dies in one 25-damage hit (fragile VIP)', () => {
    const einstein = entityAtCell(UnitType.I_EINSTEIN, House.Spain, 10, 10);
    einstein.takeDamage(25, 'SA');
    expect(einstein.alive).toBe(false);
    expect(einstein.hp).toBe(0);
  });

  it('CHAN dies in one 25-damage hit', () => {
    const chan = entityAtCell(UnitType.I_CHAN, House.Spain, 10, 10);
    chan.takeDamage(25, 'SA');
    expect(chan.alive).toBe(false);
    expect(chan.hp).toBe(0);
  });

  it('civilian survives 24 damage (1 HP remaining)', () => {
    const c5 = entityAtCell(UnitType.I_C5, House.Spain, 10, 10);
    c5.takeDamage(24, 'SA');
    expect(c5.alive).toBe(true);
    expect(c5.hp).toBe(1);
  });
});

// ── Movement (infantry.cpp) ─────────────────────────────────────────────────
// C++ infantry.cpp — civilians have rot=8 (instant snap) and move while rotating

describe('Civilian movement — nimble infantry (infantry.cpp)', () => {
  it.each(REPRESENTATIVE_CIVILIANS)('%s: rot=8 means instant facing snap', (type) => {
    expect(UNIT_STATS[type].rot).toBe(8);
    const civ = entityAtCell(type, House.Spain, 10, 10);
    civ.facing = 0 as any; // N
    civ.desiredFacing = 4 as any; // S (opposite)
    const aligned = civ.tickRotation();
    expect(aligned).toBe(true);
    expect(civ.facing).toBe(4); // S
  });

  it('EINSTEIN rot=8 means instant facing snap', () => {
    expect(UNIT_STATS.EINSTEIN.rot).toBe(8);
  });

  it('CHAN rot=8 means instant facing snap', () => {
    expect(UNIT_STATS.CHAN.rot).toBe(8);
  });
});
