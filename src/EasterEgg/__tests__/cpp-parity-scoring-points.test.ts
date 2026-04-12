/**
 * CPP Parity: Scoring & Points System — End-to-End Pipeline Verification
 *
 * This test file verifies the FULL scoring pipeline from rules.ini -> TS runtime:
 *
 *   1. INI Points= parsed correctly (rules.ini + aftrmath.ini with override semantics)
 *   2. UNIT_STATS.points matches INI for every unit/building type
 *   3. PRODUCTION_ITEMS.points matches INI for every buildable item
 *   4. Cross-consistency: UNIT_STATS.points === PRODUCTION_ITEMS.points for shared types
 *   5. Entity-level UNIT_POINTS lookup uses points (not cost) for threat scoring
 *   6. C++ Value() = 2 * Points + kills — verified at entity level
 *   7. Combat PointTotal tracking uses stats.points (not stats.cost)
 *   8. Aftermath override semantics: aftrmath.ini Points= overrides rules.ini
 *   9. Cost != Points divergence detection — ensures engine separates these concepts
 *  10. STRUCTURE_POINTS for non-buildable map objects
 *
 * C++ source references (score.cpp and techno.cpp are not in the repo;
 * line numbers are from the original Westwood C++ source):
 *   techno.cpp:6290     Risk = Reward = Points (from rules.ini Points= field)
 *   techno.cpp:3911     source->House->PointTotal += points (kill credit)
 *   techno.cpp:3990     House->PointTotal -= points (loss debit)
 *   techno.cpp:4519     Value() = Risk() + Reward = 2 * Points
 *   techno.cpp:1651     value = object->Value() + object->Crew.Kills
 *   score.cpp:546-597   Presentation() uses PointTotal for score screen
 *   rules.ini [X]       Points= per unit/building section
 *   aftrmath.ini [X]    Aftermath overrides (same section names, later load order)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UNIT_STATS, PRODUCTION_ITEMS, STRUCTURE_POINTS,
  UnitType, House, CELL_SIZE,
  HOUSE_FACTION,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  handleUnitDeath,
  checkVehicleCrush,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// INI Parser — parses rules.ini and aftrmath.ini for authoritative values
// ---------------------------------------------------------------------------

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

const rulesPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const aftermathPath = join(__dirname, '../../..', 'public/ra/assets/aftrmath.ini');
const rulesINI = parseINI(readFileSync(rulesPath, 'utf-8'));
const aftermathINI = parseINI(readFileSync(aftermathPath, 'utf-8'));

/** Get Points= for a section, with aftrmath.ini overriding rules.ini (C++ load order) */
function getIniPoints(section: string): number | undefined {
  const aftVal = aftermathINI[section]?.Points;
  if (aftVal !== undefined) return parseInt(aftVal, 10);
  const rulesVal = rulesINI[section]?.Points;
  if (rulesVal !== undefined) return parseInt(rulesVal, 10);
  return undefined;
}

/** Get Cost= for a section, with aftrmath.ini overriding rules.ini */
function getIniCost(section: string): number | undefined {
  const aftVal = aftermathINI[section]?.Cost;
  if (aftVal !== undefined) return parseInt(aftVal, 10);
  const rulesVal = rulesINI[section]?.Cost;
  if (rulesVal !== undefined) return parseInt(rulesVal, 10);
  return undefined;
}

/** Collect ALL sections that have Points= from both INI files (merged) */
function getAllIniPointsSections(): Map<string, number> {
  const result = new Map<string, number>();
  for (const section of Object.keys(rulesINI)) {
    if (rulesINI[section].Points !== undefined) {
      result.set(section, parseInt(rulesINI[section].Points, 10));
    }
  }
  for (const section of Object.keys(aftermathINI)) {
    if (aftermathINI[section].Points !== undefined) {
      result.set(section, parseInt(aftermathINI[section].Points, 10));
    }
  }
  return result;
}

const ALL_INI_POINTS = getAllIniPointsSections();

// ---------------------------------------------------------------------------
// Helpers for TS data lookup
// ---------------------------------------------------------------------------

function getTsUnitStatsPoints(type: string): number | undefined {
  return UNIT_STATS[type]?.points;
}

function getTsProdItemPoints(type: string): number | undefined {
  return PRODUCTION_ITEMS.find(i => i.type === type)?.points;
}

function getTsPoints(type: string): number | undefined {
  return getTsUnitStatsPoints(type) ?? getTsProdItemPoints(type) ?? STRUCTURE_POINTS[type];
}

/** Recreate UNIT_POINTS exactly as entity.ts does (line 18-21) */
function buildUnitPointsLookup(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of PRODUCTION_ITEMS) {
    result[item.type] = item.points ?? item.cost;
  }
  return result;
}

const UNIT_POINTS = buildUnitPointsLookup();

// ---------------------------------------------------------------------------
// Combat context helper
// ---------------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
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
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
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

// ===========================================================================
// 1. INI Parsing Sanity
// ===========================================================================

describe('INI parsing sanity', () => {
  it('rules.ini has >100 sections with Points=', () => {
    let count = 0;
    for (const s of Object.keys(rulesINI)) {
      if (rulesINI[s].Points !== undefined) count++;
    }
    expect(count).toBeGreaterThan(100);
  });

  it('aftrmath.ini has >20 sections with Points=', () => {
    let count = 0;
    for (const s of Object.keys(aftermathINI)) {
      if (aftermathINI[s].Points !== undefined) count++;
    }
    expect(count).toBeGreaterThan(20);
  });

  it('merged INI covers all combat unit/building types', () => {
    // Every combat-relevant section should have Points=
    const CORE_TYPES = [
      'E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'THF', 'MEDI',
      '1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'JEEP', 'APC', 'ARTY', 'HARV', 'MCV',
      'SS', 'DD', 'CA', 'LST', 'PT',
      'MIG', 'YAK', 'TRAN', 'HELI', 'HIND',
      'FACT', 'POWR', 'PROC', 'WEAP', 'BARR', 'TENT', 'DOME',
      'TSLA', 'GUN', 'PBOX', 'SAM', 'GAP',
    ];
    for (const type of CORE_TYPES) {
      expect(ALL_INI_POINTS.has(type), `${type} should have Points= in INI`).toBe(true);
    }
  });
});

// ===========================================================================
// 2. Points != Cost — C++ treats these as SEPARATE concepts
//    (techno.cpp:6290: Risk = Reward = Points, NOT Cost)
// ===========================================================================

describe('Points != Cost — these are separate concepts in C++ (techno.cpp:6290)', () => {

  // Document all types where Points != Cost. This is a fundamental C++ design:
  // Points= is for scoring/threat, Cost= is for purchasing/economy.
  const DIVERGENT_TYPES: [string, string][] = [
    // [type, category] — every type where INI Points != INI Cost
    ['E1', 'infantry'],       // Cost=100, Points=5
    ['E2', 'infantry'],       // Cost=160, Points=10
    ['E3', 'infantry'],       // Cost=300, Points=10
    ['E4', 'infantry'],       // Cost=300, Points=15
    ['E6', 'infantry'],       // Cost=500, Points=20
    ['E7', 'infantry'],       // Cost=1200, Points=25
    ['DOG', 'infantry'],      // Cost=200, Points=5
    ['SPY', 'infantry'],      // Cost=500, Points=15
    ['THF', 'infantry'],      // Cost=500, Points=10
    ['MEDI', 'infantry'],     // Cost=800, Points=15
    ['1TNK', 'vehicle'],      // Cost=700, Points=30
    ['2TNK', 'vehicle'],      // Cost=800, Points=40
    ['3TNK', 'vehicle'],      // Cost=950, Points=50
    ['4TNK', 'vehicle'],      // Cost=1700, Points=60
    ['V2RL', 'vehicle'],      // Cost=700, Points=40
    ['JEEP', 'vehicle'],      // Cost=600, Points=20
    ['APC', 'vehicle'],       // Cost=800, Points=25
    ['ARTY', 'vehicle'],      // Cost=600, Points=35
    ['HARV', 'vehicle'],      // Cost=1400, Points=55
    ['MCV', 'vehicle'],       // Cost=2500, Points=60
    ['MNLY', 'vehicle'],      // Cost=800, Points=50
    ['MRJ', 'vehicle'],       // Cost=600, Points=30
    ['MGG', 'vehicle'],       // Cost=600, Points=40
    ['TRUK', 'vehicle'],      // Cost=500, Points=5
    ['SS', 'naval'],          // Cost=950, Points=45
    ['DD', 'naval'],          // Cost=1000, Points=50
    ['CA', 'naval'],          // Cost=2000, Points=60
    ['LST', 'naval'],         // Cost=700, Points=25
    ['PT', 'naval'],          // Cost=500, Points=30
    ['MIG', 'aircraft'],      // Cost=1200, Points=50
    ['YAK', 'aircraft'],      // Cost=800, Points=25
    ['TRAN', 'aircraft'],     // Cost=1200, Points=35
    ['HELI', 'aircraft'],     // Cost=1200, Points=50
    ['HIND', 'aircraft'],     // Cost=1200, Points=40
    ['STNK', 'expansion'],    // Cost=800, Points=25
    ['CTNK', 'expansion'],    // Cost=2400, Points=25
    ['TTNK', 'expansion'],    // Cost=1500, Points=30
    ['QTNK', 'expansion'],    // Cost=2300, Points=60
    ['DTRK', 'expansion'],    // Cost=2400, Points=5
    ['MSUB', 'expansion'],    // Cost=1650, Points=45
    ['SHOK', 'expansion'],    // Cost=900, Points=15
    ['MECH', 'expansion'],    // Cost=950, Points=15
  ];

  for (const [type] of DIVERGENT_TYPES) {
    it(`${type}: INI Points= !== INI Cost= — TS must track both separately`, () => {
      const iniPoints = getIniPoints(type);
      const iniCost = getIniCost(type);
      expect(iniPoints, `${type} should have Points= in INI`).toBeDefined();
      expect(iniCost, `${type} should have Cost= in INI`).toBeDefined();
      expect(iniPoints).not.toBe(iniCost);
    });
  }

  it('TS UNIT_STATS stores points separately from cost for all units', () => {
    const missingPoints: string[] = [];
    for (const [type] of DIVERGENT_TYPES) {
      const stats = UNIT_STATS[type];
      if (!stats) continue; // not all divergent types are in UNIT_STATS
      if (stats.points === undefined) {
        missingPoints.push(type);
      }
    }
    expect(missingPoints, `Types missing points field in UNIT_STATS: ${missingPoints.join(', ')}`).toEqual([]);
  });

  it('TS PRODUCTION_ITEMS stores points separately from cost for all buildable items', () => {
    const missingPoints: string[] = [];
    for (const [type] of DIVERGENT_TYPES) {
      const item = PRODUCTION_ITEMS.find(i => i.type === type);
      if (!item) continue; // not all divergent types are buildable
      if (item.points === undefined) {
        missingPoints.push(type);
      }
    }
    expect(missingPoints, `Types missing points field in PRODUCTION_ITEMS: ${missingPoints.join(', ')}`).toEqual([]);
  });
});

// ===========================================================================
// 3. Cross-consistency: UNIT_STATS.points === PRODUCTION_ITEMS.points
//    For types that exist in both, the values must agree.
// ===========================================================================

describe('Cross-consistency: UNIT_STATS.points === PRODUCTION_ITEMS.points', () => {

  const sharedTypes = new Set<string>();
  for (const item of PRODUCTION_ITEMS) {
    if (UNIT_STATS[item.type]) sharedTypes.add(item.type);
  }

  for (const type of sharedTypes) {
    it(`${type}: UNIT_STATS.points === PRODUCTION_ITEMS.points`, () => {
      const unitStatsPoints = UNIT_STATS[type].points;
      const prodPoints = PRODUCTION_ITEMS.find(i => i.type === type)!.points;
      expect(unitStatsPoints, `${type} UNIT_STATS.points should be defined`).toBeDefined();
      expect(prodPoints, `${type} PRODUCTION_ITEMS.points should be defined`).toBeDefined();
      expect(unitStatsPoints).toBe(prodPoints);
    });
  }

  it('at least 30 types are shared between UNIT_STATS and PRODUCTION_ITEMS', () => {
    expect(sharedTypes.size).toBeGreaterThanOrEqual(30);
  });
});

// ===========================================================================
// 4. UNIT_POINTS lookup uses Points (not Cost)
//    entity.ts:18-21 builds UNIT_POINTS[type] = item.points ?? item.cost
//    When points is defined, it should use points, NOT fall back to cost.
// ===========================================================================

describe('UNIT_POINTS lookup uses Points not Cost (entity.ts:18-21)', () => {

  it('UNIT_POINTS built from PRODUCTION_ITEMS uses points when available', () => {
    const mismatches: string[] = [];
    for (const item of PRODUCTION_ITEMS) {
      const iniPoints = getIniPoints(item.type);
      if (iniPoints === undefined) continue;
      const lookup = UNIT_POINTS[item.type];
      if (lookup !== iniPoints) {
        mismatches.push(`${item.type}: UNIT_POINTS=${lookup}, INI Points=${iniPoints}`);
      }
    }
    expect(mismatches, `UNIT_POINTS mismatches: ${mismatches.join('; ')}`).toEqual([]);
  });

  // Critical edge cases where Points << Cost
  // NOTE: Only types in PRODUCTION_ITEMS appear in UNIT_POINTS lookup.
  // MCV is not in PRODUCTION_ITEMS (you deploy an MCV into FACT, not build it).
  const CRITICAL_DIVERGENCES: [string, number, number][] = [
    // [type, expected Points, cost that must NOT be used]
    ['E1',   5,    100],
    ['E7',   25,   1200],
    ['4TNK', 60,   1700],
    ['CTNK', 25,   2400],
    ['DTRK', 5,    2400],
    ['HARV', 55,   1400],
  ];

  for (const [type, expectedPoints, wrongCost] of CRITICAL_DIVERGENCES) {
    it(`${type}: UNIT_POINTS=${expectedPoints} (Points), NOT ${wrongCost} (Cost)`, () => {
      expect(UNIT_POINTS[type]).toBe(expectedPoints);
      expect(UNIT_POINTS[type]).not.toBe(wrongCost);
    });
  }
});

// ===========================================================================
// 5. C++ Value() = 2 * Points + kills (techno.cpp:4519, 1651)
//    The threat scoring formula in entity.ts must use this, not 2*Cost+kills.
// ===========================================================================

describe('C++ Value() = 2 * Points + kills (techno.cpp:4519, 1651)', () => {

  const VALUE_TESTS: [string, UnitType, number, number][] = [
    // [typeName, unitType, iniPoints, expectedValue (2*points, kills=0)]
    ['E1',   UnitType.I_E1,   5,   10],
    ['E7',   UnitType.I_TANYA, 25,  50],
    ['3TNK', UnitType.V_3TNK, 50,  100],
    ['4TNK', UnitType.V_4TNK, 60,  120],
    ['HARV', UnitType.V_HARV, 55,  110],
    ['SS',   UnitType.V_SS,   45,  90],
    ['HELI', UnitType.V_HELI, 50,  100],
  ];

  for (const [typeName, unitType, iniPoints, expectedValue] of VALUE_TESTS) {
    it(`${typeName}: Value() = 2*${iniPoints} = ${expectedValue} (kills=0)`, () => {
      const entity = entityAtCell(unitType, House.USSR, 10, 10);
      const points = entity.stats.points ?? UNIT_POINTS[entity.type] ?? entity.stats.strength;
      const value = Math.trunc(points * 2) + entity.kills;
      expect(entity.kills).toBe(0);
      expect(points).toBe(iniPoints);
      expect(value).toBe(expectedValue);
    });

    it(`${typeName}: Value() with 3 kills = ${expectedValue + 3}`, () => {
      const entity = entityAtCell(unitType, House.USSR, 10, 10);
      entity.kills = 3;
      const points = entity.stats.points ?? UNIT_POINTS[entity.type] ?? entity.stats.strength;
      const value = Math.trunc(points * 2) + entity.kills;
      expect(value).toBe(expectedValue + 3);
    });
  }

  it('E1 Value() must NOT be 2*100=200 (that would be 2*Cost)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const points = e1.stats.points ?? UNIT_POINTS[e1.type] ?? e1.stats.strength;
    const value = Math.trunc(points * 2) + e1.kills;
    // Cost=100 would give Value=200, but Points=5 gives Value=10
    expect(value).not.toBe(200);
    expect(value).toBe(10);
  });

  it('DTRK Value() must NOT be 2*2400=4800 (that would be 2*Cost)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const points = dtrk.stats.points ?? UNIT_POINTS[dtrk.type] ?? dtrk.stats.strength;
    const value = Math.trunc(points * 2) + dtrk.kills;
    // Cost=2400 would give Value=4800, but Points=5 gives Value=10
    expect(value).not.toBe(4800);
    expect(value).toBe(10);
  });
});

// ===========================================================================
// 6. Combat PointTotal uses stats.points (techno.cpp:3911, 3990)
//    When a unit dies, pointTotal += victim.stats.points (not cost).
// ===========================================================================

describe('Combat PointTotal uses stats.points (techno.cpp:3911, 3990)', () => {

  it('killing E1 adds 5 to pointTotal (Points=5), not 100 (Cost)', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    enemy.hp = 0;
    enemy.alive = false;
    const ctx = makeCombatCtx([enemy]);

    handleUnitDeath(ctx, enemy, {
      attackerIsPlayer: true,
      trackLoss: false,
      friendlyFireLoss: false,
    });

    const iniPoints = getIniPoints('E1')!;
    expect(ctx.pointTotal).toBe(iniPoints);
    expect(ctx.pointTotal).toBe(5);
    expect(ctx.pointTotal).not.toBe(100); // Cost
  });

  it('killing 4TNK adds 60 to pointTotal (Points=60), not 1700 (Cost)', () => {
    const enemy = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    enemy.hp = 0;
    enemy.alive = false;
    const ctx = makeCombatCtx([enemy]);

    handleUnitDeath(ctx, enemy, {
      attackerIsPlayer: true,
      trackLoss: false,
      friendlyFireLoss: false,
    });

    const iniPoints = getIniPoints('4TNK')!;
    expect(ctx.pointTotal).toBe(iniPoints);
    expect(ctx.pointTotal).toBe(60);
    expect(ctx.pointTotal).not.toBe(1700);
  });

  it('losing E7 subtracts 25 from pointTotal (Points=25), not 1200 (Cost)', () => {
    const player = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    player.hp = 0;
    player.alive = false;
    const ctx = makeCombatCtx([player]);

    handleUnitDeath(ctx, player, {
      attackerIsPlayer: false,
      trackLoss: true,
      friendlyFireLoss: false,
    });

    const iniPoints = getIniPoints('E7')!;
    expect(ctx.pointTotal).toBe(-iniPoints);
    expect(ctx.pointTotal).toBe(-25);
    expect(ctx.pointTotal).not.toBe(-1200);
  });

  it('net pointTotal from mixed battle matches INI Points (not Cost)', () => {
    // Kill 2 E1 (+5 each = +10), lose 1 3TNK (-50) => net = -40
    const e1a = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const e1b = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 20, 10);
    e1a.hp = 0; e1a.alive = false;
    e1b.hp = 0; e1b.alive = false;
    tank.hp = 0; tank.alive = false;

    const ctx = makeCombatCtx([e1a, e1b, tank]);

    handleUnitDeath(ctx, e1a, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });
    handleUnitDeath(ctx, e1b, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });
    handleUnitDeath(ctx, tank, { attackerIsPlayer: false, trackLoss: true, friendlyFireLoss: false });

    const e1Pts = getIniPoints('E1')!;
    const tankPts = getIniPoints('3TNK')!;
    expect(ctx.pointTotal).toBe(e1Pts + e1Pts - tankPts);
    expect(ctx.pointTotal).toBe(5 + 5 - 50);
    expect(ctx.pointTotal).toBe(-40);
  });
});

// ===========================================================================
// 7. Vehicle crush uses stats.points for scoring (combat.ts:569-583)
// ===========================================================================

describe('Vehicle crush uses stats.points for scoring (combat.ts:569-583)', () => {

  it('crushing E1 adds 5 to pointTotal (not 100)', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    const iniPoints = getIniPoints('E1')!;
    expect(ctx.pointTotal).toBe(iniPoints);
    expect(ctx.pointTotal).toBe(5);
  });

  it('enemy crushing player E3 subtracts 10 (not 300)', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    const iniPoints = getIniPoints('E3')!;
    expect(ctx.pointTotal).toBe(-iniPoints);
    expect(ctx.pointTotal).toBe(-10);
  });
});

// ===========================================================================
// 8. Aftermath override semantics
//    aftrmath.ini overrides rules.ini for sections that appear in both.
//    Key case: 4TNK Points=60 in both files (no change), but LST is 25 in both.
//    STNK/CTNK/TTNK/etc. are ONLY in aftrmath.ini.
// ===========================================================================

describe('Aftermath override semantics (aftrmath.ini overrides rules.ini)', () => {

  // Types that exist in BOTH INI files — aftermath should win
  const BOTH_FILES: string[] = ['4TNK', 'LST', 'FACF', 'WEAF', 'DOMF', 'C2', 'C3', 'C4', 'C5', 'C6', 'C9',
    'DOG', 'E3', 'GNRL', 'CHAN', 'DELPHI', 'MISS', 'BIO'];

  for (const type of BOTH_FILES) {
    it(`${type}: aftermath overrides rules.ini (or matches)`, () => {
      const aftPoints = aftermathINI[type]?.Points;
      const rulesPoints = rulesINI[type]?.Points;
      // At least one must exist
      expect(aftPoints !== undefined || rulesPoints !== undefined, `${type} should have Points= in at least one INI file`).toBe(true);

      // If aftermath defines it, the merged value must equal aftermath
      if (aftPoints !== undefined) {
        expect(getIniPoints(type)).toBe(parseInt(aftPoints, 10));
      }
    });
  }

  // Types ONLY in aftrmath.ini (new expansion units)
  const AFTERMATH_ONLY: [string, number][] = [
    ['STNK', 25],
    ['CTNK', 25],
    ['TTNK', 30],
    ['QTNK', 60],
    ['DTRK', 5],
    ['MSUB', 45],
    ['SHOK', 15],
    ['MECH', 15],
  ];

  for (const [type, expected] of AFTERMATH_ONLY) {
    it(`${type}: expansion unit only in aftrmath.ini, Points=${expected}`, () => {
      expect(aftermathINI[type]?.Points).toBeDefined();
      expect(getIniPoints(type)).toBe(expected);
      expect(getTsPoints(type)).toBe(expected);
    });
  }
});

// ===========================================================================
// 9. STRUCTURE_POINTS for non-buildable map objects
//    These exist on maps but are never in the sidebar.
// ===========================================================================

describe('STRUCTURE_POINTS for non-buildable map objects', () => {

  const NON_BUILDABLE: [string, number][] = [
    ['CYCL', 1],   // Chain-link fence
    ['BARB', 1],   // Barbed wire
    ['WOOD', 1],   // Wooden fence
    ['BIO',  30],  // Bio-Research Lab
    ['HOSP', 20],  // Hospital
    ['FCOM', 40],  // Forward Command
    ['MISS',  5],  // Tech Center (civilian)
  ];

  for (const [type, expected] of NON_BUILDABLE) {
    it(`${type}: STRUCTURE_POINTS=${expected} matches INI Points=${getIniPoints(type)}`, () => {
      expect(STRUCTURE_POINTS[type]).toBe(expected);
      expect(STRUCTURE_POINTS[type]).toBe(getIniPoints(type));
    });
  }
});

// ===========================================================================
// 10. Per-category exhaustive verification: every unit in INI with Points=
//     has the EXACT same value in TS (parsed from INI, not hardcoded)
// ===========================================================================

describe('Exhaustive per-category Points= verification (INI-parsed, not hardcoded)', () => {

  // Vehicles
  const VEHICLE_SECTIONS = ['V2RL', '1TNK', '3TNK', '2TNK', '4TNK', 'MRJ', 'MGG', 'ARTY',
    'HARV', 'MCV', 'JEEP', 'APC', 'MNLY', 'TRUK'];

  describe('Vehicles (C++ udata.cpp)', () => {
    for (const type of VEHICLE_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Naval
  const NAVAL_SECTIONS = ['SS', 'DD', 'CA', 'LST', 'PT', 'MSUB', 'CARR'];

  describe('Naval (C++ vdata.cpp)', () => {
    for (const type of NAVAL_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Infantry
  const INFANTRY_SECTIONS = ['DOG', 'E1', 'E2', 'E3', 'E4', 'E6', 'SPY', 'THF', 'E7',
    'MEDI', 'GNRL', 'SHOK', 'MECH', 'CHAN', 'DELPHI'];

  describe('Infantry (C++ idata.cpp)', () => {
    for (const type of INFANTRY_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Aircraft
  const AIRCRAFT_SECTIONS = ['BADR', 'U2', 'MIG', 'YAK', 'TRAN', 'HELI', 'HIND'];

  describe('Aircraft (C++ aadata.cpp)', () => {
    for (const type of AIRCRAFT_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Expansion vehicles
  const EXPANSION_SECTIONS = ['STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK'];

  describe('Expansion Vehicles (aftrmath.ini)', () => {
    for (const type of EXPANSION_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Buildings (buildable)
  const BUILDING_SECTIONS = [
    'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'SYRD', 'SPEN',
    'PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR', 'FACT',
    'PROC', 'SILO', 'HPAD', 'DOME', 'GAP', 'SAM', 'MSLO',
    'AFLD', 'POWR', 'APWR', 'STEK', 'HOSP', 'BIO', 'BARR',
    'TENT', 'KENN', 'FIX',
  ];

  describe('Buildings (C++ bdata.cpp)', () => {
    for (const type of BUILDING_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Walls and fences
  const WALL_SECTIONS = ['SBAG', 'BRIK', 'FENC', 'CYCL', 'BARB', 'WOOD'];

  describe('Walls/Fences', () => {
    for (const type of WALL_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Fake buildings
  const FAKE_SECTIONS = ['FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF'];

  describe('Fake Buildings', () => {
    for (const type of FAKE_SECTIONS) {
      it(`${type}: TS points=${getTsPoints(type)} matches INI Points=${getIniPoints(type)}`, () => {
        const iniPts = getIniPoints(type);
        const tsPts = getTsPoints(type);
        expect(iniPts).toBeDefined();
        expect(tsPts).toBeDefined();
        expect(tsPts).toBe(iniPts);
      });
    }
  });

  // Civilians (all Points=1)
  const CIVILIAN_SECTIONS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN'];

  describe('Civilians (all Points=1)', () => {
    for (const type of CIVILIAN_SECTIONS) {
      it(`${type}: INI Points=1 and TS points=1`, () => {
        expect(getIniPoints(type)).toBe(1);
        expect(getTsPoints(type)).toBe(1);
      });
    }
  });
});

// ===========================================================================
// 11. Zero-tolerance mismatch detection
//     A single test that scans ALL INI sections and finds ANY mismatch.
// ===========================================================================

describe('Zero-tolerance: no Points= value mismatches anywhere', () => {

  it('every UNIT_STATS.points matches its merged INI Points=', () => {
    const mismatches: string[] = [];
    for (const [type, stats] of Object.entries(UNIT_STATS)) {
      const iniPts = getIniPoints(type);
      if (iniPts === undefined) continue;
      if (stats.points !== undefined && stats.points !== iniPts) {
        mismatches.push(`${type}: UNIT_STATS=${stats.points}, INI=${iniPts}`);
      }
    }
    expect(mismatches, `Mismatches: ${mismatches.join('; ')}`).toEqual([]);
  });

  it('every PRODUCTION_ITEMS.points matches its merged INI Points=', () => {
    const mismatches: string[] = [];
    for (const item of PRODUCTION_ITEMS) {
      const iniPts = getIniPoints(item.type);
      if (iniPts === undefined) continue;
      if (item.points !== undefined && item.points !== iniPts) {
        mismatches.push(`${item.type}: PROD=${item.points}, INI=${iniPts}`);
      }
    }
    expect(mismatches, `Mismatches: ${mismatches.join('; ')}`).toEqual([]);
  });

  it('every STRUCTURE_POINTS value matches its merged INI Points=', () => {
    const mismatches: string[] = [];
    for (const [type, tsPts] of Object.entries(STRUCTURE_POINTS)) {
      const iniPts = getIniPoints(type);
      if (iniPts === undefined) continue;
      if (tsPts !== iniPts) {
        mismatches.push(`${type}: STRUCT_PTS=${tsPts}, INI=${iniPts}`);
      }
    }
    expect(mismatches, `Mismatches: ${mismatches.join('; ')}`).toEqual([]);
  });

  it('every entity.ts UNIT_POINTS lookup matches its merged INI Points=', () => {
    const mismatches: string[] = [];
    for (const [type, lookupPts] of Object.entries(UNIT_POINTS)) {
      const iniPts = getIniPoints(type);
      if (iniPts === undefined) continue;
      if (lookupPts !== iniPts) {
        mismatches.push(`${type}: UNIT_POINTS=${lookupPts}, INI=${iniPts}`);
      }
    }
    expect(mismatches, `Mismatches: ${mismatches.join('; ')}`).toEqual([]);
  });
});

// ===========================================================================
// 12. Comprehensive coverage: every INI Points= section accounted for in TS
// ===========================================================================

describe('Comprehensive: every INI Points= section accounted for in TS', () => {

  const TS_COVERED = new Set([
    ...Object.keys(UNIT_STATS),
    ...PRODUCTION_ITEMS.map(i => i.type),
    ...Object.keys(STRUCTURE_POINTS),
  ]);

  // Civilian buildings V01-V37 are map terrain objects, not tracked in TS
  const EXPECTED_MISSING = new Set(
    Array.from({ length: 37 }, (_, i) => `V${(i + 1).toString().padStart(2, '0')}`)
  );

  it('all combat-relevant INI sections exist in TS', () => {
    const missing: string[] = [];
    for (const [section, pts] of ALL_INI_POINTS) {
      if (EXPECTED_MISSING.has(section)) continue;
      if (!TS_COVERED.has(section)) {
        missing.push(`${section}(${pts})`);
      }
    }
    expect(missing, `INI sections missing from TS: ${missing.join(', ')}`).toEqual([]);
  });

  it('only V01-V37 terrain objects are expected to be missing from TS', () => {
    const missing: string[] = [];
    for (const [section] of ALL_INI_POINTS) {
      if (!TS_COVERED.has(section)) {
        missing.push(section);
      }
    }
    // All missing should be V01-V37
    for (const m of missing) {
      expect(EXPECTED_MISSING.has(m), `Unexpected missing section: ${m}`).toBe(true);
    }
    expect(missing.length).toBe(37);
  });
});

// ===========================================================================
// 13. Score accumulation across multiple unit types
//     Simulates a realistic battle and verifies pointTotal matches INI Points.
// ===========================================================================

describe('Realistic battle score accumulation uses INI Points', () => {

  it('mixed battle: kill 3TNK+E2+SS, lose 2TNK+E1 — pointTotal matches INI', () => {
    // Kills: 3TNK(50) + E2(10) + SS(45) = +105
    // Losses: 2TNK(40) + E1(5) = -45
    // Net: +60
    const kills = [
      entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10),
      entityAtCell(UnitType.I_E2, House.USSR, 11, 10),
      entityAtCell(UnitType.V_SS, House.USSR, 12, 10),
    ];
    const losses = [
      entityAtCell(UnitType.V_2TNK, House.Spain, 20, 10),
      entityAtCell(UnitType.I_E1, House.Spain, 21, 10),
    ];

    for (const e of [...kills, ...losses]) {
      e.hp = 0;
      e.alive = false;
    }

    const ctx = makeCombatCtx([...kills, ...losses]);

    for (const k of kills) {
      handleUnitDeath(ctx, k, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });
    }
    for (const l of losses) {
      handleUnitDeath(ctx, l, { attackerIsPlayer: false, trackLoss: true, friendlyFireLoss: false });
    }

    const expectedKillPts = getIniPoints('3TNK')! + getIniPoints('E2')! + getIniPoints('SS')!;
    const expectedLossPts = getIniPoints('2TNK')! + getIniPoints('E1')!;
    const expectedNet = expectedKillPts - expectedLossPts;

    expect(expectedKillPts).toBe(50 + 10 + 45);
    expect(expectedLossPts).toBe(40 + 5);
    expect(expectedNet).toBe(60);
    expect(ctx.pointTotal).toBe(expectedNet);
    expect(ctx.killCount).toBe(3);
    expect(ctx.lossCount).toBe(2);
  });

  it('expansion unit battle: kill DTRK+SHOK, lose CTNK — pointTotal matches INI', () => {
    // Kills: DTRK(5) + SHOK(15) = +20
    // Losses: CTNK(25) = -25
    // Net: -5
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 11, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 20, 10);

    for (const e of [dtrk, shok, ctnk]) {
      e.hp = 0;
      e.alive = false;
    }

    const ctx = makeCombatCtx([dtrk, shok, ctnk]);

    handleUnitDeath(ctx, dtrk, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });
    handleUnitDeath(ctx, shok, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });
    handleUnitDeath(ctx, ctnk, { attackerIsPlayer: false, trackLoss: true, friendlyFireLoss: false });

    const net = getIniPoints('DTRK')! + getIniPoints('SHOK')! - getIniPoints('CTNK')!;
    expect(net).toBe(5 + 15 - 25);
    expect(net).toBe(-5);
    expect(ctx.pointTotal).toBe(net);
  });
});

// ===========================================================================
// 14. Per-side casualty tracking uses correct faction mapping
// ===========================================================================

describe('Per-side casualty tracking matches C++ faction mapping', () => {

  // C++ score.cpp:548-551: USSR, BadGuy, Ukraine → Soviet (NKilled)
  // All others → Allied (GKilled)
  const SOVIET_HOUSES = [House.USSR, House.Ukraine];
  const ALLIED_HOUSES = [House.Spain, House.Greece, House.England, House.France, House.Germany, House.Turkey];

  for (const house of SOVIET_HOUSES) {
    it(`${House[house]} unit death increments sovietUnitsLost`, () => {
      const unit = entityAtCell(UnitType.I_E1, house, 10, 10);
      unit.hp = 0;
      unit.alive = false;
      const ctx = makeCombatCtx([unit]);

      handleUnitDeath(ctx, unit, { attackerIsPlayer: true, trackLoss: false, friendlyFireLoss: false });

      expect(ctx.sovietUnitsLost).toBe(1);
      expect(ctx.alliedUnitsLost).toBe(0);
      expect(HOUSE_FACTION[House[house]]).toBe('soviet');
    });
  }

  for (const house of ALLIED_HOUSES) {
    it(`${House[house]} unit death increments alliedUnitsLost`, () => {
      const unit = entityAtCell(UnitType.I_E1, house, 10, 10);
      unit.hp = 0;
      unit.alive = false;
      const ctx = makeCombatCtx([unit]);

      handleUnitDeath(ctx, unit, { attackerIsPlayer: false, trackLoss: false, friendlyFireLoss: false });

      expect(ctx.alliedUnitsLost).toBe(1);
      expect(ctx.sovietUnitsLost).toBe(0);
    });
  }
});
