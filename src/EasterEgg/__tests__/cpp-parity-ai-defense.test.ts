/**
 * C++ Behavioral Parity: AI Defense System — updateAIDefense & aiRecallDefenders
 *
 * Tests verify that updateAIDefense and aiRecallDefenders match C++ RA source code
 * behavior for AI base defense: recalling attack pool units when under attack,
 * and rallying idle guard units to intercept nearby enemies.
 *
 * Source references:
 *   - HOUSE.CPP AI() — underAttack flag, IQ gating for defense decisions
 *   - HOUSE.CPP AI_Attack() — recall defenders from attack pool
 *   - HOUSE.CPP AI_Base_Defense() — rally idle units near base to engage enemies
 *   - TECHNO.CPP Mission_Hunt — hunt behavior after recall
 *
 * Observable outcomes: tick gating, IQ gating, recall pool halving (ceil),
 * mission assignment, move target assignment, harvester exclusion,
 * distance thresholds (10 cells friendly, 12 cells enemy), alliance checks.
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
  updateAIDefense,
  aiRecallDefenders,
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
  map.setBounds(40, 40, 50, 50);
  const alliances = buildDefaultAlliances();
  return {
    entities: [], entityById: new Map(), structures: [],
    map, tick: 1, playerHouse: House.Spain,
    scenarioId: 'SCG01EA', difficulty: 'normal' as Difficulty,
    aiStates: new Map(), houseCredits: new Map(), houseIQs: new Map(), houseTechLevels: new Map(),
    houseMaxUnits: new Map(), houseMaxInfantry: new Map(), houseMaxBuildings: new Map(),
    baseBlueprint: [], baseRebuildQueue: [], baseRebuildCooldown: 0,
    scenarioProductionItems: PRODUCTION_ITEMS, scenarioUnitStats: {}, scenarioWeaponStats: {},
    nextWaveId: 0, autocreateEnabled: false, teamTypes: [], destroyedTeams: new Set(),
    waypoints: new Map(), houseEdges: new Map(), effects: [],
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    clearStructureFootprint: vi.fn(),
    findPassableSpawn: (_cx, _cy, _scx, _scy, _fw, _fh) => ({ cx: _cx, cy: _cy }),
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Create an entity, register it in ctx.entities and ctx.entityById */
function spawnEntity(ctx: AIContext, type: UnitType, house: House, x: number, y: number): Entity {
  const e = new Entity(type, house, x, y);
  ctx.entities.push(e);
  ctx.entityById.set(e.id, e);
  return e;
}

// GUN is 1x1 — at (50,50), aiGetBaseCenter returns cx=50, cy=50.
// Base center world pos = 50*24+12 = 1212 for both x and y.
const BASE_CX = 50;
const BASE_CY = 50;
const BASE_CENTER_WORLD = BASE_CX * CELL_SIZE + CELL_SIZE / 2; // 1212

// =============================================================================
// aiRecallDefenders
// =============================================================================

describe('aiRecallDefenders — C++ AI_Attack recall (HOUSE.CPP)', () => {
  it('recalls up to half (ceil) of attack pool units', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // 6 units in pool → ceil(6/2) = 3 recalled
    for (let i = 0; i < 6; i++) {
      const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
      state.attackPool.add(e.id);
    }

    aiRecallDefenders(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(3);
  });

  it('sets recalled units to HUNT mission', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    e.mission = Mission.GUARD;
    state.attackPool.add(e.id);

    aiRecallDefenders(ctx, House.USSR, state);
    expect(e.mission).toBe(Mission.HUNT);
  });

  it('sets moveTarget to base center world position', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    state.attackPool.add(e.id);

    aiRecallDefenders(ctx, House.USSR, state);
    expect(e.moveTarget).toEqual({ x: BASE_CENTER_WORLD, y: BASE_CENTER_WORLD });
  });

  it('removes recalled units from attackPool', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const e1 = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    const e2 = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    state.attackPool.add(e1.id);
    state.attackPool.add(e2.id);

    // ceil(2/2)=1 recalled
    aiRecallDefenders(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(1);
    // The first iterated unit should have been recalled
    expect(state.attackPool.has(e1.id)).toBe(false);
  });

  it('skips dead entities in attack pool without counting them', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const dead = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    dead.alive = false;
    const alive1 = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    const alive2 = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    state.attackPool.add(dead.id);
    state.attackPool.add(alive1.id);
    state.attackPool.add(alive2.id);

    // Pool size 3 → maxRecall = ceil(3/2) = 2
    // dead is skipped (not counted), alive1 & alive2 are recalled
    aiRecallDefenders(ctx, House.USSR, state);
    expect(alive1.mission).toBe(Mission.HUNT);
    expect(alive2.mission).toBe(Mission.HUNT);
  });

  it('skips entities not found in entityById', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Add phantom ID that doesn't exist in entityById
    state.attackPool.add(9999);
    const alive = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    state.attackPool.add(alive.id);

    // Pool size 2 → maxRecall = 1
    // 9999 is skipped (not found), alive is recalled
    aiRecallDefenders(ctx, House.USSR, state);
    expect(alive.mission).toBe(Mission.HUNT);
  });

  it('does nothing when no base center (no structures)', () => {
    const ctx = makeMockAIContext();
    // No structures for USSR
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    e.mission = Mission.GUARD;
    state.attackPool.add(e.id);

    aiRecallDefenders(ctx, House.USSR, state);
    // Should not modify the entity
    expect(e.mission).toBe(Mission.GUARD);
    expect(e.moveTarget).toBeNull();
    expect(state.attackPool.has(e.id)).toBe(true);
  });

  it('pool of 1 unit → recalls 1 (ceil(1/2) = 1)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
    state.attackPool.add(e.id);

    aiRecallDefenders(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(0);
    expect(e.mission).toBe(Mission.HUNT);
  });

  it('pool of 7 units → recalls 4 (ceil(7/2) = 4)', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const units: Entity[] = [];
    for (let i = 0; i < 7; i++) {
      const e = spawnEntity(ctx, UnitType.E1, House.USSR, 2000, 2000);
      state.attackPool.add(e.id);
      units.push(e);
    }

    aiRecallDefenders(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(3);

    let recalledCount = 0;
    for (const u of units) {
      if (u.mission === Mission.HUNT) recalledCount++;
    }
    expect(recalledCount).toBe(4);
  });

  it('empty pool → does nothing', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // No units in attackPool
    aiRecallDefenders(ctx, House.USSR, state);
    expect(state.attackPool.size).toBe(0);
  });
});

// =============================================================================
// updateAIDefense
// =============================================================================

describe('updateAIDefense — C++ AI_Base_Defense (HOUSE.CPP)', () => {

  // -- Tick gating --

  it('tick gating: runs on tick 1 ((1-1) % 45 === 0, TS 1-based)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Place a GUARD unit near base with an enemy nearby
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  it('tick gating: does NOT run on tick 2 ((2-1) % 45 !== 0)', () => {
    const ctx = makeMockAIContext({ tick: 2 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD); // not changed
  });

  it('tick gating: runs on tick 46', () => {
    const ctx = makeMockAIContext({ tick: 46 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  it('tick gating: runs on tick 91', () => {
    const ctx = makeMockAIContext({ tick: 91 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  // -- IQ / underAttack gating --

  it('skips houses not under attack (underAttack=false)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: false, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('skips houses with IQ < 2 (iq=1)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 1 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('skips houses with IQ < 2 (iq=0)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 0 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('proceeds when IQ === 2 (boundary)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 2 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  // -- Recall from attack pool --

  it('calls aiRecallDefenders when attackPool has units', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const poolUnit = spawnEntity(ctx, UnitType.E1, House.USSR, 3000, 3000);
    poolUnit.mission = Mission.MOVE;
    state.attackPool.add(poolUnit.id);

    updateAIDefense(ctx);

    // Recall should set poolUnit to HUNT with base center target
    expect(poolUnit.mission).toBe(Mission.HUNT);
    expect(poolUnit.moveTarget).toEqual({ x: BASE_CENTER_WORLD, y: BASE_CENTER_WORLD });
    expect(state.attackPool.has(poolUnit.id)).toBe(false);
  });

  it('does not recall when attackPool is empty', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // No pool units — just verify no crash and defense rally still works
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(state.attackPool.size).toBe(0);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  // -- Defense rally: unit/enemy distance/status filters --

  it('rallies idle GUARD units near base (dist < 10) to hunt nearby enemies', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Defender at base center (dist=0)
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Enemy 5 cells away (within 12-cell threshold)
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget).toEqual({ x: enemy.pos.x, y: enemy.pos.y });
  });

  it('rallies AREA_GUARD units near base to hunt nearby enemies', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.AREA_GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget).toEqual({ x: enemy.pos.x, y: enemy.pos.y });
  });

  it('harvesters excluded from rally', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const harvester = spawnEntity(ctx, UnitType.V_HARV, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    harvester.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(harvester.mission).toBe(Mission.GUARD); // not rallied
  });

  it('units too far from base center (dist >= 10) not rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Place defender 10 cells away from center (at boundary, dist === 10 is NOT < 10)
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD + 10 * CELL_SIZE, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD); // not rallied
  });

  it('units at dist < 10 (boundary: 9.9 cells) are rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // 9 cells away — clearly within threshold
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD + 9 * CELL_SIZE, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
  });

  it('enemies too far from base center (dist >= 12) not targeted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Enemy exactly 12 cells away (NOT < 12)
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 12 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD); // no enemy close enough
  });

  it('enemies at dist < 12 (boundary: 11 cells) are targeted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Enemy 11 cells away (within 12-cell threshold)
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 11 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget).toEqual({ x: enemy.pos.x, y: enemy.pos.y });
  });

  it('dead enemies not targeted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    const deadEnemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);
    deadEnemy.alive = false;

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('allied entities not targeted as enemies', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Ukraine is allied with USSR in default alliances
    const ally = spawnEntity(ctx, UnitType.E1, House.Ukraine,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD); // allied, not targeted
  });

  it('sets defender mission to HUNT with enemy position as moveTarget', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    const enemyX = BASE_CENTER_WORLD + 7 * CELL_SIZE;
    const enemyY = BASE_CENTER_WORLD + 3 * CELL_SIZE;
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain, enemyX, enemyY);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget!.x).toBe(enemyX);
    expect(defender.moveTarget!.y).toBe(enemyY);
  });

  it('units with HUNT mission not rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const hunter = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    hunter.mission = Mission.HUNT;
    hunter.moveTarget = { x: 999, y: 999 };

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    // HUNT is not GUARD or AREA_GUARD, so should not be re-targeted
    expect(hunter.moveTarget).toEqual({ x: 999, y: 999 });
  });

  it('units with MOVE mission not rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const mover = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    mover.mission = Mission.MOVE;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(mover.mission).toBe(Mission.MOVE);
  });

  it('no base center → skips defense rally', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    // No structures for USSR at all
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('multiple idle units each find nearest enemy independently', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Two defenders at base
    const def1 = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    def1.mission = Mission.GUARD;
    const def2 = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD + 1 * CELL_SIZE, BASE_CENTER_WORLD);
    def2.mission = Mission.AREA_GUARD;

    // Two enemies — enemy1 closer to base center, enemy2 further
    const enemy1 = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 3 * CELL_SIZE, BASE_CENTER_WORLD);
    const enemy2 = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 8 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);

    // Both defenders should target enemy1 (nearest to base center)
    expect(def1.mission).toBe(Mission.HUNT);
    expect(def2.mission).toBe(Mission.HUNT);
    expect(def1.moveTarget).toEqual({ x: enemy1.pos.x, y: enemy1.pos.y });
    expect(def2.moveTarget).toEqual({ x: enemy1.pos.x, y: enemy1.pos.y });
  });

  it('dead AI units not considered for rallying', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const deadDef = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    deadDef.alive = false;
    deadDef.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(deadDef.mission).toBe(Mission.GUARD); // not rallied because dead
  });

  // -- Edge cases and integration scenarios --

  it('units belonging to a different house are not rallied for this house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Ukraine unit near USSR base — not owned by USSR
    const ukraineUnit = spawnEntity(ctx, UnitType.E1, House.Ukraine,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    ukraineUnit.mission = Mission.GUARD;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(ukraineUnit.mission).toBe(Mission.GUARD); // wrong house
  });

  it('multiple AI houses process independently', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    // Two separate bases
    ctx.structures.push(makeStructure('GUN', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('GUN', House.Ukraine, 70, 70));

    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });
    addAIHouse(ctx, House.Ukraine, { underAttack: true, iq: 3 });

    // USSR center is at (50,50) → world (1212,1212)
    const ussrCenter = 50 * CELL_SIZE + CELL_SIZE / 2;
    const ussrDef = spawnEntity(ctx, UnitType.E1, House.USSR, ussrCenter, ussrCenter);
    ussrDef.mission = Mission.GUARD;

    // Ukraine center at (70,70) → world (1692,1692)
    const ukrCenter = 70 * CELL_SIZE + CELL_SIZE / 2;
    const ukrDef = spawnEntity(ctx, UnitType.E1, House.Ukraine, ukrCenter, ukrCenter);
    ukrDef.mission = Mission.GUARD;

    // Enemies near both bases — Spain is enemy to both USSR and Ukraine
    const enemyNearUSSR = spawnEntity(ctx, UnitType.E1, House.Spain,
      ussrCenter + 5 * CELL_SIZE, ussrCenter);
    const enemyNearUkr = spawnEntity(ctx, UnitType.E1, House.Spain,
      ukrCenter + 5 * CELL_SIZE, ukrCenter);

    updateAIDefense(ctx);

    expect(ussrDef.mission).toBe(Mission.HUNT);
    expect(ukrDef.mission).toBe(Mission.HUNT);
  });

  it('defense rally picks closest enemy to base center, not closest to defender', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Defender offset from center but still within 10 cells
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Enemy A: 3 cells from base center
    const enemyA = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 3 * CELL_SIZE, BASE_CENTER_WORLD);
    // Enemy B: 9 cells from base center (closer to defender but farther from center)
    const enemyB = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 9 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);

    // Should target enemyA (closer to base center)
    expect(defender.moveTarget).toEqual({ x: enemyA.pos.x, y: enemyA.pos.y });
  });

  it('no enemy nearby → defender stays on GUARD', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // No enemies spawned at all

    updateAIDefense(ctx);
    expect(defender.mission).toBe(Mission.GUARD);
  });

  it('both recall and rally happen in same tick when pool has units and defenders exist', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    const state = addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    // Attack pool unit (far from base)
    const poolUnit = spawnEntity(ctx, UnitType.E1, House.USSR, 3000, 3000);
    poolUnit.mission = Mission.MOVE;
    state.attackPool.add(poolUnit.id);

    // Local defender near base
    const defender = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    defender.mission = Mission.GUARD;

    // Enemy near base
    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);

    // Pool unit was recalled
    expect(poolUnit.mission).toBe(Mission.HUNT);
    expect(poolUnit.moveTarget).toEqual({ x: BASE_CENTER_WORLD, y: BASE_CENTER_WORLD });

    // Local defender was rallied to enemy
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget).toEqual({ x: enemy.pos.x, y: enemy.pos.y });
  });

  it('SLEEP mission unit is not rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const sleeper = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    sleeper.mission = Mission.SLEEP;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(sleeper.mission).toBe(Mission.SLEEP);
  });

  it('ATTACK mission unit is not rallied', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    ctx.structures.push(makeStructure('GUN', House.USSR, BASE_CX, BASE_CY));
    addAIHouse(ctx, House.USSR, { underAttack: true, iq: 3 });

    const attacker = spawnEntity(ctx, UnitType.E1, House.USSR,
      BASE_CENTER_WORLD, BASE_CENTER_WORLD);
    attacker.mission = Mission.ATTACK;

    const enemy = spawnEntity(ctx, UnitType.E1, House.Spain,
      BASE_CENTER_WORLD + 5 * CELL_SIZE, BASE_CENTER_WORLD);

    updateAIDefense(ctx);
    expect(attacker.mission).toBe(Mission.ATTACK);
  });
});
