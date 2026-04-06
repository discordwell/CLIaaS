/**
 * C++ Behavioral Parity: Multi-Factor Enemy Scoring (house.cpp:4619-4741)
 *
 * Tests verify that the TS designated enemy selection matches C++ Expert_AI
 * composite scoring: distance, kill history, relative force, last attacker bonus.
 *
 * Source: HOUSE.CPP (Expert_AI enemy selection), HOUSE.H (LAEnemy, BuildingsKilled,
 *         UnitsKilled arrays), TECHNO.CPP (kill tracking).
 *
 * C++ formula per candidate enemy house h:
 *   value  = ((MAP_CELL_W*2) - Distance(Center, h->Center)) * 2
 *   value += h->BuildingsKilled[Class->House] * 5
 *   value += h->UnitsKilled[Class->House]
 *   value += h->CurUnits - CurUnits
 *   value += h->CurBuildings - CurBuildings
 *   value += (h->CurInfantry - CurInfantry) / 4
 *   if (house == LAEnemy) value += 100
 *   Highest value wins => Enemy = house
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CELL_SIZE, MAP_CELLS,
  House, Mission, UnitType, UNIT_STATS, HOUSE_FACTION,
  worldDist,
  type ProductionItem,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type MapStructure,
  STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
} from '../engine/scenario';
import { GameMap, Terrain } from '../engine/map';
import {
  type AIHouseState, type AIContext,
  STRUCTURE_IMAGES,
  aiGetBaseCenter,
  computeEnemyScore,
  aiCountForce,
  updateDesignatedEnemy,
  aiRecordBuildingKill,
  aiRecordUnitKill,
  aiRecordLastAttacker,
  aiPickAttackTarget,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStructure(overrides: Partial<MapStructure> & { type: string; house: House; cx: number; cy: number }): MapStructure {
  const type = overrides.type;
  return {
    image: STRUCTURE_IMAGES[type] ?? type.toLowerCase(),
    hp: STRUCTURE_MAX_HP[type] ?? 256,
    maxHp: STRUCTURE_MAX_HP[type] ?? 256,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: 0,
    ...overrides,
  };
}

function makeAIState(overrides: Partial<AIHouseState> & { house: House }): AIHouseState {
  return {
    phase: 'economy',
    broke: false,
    endgame: false,
    productionEnabled: true,
    buildQueue: [],
    lastBuildTick: 0,
    buildCooldown: 0,
    attackPool: new Set(),
    attackThreshold: 6,
    lastAttackTick: 0,
    attackCooldownTicks: 600,
    harvesterCount: 0,
    refineryCount: 0,
    lastBaseAttackTick: 0,
    underAttack: false,
    incomeMult: 1.0,
    buildSpeedMult: 1.0,
    aggressionMult: 1.0,
    designatedEnemy: null,
    preferredTarget: null,
    iq: 3,
    techLevel: 10,
    maxUnit: -1,
    maxInfantry: -1,
    maxBuilding: -1,
    buildingsKilledBy: new Map(),
    unitsKilledBy: new Map(),
    lastAttackerEnemy: null,
    isStarted: true,
    ...overrides,
  };
}

function makeAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const entities = overrides.entities ?? [];
  const structures = overrides.structures ?? [];
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    map: overrides.map ?? new GameMap(),
    tick: overrides.tick ?? 0,
    playerHouse: overrides.playerHouse ?? House.Spain,
    scenarioId: overrides.scenarioId ?? 'TEST',
    difficulty: overrides.difficulty ?? 'normal',
    aiStates: overrides.aiStates ?? new Map(),
    houseCredits: overrides.houseCredits ?? new Map(),
    houseIQs: overrides.houseIQs ?? new Map(),
    houseTechLevels: overrides.houseTechLevels ?? new Map(),
    houseMaxUnits: overrides.houseMaxUnits ?? new Map(),
    houseMaxInfantry: overrides.houseMaxInfantry ?? new Map(),
    houseMaxBuildings: overrides.houseMaxBuildings ?? new Map(),
    baseBlueprint: [],
    baseRebuildQueue: [],
    baseRebuildCooldown: 0,
    scenarioProductionItems: [],
    scenarioUnitStats: {},
    scenarioWeaponStats: {},
    nextWaveId: 1,
    autocreateEnabled: false,
    teamTypes: [],
    destroyedTeams: new Set(),
    waypoints: new Map(),
    houseEdges: new Map(),
    effects: [],
    isAllied: overrides.isAllied ?? ((a: House, b: House) => a === b),
    isPlayerControlled: overrides.isPlayerControlled ?? ((e: Entity) => e.house === House.Spain),
    clearStructureFootprint: overrides.clearStructureFootprint ?? (() => {}),
  };
}

// ── computeEnemyScore unit tests ──────────────────────────────────────────────

describe('computeEnemyScore — C++ house.cpp:4660-4686', () => {
  it('nearest enemy gets higher distance bonus', () => {
    // C++ line 4660-4661: value = ((MAP_CELL_W*2) - Distance) * 2
    // Closer enemy → smaller distance → higher value
    const myCenter = { cx: 64, cy: 64 };
    const nearEnemy = { cx: 70, cy: 64 };  // ~6 cells away
    const farEnemy = { cx: 100, cy: 64 };  // ~36 cells away

    const nearScore = computeEnemyScore(myCenter, nearEnemy, 0, 0, 0, 0, 0, 0, 0, 0, false);
    const farScore = computeEnemyScore(myCenter, farEnemy, 0, 0, 0, 0, 0, 0, 0, 0, false);

    expect(nearScore).toBeGreaterThan(farScore);
    // C++ formula: near = (256 - 6) * 2 = 500, far = (256 - 36) * 2 = 440
    // So difference should be about 60
    expect(nearScore - farScore).toBeGreaterThan(50);
  });

  it('enemy that killed more buildings scores higher (C++ house.cpp:4668)', () => {
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 80, cy: 64 }; // same position for both

    // Enemy A killed 10 buildings, Enemy B killed 0
    const scoreWithKills = computeEnemyScore(myCenter, enemyCenter, 10, 0, 0, 0, 0, 0, 0, 0, false);
    const scoreNoKills = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 0, 0, false);

    // C++ line 4668: buildingsKilled * 5 = 50 bonus
    expect(scoreWithKills - scoreNoKills).toBe(50);
  });

  it('enemy unit kills contribute to score (C++ house.cpp:4669)', () => {
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 80, cy: 64 };

    const scoreWithUnitKills = computeEnemyScore(myCenter, enemyCenter, 0, 20, 0, 0, 0, 0, 0, 0, false);
    const scoreNoKills = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 0, 0, false);

    // C++ line 4669: unitsKilled * 1 = 20 bonus
    expect(scoreWithUnitKills - scoreNoKills).toBe(20);
  });

  it('last attacker gets +100 bonus (C++ house.cpp:4684)', () => {
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 80, cy: 64 };

    const scoreLastAttacker = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 0, 0, true);
    const scoreNormal = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 0, 0, false);

    expect(scoreLastAttacker - scoreNormal).toBe(100);
  });

  it('larger enemy force scores higher (C++ house.cpp:4676-4678)', () => {
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 80, cy: 64 };

    // Enemy A has more units/buildings than us
    const scoreLargeForce = computeEnemyScore(
      myCenter, enemyCenter, 0, 0,
      20, 5,   // enemyUnits=20, myUnits=5 → +15
      10, 3,   // enemyBuildings=10, myBuildings=3 → +7
      40, 8,   // enemyInfantry=40, myInfantry=8 → +8 (floor(32/4))
      false,
    );

    // Enemy B has same force as us
    const scoreEqualForce = computeEnemyScore(
      myCenter, enemyCenter, 0, 0,
      5, 5,   // equal
      3, 3,
      8, 8,
      false,
    );

    // Difference = (20-5) + (10-3) + floor((40-8)/4) = 15 + 7 + 8 = 30
    expect(scoreLargeForce - scoreEqualForce).toBe(30);
  });

  it('infantry difference is divided by 4 (C++ house.cpp:4678)', () => {
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 80, cy: 64 };

    // 12 extra infantry → floor(12/4) = 3
    const score12inf = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 12, 0, false);
    // 13 extra infantry → floor(13/4) = 3 (same due to floor)
    const score13inf = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 13, 0, false);
    // 16 extra infantry → floor(16/4) = 4
    const score16inf = computeEnemyScore(myCenter, enemyCenter, 0, 0, 0, 0, 0, 0, 16, 0, false);

    expect(score12inf).toBe(score13inf); // Both floor to 3
    expect(score16inf).toBeGreaterThan(score12inf); // 4 > 3
    expect(score16inf - score12inf).toBe(1);
  });

  it('composite score matches C++ formula exactly', () => {
    // Verify the complete formula:
    // value = ((MAP_CELL_W*2) - dist) * 2 + bKills*5 + uKills + (eUnits-mUnits) + (eBuildings-mBuildings) + floor((eInf-mInf)/4) + (isLA ? 100 : 0)
    const myCenter = { cx: 64, cy: 64 };
    const enemyCenter = { cx: 74, cy: 64 }; // dist = 10

    const score = computeEnemyScore(
      myCenter, enemyCenter,
      3,   // buildingsKilledUs
      7,   // unitsKilledUs
      12,  // enemyUnits
      8,   // myUnits
      6,   // enemyBuildings
      4,   // myBuildings
      20,  // enemyInfantry
      4,   // myInfantry
      true, // isLastAttacker
    );

    // Expected:
    // distance: (128*2 - 10) * 2 = 246 * 2 = 492
    // bKills: 3 * 5 = 15
    // uKills: 7
    // units: 12 - 8 = 4
    // buildings: 6 - 4 = 2
    // infantry: floor((20-4)/4) = floor(16/4) = 4
    // lastAttacker: 100
    // Total: 492 + 15 + 7 + 4 + 2 + 4 + 100 = 624
    expect(score).toBe(624);
  });
});

// ── updateDesignatedEnemy integration tests ───────────────────────────────────

describe('updateDesignatedEnemy — C++ house.cpp:4619-4741', () => {
  it('picks nearest enemy when all else is equal', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      // USSR base at (20, 20)
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain base at (30, 20) — closer
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      // Greece base at (80, 20) — farther
      makeStructure({ type: 'FACT', house: House.Greece, cx: 80, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Spain is closer to USSR → higher distance score → designated enemy
    expect(ussrState.designatedEnemy).toBe(House.Spain);
  });

  it('kill history can override distance advantage', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });

    // Greece has killed many of USSR's buildings
    greeceState.buildingsKilledBy.set(House.USSR, 20); // 20 * 5 = 100 bonus

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain is closer
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      // Greece is farther but killed lots of our buildings
      makeStructure({ type: 'FACT', house: House.Greece, cx: 50, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Greece's kill bonus (100) should overcome Spain's distance advantage (~20 cells * 2 = ~40)
    expect(ussrState.designatedEnemy).toBe(House.Greece);
  });

  it('last attacker bonus (+100) can tip the balance', () => {
    const ussrState = makeAIState({
      house: House.USSR,
      lastAttackerEnemy: House.Greece,
    });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain at distance 10
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      // Greece at distance 40 — but is last attacker (+100 bonus)
      makeStructure({ type: 'FACT', house: House.Greece, cx: 60, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Spain distance advantage: (256 - 10) * 2 = 492
    // Greece distance: (256 - 40) * 2 = 432, + 100 LA bonus = 532
    // Greece wins because LA bonus (100) > distance difference (60)
    expect(ussrState.designatedEnemy).toBe(House.Greece);
  });

  it('larger enemy force shifts scoring', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain closer, 1 building
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      // Greece farther, but many buildings → larger force
      makeStructure({ type: 'FACT', house: House.Greece, cx: 50, cy: 20 }),
      makeStructure({ type: 'WEAP', house: House.Greece, cx: 52, cy: 20 }),
      makeStructure({ type: 'PROC', house: House.Greece, cx: 54, cy: 20 }),
      makeStructure({ type: 'TENT', house: House.Greece, cx: 56, cy: 20 }),
      makeStructure({ type: 'POWR', house: House.Greece, cx: 54, cy: 22 }),
      makeStructure({ type: 'POWR', house: House.Greece, cx: 56, cy: 22 }),
    ];

    // Give Greece many units
    const greeceEntities: Entity[] = [];
    for (let i = 0; i < 15; i++) {
      const e = new Entity(UnitType.V_2TNK, House.Greece, 50 * CELL_SIZE, 20 * CELL_SIZE);
      greeceEntities.push(e);
    }

    const ctx = makeAIContext({
      structures,
      entities: greeceEntities,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Greece has 6 buildings vs USSR's 1 → +5 buildings bonus
    // Greece has 15 units vs USSR's 0 → +15 units bonus
    // Combined force bonus (20) + distance diff is small enough that Greece should win
    // Spain dist: (256-10)*2=492, Greece dist: (256-~32)*2=448, diff=44
    // Greece force bonus: 15 + 5 = 20, so net Greece lead = 20 - 44 = -24... still Spain
    // But with 15 more units, the force bonus should push it: 15 units + 5 buildings = 20
    // Actually let's verify — if Greece still loses, that's still correct C++ behavior
    // We mainly test that force contributes positively to score.

    // The score difference matters. Let's just verify that Greece's score is boosted by force:
    const ussrCenter = aiGetBaseCenter(ctx, House.USSR)!;
    const spainCenter = aiGetBaseCenter(ctx, House.Spain)!;
    const greeceCenter = aiGetBaseCenter(ctx, House.Greece)!;

    const spainScore = computeEnemyScore(ussrCenter, spainCenter, 0, 0, 0, 0, 1, 1, 0, 0, false);
    const greeceScore = computeEnemyScore(ussrCenter, greeceCenter, 0, 0, 15, 0, 6, 1, 0, 0, false);

    // Force contributes: Greece gets +15 (units) + 5 (buildings) = +20 relative to equal force
    // Verify force actually matters
    const greeceScoreNoForce = computeEnemyScore(ussrCenter, greeceCenter, 0, 0, 0, 0, 1, 1, 0, 0, false);
    expect(greeceScore - greeceScoreNoForce).toBe(15 + 5); // units + buildings force diff
  });

  it('designated enemy updates when scores change', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Greece, cx: 80, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    // First evaluation: Spain is closer → designated
    updateDesignatedEnemy(ctx);
    expect(ussrState.designatedEnemy).toBe(House.Spain);

    // Now Greece kills lots of USSR buildings → score shifts
    greeceState.buildingsKilledBy.set(House.USSR, 30); // 30 * 5 = 150 bonus

    ctx.tick = 121; // (tick-1) % 60 === 0
    updateDesignatedEnemy(ctx);

    // Greece now has massive kill bonus overcoming distance
    // Spain dist: (256-10)*2 = 492
    // Greece dist: (256-60)*2 = 392 + 150 kills = 542 > 492
    expect(ussrState.designatedEnemy).toBe(House.Greece);
  });

  it('highest composite score wins with all factors combined', () => {
    const ussrState = makeAIState({
      house: House.USSR,
      lastAttackerEnemy: House.Greece,
    });
    const spainState = makeAIState({ house: House.Spain });
    const greeceState = makeAIState({ house: House.Greece });
    const englandState = makeAIState({ house: House.England });

    // Greece killed 5 buildings and 10 units of USSR
    greeceState.buildingsKilledBy.set(House.USSR, 5);
    greeceState.unitsKilledBy.set(House.USSR, 10);

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
      [House.England, englandState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain: very close
      makeStructure({ type: 'FACT', house: House.Spain, cx: 25, cy: 20 }),
      // Greece: medium distance, but has kills + LA bonus
      makeStructure({ type: 'FACT', house: House.Greece, cx: 50, cy: 20 }),
      // England: far away, no kills
      makeStructure({ type: 'FACT', house: House.England, cx: 100, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Spain: (256-5)*2 = 502
    // Greece: (256-30)*2 = 452 + 5*5=25 + 10 + 100 (LA) = 587
    // England: (256-80)*2 = 352
    // Greece should win with 587
    expect(ussrState.designatedEnemy).toBe(House.Greece);
  });

  it('clears enemy if they have no buildings left', () => {
    const ussrState = makeAIState({
      house: House.USSR,
      designatedEnemy: House.Spain,
    });
    const spainState = makeAIState({ house: House.Spain });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
    ]);

    // Spain has no alive structures
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 50, cy: 20, alive: false }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Spain has no base center → cleared
    expect(ussrState.designatedEnemy).toBeNull();
  });

  it('skips enemy selection if any enemy has not started (C++ house.cpp:4639)', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain, isStarted: true });
    const greeceState = makeAIState({ house: House.Greece, isStarted: false }); // Not started!

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
      [House.Greece, greeceState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Greece, cx: 50, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 61, // (tick-1) % 60 === 0
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Greece hasn't started → skip all enemy selection → enemy stays null
    expect(ussrState.designatedEnemy).toBeNull();
  });

  it('only runs on tick multiples of 60', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const spainState = makeAIState({ house: House.Spain });

    const aiStates = new Map<House, AIHouseState>([
      [House.USSR, ussrState],
      [House.Spain, spainState],
    ]);

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates,
      tick: 31, // Not a multiple of 60
      isAllied: (a, b) => a === b,
    });

    updateDesignatedEnemy(ctx);

    // Should not have run
    expect(ussrState.designatedEnemy).toBeNull();
  });
});

// ── Kill tracking helpers ─────────────────────────────────────────────────────

describe('kill tracking helpers — C++ techno.cpp parity', () => {
  it('aiRecordBuildingKill increments per-victim counter', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, ussrState]]),
    });

    aiRecordBuildingKill(ctx, House.USSR, House.Spain);
    aiRecordBuildingKill(ctx, House.USSR, House.Spain);
    aiRecordBuildingKill(ctx, House.USSR, House.Greece);

    expect(ussrState.buildingsKilledBy.get(House.Spain)).toBe(2);
    expect(ussrState.buildingsKilledBy.get(House.Greece)).toBe(1);
  });

  it('aiRecordUnitKill increments per-victim counter', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, ussrState]]),
    });

    aiRecordUnitKill(ctx, House.USSR, House.Spain);
    aiRecordUnitKill(ctx, House.USSR, House.Spain);
    aiRecordUnitKill(ctx, House.USSR, House.Spain);

    expect(ussrState.unitsKilledBy.get(House.Spain)).toBe(3);
  });

  it('aiRecordLastAttacker sets LAEnemy on victim state', () => {
    const ussrState = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, ussrState]]),
    });

    aiRecordLastAttacker(ctx, House.USSR, House.Greece);
    expect(ussrState.lastAttackerEnemy).toBe(House.Greece);

    aiRecordLastAttacker(ctx, House.USSR, House.Spain);
    expect(ussrState.lastAttackerEnemy).toBe(House.Spain);
  });
});

// ── aiPickAttackTarget with designated enemy ──────────────────────────────────

describe('aiPickAttackTarget uses designated enemy', () => {
  it('prefers FACT of designated enemy over closer non-designated FACT', () => {
    const ussrState = makeAIState({
      house: House.USSR,
      designatedEnemy: House.Greece,
    });

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain's FACT is closer
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      // Greece's FACT is farther but is designated enemy
      makeStructure({ type: 'FACT', house: House.Greece, cx: 80, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates: new Map([[House.USSR, ussrState]]),
      isAllied: (a, b) => a === b,
    });

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();

    // Should target Greece's FACT (designated enemy) not Spain's
    const greeceFact = structures[2];
    const [w, h] = STRUCTURE_SIZE['FACT'] ?? [1, 1];
    const expectedX = (greeceFact.cx + w / 2) * CELL_SIZE;
    expect(target!.x).toBe(expectedX);
  });

  it('falls back to any enemy FACT when designated enemy has no priority structures', () => {
    const ussrState = makeAIState({
      house: House.USSR,
      designatedEnemy: House.Greece,
    });

    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      // Spain has a FACT, Greece has only a SILO (no FACT/WEAP/PROC)
      makeStructure({ type: 'FACT', house: House.Spain, cx: 30, cy: 20 }),
      makeStructure({ type: 'SILO', house: House.Greece, cx: 80, cy: 20 }),
    ];

    const ctx = makeAIContext({
      structures,
      aiStates: new Map([[House.USSR, ussrState]]),
      isAllied: (a, b) => a === b,
    });

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();

    // Greece has no FACT/WEAP/PROC → fall back to Spain's FACT
    const spainFact = structures[1];
    const [w, h] = STRUCTURE_SIZE['FACT'] ?? [1, 1];
    const expectedX = (spainFact.cx + w / 2) * CELL_SIZE;
    expect(target!.x).toBe(expectedX);
  });
});

// ── aiCountForce helper ───────────────────────────────────────────────────────

describe('aiCountForce — force counting for scoring', () => {
  it('counts units, infantry, and buildings separately', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 20, cy: 20 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 20 }),
      makeStructure({ type: 'PROC', house: House.Spain, cx: 40, cy: 20 }), // Different house
    ];

    const entities = [
      new Entity(UnitType.I_E1, House.USSR, 100, 100),  // infantry
      new Entity(UnitType.I_E1, House.USSR, 110, 100),  // infantry
      new Entity(UnitType.V_2TNK, House.USSR, 120, 100), // unit (vehicle)
      new Entity(UnitType.I_E1, House.Spain, 200, 100),  // different house
    ];

    const ctx = makeAIContext({ structures, entities });

    const force = aiCountForce(ctx, House.USSR);
    expect(force.buildings).toBe(2);
    expect(force.infantry).toBe(2);
    expect(force.units).toBe(1);
  });
});
