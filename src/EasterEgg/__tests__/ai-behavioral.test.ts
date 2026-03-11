/**
 * AI Subsystem Behavioral Tests — calls exported functions directly with
 * mock AIContext objects. No source-string pattern matching.
 *
 * Priority functions tested:
 *   - createAIHouseState
 *   - updateAIRepair
 *   - updateAISellDamaged
 *   - updateAIIncome
 *   - updateAIProduction
 *   - getAIBuildOrder
 *   - spawnAIUnit / spawnAIStructure
 *   - aiCountStructure / aiPowerProduced / aiPowerConsumed / aiHasPrereq
 *   - aiGetBaseCenter / aiIsFactoryExit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS, DIFFICULTY_MODS,
  createAIHouseState,
  updateAIRepair,
  updateAISellDamaged,
  updateAIIncome,
  updateAIProduction,
  getAIBuildOrder,
  spawnAIUnit,
  spawnAIStructure,
  aiCountStructure,
  aiPowerProduced,
  aiPowerConsumed,
  aiHasPrereq,
  aiGetBaseCenter,
  aiIsFactoryExit,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeStructure(
  type: string, house: House, cx = 50, cy = 50,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeMockAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  const alliances = buildDefaultAlliances();

  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
    difficulty: 'normal' as Difficulty,

    aiStates: new Map(),
    houseCredits: new Map(),
    houseIQs: new Map(),
    houseTechLevels: new Map(),
    houseMaxUnits: new Map(),
    houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),

    baseBlueprint: [],
    baseRebuildQueue: [],
    baseRebuildCooldown: 0,

    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {},
    scenarioWeaponStats: {},

    nextWaveId: 0,

    autocreateEnabled: false,
    teamTypes: [],
    destroyedTeams: new Set(),
    waypoints: new Map(),
    houseEdges: new Map(),

    effects: [],

    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),
    findPassableSpawn: (_cx, _cy, _scx, _scy, _fw, _fh) => ({ cx: _cx, cy: _cy }),

    ...overrides,
  };
}

/** Create an AIHouseState pre-set with given overrides, already inserted into ctx.aiStates */
function addAIHouse(
  ctx: AIContext,
  house: House,
  overrides: Partial<AIHouseState> = {},
): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. createAIHouseState
// ═══════════════════════════════════════════════════════════════════════════

describe('createAIHouseState', () => {
  it('returns valid state with correct defaults for normal difficulty', () => {
    const ctx = makeMockAIContext({ difficulty: 'normal' });
    ctx.houseIQs.set(House.USSR, 3);
    const state = createAIHouseState(ctx, House.USSR);

    expect(state.house).toBe(House.USSR);
    expect(state.phase).toBe('economy');
    expect(state.productionEnabled).toBe(false);
    expect(state.buildQueue).toEqual([]);
    expect(state.attackPool.size).toBe(0);
    expect(state.iq).toBe(3);
    expect(state.incomeMult).toBe(AI_DIFFICULTY_MODS.normal.incomeMult);
    expect(state.buildSpeedMult).toBe(AI_DIFFICULTY_MODS.normal.buildSpeedMult);
    expect(state.aggressionMult).toBe(AI_DIFFICULTY_MODS.normal.aggressionMult);
    expect(state.attackThreshold).toBe(AI_DIFFICULTY_MODS.normal.attackThreshold);
    expect(state.attackCooldownTicks).toBe(AI_DIFFICULTY_MODS.normal.attackCooldown);
  });

  it('applies easy difficulty modifiers correctly', () => {
    const ctx = makeMockAIContext({ difficulty: 'easy' });
    const state = createAIHouseState(ctx, House.USSR);

    expect(state.incomeMult).toBe(0.7);
    expect(state.buildSpeedMult).toBe(1.5);
    expect(state.attackThreshold).toBe(8);
    expect(state.aggressionMult).toBe(0.6);
  });

  it('applies hard difficulty modifiers correctly', () => {
    const ctx = makeMockAIContext({ difficulty: 'hard' });
    const state = createAIHouseState(ctx, House.USSR);

    expect(state.incomeMult).toBe(1.5);
    expect(state.buildSpeedMult).toBe(0.7);
    expect(state.attackThreshold).toBe(4);
    expect(state.aggressionMult).toBe(1.4);
  });

  it('reads IQ from houseIQs map', () => {
    const ctx = makeMockAIContext();
    ctx.houseIQs.set(House.USSR, 5);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.iq).toBe(5);
  });

  it('defaults IQ to 3 when houseIQs has no entry', () => {
    const ctx = makeMockAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.iq).toBe(3);
  });

  it('reads techLevel from houseTechLevels map', () => {
    const ctx = makeMockAIContext();
    ctx.houseTechLevels.set(House.USSR, 7);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.techLevel).toBe(7);
  });

  it('defaults techLevel to 10 when no entry', () => {
    const ctx = makeMockAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.techLevel).toBe(10);
  });

  it('reads maxUnit / maxInfantry / maxBuilding from their maps', () => {
    const ctx = makeMockAIContext();
    ctx.houseMaxUnits.set(House.USSR, 20);
    ctx.houseMaxInfantry.set(House.USSR, 15);
    ctx.houseMaxBuildings.set(House.USSR, 10);
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxUnit).toBe(20);
    expect(state.maxInfantry).toBe(15);
    expect(state.maxBuilding).toBe(10);
  });

  it('defaults maxUnit/maxInfantry/maxBuilding to -1 (unlimited)', () => {
    const ctx = makeMockAIContext();
    const state = createAIHouseState(ctx, House.USSR);
    expect(state.maxUnit).toBe(-1);
    expect(state.maxInfantry).toBe(-1);
    expect(state.maxBuilding).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. updateAIRepair
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIRepair', () => {
  it('only runs on tick % 15 === 0', () => {
    const ctx = makeMockAIContext({ tick: 7 });
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100); // no repair on non-15-tick
  });

  it('repairs damaged structures below 80% HP at tick % 15', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const maxHp = 400;
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp }); // 25%, well below 80%
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBeGreaterThan(100); // repaired
  });

  it('skips houses with IQ < 3', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 2 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100); // no repair, IQ too low
  });

  it('deducts from houseCredits, not a global pool', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    const credits = ctx.houseCredits.get(House.USSR)!;
    expect(credits).toBeLessThan(5000);
  });

  it('skips repair when house credits < 10', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100); // no repair, too poor
  });

  it('does not repair structures at or above 80% HP', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const maxHp = 400;
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: maxHp * 0.8, maxHp });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(maxHp * 0.8); // already at threshold
  });

  it('skips structures being sold (sellProgress !== undefined)', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.USSR, 50, 50, {
      hp: 100, maxHp: 400, sellProgress: 0.5,
    });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100); // not repaired while selling
  });

  it('does not repair dead structures', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 100, maxHp: 400, alive: false });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100);
  });

  it('does not repair structures belonging to other houses', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const s = makeStructure('POWR', House.Spain, 50, 50, { hp: 100, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAIRepair(ctx);
    expect(s.hp).toBe(100); // belongs to player, not USSR
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. updateAISellDamaged
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAISellDamaged', () => {
  it('only runs on tick % 75 === 0', () => {
    const ctx = makeMockAIContext({ tick: 10 });
    const s = makeStructure('BARR', House.USSR, 50, 50, { hp: 10, maxHp: 800 });
    ctx.structures.push(s);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // should not sell, wrong tick
  });

  it('sells structures below CONDITION_RED HP (25%)', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const maxHp = 800;
    const s = makeStructure('BARR', House.USSR, 50, 50, { hp: Math.floor(maxHp * 0.24), maxHp });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(false);
    expect(s.rubble).toBe(true);
  });

  it('skips houses with IQ < 3', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const s = makeStructure('BARR', House.USSR, 50, 50, { hp: 10, maxHp: 800 });
    ctx.structures.push(s);
    addAIHouse(ctx, House.USSR, { iq: 2 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // IQ too low
  });

  it('never sells FACT (Construction Yard)', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const s = makeStructure('FACT', House.USSR, 50, 50, { hp: 10, maxHp: 1000 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // FACT is never sold
  });

  it('never sells last power plant', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    // Only one POWR for this house
    const s = makeStructure('POWR', House.USSR, 50, 50, { hp: 10, maxHp: 400 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // last power plant, won't sell
  });

  it('sells a damaged power plant when another exists', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const s1 = makeStructure('POWR', House.USSR, 50, 50, { hp: 10, maxHp: 400 });
    const s2 = makeStructure('POWR', House.USSR, 52, 50); // healthy second power plant
    ctx.structures.push(s1, s2);
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s1.alive).toBe(false); // sold because there's another
  });

  it('grants refund to houseCredits (health-scaled)', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const maxHp = 800;
    const hp = Math.floor(maxHp * 0.20); // 20% HP, below 25% CONDITION_RED
    const s = makeStructure('BARR', House.USSR, 50, 50, { hp, maxHp });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 100);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    // BARR cost = 300 (from PRODUCTION_ITEMS)
    const barrItem = PRODUCTION_ITEMS.find(p => p.type === 'BARR' && p.isStructure);
    const expectedRefund = Math.floor((barrItem?.cost ?? 300) * 0.5 * (hp / maxHp));

    updateAISellDamaged(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(100 + expectedRefund);
  });

  it('calls clearStructureFootprint on sell', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const s = makeStructure('BARR', House.USSR, 50, 50, { hp: 10, maxHp: 800 });
    ctx.structures.push(s);
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(ctx.clearStructureFootprint).toHaveBeenCalledWith(s);
  });

  it('skips structures being sold (sellProgress !== undefined)', () => {
    const ctx = makeMockAIContext({ tick: 75 });
    const s = makeStructure('BARR', House.USSR, 50, 50, {
      hp: 10, maxHp: 800, sellProgress: 0.5,
    });
    ctx.structures.push(s);
    addAIHouse(ctx, House.USSR, { iq: 3 });

    updateAISellDamaged(ctx);
    expect(s.alive).toBe(true); // already being sold
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. updateAIIncome
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIIncome', () => {
  it('only runs on tick % 450 === 0', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.0 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(0); // wrong tick
  });

  it('grants income per PROC refinery on tick % 450', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 500);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.0 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(600); // +100
  });

  it('grants income per PROC -- multiple refineries accumulate', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 50, 50),
      makeStructure('PROC', House.USSR, 53, 50),
    );
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.0 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(200); // 2 PROCs * 100
  });

  it('applies incomeMult from AIHouseState', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.5 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(150); // 100 * 1.5
  });

  it('income goes to the correct house credits', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 50, 50),
      makeStructure('PROC', House.Ukraine, 55, 50),
    );
    ctx.houseCredits.set(House.USSR, 0);
    ctx.houseCredits.set(House.Ukraine, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.0 });
    addAIHouse(ctx, House.Ukraine, { iq: 3, incomeMult: 1.0 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(100);
    expect(ctx.houseCredits.get(House.Ukraine)).toBe(100);
  });

  it('does not grant income to player-allied refineries', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(makeStructure('PROC', House.Spain, 50, 50));
    ctx.houseCredits.set(House.Spain, 0);

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.Spain)).toBe(0); // player's PROC, no AI income
  });

  it('does not grant income for dead refineries', () => {
    const ctx = makeMockAIContext({ tick: 450 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50, { alive: false }));
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, incomeMult: 1.0 });

    updateAIIncome(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. updateAIProduction
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIProduction', () => {
  it('only runs on correct tick interval for difficulty', () => {
    // Normal difficulty productionInterval = 60
    const ctx = makeMockAIContext({ tick: 30, difficulty: 'normal' });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: true });

    const entitiesBefore = ctx.entities.length;
    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(entitiesBefore); // wrong tick, no production
  });

  it('produces units when house has credits and factory at correct tick', () => {
    const ctx = makeMockAIContext({ tick: 60, difficulty: 'normal' });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: true });

    updateAIProduction(ctx);
    // Should have produced at least one unit
    expect(ctx.entities.length).toBeGreaterThan(0);
    // Credits should have decreased
    expect(ctx.houseCredits.get(House.USSR)!).toBeLessThan(5000);
  });

  it('does not produce when house has no credits', () => {
    const ctx = makeMockAIContext({ tick: 60, difficulty: 'normal' });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 0);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: true });

    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('does not produce when productionEnabled is false', () => {
    const ctx = makeMockAIContext({ tick: 60, difficulty: 'normal' });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: false });

    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('respects ant cap for SCA scenarios', () => {
    const ctx = makeMockAIContext({
      tick: 60,
      difficulty: 'normal',
      scenarioId: 'SCA01EA',
    });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 50000);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: true });

    // Fill up to maxAnts with existing ants (ANT1 type triggers isAnt getter)
    const maxAnts = DIFFICULTY_MODS.normal.maxAnts;
    for (let i = 0; i < maxAnts; i++) {
      const ant = new Entity(UnitType.ANT1, House.USSR, 100, 100);
      ctx.entities.push(ant);
      ctx.entityById.set(ant.id, ant);
    }

    const entBefore = ctx.entities.length;
    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(entBefore); // ant cap reached
  });

  it('uses hard difficulty productionInterval of 42', () => {
    const ctx = makeMockAIContext({ tick: 42, difficulty: 'hard' });
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, { iq: 3, productionEnabled: true });

    updateAIProduction(ctx);
    expect(ctx.entities.length).toBeGreaterThan(0); // tick 42 divides 42
  });

  it('does not produce for player-allied houses', () => {
    const ctx = makeMockAIContext({ tick: 60, difficulty: 'normal' });
    ctx.structures.push(makeStructure('TENT', House.Spain, 50, 50));
    ctx.houseCredits.set(House.Spain, 5000);
    // Spain is player-allied, should be skipped

    updateAIProduction(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. getAIBuildOrder
// ═══════════════════════════════════════════════════════════════════════════

describe('getAIBuildOrder', () => {
  it('returns an array of structure types', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBeGreaterThan(0);
    for (const type of queue) {
      expect(typeof type).toBe('string');
    }
  });

  it('prioritizes POWR when power deficit exists', () => {
    const ctx = makeMockAIContext();
    // Add a BARR (consumes 20) but no power plant
    ctx.structures.push(makeStructure('BARR', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue[0]).toBe('POWR');
  });

  it('includes TENT when no infantry production exists', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('TENT');
  });

  it('includes PROC when fewer than 2 refineries', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('PROC');
  });

  it('includes WEAP when none exists', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('WEAP');
  });

  it('includes DOME when credits > 1000 and none exists', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 2000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('DOME');
  });

  it('does not include DOME when credits <= 1000', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 500);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).not.toContain('DOME');
  });

  it('picks TSLA defense for soviet faction, GUN for allied', () => {
    // Soviet house (USSR)
    const ctxSoviet = makeMockAIContext();
    ctxSoviet.houseCredits.set(House.USSR, 5000);
    const sState = addAIHouse(ctxSoviet, House.USSR, { iq: 3 });
    const sovQueue = getAIBuildOrder(ctxSoviet, House.USSR, sState);
    expect(sovQueue).toContain('TSLA');

    // Allied house (Spain)
    const ctxAllied = makeMockAIContext();
    ctxAllied.houseCredits.set(House.England, 5000);
    const aState = addAIHouse(ctxAllied, House.England, { iq: 3 });
    const alliedQueue = getAIBuildOrder(ctxAllied, House.England, aState);
    expect(alliedQueue).toContain('GUN');
  });

  it('includes tech center (STEK for soviet) when DOME exists', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('DOME', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });

    const queue = getAIBuildOrder(ctx, House.USSR, state);
    expect(queue).toContain('STEK');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. spawnAIUnit
// ═══════════════════════════════════════════════════════════════════════════

describe('spawnAIUnit', () => {
  it('creates entity with correct house and type', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('WEAP', House.USSR, 50, 50));

    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(unit).not.toBeNull();
    expect(unit!.house).toBe(House.USSR);
    expect(unit!.type).toBe(UnitType.V_2TNK);
  });

  it('adds unit to entities and entityById arrays', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('WEAP', House.USSR, 50, 50));

    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(ctx.entities).toContain(unit);
    expect(ctx.entityById.get(unit!.id)).toBe(unit);
  });

  it('returns null when no factory exists', () => {
    const ctx = makeMockAIContext();
    // No WEAP structure
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');
    expect(unit).toBeNull();
  });

  it('sets mission and guardOrigin when provided', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));

    const origin = { x: 500, y: 500 };
    const unit = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT', Mission.AREA_GUARD, origin);
    expect(unit!.mission).toBe(Mission.AREA_GUARD);
    expect(unit!.guardOrigin).toEqual(origin);
  });

  it('finds BARR when factoryType is TENT (infantry fallback)', () => {
    const ctx = makeMockAIContext();
    // Only BARR, no TENT
    ctx.structures.push(makeStructure('BARR', House.USSR, 50, 50));

    const unit = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT');
    expect(unit).not.toBeNull();
  });

  it('spawns infantry at different position from vehicle factory', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 50));

    const inf = spawnAIUnit(ctx, House.USSR, UnitType.I_E1, 'TENT');
    const veh = spawnAIUnit(ctx, House.USSR, UnitType.V_2TNK, 'WEAP');

    // Infantry and vehicles spawn at different positions
    expect(inf).not.toBeNull();
    expect(veh).not.toBeNull();
    // They shouldn't be at the exact same position (different factory positions)
    const samePos = inf!.pos.x === veh!.pos.x && inf!.pos.y === veh!.pos.y;
    expect(samePos).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. spawnAIStructure
// ═══════════════════════════════════════════════════════════════════════════

describe('spawnAIStructure', () => {
  it('creates structure with correct type, house, and position', () => {
    const ctx = makeMockAIContext();
    spawnAIStructure(ctx, 'POWR', House.USSR, 50, 50);

    expect(ctx.structures.length).toBe(1);
    const s = ctx.structures[0];
    expect(s.type).toBe('POWR');
    expect(s.house).toBe(House.USSR);
    expect(s.cx).toBe(50);
    expect(s.cy).toBe(50);
    expect(s.alive).toBe(true);
    expect(s.hp).toBe(s.maxHp);
  });

  it('sets maxHp from STRUCTURE_MAX_HP lookup', () => {
    const ctx = makeMockAIContext();
    spawnAIStructure(ctx, 'POWR', House.USSR, 50, 50);

    expect(ctx.structures[0].maxHp).toBe(STRUCTURE_MAX_HP['POWR']); // 400
  });

  it('marks terrain as WALL for footprint cells', () => {
    const ctx = makeMockAIContext();
    // POWR is 2x2
    spawnAIStructure(ctx, 'POWR', House.USSR, 50, 50);

    const [fw, fh] = STRUCTURE_SIZE['POWR']!;
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        expect(ctx.map.getTerrain(50 + dx, 50 + dy)).toBe(Terrain.WALL);
      }
    }
  });

  it('sets rubble to false on new structure', () => {
    const ctx = makeMockAIContext();
    spawnAIStructure(ctx, 'BARR', House.USSR, 50, 50);
    expect(ctx.structures[0].rubble).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Pure helper functions (aiCountStructure, aiPower*, aiHasPrereq, etc.)
// ═══════════════════════════════════════════════════════════════════════════

describe('aiCountStructure', () => {
  it('counts alive structures of a given type for a house', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
      makeStructure('POWR', House.Spain, 54, 50), // different house
      makeStructure('POWR', House.USSR, 56, 50, { alive: false }), // dead
    );

    expect(aiCountStructure(ctx, House.USSR, 'POWR')).toBe(2);
  });

  it('returns 0 when no matching structures', () => {
    const ctx = makeMockAIContext();
    expect(aiCountStructure(ctx, House.USSR, 'POWR')).toBe(0);
  });
});

describe('aiPowerProduced', () => {
  it('calculates power from POWR (100) and APWR (200)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('APWR', House.USSR, 52, 50),
    );

    expect(aiPowerProduced(ctx, House.USSR)).toBe(300);
  });

  it('ignores dead structures', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50, { alive: false }),
    );

    expect(aiPowerProduced(ctx, House.USSR)).toBe(0);
  });

  it('ignores structures from other houses', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('POWR', House.Spain, 50, 50));

    expect(aiPowerProduced(ctx, House.USSR)).toBe(0);
  });
});

describe('aiPowerConsumed', () => {
  it('calculates power consumption for various structure types', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 50, 50),  // 20
      makeStructure('WEAP', House.USSR, 52, 50),  // 30
      makeStructure('TSLA', House.USSR, 55, 50),  // 150
    );

    expect(aiPowerConsumed(ctx, House.USSR)).toBe(200);
  });

  it('returns 0 for POWR and APWR (they produce, not consume)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('APWR', House.USSR, 52, 50),
    );

    expect(aiPowerConsumed(ctx, House.USSR)).toBe(0);
  });
});

describe('aiHasPrereq', () => {
  it('returns true when structure of given type exists', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('DOME', House.USSR, 50, 50));

    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(true);
  });

  it('returns false when structure does not exist', () => {
    const ctx = makeMockAIContext();
    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(false);
  });

  it('TENT prereq is satisfied by either TENT or BARR', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('BARR', House.USSR, 50, 50));
    expect(aiHasPrereq(ctx, House.USSR, 'TENT')).toBe(true);

    const ctx2 = makeMockAIContext();
    ctx2.structures.push(makeStructure('TENT', House.USSR, 50, 50));
    expect(aiHasPrereq(ctx2, House.USSR, 'TENT')).toBe(true);
  });

  it('does not match dead structures', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('DOME', House.USSR, 50, 50, { alive: false }));

    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(false);
  });

  it('does not match structures from other houses', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('DOME', House.Spain, 50, 50));

    expect(aiHasPrereq(ctx, House.USSR, 'DOME')).toBe(false);
  });
});

describe('aiGetBaseCenter', () => {
  it('returns centroid of alive structures', () => {
    const ctx = makeMockAIContext();
    // Two 1x1 structures at (50,50) and (52,50)
    ctx.structures.push(
      makeStructure('GUN', House.USSR, 50, 50),
      makeStructure('GUN', House.USSR, 52, 50),
    );

    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();
    // GUN is 1x1, centers are 50.5 and 52.5, avg = 51.5 -> floor = 51
    expect(center!.cx).toBe(51);
    expect(center!.cy).toBe(50);
  });

  it('returns null when no alive structures', () => {
    const ctx = makeMockAIContext();
    expect(aiGetBaseCenter(ctx, House.USSR)).toBeNull();
  });

  it('ignores dead structures', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('GUN', House.USSR, 50, 50, { alive: false }),
      makeStructure('GUN', House.USSR, 54, 50),
    );

    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();
    // Only the alive one at 54,50 should be counted
    expect(center!.cx).toBe(54);
  });
});

describe('aiIsFactoryExit', () => {
  it('returns true for cell below a factory (WEAP exit zone)', () => {
    const ctx = makeMockAIContext();
    // WEAP is 3x2 at (50,50), exit row is cy=52 (50+2), cells 50-52
    ctx.structures.push(makeStructure('WEAP', House.USSR, 50, 50));

    expect(aiIsFactoryExit(ctx, 50, 52, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 51, 52, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 52, 52, House.USSR)).toBe(true);
  });

  it('returns false for cells not in the exit row', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('WEAP', House.USSR, 50, 50));

    expect(aiIsFactoryExit(ctx, 50, 50, House.USSR)).toBe(false); // in the structure
    expect(aiIsFactoryExit(ctx, 50, 53, House.USSR)).toBe(false); // too far below
  });

  it('returns false for other house factories', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('WEAP', House.Spain, 50, 50));

    expect(aiIsFactoryExit(ctx, 50, 52, House.USSR)).toBe(false);
  });

  it('returns true for TENT exit zone', () => {
    const ctx = makeMockAIContext();
    // TENT is 2x2 at (50,50), exit at cy=52
    ctx.structures.push(makeStructure('TENT', House.USSR, 50, 50));

    expect(aiIsFactoryExit(ctx, 50, 52, House.USSR)).toBe(true);
    expect(aiIsFactoryExit(ctx, 51, 52, House.USSR)).toBe(true);
  });
});
