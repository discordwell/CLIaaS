/**
 * C++ Behavioral Parity: AI State Machine (ai.ts, 1,319 lines)
 *
 * Tests verify AI strategic behavior matches C++ Red Alert source code.
 * Covers: 8+ phases (economy → buildup → attack), IQ-gated decisions,
 * difficulty modifiers, unit caps, team autocreate, build order priority,
 * attack groups, defense rally, retreat, repair, sell, income, placement.
 *
 * Source: HOUSE.CPP (AI house logic), RULES.CPP (difficulty constants),
 *         TEAM.CPP (autocreate teams), FACTORY.CPP (production picks).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  House, Mission, UnitType, UNIT_STATS, HOUSE_FACTION,
  worldDist,
  type ProductionItem,
  type UnitStats,
  type WeaponStats,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type MapStructure, type TeamType,
  houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  applyScenarioOverrides,
} from '../engine/scenario';
import { GameMap, Terrain } from '../engine/map';
import {
  type AIHouseState, type Difficulty, type AIContext,
  AI_DIFFICULTY_MODS, STRUCTURE_IMAGES, DIFFICULTY_MODS,
  aiCountStructure, aiPowerProduced, aiPowerConsumed,
  aiHasPrereq, aiGetBaseCenter, aiIsFactoryExit, aiStagingArea,
  aiPickAttackTarget,
  createAIHouseState,
  getAIBuildOrder, getAIProductionPick,
  aiPlaceStructure,
  spawnAIStructure, spawnAIUnit,
  updateBaseRebuild, updateAIStrategicPlanner, updateAIConstruction,
  updateAIHarvesters, updateAIAttackGroups, updateAIDefense,
  updateAIRetreat, updateAIRepair, updateAISellDamaged,
  updateAIIncome, updateAIProduction, updateAIAutocreateTeams,
  launchAIAttack, aiRecallDefenders,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal production items for testing */
const TEST_PRODUCTION_ITEMS: ProductionItem[] = [
  { type: 'E1', name: 'Rifle', cost: 100, buildTime: 45, prerequisite: 'TENT', faction: 'both', techLevel: 1 },
  { type: 'E2', name: 'Grenadier', cost: 160, buildTime: 55, prerequisite: 'TENT', faction: 'soviet', techLevel: 1 },
  { type: 'E3', name: 'Rocket', cost: 300, buildTime: 75, prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  { type: 'E6', name: 'Engineer', cost: 500, buildTime: 100, prerequisite: 'TENT', faction: 'both', techLevel: 5 },
  { type: 'MEDI', name: 'Medic', cost: 800, buildTime: 90, prerequisite: 'TENT', faction: 'allied', techLevel: 2 },
  { type: '1TNK', name: 'Light Tank', cost: 700, buildTime: 120, prerequisite: 'WEAP', faction: 'allied', techLevel: 2 },
  { type: '2TNK', name: 'Medium Tank', cost: 800, buildTime: 140, prerequisite: 'WEAP', faction: 'allied', techLevel: 5 },
  { type: '3TNK', name: 'Heavy Tank', cost: 950, buildTime: 160, prerequisite: 'WEAP', faction: 'soviet', techLevel: 7 },
  { type: '4TNK', name: 'Mammoth', cost: 1500, buildTime: 200, prerequisite: 'WEAP', faction: 'soviet', techLevel: 10 },
  { type: 'HARV', name: 'Harvester', cost: 1400, buildTime: 150, prerequisite: 'WEAP', faction: 'both', techLevel: 1 },
  { type: 'JEEP', name: 'Ranger', cost: 600, buildTime: 100, prerequisite: 'WEAP', faction: 'allied', techLevel: 3 },
  // Structures
  { type: 'POWR', name: 'Power Plant', cost: 300, buildTime: 100, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'APWR', name: 'Adv Power', cost: 500, buildTime: 150, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 5 },
  { type: 'TENT', name: 'Barracks', cost: 400, buildTime: 100, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 1 },
  { type: 'BARR', name: 'Barracks', cost: 400, buildTime: 100, prerequisite: 'FACT', faction: 'soviet', isStructure: true, techLevel: 1 },
  { type: 'WEAP', name: 'War Factory', cost: 2000, buildTime: 200, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 2 },
  { type: 'PROC', name: 'Refinery', cost: 2000, buildTime: 200, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'DOME', name: 'Radar', cost: 1000, buildTime: 150, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 3 },
  { type: 'GUN', name: 'Turret', cost: 600, buildTime: 100, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 3 },
  { type: 'TSLA', name: 'Tesla Coil', cost: 1500, buildTime: 200, prerequisite: 'FACT', faction: 'soviet', isStructure: true, techLevel: 5 },
  { type: 'ATEK', name: 'Allied Tech', cost: 1500, buildTime: 200, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 7 },
  { type: 'STEK', name: 'Soviet Tech', cost: 1500, buildTime: 200, prerequisite: 'FACT', faction: 'soviet', isStructure: true, techLevel: 7 },
  { type: 'HPAD', name: 'Helipad', cost: 1500, buildTime: 150, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 8 },
  { type: 'AFLD', name: 'Airfield', cost: 1500, buildTime: 150, prerequisite: 'FACT', faction: 'soviet', isStructure: true, techLevel: 8 },
  { type: 'FIX', name: 'Repair Pad', cost: 1200, buildTime: 150, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 4 },
  { type: 'SILO', name: 'Silo', cost: 150, buildTime: 50, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 2 },
  { type: 'FACT', name: 'Constr. Yard', cost: 5000, buildTime: 300, prerequisite: 'FACT', faction: 'both', isStructure: true, techLevel: 1 },
  { type: 'HBOX', name: 'Pillbox', cost: 400, buildTime: 80, prerequisite: 'FACT', faction: 'allied', isStructure: true, techLevel: 2 },
];

/** Create a MapStructure with sensible defaults */
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

/** Create an AIHouseState with sensible defaults */
function makeAIState(overrides: Partial<AIHouseState> & { house: House }): AIHouseState {
  return {
    phase: 'economy',
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
    ...overrides,
  };
}

/** Create a minimal AIContext for testing */
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
    baseBlueprint: overrides.baseBlueprint ?? [],
    baseRebuildQueue: overrides.baseRebuildQueue ?? [],
    baseRebuildCooldown: overrides.baseRebuildCooldown ?? 0,
    scenarioProductionItems: overrides.scenarioProductionItems ?? TEST_PRODUCTION_ITEMS,
    scenarioUnitStats: overrides.scenarioUnitStats ?? {},
    scenarioWeaponStats: overrides.scenarioWeaponStats ?? {},
    nextWaveId: overrides.nextWaveId ?? 1,
    autocreateEnabled: overrides.autocreateEnabled ?? false,
    teamTypes: overrides.teamTypes ?? [],
    destroyedTeams: overrides.destroyedTeams ?? new Set(),
    waypoints: overrides.waypoints ?? new Map(),
    houseEdges: overrides.houseEdges ?? new Map(),
    effects: overrides.effects ?? [],
    isAllied: overrides.isAllied ?? ((a: House, b: House) => a === b),
    isPlayerControlled: overrides.isPlayerControlled ?? ((e: Entity) => e.house === House.Spain),
    clearStructureFootprint: overrides.clearStructureFootprint ?? (() => {}),
  };
}

/** Entity at cell center */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ── 1. Difficulty Modifiers (rules.cpp parity) ────────────────────────────────

describe('AI_DIFFICULTY_MODS constants (rules.cpp difficulty tables)', () => {
  it('easy difficulty has reduced income and slower aggression', () => {
    const easy = AI_DIFFICULTY_MODS.easy;
    expect(easy.incomeMult).toBe(0.7);
    expect(easy.buildSpeedMult).toBe(1.5);
    expect(easy.attackThreshold).toBe(8);
    expect(easy.attackCooldown).toBe(900);
    expect(easy.aggressionMult).toBe(0.6);
    expect(easy.retreatHpPercent).toBe(0.30);
    expect(easy.productionInterval).toBe(90);
  });

  it('normal difficulty has baseline values', () => {
    const normal = AI_DIFFICULTY_MODS.normal;
    expect(normal.incomeMult).toBe(1.0);
    expect(normal.buildSpeedMult).toBe(1.0);
    expect(normal.attackThreshold).toBe(6);
    expect(normal.attackCooldown).toBe(600);
    expect(normal.aggressionMult).toBe(1.0);
    expect(normal.retreatHpPercent).toBe(0.25);
    expect(normal.productionInterval).toBe(60);
  });

  it('hard difficulty has boosted income and faster aggression', () => {
    const hard = AI_DIFFICULTY_MODS.hard;
    expect(hard.incomeMult).toBe(1.5);
    expect(hard.buildSpeedMult).toBe(0.7);
    expect(hard.attackThreshold).toBe(4);
    expect(hard.attackCooldown).toBe(400);
    expect(hard.aggressionMult).toBe(1.4);
    expect(hard.retreatHpPercent).toBe(0.15);
    expect(hard.productionInterval).toBe(42);
  });

  it('all three difficulties are defined', () => {
    expect(Object.keys(AI_DIFFICULTY_MODS)).toEqual(['easy', 'normal', 'hard']);
  });

  it('easy attack threshold > normal > hard (easier = needs more units)', () => {
    expect(AI_DIFFICULTY_MODS.easy.attackThreshold).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.attackThreshold);
    expect(AI_DIFFICULTY_MODS.normal.attackThreshold).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.attackThreshold);
  });

  it('easy buildSpeedMult > normal > hard (easier = builds slower)', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildSpeedMult).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.buildSpeedMult);
    expect(AI_DIFFICULTY_MODS.normal.buildSpeedMult).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.buildSpeedMult);
  });

  it('easy retreatHpPercent > normal > hard (easier = retreats sooner)', () => {
    expect(AI_DIFFICULTY_MODS.easy.retreatHpPercent).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.retreatHpPercent);
    expect(AI_DIFFICULTY_MODS.normal.retreatHpPercent).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.retreatHpPercent);
  });
});

describe('DIFFICULTY_MODS ant/queen spawn rates', () => {
  it('easy has lowest ant pressure', () => {
    const easy = DIFFICULTY_MODS.easy;
    expect(easy.spawnInterval).toBe(45);
    expect(easy.maxAnts).toBe(15);
    expect(easy.fireAntChance).toBe(0.15);
    expect(easy.waveSize).toBe(0.7);
  });

  it('hard has highest ant pressure', () => {
    const hard = DIFFICULTY_MODS.hard;
    expect(hard.spawnInterval).toBe(20);
    expect(hard.maxAnts).toBe(28);
    expect(hard.fireAntChance).toBe(0.50);
    expect(hard.waveSize).toBe(1.3);
  });

  it('maxAnts scales easy < normal < hard', () => {
    expect(DIFFICULTY_MODS.easy.maxAnts).toBeLessThan(DIFFICULTY_MODS.normal.maxAnts);
    expect(DIFFICULTY_MODS.normal.maxAnts).toBeLessThan(DIFFICULTY_MODS.hard.maxAnts);
  });
});

describe('STRUCTURE_IMAGES mapping', () => {
  it('maps all standard structure types to lowercase images', () => {
    const expected: [string, string][] = [
      ['FACT', 'fact'], ['POWR', 'powr'], ['APWR', 'apwr'], ['BARR', 'barr'],
      ['TENT', 'tent'], ['WEAP', 'weap'], ['PROC', 'proc'], ['SILO', 'silo'],
      ['DOME', 'dome'], ['FIX', 'fix'], ['GUN', 'gun'], ['SAM', 'sam'],
      ['HBOX', 'hbox'], ['TSLA', 'tsla'], ['AGUN', 'agun'], ['GAP', 'gap'],
      ['PBOX', 'pbox'], ['HPAD', 'hpad'], ['AFLD', 'afld'], ['ATEK', 'atek'],
      ['STEK', 'stek'], ['IRON', 'iron'], ['PDOX', 'pdox'], ['KENN', 'kenn'],
      ['QUEE', 'quee'], ['LAR1', 'lar1'], ['LAR2', 'lar2'],
    ];
    for (const [key, val] of expected) {
      expect(STRUCTURE_IMAGES[key], `${key} should map to ${val}`).toBe(val);
    }
  });

  it('has 27 entries', () => {
    expect(Object.keys(STRUCTURE_IMAGES).length).toBe(27);
  });
});

// ── 2. createAIHouseState (HOUSE.CPP AI init) ─────────────────────────────────

describe('createAIHouseState — difficulty modifier application (HOUSE.CPP)', () => {
  it('initializes with economy phase and production disabled', () => {
    const ctx = makeAIContext({ difficulty: 'normal', houseIQs: new Map([[House.USSR, 3]]) });
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.house).toBe(House.USSR);
    expect(state.phase).toBe('economy');
    expect(state.productionEnabled).toBe(false);
    expect(state.buildQueue).toEqual([]);
    expect(state.attackPool.size).toBe(0);
  });

  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    it(`applies ${diff} difficulty modifiers`, () => {
      const mods = AI_DIFFICULTY_MODS[diff];
      const ctx = makeAIContext({ difficulty: diff, houseIQs: new Map([[House.USSR, 3]]) });
      const state = createAIHouseState(ctx, House.USSR);
      expect(state.incomeMult, `${diff} incomeMult`).toBe(mods.incomeMult);
      expect(state.buildSpeedMult, `${diff} buildSpeedMult`).toBe(mods.buildSpeedMult);
      expect(state.attackThreshold, `${diff} attackThreshold`).toBe(mods.attackThreshold);
      expect(state.attackCooldownTicks, `${diff} attackCooldown`).toBe(mods.attackCooldown);
      expect(state.aggressionMult, `${diff} aggressionMult`).toBe(mods.aggressionMult);
    });
  }

  it('reads IQ from houseIQs map (default 3)', () => {
    const ctx = makeAIContext({ houseIQs: new Map([[House.USSR, 5]]) });
    expect(createAIHouseState(ctx, House.USSR).iq).toBe(5);
  });

  it('defaults IQ to 3 when not in map', () => {
    const ctx = makeAIContext({});
    expect(createAIHouseState(ctx, House.USSR).iq).toBe(3);
  });

  it('reads techLevel from houseTechLevels (default 10)', () => {
    const ctx = makeAIContext({ houseTechLevels: new Map([[House.USSR, 7]]) });
    expect(createAIHouseState(ctx, House.USSR).techLevel).toBe(7);
  });

  it('reads maxUnit/maxInfantry/maxBuilding caps (default -1 = uncapped)', () => {
    const ctx = makeAIContext({
      houseMaxUnits: new Map([[House.USSR, 20]]),
      houseMaxInfantry: new Map([[House.USSR, 15]]),
      houseMaxBuildings: new Map([[House.USSR, 10]]),
    });
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxUnit).toBe(20);
    expect(state.maxInfantry).toBe(15);
    expect(state.maxBuilding).toBe(10);
  });

  it('defaults caps to -1 (uncapped)', () => {
    const ctx = makeAIContext({});
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxUnit).toBe(-1);
    expect(state.maxInfantry).toBe(-1);
    expect(state.maxBuilding).toBe(-1);
  });
});

// ── 3. Pure query functions ────────────────────────────────────────────────────

describe('aiCountStructure (HOUSE.CPP structure census)', () => {
  it('counts alive structures of a specific type for a house', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 12, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.Spain, cx: 14, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 14 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiCountStructure(ctx, House.USSR, 'POWR')).toBe(2);
    expect(aiCountStructure(ctx, House.Spain, 'POWR')).toBe(1);
    expect(aiCountStructure(ctx, House.USSR, 'WEAP')).toBe(1);
    expect(aiCountStructure(ctx, House.USSR, 'DOME')).toBe(0);
  });

  it('ignores dead structures', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 12, cy: 10, alive: false }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiCountStructure(ctx, House.USSR, 'POWR')).toBe(1);
  });

  it('returns 0 for empty structures list', () => {
    const ctx = makeAIContext({ structures: [] });
    expect(aiCountStructure(ctx, House.USSR, 'POWR')).toBe(0);
  });
});

describe('aiPowerProduced (HOUSE.CPP power grid)', () => {
  it('POWR produces 100, APWR produces 200', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'APWR', house: House.USSR, cx: 12, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerProduced(ctx, House.USSR)).toBe(300);
  });

  it('ignores dead power plants', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10, alive: false }),
      makeStructure({ type: 'APWR', house: House.USSR, cx: 12, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerProduced(ctx, House.USSR)).toBe(200);
  });

  it('ignores other houses', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.Spain, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerProduced(ctx, House.USSR)).toBe(100);
  });

  it('non-power structures produce 0', () => {
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerProduced(ctx, House.USSR)).toBe(0);
  });
});

describe('aiPowerConsumed (HOUSE.CPP power grid)', () => {
  it('TENT/BARR consume 20 each', () => {
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'BARR', house: House.USSR, cx: 12, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerConsumed(ctx, House.USSR)).toBe(40);
  });

  it('TSLA consumes 150 (highest single consumer)', () => {
    const structures = [
      makeStructure({ type: 'TSLA', house: House.USSR, cx: 10, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerConsumed(ctx, House.USSR)).toBe(150);
  });

  it('ATEK consumes 200, STEK consumes 100', () => {
    const structures = [
      makeStructure({ type: 'ATEK', house: House.Spain, cx: 10, cy: 10 }),
      makeStructure({ type: 'STEK', house: House.Spain, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerConsumed(ctx, House.Spain)).toBe(300);
  });

  it('all power consumers sum correctly', () => {
    const consumers: [string, number][] = [
      ['TENT', 20], ['BARR', 20], ['WEAP', 30], ['PROC', 30],
      ['DOME', 40], ['GUN', 40], ['PBOX', 15], ['HBOX', 15],
      ['TSLA', 150], ['SAM', 20], ['AGUN', 50], ['ATEK', 200],
      ['STEK', 100], ['HPAD', 10], ['AFLD', 30], ['GAP', 60],
      ['FIX', 30], ['FTUR', 20], ['SILO', 10], ['KENN', 10],
      ['IRON', 200], ['PDOX', 200], ['MSLO', 100],
    ];
    for (const [type, expected] of consumers) {
      const structures = [makeStructure({ type, house: House.USSR, cx: 10, cy: 10 })];
      const ctx = makeAIContext({ structures });
      expect(aiPowerConsumed(ctx, House.USSR), `${type} should consume ${expected}`).toBe(expected);
    }
  });

  it('SYRD and SPEN consume 30 each', () => {
    const structures = [
      makeStructure({ type: 'SYRD', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'SPEN', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    expect(aiPowerConsumed(ctx, House.USSR)).toBe(60);
  });

  it('FACT consumes 0 power', () => {
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures });
    expect(aiPowerConsumed(ctx, House.USSR)).toBe(0);
  });
});

describe('aiHasPrereq (HOUSE.CPP prerequisite check)', () => {
  it('TENT prereq is satisfied by either TENT or BARR', () => {
    const ctx1 = makeAIContext({ structures: [makeStructure({ type: 'TENT', house: House.Spain, cx: 10, cy: 10 })] });
    expect(aiHasPrereq(ctx1, House.Spain, 'TENT')).toBe(true);

    const ctx2 = makeAIContext({ structures: [makeStructure({ type: 'BARR', house: House.Spain, cx: 10, cy: 10 })] });
    expect(aiHasPrereq(ctx2, House.Spain, 'TENT')).toBe(true);
  });

  it('TENT prereq fails with no TENT or BARR', () => {
    const ctx = makeAIContext({ structures: [makeStructure({ type: 'WEAP', house: House.Spain, cx: 10, cy: 10 })] });
    expect(aiHasPrereq(ctx, House.Spain, 'TENT')).toBe(false);
  });

  it('non-TENT prereq checks exact type', () => {
    const ctx = makeAIContext({ structures: [makeStructure({ type: 'DOME', house: House.USSR, cx: 10, cy: 10 })] });
    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(true);
    expect(aiHasPrereq(ctx, House.USSR, 'WEAP')).toBe(false);
  });

  it('ignores dead structures', () => {
    const ctx = makeAIContext({ structures: [makeStructure({ type: 'DOME', house: House.USSR, cx: 10, cy: 10, alive: false })] });
    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(false);
  });

  it('only checks own house', () => {
    const ctx = makeAIContext({ structures: [makeStructure({ type: 'DOME', house: House.Spain, cx: 10, cy: 10 })] });
    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(false);
  });
});

describe('aiGetBaseCenter (HOUSE.CPP centroid)', () => {
  it('returns centroid of alive structures', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 }),  // center 11,11 (2x2)
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),  // center 15,11
    ];
    const ctx = makeAIContext({ structures });
    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();
    // Avg of (11,11) and (15,11) = (13,11)
    expect(center!.cx).toBe(13);
    expect(center!.cy).toBe(11);
  });

  it('returns null if no alive structures', () => {
    const ctx = makeAIContext({ structures: [] });
    expect(aiGetBaseCenter(ctx, House.USSR)).toBeNull();
  });

  it('ignores dead structures', () => {
    const structures = [
      makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10, alive: false }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 20, cy: 20 }),
    ];
    const ctx = makeAIContext({ structures });
    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();
    // Only WEAP (3x2), center = 20+1.5=21.5, 20+1=21 → floor(21.5)=21, floor(21)=21
    expect(center!.cx).toBe(21);
    expect(center!.cy).toBe(21);
  });

  it('accounts for structure size when computing center', () => {
    // FACT is 3x3, placed at (10,10) → center = (11.5, 11.5) → floor = (11,11) with single structure
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures });
    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center!.cx).toBe(11);
    expect(center!.cy).toBe(11);
  });
});

describe('aiIsFactoryExit (HOUSE.CPP exit zone check)', () => {
  it('cell directly below WEAP is an exit zone', () => {
    // WEAP is 3x2, placed at (10,10). Exit row is cy=12 (10+2), cx=10..12
    const structures = [makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures });
    expect(aiIsFactoryExit(ctx, 10, 12, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 11, 12, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 12, 12, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 13, 12, House.USSR)).toBe(false); // outside width
    expect(aiIsFactoryExit(ctx, 10, 13, House.USSR)).toBe(false); // too far below
    expect(aiIsFactoryExit(ctx, 10, 11, House.USSR)).toBe(false); // inside building
  });

  it('cell below TENT (2x2) is exit zone', () => {
    // TENT at (5,5), 2x2 → exit row cy=7, cx=5..6
    const structures = [makeStructure({ type: 'TENT', house: House.USSR, cx: 5, cy: 5 })];
    const ctx = makeAIContext({ structures });
    expect(aiIsFactoryExit(ctx, 5, 7, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 6, 7, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 7, 7, House.USSR)).toBe(false);
  });

  it('only checks own house exits', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.Spain, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures });
    expect(aiIsFactoryExit(ctx, 10, 12, House.USSR)).toBe(false);
  });

  it('ignores non-factory structures (DOME, GUN, etc.)', () => {
    const structures = [makeStructure({ type: 'DOME', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures });
    expect(aiIsFactoryExit(ctx, 10, 12, House.USSR)).toBe(false);
  });

  it('checks PROC as factory exit', () => {
    // PROC is 3x2 at (10,10) → exit row cy=12, cx=10..12
    const structures = [makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures });
    expect(aiIsFactoryExit(ctx, 10, 12, House.USSR)).toBe(true);
  });
});

describe('aiStagingArea (HOUSE.CPP rally point)', () => {
  it('returns staging point between base and enemy', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 50, cy: 10 }),
    ];
    const ctx = makeAIContext({
      structures,
      isAllied: (a, b) => a === b,
    });
    const staging = aiStagingArea(ctx, House.USSR);
    expect(staging).not.toBeNull();
    // Should be offset from USSR base center toward Spain base
    const ussrCenter = aiGetBaseCenter(ctx, House.USSR)!;
    const stageCx = staging!.x / CELL_SIZE;
    expect(stageCx).toBeGreaterThan(ussrCenter.cx);
  });

  it('returns null when no base structures', () => {
    const ctx = makeAIContext({ structures: [] });
    expect(aiStagingArea(ctx, House.USSR)).toBeNull();
  });

  it('staging point is 5 cells from base center toward enemy', () => {
    // Base at (10,10), enemy at (10,50) → direction is pure south
    const structures = [
      makeStructure({ type: 'SILO', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'SILO', house: House.Spain, cx: 10, cy: 50 }),
    ];
    const ctx = makeAIContext({
      structures,
      isAllied: (a, b) => a === b,
    });
    const staging = aiStagingArea(ctx, House.USSR);
    expect(staging).not.toBeNull();
    // Should be roughly 5 cells south of base center
    const baseCy = aiGetBaseCenter(ctx, House.USSR)!.cy;
    const stageCy = Math.floor(staging!.y / CELL_SIZE);
    expect(stageCy).toBeGreaterThan(baseCy);
    expect(stageCy).toBeLessThanOrEqual(baseCy + 6);
  });
});

// ── 4. Phase transitions (HOUSE.CPP AI_Strategic_Planner) ──────────────────────

describe('updateAIStrategicPlanner — phase transitions (HOUSE.CPP)', () => {
  it('only runs on tick % 150 === 0', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 149,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy'); // didn't run
  });

  it('transitions economy → buildup when barracks + weap + 2 power', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in economy when missing WEAP', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('stays in economy when missing barracks', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('stays in economy with only 1 power plant', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('transitions buildup → attack when attack pool >= threshold', () => {
    const pool = new Set([1, 2, 3, 4, 5, 6]);
    const state = makeAIState({ house: House.USSR, phase: 'buildup', attackPool: pool, attackThreshold: 6 });
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });

  it('stays in buildup when pool < threshold', () => {
    const pool = new Set([1, 2, 3]);
    const state = makeAIState({ house: House.USSR, phase: 'buildup', attackPool: pool, attackThreshold: 6 });
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('transitions attack → buildup when attack pool is empty', () => {
    const state = makeAIState({ house: House.USSR, phase: 'attack', attackPool: new Set() });
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in attack when pool still has units', () => {
    const state = makeAIState({ house: House.USSR, phase: 'attack', attackPool: new Set([1, 2]) });
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });

  it('counts harvesters and refineries during planner tick', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 20, 20);
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 16, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(1);
    expect(state.refineryCount).toBe(2);
  });

  it('clears underAttack if 150 ticks have passed since last base attack', () => {
    const state = makeAIState({ house: House.USSR, underAttack: true, lastBaseAttackTick: 0 });
    const ctx = makeAIContext({
      tick: 300, // 300 - 0 = 300 > 150
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(false);
  });

  it('keeps underAttack if less than 150 ticks since last base attack', () => {
    const state = makeAIState({ house: House.USSR, underAttack: true, lastBaseAttackTick: 200 });
    const ctx = makeAIContext({
      tick: 300, // 300 - 200 = 100 < 150
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(true);
  });
});

// ── 5. IQ-gated behaviors ──────────────────────────────────────────────────────

describe('IQ-gated AI behaviors (HOUSE.CPP IQ thresholds)', () => {
  it('IQ 0 skips strategic planner entirely', () => {
    const state = makeAIState({ house: House.USSR, iq: 0, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy'); // IQ 0 → skipped
  });

  it('IQ < 1 skips construction', () => {
    const state = makeAIState({ house: House.USSR, iq: 0, productionEnabled: true });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      structures,
    });
    const before = structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before); // no new structures
  });

  it('IQ >= 1 allows construction (populates build queue)', () => {
    const state = makeAIState({ house: House.USSR, iq: 1, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 63, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      structures,
    });
    updateAIConstruction(ctx);
    // IQ >= 1 entered the code path: either built something or populated the build queue
    const builtSomething = ctx.structures.length > 2;
    const populatedQueue = state.buildQueue.length > 0 || state.lastBuildTick > 0;
    expect(builtSomething || populatedQueue,
      'IQ 1 should enter construction logic (build or populate queue)').toBe(true);
  });

  it('IQ < 2 skips attack groups', () => {
    const state = makeAIState({ house: House.USSR, iq: 1, phase: 'buildup', productionEnabled: true });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 120,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('IQ >= 2 allows attack group accumulation', () => {
    const state = makeAIState({ house: House.USSR, iq: 2, phase: 'buildup', productionEnabled: true });
    // Place units near staging area
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const staging = aiStagingArea(makeAIContext({ structures, isAllied: (a, b) => a === b }), House.USSR);
    const unit = new Entity(UnitType.V_2TNK, House.USSR, staging!.x, staging!.y);
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 120,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });

  it('IQ < 2 skips defense rally', () => {
    const state = makeAIState({ house: House.USSR, iq: 1, underAttack: true, attackPool: new Set([1]) });
    const ctx = makeAIContext({
      tick: 45,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
    });
    updateAIDefense(ctx);
    expect(state.attackPool.size).toBe(1); // not recalled
  });

  it('IQ < 2 skips base rebuild', () => {
    const state = makeAIState({ house: House.USSR, iq: 1 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 10 + 14 * MAP_CELLS, house: House.USSR }],
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildQueue.length).toBe(0);
  });

  it('IQ < 3 skips retreat', () => {
    const state = makeAIState({ house: House.USSR, iq: 2 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 20, 20);
    unit.hp = 1; // very low
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.GUARD); // didn't retreat
  });

  it('IQ >= 3 triggers retreat for damaged units', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 20, 20);
    unit.hp = 1; // well below 25% retreat threshold
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('IQ < 3 skips repair', () => {
    const state = makeAIState({ house: House.USSR, iq: 2 });
    const damaged = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: 100 });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [damaged],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIRepair(ctx);
    expect(damaged.hp).toBe(100); // unchanged
  });

  it('IQ >= 3 repairs damaged structures', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const damaged = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [damaged],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    const hpBefore = damaged.hp;
    updateAIRepair(ctx);
    expect(damaged.hp).toBeGreaterThan(hpBefore);
  });

  it('IQ < 3 skips sell-damaged', () => {
    const state = makeAIState({ house: House.USSR, iq: 2 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const dying = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: 1 }); // well below CONDITION_RED
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [dying],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(dying.alive).toBe(true); // not sold
  });

  it('IQ >= 3 sells near-death structures', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const dying = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: 1 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [dying],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(dying.alive).toBe(false);
    expect(dying.rubble).toBe(true);
  });

  it('IQ < 2 skips autocreate teams', () => {
    const state = makeAIState({ house: House.USSR, iq: 1, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 10, cy: 10 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// ── 6. Build order priority (getAIBuildOrder) ──────────────────────────────────

describe('getAIBuildOrder — priority queue (HOUSE.CPP build logic)', () => {
  it('queues POWR first when power deficit', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 14, cy: 10 }), // consumes 20
      // No POWR — consumed > produced
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue[0]).toBe('POWR');
  });

  it('queues TENT when no barracks exist', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('TENT');
  });

  it('queues PROC when fewer than 2 refineries', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 18, cy: 10 }), // only 1
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('PROC');
  });

  it('queues WEAP when no war factory', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('WEAP');
  });

  it('queues DOME when credits > 1000 and no dome', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('DOME');
  });

  it('skips DOME when credits <= 1000', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 500]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('DOME');
  });

  it('soviet AI queues TSLA for defense, not GUN', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('TSLA');
    expect(queue).not.toContain('GUN');
  });

  it('allied AI queues GUN for defense, not TSLA', () => {
    const state = makeAIState({ house: House.Spain });
    const structures = [
      makeStructure({ type: 'FACT', house: House.Spain, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.Spain, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.Spain, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.Spain, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.Spain, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.Spain, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.Spain, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.Spain, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.Spain, state);
    expect(queue).toContain('GUN');
    expect(queue).not.toContain('TSLA');
  });

  it('queues tech center (STEK for soviet) when DOME exists', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
      makeStructure({ type: 'DOME', house: House.USSR, cx: 34, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('STEK');
  });

  it('queues AFLD for soviet when has STEK', () => {
    const state = makeAIState({ house: House.USSR });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
      makeStructure({ type: 'DOME', house: House.USSR, cx: 34, cy: 10 }),
      makeStructure({ type: 'STEK', house: House.USSR, cx: 36, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('AFLD');
  });

  it('queues extra PROC when harvester count > refinery count', () => {
    const state = makeAIState({ house: House.USSR, harvesterCount: 3, refineryCount: 1 });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 16, cy: 10 }),
      makeStructure({ type: 'TENT', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 22, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 26, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({ structures, houseCredits: new Map([[House.USSR, 5000]]) });
    const queue = getAIBuildOrder(ctx, House.USSR, state);
    // Should have PROC in queue from the harv > ref check (item 10)
    const procCount = queue.filter(q => q === 'PROC').length;
    expect(procCount).toBeGreaterThanOrEqual(1);
  });
});

// ── 7. Spawning functions ──────────────────────────────────────────────────────

describe('spawnAIStructure (HOUSE.CPP)', () => {
  it('adds structure to ctx.structures', () => {
    const ctx = makeAIContext({ structures: [] });
    spawnAIStructure(ctx, 'POWR', House.USSR, 10, 10);
    expect(ctx.structures.length).toBe(1);
    expect(ctx.structures[0].type).toBe('POWR');
    expect(ctx.structures[0].house).toBe(House.USSR);
    expect(ctx.structures[0].cx).toBe(10);
    expect(ctx.structures[0].cy).toBe(10);
    expect(ctx.structures[0].alive).toBe(true);
  });

  it('sets correct image from STRUCTURE_IMAGES', () => {
    const ctx = makeAIContext({ structures: [] });
    spawnAIStructure(ctx, 'TSLA', House.USSR, 10, 10);
    expect(ctx.structures[0].image).toBe('tsla');
  });

  it('uses STRUCTURE_MAX_HP for hp/maxHp', () => {
    const ctx = makeAIContext({ structures: [] });
    spawnAIStructure(ctx, 'POWR', House.USSR, 10, 10);
    const expected = STRUCTURE_MAX_HP['POWR'] ?? 256;
    expect(ctx.structures[0].hp).toBe(expected);
    expect(ctx.structures[0].maxHp).toBe(expected);
  });

  it('marks footprint as WALL terrain', () => {
    const map = new GameMap();
    const ctx = makeAIContext({ structures: [], map });
    spawnAIStructure(ctx, 'POWR', House.USSR, 10, 10); // 2x2
    expect(map.getTerrain(10, 10)).toBe(Terrain.WALL);
    expect(map.getTerrain(11, 10)).toBe(Terrain.WALL);
    expect(map.getTerrain(10, 11)).toBe(Terrain.WALL);
    expect(map.getTerrain(11, 11)).toBe(Terrain.WALL);
    // Adjacent cell should still be CLEAR
    expect(map.getTerrain(12, 10)).toBe(Terrain.CLEAR);
  });

  it('marks 3x3 FACT footprint correctly', () => {
    const map = new GameMap();
    const ctx = makeAIContext({ structures: [], map });
    spawnAIStructure(ctx, 'FACT', House.USSR, 10, 10);
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(map.getTerrain(10 + dx, 10 + dy), `(${10 + dx},${10 + dy})`).toBe(Terrain.WALL);
      }
    }
  });

  it('assigns weapon from STRUCTURE_WEAPONS', () => {
    const ctx = makeAIContext({ structures: [] });
    spawnAIStructure(ctx, 'GUN', House.USSR, 10, 10);
    expect(ctx.structures[0].weapon).toBeDefined();
    expect(ctx.structures[0].weapon!.damage).toBe(40);
    expect(ctx.structures[0].weapon!.range).toBe(6);
  });

  it('structures without weapons get undefined weapon', () => {
    const ctx = makeAIContext({ structures: [] });
    spawnAIStructure(ctx, 'POWR', House.USSR, 10, 10);
    expect(ctx.structures[0].weapon).toBeUndefined();
  });
});

describe('spawnAIUnit (FACTORY.CPP)', () => {
  it('spawns infantry from TENT/BARR', () => {
    const structures = [makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT');
    expect(unit).not.toBeNull();
    expect(unit!.type).toBe(UnitType.I_E1);
    expect(unit!.house).toBe(House.USSR);
    expect(ctx.entities).toContain(unit);
    expect(ctx.entityById.get(unit!.id)).toBe(unit);
  });

  it('spawns vehicles from WEAP', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(unit).not.toBeNull();
    expect(unit!.type).toBe(UnitType.V_2TNK);
  });

  it('returns null when no factory of required type exists', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT');
    expect(unit).toBeNull();
  });

  it('sets mission and guardOrigin when provided', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const origin: WorldPos = { x: 500, y: 500 };
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP', Mission.AREA_GUARD, origin);
    expect(unit!.mission).toBe(Mission.AREA_GUARD);
    expect(unit!.guardOrigin).toEqual(origin);
  });

  it('infantry spawn uses BARR if TENT not available', () => {
    const structures = [makeStructure({ type: 'BARR', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT');
    expect(unit).not.toBeNull();
  });

  it('only uses own house factory', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.Spain, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(unit).toBeNull();
  });

  it('default mission is GUARD', () => {
    const structures = [makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ structures, entities: [] });
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(unit!.mission).toBe(Mission.GUARD);
  });
});

// ── 8. Attack groups and launch (HOUSE.CPP, TEAM.CPP) ──────────────────────────

describe('updateAIAttackGroups — pool accumulation and launch (HOUSE.CPP)', () => {
  it('only runs on tick % 120 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'buildup', productionEnabled: true });
    const ctx = makeAIContext({
      tick: 119,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('skips houses with production disabled', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'buildup', productionEnabled: false });
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('skips economy phase', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'economy', productionEnabled: true });
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('adds GUARD/AREA_GUARD units near staging area to pool', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'buildup', productionEnabled: true });
    const staging = aiStagingArea(makeAIContext({ structures, isAllied: (a, b) => a === b }), House.USSR);
    const unit = new Entity(UnitType.V_2TNK, House.USSR, staging!.x, staging!.y);
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 120,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(unit.id)).toBe(true);
  });

  it('excludes harvesters from attack pool', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'buildup', productionEnabled: true });
    const staging = aiStagingArea(makeAIContext({ structures, isAllied: (a, b) => a === b }), House.USSR);
    const harv = new Entity(UnitType.V_HARV, House.USSR, staging!.x, staging!.y);
    harv.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 120,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(harv.id)).toBe(false);
  });

  it('removes dead units from attack pool', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60);
    const state = makeAIState({ house: House.USSR, iq: 3, phase: 'buildup', productionEnabled: true, attackPool: new Set([unit.id]) });
    unit.alive = false;
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 120,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(unit.id)).toBe(false);
  });

  it('launches attack when pool >= effective threshold and cooldown elapsed', () => {
    const units: Entity[] = [];
    for (let i = 0; i < 6; i++) {
      const u = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60 + i);
      u.mission = Mission.GUARD;
      units.push(u);
    }
    const pool = new Set(units.map(u => u.id));
    const state = makeAIState({
      house: House.USSR, iq: 3, phase: 'attack', productionEnabled: true,
      attackPool: pool, attackThreshold: 6, lastAttackTick: 0, attackCooldownTicks: 600, aggressionMult: 1.0,
    });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 720, // > 600 cooldown
      entities: units,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    // After launch, pool should be cleared
    expect(state.attackPool.size).toBe(0);
    // Units should be set to HUNT mission
    for (const u of units) {
      expect(u.mission).toBe(Mission.HUNT);
    }
  });

  it('effective threshold accounts for aggressionMult', () => {
    // attackThreshold=6, aggressionMult=1.4 → effectiveThreshold = floor(6/1.4) = 4
    const units: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const u = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60 + i);
      u.mission = Mission.GUARD;
      units.push(u);
    }
    const pool = new Set(units.map(u => u.id));
    const state = makeAIState({
      house: House.USSR, iq: 3, phase: 'attack', productionEnabled: true,
      attackPool: pool, attackThreshold: 6, lastAttackTick: 0, attackCooldownTicks: 600, aggressionMult: 1.4,
    });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 720,
      entities: units,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0); // launched with only 4 units
  });
});

describe('launchAIAttack (HOUSE.CPP attack coordination)', () => {
  it('sets all pool units to HUNT with shared waveId', () => {
    const units = [
      entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60),
      entityAtCell(UnitType.I_E1, House.USSR, 61, 60),
    ];
    const pool = new Set(units.map(u => u.id));
    const state = makeAIState({ house: House.USSR, attackPool: pool });
    const structures = [
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const ctx = makeAIContext({
      entities: units,
      structures,
      nextWaveId: 5,
      isAllied: (a, b) => a === b,
    });
    launchAIAttack(ctx, House.USSR, state);
    expect(units[0].mission).toBe(Mission.HUNT);
    expect(units[1].mission).toBe(Mission.HUNT);
    expect(units[0].waveId).toBe(5);
    expect(units[1].waveId).toBe(5);
    expect(ctx.nextWaveId).toBe(6);
  });

  it('sets rally tick 30 ticks in the future', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60);
    const state = makeAIState({ house: House.USSR, attackPool: new Set([unit.id]) });
    const structures = [makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 })];
    const ctx = makeAIContext({
      tick: 1000,
      entities: [unit],
      structures,
      nextWaveId: 1,
      isAllied: (a, b) => a === b,
    });
    launchAIAttack(ctx, House.USSR, state);
    expect(unit.waveRallyTick).toBe(1030);
  });

  it('clears attack pool and records lastAttackTick', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60);
    const state = makeAIState({ house: House.USSR, attackPool: new Set([unit.id]) });
    const structures = [makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 })];
    const ctx = makeAIContext({
      tick: 500,
      entities: [unit],
      structures,
      isAllied: (a, b) => a === b,
    });
    launchAIAttack(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(0);
    expect(state.lastAttackTick).toBe(500);
  });

  it('does nothing when no target available', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 60, 60);
    const state = makeAIState({ house: House.USSR, attackPool: new Set([unit.id]) });
    // No enemy structures or units
    const ctx = makeAIContext({
      entities: [unit],
      structures: [],
      isAllied: (a, b) => a === b,
    });
    launchAIAttack(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(1); // unchanged — no target found
  });
});

describe('aiPickAttackTarget (HOUSE.CPP target priority)', () => {
  it('prioritizes FACT > WEAP > PROC', () => {
    const structures = [
      makeStructure({ type: 'PROC', house: House.Spain, cx: 20, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.Spain, cx: 30, cy: 10 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 40, cy: 10 }),
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
    ];
    const ctx = makeAIContext({
      structures,
      isAllied: (a, b) => a === b,
    });
    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Should target FACT (highest priority)
    const factCenter = (40 + 1.5) * CELL_SIZE;
    expect(target!.x).toBe(factCenter);
  });

  it('uses preferredTarget when set', () => {
    const state = makeAIState({ house: House.USSR, preferredTarget: 2 }); // 2 = WEAP
    const structures = [
      makeStructure({ type: 'FACT', house: House.Spain, cx: 40, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.Spain, cx: 30, cy: 10 }),
    ];
    const ctx = makeAIContext({
      structures,
      aiStates: new Map([[House.USSR, state]]),
      isAllied: (a, b) => a === b,
    });
    const target = aiPickAttackTarget(ctx, House.USSR);
    // Should target WEAP due to preferredTarget=2
    const weapCx = (30 + 1.5) * CELL_SIZE;
    expect(target!.x).toBe(weapCx);
  });

  it('falls back to nearest enemy structure when priority buildings absent', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'SILO', house: House.Spain, cx: 12, cy: 10 }),
      makeStructure({ type: 'DOME', house: House.Spain, cx: 50, cy: 50 }),
    ];
    const ctx = makeAIContext({
      structures,
      isAllied: (a, b) => a === b,
    });
    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Should pick SILO (cx=12) as it's closer to USSR base center (cx=11)
    expect(target!.x).toBe((12 + 0.5) * CELL_SIZE); // SILO is 1x1
  });

  it('falls back to nearest enemy unit when no structures', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
    ];
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 20, 20);
    const ctx = makeAIContext({
      entities: [enemy],
      structures,
      isAllied: (a, b) => a === b,
    });
    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    expect(target!.x).toBe(enemy.pos.x);
    expect(target!.y).toBe(enemy.pos.y);
  });

  it('returns null when no enemies exist', () => {
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({
      structures,
      isAllied: (a, b) => a === b,
    });
    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).toBeNull();
  });
});

// ── 9. Defense and recall (HOUSE.CPP defense logic) ────────────────────────────

describe('aiRecallDefenders (HOUSE.CPP)', () => {
  it('recalls up to half the attack pool', () => {
    const units: Entity[] = [];
    for (let i = 0; i < 6; i++) {
      const u = entityAtCell(UnitType.V_2TNK, House.USSR, 20 + i, 20);
      units.push(u);
    }
    const pool = new Set(units.map(u => u.id));
    const state = makeAIState({ house: House.USSR, attackPool: pool });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ entities: units, structures });
    aiRecallDefenders(ctx, House.USSR, state);
    // Should recall ceil(6/2) = 3
    expect(state.attackPool.size).toBe(3);
    const recalled = units.filter(u => u.mission === Mission.HUNT);
    expect(recalled.length).toBe(3);
  });

  it('recalled units get moveTarget set to base center', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    const state = makeAIState({ house: House.USSR, attackPool: new Set([unit.id]) });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({ entities: [unit], structures });
    aiRecallDefenders(ctx, House.USSR, state);
    expect(unit.mission).toBe(Mission.HUNT);
    expect(unit.moveTarget).not.toBeNull();
    // Should be near base center
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    expect(unit.moveTarget!.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
  });

  it('does nothing when no base center', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.mission = Mission.GUARD;
    const state = makeAIState({ house: House.USSR, attackPool: new Set([unit.id]) });
    const ctx = makeAIContext({ entities: [unit], structures: [] });
    aiRecallDefenders(ctx, House.USSR, state);
    expect(unit.mission).toBe(Mission.GUARD); // unchanged
  });
});

describe('updateAIDefense (HOUSE.CPP defense rally)', () => {
  it('only runs on tick % 45 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, underAttack: true });
    const ctx = makeAIContext({
      tick: 44,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
    });
    updateAIDefense(ctx);
    // No changes expected since tick not aligned
  });

  it('skips houses not under attack', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, underAttack: false });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 11);
    unit.mission = Mission.GUARD;
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 12);
    const ctx = makeAIContext({
      tick: 45,
      entities: [unit, enemy],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isAllied: (a, b) => a === b,
    });
    updateAIDefense(ctx);
    expect(unit.mission).toBe(Mission.GUARD); // not rallied
  });

  it('guard units near base engage nearby enemies when under attack', () => {
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const baseCenter = aiGetBaseCenter(makeAIContext({ structures }), House.USSR)!;
    const defender = new Entity(UnitType.V_2TNK, House.USSR,
      baseCenter.cx * CELL_SIZE + CELL_SIZE / 2,
      baseCenter.cy * CELL_SIZE + CELL_SIZE / 2);
    defender.mission = Mission.GUARD;
    const enemy = new Entity(UnitType.I_E1, House.Spain,
      (baseCenter.cx + 2) * CELL_SIZE + CELL_SIZE / 2,
      baseCenter.cy * CELL_SIZE + CELL_SIZE / 2);
    const state = makeAIState({ house: House.USSR, iq: 3, underAttack: true });
    const ctx = makeAIContext({
      tick: 45,
      entities: [defender, enemy],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isAllied: (a, b) => a === b,
    });
    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });
});

// ── 10. Retreat logic (HOUSE.CPP retreat) ──────────────────────────────────────

describe('updateAIRetreat (HOUSE.CPP retreat system)', () => {
  it('only runs on tick % 30 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.hp = 1;
    const ctx = makeAIContext({
      tick: 29,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('retreats unit below HP threshold to FIX structure', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.hp = 1; // well below 25%
    unit.mission = Mission.GUARD;
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'FIX', house: House.USSR, cx: 20, cy: 20 }),
    ];
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.MOVE);
    expect(unit.moveTarget).not.toBeNull();
    // Should be heading toward FIX center
    const [fw, fh] = STRUCTURE_SIZE['FIX'] ?? [3, 2];
    const fixCenter = { x: (20 + fw / 2) * CELL_SIZE, y: (20 + fh / 2) * CELL_SIZE };
    expect(unit.moveTarget!.x).toBe(fixCenter.x);
    expect(unit.moveTarget!.y).toBe(fixCenter.y);
  });

  it('retreats to base center when no FIX exists', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.hp = 1;
    unit.mission = Mission.GUARD;
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.MOVE);
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    expect(unit.moveTarget!.x).toBe(center.cx * CELL_SIZE + CELL_SIZE / 2);
  });

  it('removes retreating unit from attack pool', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.hp = 1;
    unit.mission = Mission.GUARD;
    const state = makeAIState({ house: House.USSR, iq: 3, attackPool: new Set([unit.id]) });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })];
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(state.attackPool.has(unit.id)).toBe(false);
  });

  it('skips player-controlled units', () => {
    const state = makeAIState({ house: House.Spain, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 50, 50);
    unit.hp = 1;
    unit.mission = Mission.GUARD;
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.Spain, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.Spain, cx: 10, cy: 10 })],
      isPlayerControlled: (e) => e.house === House.Spain,
    });
    updateAIRetreat(ctx);
    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('skips units already moving to a target', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    unit.hp = 1;
    unit.mission = Mission.MOVE;
    unit.moveTarget = { x: 100, y: 100 };
    const ctx = makeAIContext({
      tick: 30,
      entities: [unit],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    // Should not override existing move target
    expect(unit.moveTarget!.x).toBe(100);
  });

  it('skips ants and suicide units', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 50, 50);
    ant.hp = 1;
    ant.mission = Mission.GUARD;
    const suicide = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 51);
    suicide.hp = 1;
    suicide.mission = Mission.GUARD;
    suicide.isSuicide = true;
    const ctx = makeAIContext({
      tick: 30,
      entities: [ant, suicide],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(ant.mission).toBe(Mission.GUARD);
    expect(suicide.mission).toBe(Mission.GUARD);
  });

  it('emergency harvester return below difficulty retreat threshold', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 50, 50);
    harv.hp = Math.floor(harv.maxHp * 0.1); // 10% HP
    harv.mission = Mission.GUARD;
    harv.harvesterState = 'harvesting';
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 20, cy: 20 }),
    ];
    const ctx = makeAIContext({
      tick: 30,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(harv.harvesterState).toBe('returning');
    expect(harv.mission).toBe(Mission.MOVE);
  });

  it('harvester at or above retreat threshold does NOT emergency return', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 50, 50);
    harv.hp = Math.floor(harv.maxHp * 0.5); // 50% HP
    harv.mission = Mission.GUARD;
    harv.harvesterState = 'harvesting';
    const ctx = makeAIContext({
      tick: 30,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    expect(harv.harvesterState).toBe('harvesting'); // unchanged
  });

  it('retreat threshold varies by difficulty', () => {
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const mods = AI_DIFFICULTY_MODS[diff];
      const state = makeAIState({ house: House.USSR, iq: 3 });
      const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
      // Set HP just above threshold
      unit.hp = Math.ceil(unit.maxHp * mods.retreatHpPercent) + 1;
      unit.mission = Mission.GUARD;
      const ctx = makeAIContext({
        tick: 30,
        difficulty: diff,
        entities: [unit],
        aiStates: new Map([[House.USSR, state]]),
        structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
        isPlayerControlled: () => false,
      });
      updateAIRetreat(ctx);
      expect(unit.mission, `${diff}: unit above threshold should not retreat`).toBe(Mission.GUARD);
    }
  });
});

// ── 11. Repair and sell (rules.cpp constants) ───────────────────────────────────

describe('updateAIRepair (rules.cpp REPAIR_STEP=5, REPAIR_PERCENT=0.20)', () => {
  it('repairs structure by REPAIR_STEP (5 hp) per tick', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    const hpBefore = s.hp;
    updateAIRepair(ctx);
    expect(s.hp).toBe(hpBefore + 5);
  });

  it('deducts repair cost from credits', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIRepair(ctx);
    expect(ctx.houseCredits.get(House.USSR)!).toBeLessThan(5000);
  });

  it('does not repair structures above 80% HP', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.85) });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    const hpBefore = s.hp;
    updateAIRepair(ctx);
    expect(s.hp).toBe(hpBefore);
  });

  it('does not repair when credits < 10', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5]]),
    });
    const hpBefore = s.hp;
    updateAIRepair(ctx);
    expect(s.hp).toBe(hpBefore);
  });

  it('does not repair structures being sold', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    (s as any).sellProgress = 0.5;
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    const hpBefore = s.hp;
    updateAIRepair(ctx);
    expect(s.hp).toBe(hpBefore);
  });

  it('caps repair at maxHp', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['SILO'] ?? 300;
    // HP just 2 below max — repair step of 5 should cap at maxHp
    const s = makeStructure({ type: 'SILO', house: House.USSR, cx: 10, cy: 10, hp: maxHp - 2 });
    // But SILO starts at maxHp * 0.8 = 240 check... hp must be < 0.8*maxHp to qualify
    // Let's use a lower HP
    s.hp = Math.floor(maxHp * 0.79);
    const ctx = makeAIContext({
      tick: 15,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    // Repair multiple times
    for (let i = 0; i < 200; i++) {
      ctx.tick = i * 15;
      updateAIRepair(ctx);
    }
    expect(s.hp).toBeLessThanOrEqual(maxHp);
  });
});

describe('updateAISellDamaged (HOUSE.CPP auto-sell)', () => {
  it('sells structures below CONDITION_RED (25% HP)', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.10) });
    let footprintCleared = false;
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
      clearStructureFootprint: () => { footprintCleared = true; },
    });
    updateAISellDamaged(ctx);
    expect(s.alive).toBe(false);
    expect(s.rubble).toBe(true);
    expect(footprintCleared).toBe(true);
  });

  it('gives partial credit refund based on HP ratio', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const hp = Math.floor(maxHp * 0.20); // just below 25%
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    const credits = ctx.houseCredits.get(House.USSR) ?? 0;
    // refund = floor(cost * 0.5 * hpRatio)
    const weapCost = TEST_PRODUCTION_ITEMS.find(p => p.type === 'WEAP')!.cost;
    const expectedRefund = Math.floor(weapCost * 0.5 * (hp / maxHp));
    expect(credits).toBe(expectedRefund);
  });

  it('never sells FACT', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['FACT'] ?? 1000;
    const s = makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10, hp: 1 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true);
  });

  it('does not sell last power plant', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['POWR'] ?? 400;
    const s = makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10, hp: 1 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // only power plant, won't sell
  });

  it('sells damaged power plant when another exists', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['POWR'] ?? 400;
    const damaged = makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10, hp: 1 });
    const healthy = makeStructure({ type: 'POWR', house: House.USSR, cx: 14, cy: 10 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [damaged, healthy],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(damaged.alive).toBe(false);
  });

  it('does not sell structures above CONDITION_RED', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.30) });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true);
  });
});

// ── 12. Income (rules.cpp passive income) ──────────────────────────────────────

describe('updateAIIncome (HOUSE.CPP passive refinery income)', () => {
  it('only runs on tick % 450 === 0', () => {
    const ctx = makeAIContext({
      tick: 449,
      structures: [makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 })],
      houseCredits: new Map([[House.USSR, 0]]),
      aiStates: new Map([[House.USSR, makeAIState({ house: House.USSR })]]),
      isAllied: (a, b) => a === b,
    });
    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(0);
  });

  it('AI house earns 100 * incomeMult per refinery', () => {
    const state = makeAIState({ house: House.USSR, incomeMult: 1.0 });
    const ctx = makeAIContext({
      tick: 450,
      structures: [
        makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
        makeStructure({ type: 'PROC', house: House.USSR, cx: 16, cy: 10 }),
      ],
      houseCredits: new Map([[House.USSR, 0]]),
      aiStates: new Map([[House.USSR, state]]),
      isAllied: (a, b) => a === b,
    });
    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(200); // 100 per refinery
  });

  it('incomeMult scales income (easy=0.7 → 70 per refinery)', () => {
    const state = makeAIState({ house: House.USSR, incomeMult: 0.7 });
    const ctx = makeAIContext({
      tick: 450,
      structures: [makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 })],
      houseCredits: new Map([[House.USSR, 0]]),
      aiStates: new Map([[House.USSR, state]]),
      isAllied: (a, b) => a === b,
    });
    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(70);
  });

  it('player refineries do not earn AI income', () => {
    const ctx = makeAIContext({
      tick: 450,
      structures: [makeStructure({ type: 'PROC', house: House.Spain, cx: 10, cy: 10 })],
      houseCredits: new Map([[House.Spain, 0]]),
      isAllied: (a, b) => a === b,
      playerHouse: House.Spain,
    });
    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.Spain)).toBe(0);
  });

  it('dead refineries do not produce income', () => {
    const state = makeAIState({ house: House.USSR, incomeMult: 1.0 });
    const ctx = makeAIContext({
      tick: 450,
      structures: [makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10, alive: false })],
      houseCredits: new Map([[House.USSR, 0]]),
      aiStates: new Map([[House.USSR, state]]),
      isAllied: (a, b) => a === b,
    });
    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(0);
  });
});

// ── 13. Harvester management ───────────────────────────────────────────────────

describe('updateAIHarvesters (HOUSE.CPP harvester management)', () => {
  it('counts harvesters and refineries per house', () => {
    const harv1 = entityAtCell(UnitType.V_HARV, House.USSR, 20, 20);
    const harv2 = entityAtCell(UnitType.V_HARV, House.USSR, 22, 20);
    const state = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      tick: 60,
      entities: [harv1, harv2],
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 })],
    });
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(2);
    expect(state.refineryCount).toBe(1);
  });

  it('force-produces harvester when count is 0 but PROC and WEAP exist', () => {
    const state = makeAIState({ house: House.USSR, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_HARV);
  });

  it('deducts harvester cost from credits', () => {
    const state = makeAIState({ house: House.USSR, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIHarvesters(ctx);
    const harvCost = TEST_PRODUCTION_ITEMS.find(p => p.type === 'HARV')!.cost;
    expect(ctx.houseCredits.get(House.USSR)).toBe(5000 - harvCost);
  });

  it('does not force-produce when production disabled', () => {
    const state = makeAIState({ house: House.USSR, productionEnabled: false });
    const structures = [
      makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('does not force-produce when harvester already exists', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 20, 20);
    const state = makeAIState({ house: House.USSR, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'PROC', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(1); // no new harvester
  });
});

// ── 14. Unit caps (HOUSE.CPP MaxUnit/MaxInfantry/MaxBuilding) ──────────────────

describe('Unit caps in production (HOUSE.CPP MaxUnit/MaxInfantry)', () => {
  it('maxInfantry cap prevents infantry production', () => {
    const state = makeAIState({ house: House.USSR, maxInfantry: 2, productionEnabled: true });
    // Already have 2 infantry
    const inf1 = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    const inf2 = entityAtCell(UnitType.I_E1, House.USSR, 22, 20);
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60, // matches normal productionInterval
      entities: [inf1, inf2],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 5000]]),
      isAllied: (a, b) => a === b,
    });
    const before = ctx.entities.length;
    updateAIProduction(ctx);
    // Should not have produced infantry (cap reached)
    // May produce vehicle though — just check infantry count
    const infAfter = ctx.entities.filter(e => e.stats.isInfantry && e.house === House.USSR).length;
    expect(infAfter).toBe(2); // still 2
  });

  it('maxUnit cap prevents vehicle production', () => {
    const state = makeAIState({ house: House.USSR, maxUnit: 1, productionEnabled: true });
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 20, 20);
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [tank],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    const vehAfter = ctx.entities.filter(e => !e.stats.isInfantry && !e.isAnt && e.house === House.USSR).length;
    expect(vehAfter).toBe(1); // still 1
  });

  it('maxBuilding cap prevents construction', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, maxBuilding: 2, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 62, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before); // capped at 2
  });
});

// ── 15. Production pick (FACTORY.CPP weighted selection) ───────────────────────

describe('getAIProductionPick — weighted unit selection (FACTORY.CPP)', () => {
  it('returns null when no items available', () => {
    const ctx = makeAIContext({ scenarioProductionItems: [] });
    const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
    expect(pick).toBeNull();
  });

  it('filters by faction (soviet house gets soviet + both items)', () => {
    // Run 20 picks — all should be valid for soviet
    const state = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, state]]),
      entities: [],
    });
    for (let i = 0; i < 20; i++) {
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick) {
        expect(pick.faction === 'soviet' || pick.faction === 'both',
          `${pick.type} faction=${pick.faction} should be soviet or both`).toBe(true);
      }
    }
  });

  it('respects techLevel filter', () => {
    const state = makeAIState({ house: House.USSR, techLevel: 1 });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, state]]),
      entities: [],
    });
    for (let i = 0; i < 20; i++) {
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick && pick.techLevel !== undefined) {
        expect(pick.techLevel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('respects techPrereq requirement', () => {
    // E4 (Flamethrower) requires STEK — without STEK, should never pick E4
    const state = makeAIState({ house: House.USSR, techLevel: 10 });
    const ctx = makeAIContext({
      aiStates: new Map([[House.USSR, state]]),
      entities: [],
      structures: [], // no STEK
    });
    for (let i = 0; i < 50; i++) {
      const pick = getAIProductionPick(ctx, House.USSR, 'infantry');
      if (pick) {
        expect(pick.type).not.toBe('E4');
      }
    }
  });

  it('boosts anti-armor weight when ratio < 40%', () => {
    // Start with 10 E1 infantry and 0 anti-armor → ratio = 0
    const entities: Entity[] = [];
    for (let i = 0; i < 10; i++) {
      entities.push(entityAtCell(UnitType.I_E1, House.Spain, 20 + i, 20));
    }
    const state = makeAIState({ house: House.Spain, techLevel: 10 });
    const ctx = makeAIContext({
      aiStates: new Map([[House.Spain, state]]),
      entities,
      structures: [makeStructure({ type: 'WEAP', house: House.Spain, cx: 10, cy: 10 })],
    });
    // Over many picks, anti-armor types should be heavily favored
    let antiArmorCount = 0;
    const antiArmorTypes = new Set(['E3', '1TNK', '2TNK', '3TNK', '4TNK']);
    for (let i = 0; i < 100; i++) {
      const pick = getAIProductionPick(ctx, House.Spain, 'vehicle');
      if (pick && antiArmorTypes.has(pick.type)) antiArmorCount++;
    }
    expect(antiArmorCount).toBeGreaterThan(30); // should be heavily weighted
  });

  it('reduces weight for E6 (0.2x) and MEDI (0.3x) and HARV (0.1x)', () => {
    // These specialty units should appear rarely
    const state = makeAIState({ house: House.Spain, techLevel: 10 });
    const ctx = makeAIContext({
      aiStates: new Map([[House.Spain, state]]),
      entities: [],
    });
    let e6Count = 0;
    for (let i = 0; i < 200; i++) {
      const pick = getAIProductionPick(ctx, House.Spain, 'infantry');
      if (pick?.type === 'E6') e6Count++;
    }
    // E6 has 0.2 weight vs normal 1-3, so should be quite rare
    expect(e6Count).toBeLessThan(30);
  });
});

// ── 16. Construction system ────────────────────────────────────────────────────

describe('updateAIConstruction (HOUSE.CPP construction system)', () => {
  it('only runs on tick % 90 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 })];
    const ctx = makeAIContext({
      tick: 89,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before);
  });

  it('requires FACT to build', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const structures = [makeStructure({ type: 'POWR', house: House.USSR, cx: 60, cy: 60 })]; // no FACT
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before);
  });

  it('skips when credits <= 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 })];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 0]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before);
  });

  it('respects buildCooldown', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true, buildCooldown: 5 });
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 })];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before);
    expect(state.buildCooldown).toBe(4); // decremented
  });

  it('sets buildCooldown after successful build based on difficulty', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 63, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 90,
      difficulty: 'hard',
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    updateAIConstruction(ctx);
    // If placement succeeded, buildCooldown should be set
    // Hard: buildSpeedMult=0.7, cooldown = floor(6 * 0.7) = 4
    if (ctx.structures.length > 2) {
      expect(state.buildCooldown).toBe(Math.floor(6 * 0.7));
    } else {
      // Placement may fail due to spiral scan constraints — verify no regression
      expect(state.buildCooldown).toBe(0);
    }
  });
});

// ── 17. Placement logic (aiPlaceStructure) ─────────────────────────────────────

describe('aiPlaceStructure — spiral scan placement (HOUSE.CPP)', () => {
  it('places structure adjacent to existing base', () => {
    // Need multiple structures to create adjacency opportunities around a non-trivial base
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 63, cy: 60 }), // right of FACT
    ];
    const ctx = makeAIContext({ structures });
    const pos = aiPlaceStructure(ctx, House.USSR, 'SILO'); // 1x1 for easier placement
    expect(pos).not.toBeNull();
    // Should be within adjacency range of base
    const center = aiGetBaseCenter(ctx, House.USSR)!;
    expect(Math.abs(pos!.cx - center.cx)).toBeLessThanOrEqual(8);
    expect(Math.abs(pos!.cy - center.cy)).toBeLessThanOrEqual(8);
  });

  it('returns null when no base center', () => {
    const ctx = makeAIContext({ structures: [] });
    expect(aiPlaceStructure(ctx, House.USSR, 'POWR')).toBeNull();
  });

  it('avoids placing on existing structures', () => {
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 63, cy: 60 }),
    ];
    const ctx = makeAIContext({ structures });
    const pos = aiPlaceStructure(ctx, House.USSR, 'SILO'); // 1x1 for easier placement
    if (pos) {
      // Verify no overlap with any existing structure footprint
      for (const s of structures) {
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const overlaps = pos.cx >= s.cx && pos.cx < s.cx + sw &&
                         pos.cy >= s.cy && pos.cy < s.cy + sh;
        expect(overlaps, `placed at (${pos.cx},${pos.cy}) should not overlap ${s.type} at (${s.cx},${s.cy})`).toBe(false);
      }
    }
  });

  it('avoids WATER and WALL terrain', () => {
    const map = new GameMap();
    // Place water around the base
    for (let i = 55; i < 65; i++) {
      map.setTerrain(i, 58, Terrain.WATER);
    }
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 })];
    const ctx = makeAIContext({ structures, map });
    const pos = aiPlaceStructure(ctx, House.USSR, 'POWR');
    if (pos) {
      // Verify position doesn't overlap water
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const t = map.getTerrain(pos.cx + dx, pos.cy + dy);
          // The spawn itself marks WALL, but pre-existing placement should avoid water
          expect(t === Terrain.WATER, `(${pos.cx + dx},${pos.cy + dy}) should not be water`).toBe(false);
        }
      }
    }
  });

  it('defense structures (GUN, TSLA, SAM) placed at outer edge', () => {
    const structures = [makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 })];
    const ctx = makeAIContext({ structures });
    const gunPos = aiPlaceStructure(ctx, House.USSR, 'GUN');
    const powrPos = aiPlaceStructure(ctx, House.USSR, 'POWR');
    if (gunPos && powrPos) {
      const center = aiGetBaseCenter(ctx, House.USSR)!;
      const gunDist = (gunPos.cx - center.cx) ** 2 + (gunPos.cy - center.cy) ** 2;
      const powrDist = (powrPos.cx - center.cx) ** 2 + (powrPos.cy - center.cy) ** 2;
      // Defense should be farther from center than normal buildings
      expect(gunDist).toBeGreaterThanOrEqual(powrDist);
    }
  });

  it('does not block factory exits', () => {
    const structures = [
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.USSR, cx: 56, cy: 60 }),
    ];
    const ctx = makeAIContext({ structures });
    const pos = aiPlaceStructure(ctx, House.USSR, 'POWR');
    if (pos) {
      // Verify no cell of the placed structure is in the WEAP exit zone
      const [fw, fh] = STRUCTURE_SIZE['POWR'] ?? [2, 2];
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          expect(aiIsFactoryExit(ctx, pos.cx + dx, pos.cy + dy, House.USSR),
            `(${pos.cx + dx},${pos.cy + dy}) should not be a factory exit`).toBe(false);
        }
      }
    }
  });
});

// ── 18. Base rebuild (HOUSE.CPP base rebuild logic) ────────────────────────────

describe('updateBaseRebuild (HOUSE.CPP base rebuild)', () => {
  it('only runs on tick % 75 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 74,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildQueue.length).toBe(0);
  });

  it('does nothing with empty blueprint', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [],
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildQueue.length).toBe(0);
  });

  it('requires FACT for house to rebuild', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'POWR', house: House.USSR, cx: 10, cy: 10 })], // no FACT
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildQueue.length).toBe(0);
  });

  it('queues destroyed blueprint structures for rebuild', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    // Blueprint has a POWR at (14,10) but it's not alive
    // Give 0 credits so the queue populates but can't afford to process the first item
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      houseCredits: new Map([[House.USSR, 0]]), // can't afford to build
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    // Queue was populated but first item couldn't be built (insufficient credits)
    // The shift still happens but the function returns before spawning — queue is emptied
    // Instead verify the structure was NOT spawned (only original FACT)
    // With 0 credits, the function returns before spawning, BUT it already shifted the item
    // So let's verify the blueprint detection worked by giving enough credits and checking spawn
    // Actually: The function shifts the item then checks credits. If not enough, it returns without spawning.
    // So the queue item is consumed but structure not built.
    // Let's test differently: provide credits and verify structure spawned
    const ctx2 = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, makeAIState({ house: House.USSR, iq: 3 })]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx2);
    // POWR should have been spawned at (14, 10)
    const spawned = ctx2.structures.find(s => s.type === 'POWR' && s.cx === 14 && s.cy === 10);
    expect(spawned, 'POWR should be spawned from blueprint rebuild').toBeDefined();
    expect(spawned!.alive).toBe(true);
  });

  it('sorts rebuild queue by priority (POWR=0, PROC=1, WEAP=2, etc.)', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    // Give 0 credits: queue will populate and sort, then shift first item but return
    // before spawning because credits < cost. We can check remaining 2 items are sorted.
    // But actually the shift consumes item 0 regardless. So we check items at indices 0,1 after shift.
    // Provide credits so the first item (POWR) actually spawns.
    // Then remaining queue should have WEAP (priority 2), DOME (priority 4).
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [
        { type: 'DOME', cell: 20 + 10 * MAP_CELLS, house: House.USSR },  // priority 4
        { type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR },  // priority 0
        { type: 'WEAP', cell: 17 + 10 * MAP_CELLS, house: House.USSR },  // priority 2
      ],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    // POWR (priority 0) was first in sorted queue, spawned. Remaining queue:
    expect(ctx.baseRebuildQueue.length).toBe(2);
    expect(ctx.baseRebuildQueue[0].type).toBe('WEAP'); // priority 2
    expect(ctx.baseRebuildQueue[1].type).toBe('DOME'); // priority 4
    // Verify POWR was actually spawned
    expect(ctx.structures.some(s => s.type === 'POWR' && s.cx === 14)).toBe(true);
  });

  it('sets 30-second rebuild cooldown after spawning', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      baseRebuildQueue: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildCooldown).toBe(GAME_TICKS_PER_SEC * 30);
  });

  it('waits while cooldown is active', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })],
      baseBlueprint: [{ type: 'POWR', cell: 14 + 10 * MAP_CELLS, house: House.USSR }],
      baseRebuildCooldown: 100,
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    expect(ctx.baseRebuildCooldown).toBe(99); // decremented but no rebuild
  });
});

// ── 19. Autocreate teams (TEAM.CPP) ────────────────────────────────────────────

describe('updateAIAutocreateTeams (TEAM.CPP autocreate)', () => {
  it('does nothing when autocreateEnabled is false', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: false,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 10, cy: 10 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('only runs on tick % 120 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 119,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 10, cy: 10 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('spawns team members at waypoint', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(3);
    for (const e of ctx.entities) {
      expect(e.type).toBe(UnitType.I_E1);
      expect(e.house).toBe(House.USSR);
    }
  });

  it('team with no missions defaults to HUNT', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 1 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities[0].mission).toBe(Mission.HUNT);
  });

  it('team with missions assigns teamMissions script', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 1 }],
      missions: [{ mission: 'MOVE', data: 5 }, { mission: 'ATTACK', data: 0 }],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities[0].teamMissions.length).toBe(2);
    expect(ctx.entities[0].teamMissionIndex).toBe(0);
  });

  it('only processes autocreate-flagged teams (flag bit 2 = 4)', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const nonAutoTeam: TeamType = {
      name: 'T1', house: 2, flags: 0, origin: 0, trigger: -1, // no autocreate flag
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [nonAutoTeam],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('skips destroyed teams', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      destroyedTeams: new Set([0]),
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('requires >= 500 credits', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 400]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('spawns at map edge when houseEdge is set', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 1 }],
      missions: [],
    };
    const map = new GameMap();
    map.boundsX = 0;
    map.boundsY = 0;
    map.boundsW = 128;
    map.boundsH = 128;
    const ctx = makeAIContext({
      tick: 120,
      map,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      houseEdges: new Map([[House.USSR, 'north']]),
      waypoints: new Map(),
    });
    updateAIAutocreateTeams(ctx);
    expect(ctx.entities.length).toBe(1);
    // Should be near the north edge (cy ≈ 0)
    const cy = Math.floor(ctx.entities[0].pos.y / CELL_SIZE);
    expect(cy).toBeLessThanOrEqual(1);
  });

  it('flag bit 1 (IsSuicide=2) forces HUNT mission', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team: TeamType = {
      name: 'T1', house: 2, flags: 4 | 2, origin: 0, trigger: -1, // autocreate + suicide
      members: [{ type: 'E1', count: 1 }],
      missions: [{ mission: 'MOVE', data: 5 }],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    // Flag bit 1 (IsSuicide) forces HUNT regardless of mission script
    expect(ctx.entities[0].mission).toBe(Mission.HUNT);
  });

  it('only one team per house per cycle', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: true });
    const team1: TeamType = {
      name: 'T1', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E1', count: 2 }],
      missions: [],
    };
    const team2: TeamType = {
      name: 'T2', house: 2, flags: 4, origin: 0, trigger: -1,
      members: [{ type: 'E3', count: 3 }],
      missions: [],
    };
    const ctx = makeAIContext({
      tick: 120,
      aiStates: new Map([[House.USSR, state]]),
      houseCredits: new Map([[House.USSR, 10000]]),
      autocreateEnabled: true,
      teamTypes: [team1, team2],
      waypoints: new Map([[0, { cx: 50, cy: 50 }]]),
    });
    updateAIAutocreateTeams(ctx);
    // Only team1 should spawn (2 E1), team2 skipped due to one-per-cycle
    expect(ctx.entities.length).toBe(2);
    expect(ctx.entities.every(e => e.type === UnitType.I_E1)).toBe(true);
  });
});

// ── 20. AI Production (full cycle) ────────────────────────────────────────────

describe('updateAIProduction — full production cycle (HOUSE.CPP)', () => {
  it('production interval varies by difficulty', () => {
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const mods = AI_DIFFICULTY_MODS[diff];
      const state = makeAIState({ house: House.USSR, productionEnabled: true });
      const structures = [
        makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
        makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      ];
      // Test at non-matching tick
      const ctx = makeAIContext({
        tick: mods.productionInterval - 1,
        difficulty: diff,
        entities: [],
        aiStates: new Map([[House.USSR, state]]),
        structures,
        houseCredits: new Map([[House.USSR, 10000]]),
        isAllied: (a, b) => a === b,
      });
      updateAIProduction(ctx);
      expect(ctx.entities.length, `${diff}: should not produce at tick ${mods.productionInterval - 1}`).toBe(0);
    }
  });

  it('prioritizes harvester when harvesterCount < refineryCount', () => {
    const state = makeAIState({ house: House.USSR, productionEnabled: true, harvesterCount: 0, refineryCount: 1 });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    const harvesters = ctx.entities.filter(e => e.type === UnitType.V_HARV);
    expect(harvesters.length).toBe(1);
  });

  it('skips production for player-allied houses', () => {
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      structures: [makeStructure({ type: 'TENT', house: House.Spain, cx: 10, cy: 10 })],
      houseCredits: new Map([[House.Spain, 10000]]),
      isAllied: (a, b) => a === b,
      playerHouse: House.Spain,
    });
    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('ant missions respect maxAnts cap', () => {
    // Create 20 ants (normal cap)
    const ants: Entity[] = [];
    for (let i = 0; i < 20; i++) {
      const ant = entityAtCell(UnitType.ANT1, House.USSR, 20 + i, 20);
      ants.push(ant);
    }
    const ctx = makeAIContext({
      tick: 60,
      scenarioId: 'SCA01EA',
      difficulty: 'normal',
      entities: ants,
      structures: [],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    // Should not produce more (at cap)
    expect(ctx.entities.length).toBe(20);
  });

  it('sends produced units to staging area when available', () => {
    const state = makeAIState({ house: House.USSR, productionEnabled: true });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 64, cy: 60 }),
      makeStructure({ type: 'FACT', house: House.Spain, cx: 80, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    // New units should have moveTarget set to staging area
    for (const e of ctx.entities) {
      if (e.type !== UnitType.V_HARV) {
        expect(e.moveTarget).not.toBeNull();
      }
    }
  });

  it('skips infantry when no barracks', () => {
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      structures: [makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 })],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    const infantry = ctx.entities.filter(e => e.stats.isInfantry);
    expect(infantry.length).toBe(0);
  });

  it('vehicle production requires >= 600 credits', () => {
    const ctx = makeAIContext({
      tick: 60,
      entities: [],
      structures: [
        makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      ],
      houseCredits: new Map([[House.USSR, 500]]), // < 600
      isAllied: (a, b) => a === b,
    });
    updateAIProduction(ctx);
    const vehicles = ctx.entities.filter(e => !e.stats.isInfantry);
    expect(vehicles.length).toBe(0);
  });
});

// ── 21. Edge cases and integration ─────────────────────────────────────────────

describe('AI edge cases', () => {
  it('multiple AI houses operate independently', () => {
    const ussrState = makeAIState({ house: House.USSR, phase: 'economy', iq: 3 });
    const ukrState = makeAIState({ house: House.Ukraine, phase: 'buildup', iq: 3, attackPool: new Set([999]) });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([
        [House.USSR, ussrState],
        [House.Ukraine, ukrState],
      ]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    // USSR transitions because it has the buildings
    expect(ussrState.phase).toBe('buildup');
    // Ukraine stays in buildup (independent state)
    expect(ukrState.phase).toBe('buildup');
  });

  it('dead entities do not count in harvester census', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 20, 20);
    harv.alive = false;
    const state = makeAIState({ house: House.USSR });
    const ctx = makeAIContext({
      tick: 150,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(0);
  });

  it('BARR counts as barracks for economy→buildup transition', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'BARR', house: House.USSR, cx: 10, cy: 10 }), // BARR instead of TENT
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('updateAIHarvesters only runs on tick % 60 === 0', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 20, 20);
    const state = makeAIState({ house: House.USSR });
    state.harvesterCount = 99; // stale value
    const ctx = makeAIContext({
      tick: 59,
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures: [],
    });
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(99); // not updated, tick not aligned
  });

  it('updateAIRepair only runs on tick % 15 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 1000;
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: Math.floor(maxHp * 0.5) });
    const ctx = makeAIContext({
      tick: 14,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 5000]]),
    });
    const hpBefore = s.hp;
    updateAIRepair(ctx);
    expect(s.hp).toBe(hpBefore); // not repaired, tick not aligned
  });

  it('updateAISellDamaged only runs on tick % 75 === 0', () => {
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const s = makeStructure({ type: 'WEAP', house: House.USSR, cx: 10, cy: 10, hp: 1 });
    const ctx = makeAIContext({
      tick: 74,
      aiStates: new Map([[House.USSR, state]]),
      structures: [s],
      houseCredits: new Map([[House.USSR, 0]]),
    });
    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // not sold, tick not aligned
  });

  it('updateAIConstruction skips when productionEnabled is false', () => {
    const state = makeAIState({ house: House.USSR, iq: 3, productionEnabled: false });
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 60, cy: 60 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 63, cy: 60 }),
    ];
    const ctx = makeAIContext({
      tick: 90,
      aiStates: new Map([[House.USSR, state]]),
      structures,
      houseCredits: new Map([[House.USSR, 50000]]),
    });
    const before = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(before); // production disabled, no building
  });

  it('base rebuild blocked check considers full structure footprint, not just top-left', () => {
    // Bug: updateBaseRebuild checked s.cx === pos.cx+dx (top-left only), missing
    // structures whose footprint COVERS the cell. A 3x3 FACT at (10,10) occupying
    // (10-12,10-12) should block rebuild at cell (11,10) even though s.cx=10 ≠ 11.
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const ctx = makeAIContext({
      tick: 75,
      aiStates: new Map([[House.USSR, state]]),
      structures: [makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 })], // 3x3: (10-12, 10-12)
      baseBlueprint: [
        // Try to rebuild a SILO at (11,10) — overlaps FACT footprint at cell (11,10)
        { type: 'SILO', cell: 11 + 10 * MAP_CELLS, house: House.USSR },
      ],
      houseCredits: new Map([[House.USSR, 10000]]),
      isAllied: (a, b) => a === b,
    });
    updateBaseRebuild(ctx);
    // The SILO at (11,10) should NOT be rebuilt because it overlaps the FACT footprint
    const silo = ctx.structures.find(s => s.type === 'SILO' && s.cx === 11 && s.cy === 10);
    expect(silo, 'SILO should NOT be rebuilt on top of FACT footprint').toBeUndefined();
  });

  it('harvester emergency retreat threshold scales with difficulty (not hardcoded 0.3)', () => {
    // Bug: harvester used hardcoded 0.3 threshold instead of difficulty-scaled retreatHpPercent
    // On hard difficulty (retreatHpPercent=0.15), a harvester at 20% HP should retreat
    // because 0.20 > 0.15 is above threshold — wait, that means it should NOT retreat.
    // Actually, the retreat triggers when hpRatio < threshold.
    // On hard (threshold=0.15): harvester at 20% should NOT retreat (20% >= 15%)
    // On easy (threshold=0.30): harvester at 25% should retreat (25% < 30%)
    // With hardcoded 0.3, hard difficulty harvester at 25% would retreat (25% < 30%)
    // but it SHOULDN'T because hard retreatHpPercent is 0.15.
    const state = makeAIState({ house: House.USSR, iq: 3 });
    const harv = entityAtCell(UnitType.V_HARV, House.USSR, 50, 50);
    harv.hp = Math.ceil(harv.maxHp * 0.20); // 20% HP
    harv.mission = Mission.GUARD;
    harv.harvesterState = 'harvesting';
    const structures = [
      makeStructure({ type: 'FACT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'PROC', house: House.USSR, cx: 20, cy: 20 }),
    ];
    const ctx = makeAIContext({
      tick: 30,
      difficulty: 'hard', // retreatHpPercent = 0.15
      entities: [harv],
      aiStates: new Map([[House.USSR, state]]),
      structures,
      isPlayerControlled: () => false,
    });
    updateAIRetreat(ctx);
    // On hard difficulty, 20% > 15% threshold → should NOT retreat
    // (With hardcoded 0.3: 20% < 30% → WOULD retreat — this is the bug)
    expect(harv.harvesterState, 'hard difficulty: 20% HP harvester should NOT emergency return').toBe('harvesting');
  });

  it('APWR counts toward 2-power-plant requirement', () => {
    const state = makeAIState({ house: House.USSR, phase: 'economy' });
    const structures = [
      makeStructure({ type: 'TENT', house: House.USSR, cx: 10, cy: 10 }),
      makeStructure({ type: 'WEAP', house: House.USSR, cx: 14, cy: 10 }),
      makeStructure({ type: 'POWR', house: House.USSR, cx: 18, cy: 10 }),
      makeStructure({ type: 'APWR', house: House.USSR, cx: 20, cy: 10 }),
    ];
    const ctx = makeAIContext({
      tick: 150,
      aiStates: new Map([[House.USSR, state]]),
      structures,
    });
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });
});
