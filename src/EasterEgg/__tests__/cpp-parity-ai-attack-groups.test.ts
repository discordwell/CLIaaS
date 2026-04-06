/**
 * C++ Behavioral Parity: AI Attack Groups — Pool Accumulation, Target Selection, Attack Launch
 *
 * Tests verify that updateAIAttackGroups, aiPickAttackTarget, and launchAIAttack
 * match C++ RA source code behavior for AI coordinated attacks.
 *
 * Source references:
 *   - HOUSE.CPP AI_Attack() — attack pool accumulation, staging area proximity check
 *   - HOUSE.CPP AI_Attack() — effective threshold/cooldown with aggressionMult
 *   - HOUSE.CPP Pick_Attack_Target() — preferred target, priority list, nearest fallback
 *   - HOUSE.CPP Launch_Attack() — HUNT mission assignment, wave coordination
 *
 * Observable outcomes: pool accumulation gating, target priority resolution,
 * mission assignment, wave ID coordination, cooldown enforcement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem, type WorldPos,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateAIAttackGroups,
  aiPickAttackTarget,
  launchAIAttack,
  aiStagingArea,
  aiGetBaseCenter,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeStructure(
  type: string, house: House, cx = 50, cy = 50,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: opts.hp ?? maxHp, maxHp,
    alive: opts.alive ?? true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeMockAIContext(overrides: Partial<AIContext> = {}): AIContext {
  const map = new GameMap();
  map.setBounds(40, 40, 80, 80);
  const alliances = buildDefaultAlliances();
  return {
    entities: [], entityById: new Map(), structures: [],
    map, tick: 1, playerHouse: House.Spain,
    scenarioId: 'SCG01EA', difficulty: 'normal' as Difficulty,
    aiStates: new Map(), houseCredits: new Map(),
    houseIQs: new Map(), houseTechLevels: new Map(),
    houseMaxUnits: new Map(), houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),
    baseBlueprint: [], baseRebuildQueue: [], baseRebuildCooldown: 0,
    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {}, scenarioWeaponStats: {},
    nextWaveId: 1,
    autocreateEnabled: false, teamTypes: [],
    destroyedTeams: new Set(), waypoints: new Map(),
    houseEdges: new Map(), effects: [],
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Place an entity at a world position and register it in context */
function addEntity(ctx: AIContext, type: UnitType, house: House, x: number, y: number, opts: Partial<Entity> = {}): Entity {
  const e = new Entity(type, house, x, y);
  Object.assign(e, opts);
  ctx.entities.push(e);
  ctx.entityById.set(e.id, e);
  return e;
}

/** Place entity at a cell position (center of cell) */
function addEntityAtCell(ctx: AIContext, type: UnitType, house: House, cx: number, cy: number, opts: Partial<Entity> = {}): Entity {
  return addEntity(ctx, type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2, opts);
}

/** Set up a basic AI base with structures so aiStagingArea works.
 *  Places own structures at (50,50) and enemy structures at (70,70). */
function setupBaseWithStaging(ctx: AIContext, house: House): void {
  ctx.structures.push(
    makeStructure('FACT', house, 50, 50),
    makeStructure('WEAP', house, 53, 50),
    makeStructure('POWR', house, 50, 53),
  );
  // Enemy structures so staging area points toward them
  ctx.structures.push(
    makeStructure('FACT', House.Spain, 70, 70),
  );
}

// =============================================================================
//  1. updateAIAttackGroups — Tick Gating
// =============================================================================

describe('updateAIAttackGroups — tick gating (only (tick-1) % 120 === 0)', () => {

  it('runs on tick 1 (first fire)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    // Place a guard unit near staging area
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });

  it('runs on tick 121', () => {
    const ctx = makeMockAIContext({ tick: 121 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });

  it('does nothing on tick 0 (before first tick)', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does nothing on tick 119', () => {
    const ctx = makeMockAIContext({ tick: 119 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('runs on tick 241 (second multiple)', () => {
    const ctx = makeMockAIContext({ tick: 241 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });
});

// =============================================================================
//  2. updateAIAttackGroups — Production & IQ & Phase Gates
// =============================================================================

describe('updateAIAttackGroups — gating: productionEnabled, IQ, phase', () => {

  it('skips house when productionEnabled is false', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: false, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('skips house when IQ < 2 (IQ=0)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 0, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('skips house when IQ < 2 (IQ=1)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 1, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('runs for IQ=2 (boundary)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 2, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });

  it('skips house in economy phase', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'economy',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('runs in buildup phase', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });

  it('runs in attack phase', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'attack',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(1);
  });
});

// =============================================================================
//  3. updateAIAttackGroups — No Staging Area
// =============================================================================

describe('updateAIAttackGroups — no staging area skips house', () => {

  it('skips pool accumulation when house has no structures (no base center)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    // No structures for USSR -> aiStagingArea returns null
    addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });
});

// =============================================================================
//  4. updateAIAttackGroups — Pool Accumulation
// =============================================================================

describe('updateAIAttackGroups — pool accumulation', () => {

  it('adds idle GUARD units near staging area to pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    const e = addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(e.id)).toBe(true);
  });

  it('adds idle AREA_GUARD units near staging area to pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    const e = addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.AREA_GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(e.id)).toBe(true);
  });

  it('excludes harvesters (V_HARV) from pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_HARV, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does not add units with HUNT mission (not idle)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.HUNT });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does not add units with MOVE mission', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.MOVE });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does not re-add units already in pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    const e = addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    // Pre-add to pool
    state.attackPool.add(e.id);
    expect(state.attackPool.size).toBe(1);

    updateAIAttackGroups(ctx);
    // Still exactly 1 — not duplicated
    expect(state.attackPool.size).toBe(1);
  });

  it('does not add units too far from staging area (dist >= 8 cells)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    // Place unit 10 cells away from staging
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x + 10 * CELL_SIZE, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does not add dead units to pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD, alive: false });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });

  it('does not add units from other houses', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;
    // Spain unit at staging area — wrong house
    addEntity(ctx, UnitType.V_2TNK, House.Spain, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    expect(state.attackPool.size).toBe(0);
  });
});

// =============================================================================
//  5. updateAIAttackGroups — Dead Entity Pruning
// =============================================================================

describe('updateAIAttackGroups — dead entity pruning from pool', () => {

  it('removes dead entities from attack pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    const e = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e.id);
    e.alive = false;

    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(e.id)).toBe(false);
  });

  it('removes IDs for entities no longer in entityById', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
    });
    setupBaseWithStaging(ctx, House.USSR);
    // Add a phantom ID to the pool (entity doesn't exist)
    state.attackPool.add(9999);

    updateAIAttackGroups(ctx);
    expect(state.attackPool.has(9999)).toBe(false);
  });
});

// =============================================================================
//  6. updateAIAttackGroups — Threshold & Cooldown Calculations
// =============================================================================

describe('updateAIAttackGroups — effective threshold and cooldown', () => {

  it('effectiveThreshold = max(2, floor(attackThreshold / aggressionMult))', () => {
    // With normal difficulty: threshold=6, aggressionMult=1.0 -> effective=6
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 6, aggressionMult: 1.0,
      attackCooldownTicks: 600, lastAttackTick: -9999,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add exactly 5 units (below threshold=6)
    for (let i = 0; i < 5; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // Pool has 5, threshold is 6 — no attack launched, pool stays
    expect(state.attackPool.size).toBe(5);
  });

  it('hard difficulty aggressionMult=1.4 lowers effective threshold', () => {
    // threshold=4, aggressionMult=1.4 -> floor(4/1.4)=2, max(2,2)=2
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 4, aggressionMult: 1.4,
      attackCooldownTicks: 400, lastAttackTick: -9999,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add 2 units (exactly at effective threshold)
    for (let i = 0; i < 2; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // Pool >= 2 and cooldown elapsed -> attack launched -> pool cleared
    expect(state.attackPool.size).toBe(0);
    expect(state.lastAttackTick).toBe(1);
  });

  it('effective threshold never goes below 2 (min clamp)', () => {
    // threshold=2, aggressionMult=10.0 -> floor(2/10)=0, max(2,0)=2
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 2, aggressionMult: 10.0,
      attackCooldownTicks: 100, lastAttackTick: -9999,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add 1 unit — below min threshold of 2
    addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });

    updateAIAttackGroups(ctx);
    // Pool=1 < 2, should NOT attack
    expect(state.attackPool.size).toBe(1);
  });

  it('attack launched when pool >= effectiveThreshold AND cooldown elapsed', () => {
    const ctx = makeMockAIContext({ tick: 1201 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 6, aggressionMult: 1.0,
      attackCooldownTicks: 600, lastAttackTick: 0,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add 6 units to reach threshold
    for (let i = 0; i < 6; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // tick(1201) - lastAttack(0) = 1201 > 600 cooldown, pool(6) >= threshold(6)
    // Attack launched -> pool cleared
    expect(state.attackPool.size).toBe(0);
    expect(state.lastAttackTick).toBe(1201);
  });

  it('attack NOT launched when pool < threshold', () => {
    const ctx = makeMockAIContext({ tick: 1201 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 6, aggressionMult: 1.0,
      attackCooldownTicks: 600, lastAttackTick: 0,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add only 3 units (below threshold)
    for (let i = 0; i < 3; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // Pool(3) < threshold(6) -> no attack
    expect(state.attackPool.size).toBe(3);
  });

  it('attack NOT launched when cooldown not elapsed', () => {
    const ctx = makeMockAIContext({ tick: 121 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 6, aggressionMult: 1.0,
      attackCooldownTicks: 600, lastAttackTick: 0,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Add 6 units (meets threshold)
    for (let i = 0; i < 6; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // tick(121) - lastAttack(0) = 121 <= 600 cooldown -> no attack even though pool is full
    expect(state.attackPool.size).toBe(6);
  });

  it('effective cooldown is floor(attackCooldownTicks / aggressionMult)', () => {
    // cooldown=600, aggressionMult=1.4 -> floor(600/1.4) = 428
    // tick=481, lastAttack=0 -> elapsed=481 > 428 -> attack should fire
    const ctx = makeMockAIContext({ tick: 481 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 4, aggressionMult: 1.4,
      attackCooldownTicks: 600, lastAttackTick: 0,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // effectiveThreshold = max(2, floor(4/1.4)) = max(2, 2) = 2
    // Add 3 units
    for (let i = 0; i < 3; i++) {
      addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x, staging.y, { mission: Mission.GUARD });
    }

    updateAIAttackGroups(ctx);
    // 481 > floor(600/1.4)=428 -> cooldown elapsed, pool(3)>=threshold(2)
    expect(state.attackPool.size).toBe(0);
    expect(state.lastAttackTick).toBe(481);
  });
});

// =============================================================================
//  7. aiPickAttackTarget — Preferred Target
// =============================================================================

describe('aiPickAttackTarget — preferred target', () => {

  it('targets preferred structure type when set and enemy has it', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3, preferredTarget: 2 }); // 2 = WEAP
    ctx.structures.push(
      makeStructure('FACT', House.Spain, 60, 60),
      makeStructure('WEAP', House.Spain, 65, 65),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // WEAP is 3x2, center at (65 + 1.5) * 24 = 1596, (65 + 1) * 24 = 1584
    const [w, h] = STRUCTURE_SIZE['WEAP']!;
    const expectedX = (65 + w / 2) * CELL_SIZE;
    const expectedY = (65 + h / 2) * CELL_SIZE;
    expect(target!.x).toBe(expectedX);
    expect(target!.y).toBe(expectedY);
  });

  it('falls through to priority list when preferred target type not found among enemies', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3, preferredTarget: 3 }); // 3 = PDOX
    // No PDOX among enemies, but FACT exists
    ctx.structures.push(
      makeStructure('FACT', House.Spain, 60, 60),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Should target FACT (priority list fallback)
    const [w, h] = STRUCTURE_SIZE['FACT']!;
    expect(target!.x).toBe((60 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((60 + h / 2) * CELL_SIZE);
  });

  it('ignores allied structures for preferred target', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3, preferredTarget: 2 }); // 2 = WEAP
    // Greece is allied with Spain by default, but USSR is not allied with Spain
    // Place a WEAP for USSR's own house (allied) and one for Spain (enemy)
    ctx.structures.push(
      makeStructure('WEAP', House.USSR, 50, 50), // allied (own)
      makeStructure('FACT', House.Spain, 60, 60), // enemy
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    // Should skip own WEAP and fall through to FACT via priority list
    const [w, h] = STRUCTURE_SIZE['FACT']!;
    expect(target!.x).toBe((60 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((60 + h / 2) * CELL_SIZE);
  });
});

// =============================================================================
//  8. aiPickAttackTarget — Priority List
// =============================================================================

describe('aiPickAttackTarget — priority list (FACT, WEAP, PROC)', () => {

  it('prioritizes FACT over WEAP and PROC', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.Spain, 60, 60),
      makeStructure('WEAP', House.Spain, 65, 65),
      makeStructure('FACT', House.Spain, 70, 70),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    const [w, h] = STRUCTURE_SIZE['FACT']!;
    expect(target!.x).toBe((70 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((70 + h / 2) * CELL_SIZE);
  });

  it('prioritizes WEAP when no FACT exists', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.Spain, 60, 60),
      makeStructure('WEAP', House.Spain, 65, 65),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    const [w, h] = STRUCTURE_SIZE['WEAP']!;
    expect(target!.x).toBe((65 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((65 + h / 2) * CELL_SIZE);
  });

  it('prioritizes PROC when no FACT or WEAP', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('POWR', House.Spain, 60, 60),
      makeStructure('PROC', House.Spain, 65, 65),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    const [w, h] = STRUCTURE_SIZE['PROC']!;
    expect(target!.x).toBe((65 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((65 + h / 2) * CELL_SIZE);
  });

  it('ignores dead structures in priority list', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('FACT', House.Spain, 60, 60, { alive: false }),
      makeStructure('WEAP', House.Spain, 65, 65),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    const [w, h] = STRUCTURE_SIZE['WEAP']!;
    expect(target!.x).toBe((65 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((65 + h / 2) * CELL_SIZE);
  });

  it('ignores allied structures in priority list', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // FACT belongs to USSR (own house), so it's allied
    ctx.structures.push(
      makeStructure('FACT', House.USSR, 60, 60),
      makeStructure('PROC', House.Spain, 65, 65),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    const [w, h] = STRUCTURE_SIZE['PROC']!;
    expect(target!.x).toBe((65 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((65 + h / 2) * CELL_SIZE);
  });
});

// =============================================================================
//  9. aiPickAttackTarget — Nearest Fallback
// =============================================================================

describe('aiPickAttackTarget — nearest fallback (structure then entity)', () => {

  it('falls back to nearest enemy structure when no priority targets', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Own base center structures
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
    );
    // Enemy non-priority structures at varying distances
    ctx.structures.push(
      makeStructure('TSLA', House.Spain, 70, 70), // farther
      makeStructure('GUN', House.Spain, 55, 55),   // closer
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // GUN at (55,55) is closer to base center (50,50) than TSLA at (70,70)
    const [w, h] = STRUCTURE_SIZE['GUN']!;
    expect(target!.x).toBe((55 + w / 2) * CELL_SIZE);
    expect(target!.y).toBe((55 + h / 2) * CELL_SIZE);
  });

  it('falls back to nearest enemy entity when no enemy structures', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Own structures (for base center calculation)
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
    );
    // No enemy structures, but enemy entities exist
    const farUnit = addEntity(ctx, UnitType.V_2TNK, House.Spain, 70 * CELL_SIZE, 70 * CELL_SIZE);
    const nearUnit = addEntity(ctx, UnitType.I_E1, House.Spain, 55 * CELL_SIZE, 55 * CELL_SIZE);

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    expect(target!.x).toBe(nearUnit.pos.x);
    expect(target!.y).toBe(nearUnit.pos.y);
  });

  it('returns null when no enemies at all', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Own structures only
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    expect(target).toBeNull();
  });

  it('returns null when house has no base center (no structures)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // No structures for USSR, no priorities
    ctx.structures.push(
      makeStructure('POWR', House.Spain, 60, 60),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    // No base center -> returns null after priority list miss
    expect(target).toBeNull();
  });

  it('returns world coordinates centered on structure', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // FACT is 3x3 at (60,60)
    ctx.structures.push(
      makeStructure('FACT', House.Spain, 60, 60),
    );

    const target = aiPickAttackTarget(ctx, House.USSR);
    // Center should be (60 + 3/2) * 24 = 61.5 * 24 = 1476
    // (60 + 3/2) * 24 = 1476
    expect(target!.x).toBe((60 + 1.5) * CELL_SIZE);
    expect(target!.y).toBe((60 + 1.5) * CELL_SIZE);
  });
});

// =============================================================================
//  10. launchAIAttack — Mission Assignment
// =============================================================================

describe('launchAIAttack — mission and target assignment', () => {

  it('sets all pool units to HUNT mission', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    // Enemy structure for target
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const e2 = addEntity(ctx, UnitType.V_1TNK, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.AREA_GUARD });
    state.attackPool.add(e1.id);
    state.attackPool.add(e2.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.mission).toBe(Mission.HUNT);
    expect(e2.mission).toBe(Mission.HUNT);
  });

  it('sets moveTarget to attack target for all pool units', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);

    launchAIAttack(ctx, House.USSR, state);

    const [w, h] = STRUCTURE_SIZE['FACT']!;
    const expectedTarget = {
      x: (60 + w / 2) * CELL_SIZE,
      y: (60 + h / 2) * CELL_SIZE,
    };
    expect(e1.moveTarget).toEqual(expectedTarget);
  });

  it('assigns waveId from nextWaveId (incremented)', () => {
    const ctx = makeMockAIContext({ tick: 100, nextWaveId: 5 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.waveId).toBe(5);
    expect(ctx.nextWaveId).toBe(6);
  });

  it('sets waveRallyTick to tick + 30', () => {
    const ctx = makeMockAIContext({ tick: 200 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.waveRallyTick).toBe(230);
  });

  it('updates lastAttackTick to current tick', () => {
    const ctx = makeMockAIContext({ tick: 300 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, lastAttackTick: 0 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(state.lastAttackTick).toBe(300);
  });

  it('clears attackPool after launch', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const e2 = addEntity(ctx, UnitType.V_1TNK, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);
    state.attackPool.add(e2.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(state.attackPool.size).toBe(0);
  });

  it('skips dead entities in pool during launch', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const alive = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const dead = addEntity(ctx, UnitType.V_1TNK, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    dead.alive = false;
    state.attackPool.add(alive.id);
    state.attackPool.add(dead.id);

    launchAIAttack(ctx, House.USSR, state);

    // Alive unit gets HUNT
    expect(alive.mission).toBe(Mission.HUNT);
    // Dead unit's mission stays unchanged
    expect(dead.mission).toBe(Mission.GUARD);
    // Pool still cleared
    expect(state.attackPool.size).toBe(0);
  });

  it('skips entities missing from entityById', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);
    state.attackPool.add(9999); // phantom ID

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.mission).toBe(Mission.HUNT);
    // No crash from missing entity
    expect(state.attackPool.size).toBe(0);
  });

  it('does nothing when no valid attack target', () => {
    const ctx = makeMockAIContext({ tick: 100 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, lastAttackTick: 0 });
    // No enemy structures or entities — target will be null

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);

    launchAIAttack(ctx, House.USSR, state);

    // No target -> nothing happens
    expect(e1.mission).toBe(Mission.GUARD);
    expect(state.lastAttackTick).toBe(0);
    expect(state.attackPool.size).toBe(1);
  });

  it('all pool units share the same waveId', () => {
    const ctx = makeMockAIContext({ tick: 100, nextWaveId: 10 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const e2 = addEntity(ctx, UnitType.V_1TNK, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const e3 = addEntity(ctx, UnitType.I_E1, House.USSR, 52 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);
    state.attackPool.add(e2.id);
    state.attackPool.add(e3.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.waveId).toBe(10);
    expect(e2.waveId).toBe(10);
    expect(e3.waveId).toBe(10);
    expect(ctx.nextWaveId).toBe(11);
  });

  it('all pool units share the same waveRallyTick', () => {
    const ctx = makeMockAIContext({ tick: 500 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 60, 60));

    const e1 = addEntity(ctx, UnitType.V_2TNK, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    const e2 = addEntity(ctx, UnitType.V_1TNK, House.USSR, 51 * CELL_SIZE, 50 * CELL_SIZE, { mission: Mission.GUARD });
    state.attackPool.add(e1.id);
    state.attackPool.add(e2.id);

    launchAIAttack(ctx, House.USSR, state);

    expect(e1.waveRallyTick).toBe(530);
    expect(e2.waveRallyTick).toBe(530);
  });
});

// =============================================================================
//  11. Integration — updateAIAttackGroups triggers launchAIAttack
// =============================================================================

describe('Integration — updateAIAttackGroups triggers full attack cycle', () => {

  it('accumulates pool then launches attack when threshold+cooldown met', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, productionEnabled: true, phase: 'buildup',
      attackThreshold: 3, aggressionMult: 1.0,
      attackCooldownTicks: 100, lastAttackTick: -9999,
    });
    setupBaseWithStaging(ctx, House.USSR);
    const staging = aiStagingArea(ctx, House.USSR)!;

    // Place 3 guard units near staging
    const units: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      units.push(addEntity(ctx, UnitType.V_2TNK, House.USSR, staging.x + i, staging.y, { mission: Mission.GUARD }));
    }

    updateAIAttackGroups(ctx);

    // All units should have been pooled and attack launched
    for (const u of units) {
      expect(u.mission).toBe(Mission.HUNT);
    }
    expect(state.attackPool.size).toBe(0);
    expect(state.lastAttackTick).toBe(1);
  });
});
