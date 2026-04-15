/**
 * C++ Behavioral Parity: AI Retreat System
 *
 * Tests verify that updateAIRetreat matches C++ RA source code behavior
 * for damaged unit retreat and emergency harvester return logic.
 *
 * Source references:
 *   - HOUSE.CPP AI() — retreat decision loop (IQ >= 3 houses)
 *   - UNIT.CPP AI_Harvest() — emergency harvester return to refinery
 *   - HOUSE.CPP Expert_AI() — retreat threshold from difficulty mods
 *
 * Observable outcomes: tick gating, entity filters (dead/player/ant/suicide/IQ),
 * harvester emergency return (nearest PROC, state transitions, threshold),
 * non-harvester retreat (FIX depot vs base center fallback, attackPool removal,
 * difficulty-specific thresholds).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, HOUSE_FACTION, PRODUCTION_ITEMS,
  type ProductionItem, type WorldPos,
  buildDefaultAlliances,
pixelToLepton, } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateAIRetreat,
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
    aiStates: new Map(), houseCredits: new Map(),
    houseIQs: new Map(), houseTechLevels: new Map(),
    houseMaxUnits: new Map(), houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),
    baseBlueprint: [], baseRebuildQueue: [], baseRebuildCooldown: 0,
    scenarioProductionItems: PRODUCTION_ITEMS,
    scenarioUnitStats: {}, scenarioWeaponStats: {},
    nextWaveId: 0,
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

/** Create a damaged AI unit at a specific position */
function makeUnit(
  type: UnitType, house: House, hpRatio: number,
  x = 45 * CELL_SIZE, y = 45 * CELL_SIZE,
): Entity {
  const e = new Entity(type, house, x, y);
  e.hp = Math.floor(e.maxHp * hpRatio);
  return e;
}

// =============================================================================
// 1. Tick Gating (C++ HOUSE.CPP: retreat runs every 30 ticks)
// =============================================================================

describe('Tick gating — only runs on (tick-1) % 30 === 0', () => {
  it('does nothing on tick 0 (before first tick)', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    // Add a structure so base center exists
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD); // not changed to MOVE
  });

  it('processes on tick 1 (first fire)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('processes on tick 31', () => {
    const ctx = makeMockAIContext({ tick: 31 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('does nothing on tick 15 (not aligned)', () => {
    const ctx = makeMockAIContext({ tick: 15 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });
});

// =============================================================================
// 2. Entity Filters (C++ HOUSE.CPP: skip dead/player/ant/suicide/no-state/low-IQ)
// =============================================================================

describe('Entity filters — skip ineligible units', () => {
  it('skips dead entities', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    unit.alive = false;
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('skips player-controlled entities', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    // Spain is player-controlled by default
    addAIHouse(ctx, House.Spain, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.Spain, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.Spain, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('skips ant entities (isAnt === true)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const ant = makeUnit(UnitType.ANT1, House.USSR, 0.10);
    ctx.entities.push(ant);

    expect(ant.isAnt).toBe(true);
    updateAIRetreat(ctx);

    expect(ant.mission).toBe(Mission.GUARD);
  });

  it('skips suicide entities (isSuicide === true)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    unit.isSuicide = true;
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('skips entities without an AI state for their house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    // No AI state added for USSR
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('skips entities when house IQ < 3', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 2 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('processes entities when house IQ === 3', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.I_E1, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });
});

// =============================================================================
// 3. Harvester Emergency Return (C++ UNIT.CPP AI_Harvest — hp < 30% → PROC)
// =============================================================================

describe('Harvester emergency return — damaged harvesters flee to nearest PROC', () => {
  it('damaged harvester (hp < 30% maxHp) returns to nearest PROC', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    const proc = makeStructure('PROC', House.USSR, 50, 50);
    ctx.structures.push(proc);
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.20); // 20% HP
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.mission).toBe(Mission.MOVE);
    expect(harv.harvesterState).toBe('returning');
  });

  it('harvester at exactly 30% HP does NOT trigger emergency return', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.30); // exactly 30%
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // hpRatio >= 0.3 → continue (skip)
    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.harvesterState).toBe('idle');
  });

  it('harvester above 30% HP does not trigger emergency return', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.50);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.mission).toBe(Mission.GUARD);
  });

  it('already-returning harvester (harvesterState="returning") is not interrupted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    harv.harvesterState = 'returning';
    ctx.entities.push(harv);

    const origMission = harv.mission;
    updateAIRetreat(ctx);

    expect(harv.mission).toBe(origMission);
  });

  it('already-unloading harvester (harvesterState="unloading") is not interrupted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    harv.harvesterState = 'unloading';
    ctx.entities.push(harv);

    const origMission = harv.mission;
    updateAIRetreat(ctx);

    expect(harv.mission).toBe(origMission);
  });

  it('harvester already on MOVE mission with moveTarget is not interrupted', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    harv.mission = Mission.MOVE;
    harv.moveTarget = { lx: pixelToLepton(100), ly: pixelToLepton(100) };
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // moveTarget should NOT be overwritten
    expect(harv.moveTarget).toEqual({ lx: pixelToLepton(100), ly: pixelToLepton(100) });
  });

  it('sets harvesterState to "returning"', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.harvesterState).toBe('returning');
  });

  it('sets mission to MOVE', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.mission).toBe(Mission.MOVE);
  });

  it('sets moveTarget to nearest PROC center', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    const procCx = 50, procCy = 50;
    ctx.structures.push(makeStructure('PROC', House.USSR, procCx, procCy));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // PROC size is [3, 3], so center = (cx + 3/2) * CELL_SIZE, (cy + 3/2) * CELL_SIZE
    const [w, h] = STRUCTURE_SIZE['PROC']!;
    const expectedX = (procCx + w / 2) * CELL_SIZE;
    const expectedY = (procCy + h / 2) * CELL_SIZE;
    expect(harv.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('sets harvestTick to 0', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    harv.harvestTick = 99; // had been harvesting
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.harvestTick).toBe(0);
  });

  it('finds nearest PROC among multiple (distance check)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Far PROC
    const farProc = makeStructure('PROC', House.USSR, 80, 80);
    // Near PROC
    const nearProc = makeStructure('PROC', House.USSR, 44, 44);
    ctx.structures.push(farProc, nearProc);

    // Harvester at (45*24, 45*24) = (1080, 1080)
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10, 45 * CELL_SIZE, 45 * CELL_SIZE);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    const [w, h] = STRUCTURE_SIZE['PROC']!;
    const expectedX = (nearProc.cx + w / 2) * CELL_SIZE;
    const expectedY = (nearProc.cy + h / 2) * CELL_SIZE;
    expect(harv.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('no PROC available → harvester not re-tasked', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // No PROC structures at all
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // No PROC → harvester continues (not retasked), skipped via `continue`
    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.harvesterState).toBe('idle');
  });

  it('only own-house PROCs considered (not enemy)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Enemy PROC
    ctx.structures.push(makeStructure('PROC', House.Spain, 44, 44));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.harvesterState).toBe('idle');
  });

  it('dead PROCs are excluded', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50, { alive: false }));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.harvesterState).toBe('idle');
  });

  it('harvester does not fall through to non-harvester retreat logic', () => {
    // Even if below retreatPercent, a harvester with a PROC should get
    // harvester-specific behavior (returning state) not general retreat
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('FIX', House.USSR, 55, 55));
    state.attackPool.add(999); // dummy
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    state.attackPool.add(harv.id);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // Should use harvester path (returning to PROC), not FIX
    expect(harv.harvesterState).toBe('returning');
    // attackPool should NOT have the harvester removed (harvester path doesn't do this)
    expect(state.attackPool.has(harv.id)).toBe(true);
  });
});

// =============================================================================
// 4. Non-Harvester Retreat (C++ HOUSE.CPP Expert_AI — hp < retreatPercent)
// =============================================================================

describe('Non-harvester retreat — damaged combat units fall back', () => {
  it('unit below retreatPercent (normal=0.25) retreats', () => {
    const ctx = makeMockAIContext({ tick: 1, difficulty: 'normal' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.20); // 20% < 25%
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('unit at exactly retreatPercent (normal=0.25) does NOT retreat', () => {
    const ctx = makeMockAIContext({ tick: 1, difficulty: 'normal' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    // Create a unit at exactly 25% HP
    const unit = new Entity(UnitType.V_2TNK, House.USSR, 45 * CELL_SIZE, 45 * CELL_SIZE);
    unit.hp = Math.floor(unit.maxHp * 0.25);
    // Need exact check: hpRatio = floor(maxHp * 0.25) / maxHp
    // If this equals 0.25, it won't retreat (>= 0.25 → continue)
    // If it rounds down, it retreats. Let's set exactly.
    unit.hp = Math.ceil(unit.maxHp * 0.25); // at or above threshold
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    // hp/maxHp >= 0.25 → no retreat
    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('unit above retreatPercent does not retreat', () => {
    const ctx = makeMockAIContext({ tick: 1, difficulty: 'normal' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.80);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('easy difficulty uses 0.30 retreat threshold', () => {
    expect(AI_DIFFICULTY_MODS.easy.retreatHpPercent).toBe(0.30);

    const ctx = makeMockAIContext({ tick: 1, difficulty: 'easy' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    // 28% < 30% → should retreat on easy
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.28);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('hard difficulty uses 0.15 retreat threshold', () => {
    expect(AI_DIFFICULTY_MODS.hard.retreatHpPercent).toBe(0.15);

    const ctx = makeMockAIContext({ tick: 1, difficulty: 'hard' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    // 10% < 15% → should retreat on hard
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('hard difficulty: unit at 20% does NOT retreat (20% >= 15%)', () => {
    const ctx = makeMockAIContext({ tick: 1, difficulty: 'hard' as Difficulty });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.20);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    // 20% >= 15% threshold → no retreat
    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('already moving (MOVE + moveTarget) not re-tasked', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    unit.mission = Mission.MOVE;
    unit.moveTarget = { lx: pixelToLepton(200), ly: pixelToLepton(200) };
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    // Should not overwrite existing move order
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(200), ly: pixelToLepton(200) });
  });

  it('retreats to FIX (service depot) when available', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    const fixCx = 55, fixCy = 55;
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50)); // for base center
    ctx.structures.push(makeStructure('FIX', House.USSR, fixCx, fixCy));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    const [w, h] = STRUCTURE_SIZE['FIX']!;
    const expectedX = (fixCx + w / 2) * CELL_SIZE;
    const expectedY = (fixCy + h / 2) * CELL_SIZE;
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('falls back to base center when no FIX available', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // Add structures but no FIX
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();

    updateAIRetreat(ctx);

    const expectedX = center!.cx * CELL_SIZE + CELL_SIZE / 2;
    const expectedY = center!.cy * CELL_SIZE + CELL_SIZE / 2;
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('sets mission to MOVE on retreat', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.MOVE);
  });

  it('removes unit from attackPool on retreat', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    state.attackPool.add(unit.id);
    ctx.entities.push(unit);

    expect(state.attackPool.has(unit.id)).toBe(true);

    updateAIRetreat(ctx);

    expect(state.attackPool.has(unit.id)).toBe(false);
  });

  it('no base center → does not retreat', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    // No structures at all → no base center
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).toBeNull();

    updateAIRetreat(ctx);

    expect(unit.mission).toBe(Mission.GUARD);
  });

  it('dead FIX not used as retreat target — falls back to base center', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('FIX', House.USSR, 55, 55, { alive: false }));
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    const center = aiGetBaseCenter(ctx, House.USSR);
    expect(center).not.toBeNull();

    updateAIRetreat(ctx);

    // Should fall back to base center since FIX is dead
    const expectedX = center!.cx * CELL_SIZE + CELL_SIZE / 2;
    const expectedY = center!.cy * CELL_SIZE + CELL_SIZE / 2;
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('only own-house FIX used — enemy FIX ignored', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50)); // for base center
    ctx.structures.push(makeStructure('FIX', House.Spain, 55, 55)); // enemy FIX
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    const center = aiGetBaseCenter(ctx, House.USSR);

    updateAIRetreat(ctx);

    // Should fall back to base center, not enemy FIX
    const expectedX = center!.cx * CELL_SIZE + CELL_SIZE / 2;
    const expectedY = center!.cy * CELL_SIZE + CELL_SIZE / 2;
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });
});

// =============================================================================
// 5. Edge Cases & Integration
// =============================================================================

describe('Edge cases and multi-unit interactions', () => {
  it('multiple damaged units all retreat independently', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('FIX', House.USSR, 55, 55));
    const u1 = makeUnit(UnitType.V_2TNK, House.USSR, 0.10, 42 * CELL_SIZE, 42 * CELL_SIZE);
    const u2 = makeUnit(UnitType.I_E1, House.USSR, 0.10, 48 * CELL_SIZE, 48 * CELL_SIZE);
    state.attackPool.add(u1.id);
    state.attackPool.add(u2.id);
    ctx.entities.push(u1, u2);

    updateAIRetreat(ctx);

    expect(u1.mission).toBe(Mission.MOVE);
    expect(u2.mission).toBe(Mission.MOVE);
    expect(state.attackPool.has(u1.id)).toBe(false);
    expect(state.attackPool.has(u2.id)).toBe(false);
  });

  it('healthy unit and damaged unit — only damaged one retreats', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const healthy = makeUnit(UnitType.V_2TNK, House.USSR, 0.80);
    const damaged = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    state.attackPool.add(healthy.id);
    state.attackPool.add(damaged.id);
    ctx.entities.push(healthy, damaged);

    updateAIRetreat(ctx);

    expect(healthy.mission).toBe(Mission.GUARD); // healthy stays
    expect(damaged.mission).toBe(Mission.MOVE);  // damaged retreats
    expect(state.attackPool.has(healthy.id)).toBe(true);
    expect(state.attackPool.has(damaged.id)).toBe(false);
  });

  it('FIX from first matching structure is used (breaks after first)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    // Two FIX structures — code uses first matching one (break after first)
    const fix1 = makeStructure('FIX', House.USSR, 55, 55);
    const fix2 = makeStructure('FIX', House.USSR, 60, 60);
    ctx.structures.push(fix1, fix2);
    const unit = makeUnit(UnitType.V_2TNK, House.USSR, 0.10);
    ctx.entities.push(unit);

    updateAIRetreat(ctx);

    const [w, h] = STRUCTURE_SIZE['FIX']!;
    const expectedX = (fix1.cx + w / 2) * CELL_SIZE;
    const expectedY = (fix1.cy + h / 2) * CELL_SIZE;
    expect(unit.moveTarget).toEqual({ lx: pixelToLepton(expectedX), ly: pixelToLepton(expectedY) });
  });

  it('harvester with no PROC does NOT get general retreat (continue skips)', () => {
    // A damaged harvester with no PROC hits `continue` and never reaches
    // the non-harvester retreat code below
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('FIX', House.USSR, 55, 55));
    const harv = makeUnit(UnitType.V_HARV, House.USSR, 0.10);
    state.attackPool.add(harv.id);
    ctx.entities.push(harv);

    updateAIRetreat(ctx);

    // Harvester branch hits `continue` — should NOT retreat to FIX
    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.harvesterState).toBe('idle');
    // attackPool should NOT be modified by harvester branch
    expect(state.attackPool.has(harv.id)).toBe(true);
  });

  it('AI_DIFFICULTY_MODS retreatHpPercent values are correct', () => {
    expect(AI_DIFFICULTY_MODS.easy.retreatHpPercent).toBe(0.30);
    expect(AI_DIFFICULTY_MODS.normal.retreatHpPercent).toBe(0.25);
    expect(AI_DIFFICULTY_MODS.hard.retreatHpPercent).toBe(0.15);
  });

  it('STRUCTURE_SIZE for PROC and FIX are as expected', () => {
    // PROC is 3x3, FIX is 3x3
    expect(STRUCTURE_SIZE['PROC']).toEqual([3, 3]);
    expect(STRUCTURE_SIZE['FIX']).toEqual([3, 3]);
  });
});
