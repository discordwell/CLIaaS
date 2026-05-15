/**
 * C++ Behavioral Parity: AI Strategic Planner — Phase Transitions
 *
 * Tests verify that updateAIStrategicPlanner matches C++ RA source code behavior
 * for the AI house-level state machine (economy -> buildup -> attack cycle).
 *
 * Source references:
 *   - HOUSE.CPP AI() — main AI decision loop, phase transition logic
 *   - HOUSE.CPP AI_Building() — prerequisite checks for construction
 *   - HOUSE.CPP Check_Robotics() / Check_Harvester() — harvester/refinery counting
 *
 * Observable outcomes: phase transitions, tick gating, IQ gating,
 * harvester/refinery counting, underAttack timeout, multi-house independence.
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
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateAIStrategicPlanner,
  aiCountStructure,
  aiHasPrereq,
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
    findPassableSpawn: (_cx, _cy, _scx, _scy, _fw, _fh) => ({ cx: _cx, cy: _cy }),
    ...overrides,
  };
}

function addAIHouse(ctx: AIContext, house: House, overrides: Partial<AIHouseState> = {}): AIHouseState {
  const state = createAIHouseState(ctx, house);
  Object.assign(state, { isBaseBuilding: true }, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

/** Build the standard prerequisite structures for economy -> buildup transition */
function addEconomyPrereqs(ctx: AIContext, house: House): void {
  ctx.structures.push(
    makeStructure('TENT', house, 45, 45),
    makeStructure('WEAP', house, 47, 45),
    makeStructure('POWR', house, 45, 47),
    makeStructure('POWR', house, 47, 47),
  );
}

// =============================================================================
// 1. Tick Gating
// TS AI tick starts at 1 (C++ Frame starts at 0). TS uses (tick-1) % 150 === 0,
// so the planner fires at tick 1, 151, 301, etc.
// =============================================================================

describe('Tick gating — only runs on (tick-1) % 150 === 0', () => {
  it('does nothing on tick 0 (before first tick)', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);

    // Phase should NOT transition even though prereqs are met
    expect(state.phase).toBe('economy');
  });

  it('does nothing on tick 150 (one before window)', () => {
    const ctx = makeMockAIContext({ tick: 150 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('runs on tick 1 (first fire)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('runs on tick 151', () => {
    const ctx = makeMockAIContext({ tick: 151 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('runs on tick 301 (second multiple)', () => {
    const ctx = makeMockAIContext({ tick: 301 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('does nothing on tick 152 (just past window)', () => {
    const ctx = makeMockAIContext({ tick: 152 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });
});

// =============================================================================
// 2. IQ=0 Skip (C++ HOUSE.CPP: if IQ == 0 skip AI processing)
// =============================================================================

describe('IQ=0 houses are skipped entirely', () => {
  it('does not transition phase when IQ is 0', () => {
    const ctx = makeMockAIContext({ tick: 151 });
    const state = addAIHouse(ctx, House.USSR, { iq: 0, phase: 'economy', isBaseBuilding: false });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('does not update harvesterCount when IQ is 0', () => {
    const ctx = makeMockAIContext({ tick: 151 });
    const state = addAIHouse(ctx, House.USSR, { iq: 0, harvesterCount: 5, isBaseBuilding: false });
    ctx.entities.push(new Entity(UnitType.V_HARV, House.USSR, 200, 200));

    updateAIStrategicPlanner(ctx);
    // harvesterCount should remain at its initial value (not reset to 0)
    expect(state.harvesterCount).toBe(5);
  });

  it('does not update refineryCount when IQ is 0', () => {
    const ctx = makeMockAIContext({ tick: 151 });
    const state = addAIHouse(ctx, House.USSR, { iq: 0, refineryCount: 3, isBaseBuilding: false });
    ctx.structures.push(makeStructure('PROC', House.USSR));

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(3);
  });

  it('does not clear underAttack when IQ is 0', () => {
    const ctx = makeMockAIContext({ tick: 451 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 0, underAttack: true, lastBaseAttackTick: 100, isBaseBuilding: false,
    });

    updateAIStrategicPlanner(ctx);
    // underAttack should remain true because IQ=0 skips all processing
    expect(state.underAttack).toBe(true);
  });
});

// =============================================================================
// 3. Harvester Counting (C++ HOUSE.CPP: harvester census)
// =============================================================================

describe('Harvester counting — alive V_HARV for house', () => {
  it('counts alive harvesters for the AI house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.entities.push(
      new Entity(UnitType.V_HARV, House.USSR, 200, 200),
      new Entity(UnitType.V_HARV, House.USSR, 250, 250),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(2);
  });

  it('resets harvesterCount to 0 before counting', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, harvesterCount: 99 });
    // No harvesters in the entity list

    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(0);
  });

  it('excludes dead harvesters from count', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    const alive = new Entity(UnitType.V_HARV, House.USSR, 200, 200);
    const dead = new Entity(UnitType.V_HARV, House.USSR, 250, 250);
    dead.alive = false;
    ctx.entities.push(alive, dead);

    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(1);
  });

  it('excludes harvesters belonging to other houses', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.entities.push(
      new Entity(UnitType.V_HARV, House.USSR, 200, 200),
      new Entity(UnitType.V_HARV, House.Spain, 300, 300),
      new Entity(UnitType.V_HARV, House.Greece, 400, 400),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(1);
  });

  it('does not count non-harvester vehicles', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.entities.push(
      new Entity(UnitType.V_HARV, House.USSR, 200, 200),
      new Entity(UnitType.V_1TNK, House.USSR, 250, 250),
      new Entity(UnitType.V_2TNK, House.USSR, 300, 300),
      new Entity(UnitType.I_E1, House.USSR, 350, 350),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.harvesterCount).toBe(1);
  });
});

// =============================================================================
// 4. Refinery Counting (C++ HOUSE.CPP: refinery census)
// =============================================================================

describe('Refinery counting — alive PROC structures for house', () => {
  it('counts alive refineries for the AI house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 45, 45),
      makeStructure('PROC', House.USSR, 48, 45),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(2);
  });

  it('resets refineryCount to 0 before counting', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, refineryCount: 77 });

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(0);
  });

  it('excludes dead refineries from count', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 45, 45),
      makeStructure('PROC', House.USSR, 48, 45, { alive: false }),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(1);
  });

  it('excludes refineries from other houses', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 45, 45),
      makeStructure('PROC', House.Spain, 48, 45),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(1);
  });

  it('does not count non-PROC structures as refineries', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3 });
    ctx.structures.push(
      makeStructure('PROC', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 48, 45),
      makeStructure('POWR', House.USSR, 48, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.refineryCount).toBe(1);
  });
});

// =============================================================================
// 5. UnderAttack Timeout (C++ HOUSE.CPP: Expert_AI STATE_ATTACKED transitions)
// =============================================================================

describe('UnderAttack timeout — Expert_AI mirrors LATime with a one-minute window', () => {
  it('clears underAttack when tick - lastBaseAttackTick > TICKS_PER_MINUTE', () => {
    const ctx = makeMockAIContext({ tick: 1051 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: true, underAttack: true, lastBaseAttackTick: 100,
    });

    updateAIStrategicPlanner(ctx);
    // C++: LATime + TICKS_PER_MINUTE < Frame clears STATE_ATTACKED.
    expect(state.underAttack).toBe(false);
  });

  it('keeps underAttack true when tick - lastBaseAttackTick === TICKS_PER_MINUTE', () => {
    const ctx = makeMockAIContext({ tick: 1051 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: true, underAttack: true, lastBaseAttackTick: 151,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(true);
  });

  it('keeps underAttack true when within TICKS_PER_MINUTE of last attack', () => {
    const ctx = makeMockAIContext({ tick: 301 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: true, underAttack: true, lastBaseAttackTick: 200,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(true);
  });

  it('enters underAttack for base-building houses with fresh LATime', () => {
    const ctx = makeMockAIContext({ tick: 451 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: true, underAttack: false, lastBaseAttackTick: 200,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(true);
  });

  it('does not enter underAttack for non-base-building houses with fresh LATime', () => {
    const ctx = makeMockAIContext({ tick: 451 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: false, underAttack: false, lastBaseAttackTick: 200,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(false);
  });
});

// =============================================================================
// 6. Economy -> Buildup Transition (C++ HOUSE.CPP: prerequisite checks)
// =============================================================================

describe('Economy -> Buildup transition — requires TENT/BARR + WEAP + 2 power', () => {
  it('transitions when TENT, WEAP, and 2 POWR are present', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in economy without TENT (no barracks)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('stays in economy without WEAP', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('stays in economy with only 1 power plant (needs >= 2)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('transitions with BARR instead of TENT (aiHasPrereq treats BARR as TENT)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('BARR', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('transitions with mixed POWR + APWR (1 POWR + 1 APWR >= 2)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('APWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('transitions with 2 APWR (no POWR needed)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('APWR', House.USSR, 45, 47),
      makeStructure('APWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in economy with 0 power plants', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });

  it('ignores dead prerequisite structures', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45, { alive: false }),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    // TENT is dead, so hasBarracks is false
    expect(state.phase).toBe('economy');
  });

  it('ignores other house structures for prereqs', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.Spain, 45, 45),  // wrong house
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');
  });
});

// =============================================================================
// 7. Buildup -> Attack Transition (C++ HOUSE.CPP: attack pool threshold)
// =============================================================================

describe('Buildup -> Attack transition — attackPool.size >= attackThreshold', () => {
  it('transitions when pool reaches threshold', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const pool = new Set([1, 2, 3, 4, 5, 6]);
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 6,
    });
    state.attackPool = pool;

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });

  it('transitions when pool exceeds threshold', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const pool = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 6,
    });
    state.attackPool = pool;

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });

  it('stays in buildup when pool is below threshold', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const pool = new Set([1, 2, 3]);
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 6,
    });
    state.attackPool = pool;

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in buildup with empty pool', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 6,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });
});

// =============================================================================
// 8. Attack -> Buildup Transition (C++ HOUSE.CPP: attack pool depletion)
// =============================================================================

describe('Attack -> Buildup transition — attackPool.size === 0', () => {
  it('transitions back to buildup when attack pool is empty', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'attack',
    });
    // attackPool is empty by default (new Set())

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });

  it('stays in attack phase when pool has units', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const pool = new Set([1, 2, 3]);
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'attack',
    });
    state.attackPool = pool;

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });

  it('stays in attack phase with exactly 1 unit remaining', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const pool = new Set([42]);
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'attack',
    });
    state.attackPool = pool;

    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');
  });
});

// =============================================================================
// 9. Multi-House Independence (C++ HOUSE.CPP: per-house AI loop)
// =============================================================================

describe('Multiple houses transition independently', () => {
  it('one house transitions while another stays (different phases)', () => {
    const ctx = makeMockAIContext({ tick: 1 });

    // USSR: economy with prereqs met -> should transition to buildup
    const ussrState = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    // Greece: economy without prereqs -> should stay
    const greeceState = addAIHouse(ctx, House.Greece, { iq: 3, phase: 'economy' });

    updateAIStrategicPlanner(ctx);

    expect(ussrState.phase).toBe('buildup');
    expect(greeceState.phase).toBe('economy');
  });

  it('both houses transition independently in same tick', () => {
    const ctx = makeMockAIContext({ tick: 1 });

    // USSR: buildup with full pool -> attack
    const ussrPool = new Set([1, 2, 3, 4, 5, 6]);
    const ussrState = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 6,
    });
    ussrState.attackPool = ussrPool;

    // Greece: attack with empty pool -> buildup
    const greeceState = addAIHouse(ctx, House.Greece, {
      iq: 3, phase: 'attack',
    });

    updateAIStrategicPlanner(ctx);

    expect(ussrState.phase).toBe('attack');
    expect(greeceState.phase).toBe('buildup');
  });

  it('harvester counts are per-house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const ussrState = addAIHouse(ctx, House.USSR, { iq: 3 });
    const greeceState = addAIHouse(ctx, House.Greece, { iq: 3 });

    ctx.entities.push(
      new Entity(UnitType.V_HARV, House.USSR, 200, 200),
      new Entity(UnitType.V_HARV, House.USSR, 250, 250),
      new Entity(UnitType.V_HARV, House.Greece, 300, 300),
    );

    updateAIStrategicPlanner(ctx);

    expect(ussrState.harvesterCount).toBe(2);
    expect(greeceState.harvesterCount).toBe(1);
  });

  it('refinery counts are per-house', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const ussrState = addAIHouse(ctx, House.USSR, { iq: 3 });
    const greeceState = addAIHouse(ctx, House.Greece, { iq: 3 });

    ctx.structures.push(
      makeStructure('PROC', House.USSR, 45, 45),
      makeStructure('PROC', House.USSR, 47, 45),
      makeStructure('PROC', House.USSR, 49, 45),
      makeStructure('PROC', House.Greece, 45, 47),
    );

    updateAIStrategicPlanner(ctx);

    expect(ussrState.refineryCount).toBe(3);
    expect(greeceState.refineryCount).toBe(1);
  });
});

// =============================================================================
// 10. Full Cycle (C++ HOUSE.CPP: complete phase progression)
// =============================================================================

describe('Full phase cycle — economy -> buildup -> attack -> buildup', () => {
  it('completes full economy -> buildup -> attack -> buildup cycle', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });

    // Phase 1: economy, no prereqs yet — fires at tick 1 but no prereqs
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('economy');

    // Add prereqs
    addEconomyPrereqs(ctx, House.USSR);

    // Phase 2: economy -> buildup
    ctx.tick = 151;
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');

    // Phase 3: buildup, pool not ready
    ctx.tick = 301;
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');

    // Fill the attack pool
    for (let i = 1; i <= state.attackThreshold; i++) {
      state.attackPool.add(i);
    }

    // Phase 4: buildup -> attack
    ctx.tick = 451;
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');

    // Phase 5: attack, still has units
    ctx.tick = 601;
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('attack');

    // Deplete the pool
    state.attackPool.clear();

    // Phase 6: attack -> buildup (cycle restarts)
    ctx.tick = 751;
    updateAIStrategicPlanner(ctx);
    expect(state.phase).toBe('buildup');
  });
});

// =============================================================================
// 11. Edge Cases & Boundary Conditions
// =============================================================================

describe('Edge cases and boundary conditions', () => {
  it('handles no AI houses gracefully', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    // No houses added
    expect(() => updateAIStrategicPlanner(ctx)).not.toThrow();
  });

  it('economy phase does not jump directly to attack', () => {
    // Even with a full attack pool, economy goes to buildup first (not attack)
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'economy', attackThreshold: 4,
    });
    state.attackPool = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    addEconomyPrereqs(ctx, House.USSR);

    updateAIStrategicPlanner(ctx);
    // Goes to buildup, NOT attack — the switch only handles economy->buildup
    expect(state.phase).toBe('buildup');
  });

  it('buildup -> attack uses >= comparison (exact threshold triggers)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 4,
    });
    state.attackPool = new Set([1, 2, 3, 4]);

    updateAIStrategicPlanner(ctx);
    // 4 >= 4 should trigger
    expect(state.phase).toBe('attack');
  });

  it('buildup stays when pool is one below threshold', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 4,
    });
    state.attackPool = new Set([1, 2, 3]);

    updateAIStrategicPlanner(ctx);
    // 3 < 4 should not trigger
    expect(state.phase).toBe('buildup');
  });

  it('underAttack boundary: clears only after the 900-tick C++ minute expires', () => {
    const ctx = makeMockAIContext({ tick: 1051 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, isBaseBuilding: true, underAttack: true, lastBaseAttackTick: 149,
    });

    updateAIStrategicPlanner(ctx);
    expect(state.underAttack).toBe(false);
  });
});
