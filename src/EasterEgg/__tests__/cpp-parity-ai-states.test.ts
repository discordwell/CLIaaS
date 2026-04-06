/**
 * C++ Behavioral Parity: AI States — BROKE, ENDGAME, Fire-Sale, Do-All-To-Hunt
 *
 * Tests verify that the TS AI state machine matches C++ RA source code behavior
 * for the missing AI states (BROKE and ENDGAME) and their associated actions.
 *
 * Source references:
 *   - house.cpp:4749-4769 Expert_AI() — state transitions (BUILDUP/BROKE/ATTACKED/ENDGAME)
 *   - house.cpp:4754-4756 — STATE_BUILDUP → STATE_BROKE when Available_Money() < 25
 *   - house.cpp:4758-4761 — STATE_BROKE → STATE_BUILDUP when Available_Money() >= 25
 *   - house.cpp:4976-4988 Check_Fire_Sale() — no production buildings → URGENCY_CRITICAL
 *   - house.cpp:5164-5174 AI_Fire_Sale() — Fire_Sale() + Do_All_To_Hunt()
 *   - house.cpp:7322-7335 Fire_Sale() — sell all buildings
 *   - house.cpp:7354-7393 Do_All_To_Hunt() — all units/infantry → MISSION_HUNT
 *
 * Observable outcomes: broke flag, endgame flag, buildings sold, units set to HUNT,
 * construction blocked in BROKE state, fire-sale refund credits.
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
  updateAIConstruction,
  aiCountStructure,
  aiHasPrereq,
  aiFireSale,
  aiDoAllToHunt,
  aiCheckEndgame,
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
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

// =============================================================================
// 1. BROKE State — C++ house.cpp:4753-4761
// =============================================================================

describe('BROKE state — money < 25 stops building (house.cpp:4753-4761)', () => {
  it('AI enters BROKE state when money < 25', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 10);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(true);
  });

  it('AI enters BROKE at boundary: money = 24', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 24);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(true);
  });

  it('AI enters BROKE at money = 0', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 0);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(true);
  });

  it('AI does NOT enter BROKE when money = 25 (boundary: >= 25 is not broke)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 25);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(false);
  });

  it('AI does NOT enter BROKE when money = 100', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 100);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(false);
  });

  it('AI exits BROKE state when money >= 25', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup', broke: true });
    ctx.houseCredits.set(House.USSR, 25);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(false);
  });

  it('AI exits BROKE state when money rises to 1000', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup', broke: true });
    ctx.houseCredits.set(House.USSR, 1000);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(false);
  });

  it('AI stays BROKE when money is still < 25', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup', broke: true });
    ctx.houseCredits.set(House.USSR, 10);

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(true);
  });

  it('BROKE state prevents new construction', () => {
    const ctx = makeMockAIContext({ tick: 91 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', broke: true,
      productionEnabled: true,
    });
    ctx.houseCredits.set(House.USSR, 10);
    // Provide FACT so construction would normally work
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const initialStructCount = ctx.structures.length;

    updateAIConstruction(ctx);

    // No new structures should be built
    expect(ctx.structures.length).toBe(initialStructCount);
  });

  it('construction is not blocked when BROKE is false (build queue is consumed)', () => {
    const ctx = makeMockAIContext({ tick: 91 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', broke: false,
      productionEnabled: true,
      buildQueue: ['POWR'],
    });
    ctx.houseCredits.set(House.USSR, 500);
    ctx.structures.push(makeStructure('FACT', House.USSR, 55, 55));

    updateAIConstruction(ctx);

    // When not broke, the function processes the build queue (may or may not place
    // depending on adjacency). The key is it didn't skip due to broke.
    // If broke=true, the buildQueue would remain untouched.
    // Since broke=false + has FACT + has credits, it attempts placement and
    // either builds or shifts the queue item.
    expect(state.buildQueue.length).toBe(0); // Queue item was consumed (built or failed placement)
  });

  it('BROKE with no credits entry (undefined) triggers broke', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    // Don't set any credits — houseCredits.get returns undefined → ?? 0 → < 25

    updateAIStrategicPlanner(ctx);

    expect(state.broke).toBe(true);
  });
});

// =============================================================================
// 2. ENDGAME State — C++ house.cpp:4749-4751, 4976-4988
// =============================================================================

describe('ENDGAME state — no production buildings triggers fire-sale + all-hunt', () => {
  it('AI enters ENDGAME when no ConYard, no Barracks, no War Factory remain', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    // Only non-production buildings remain
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(true);
  });

  it('AI does NOT enter ENDGAME when FACT is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('FACT', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when TENT is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when BARR is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('BARR', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when WEAP is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('WEAP', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when HPAD is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('HPAD', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when AFLD is alive', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('AFLD', House.USSR, 50, 50),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when no buildings at all (nothing to sell)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    // No structures at all — C++ requires CurBuildings > 0

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('AI does NOT enter ENDGAME when underAttack is true (C++ State != STATE_ATTACKED)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', underAttack: true, lastBaseAttackTick: 0,
    });
    ctx.houseCredits.set(House.USSR, 1000);
    // Only non-production buildings
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(false);
  });

  it('dead production buildings do not prevent ENDGAME', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('FACT', House.USSR, 50, 50, { alive: false }),
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(true);
  });

  it('production buildings belonging to other house do not prevent ENDGAME', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('FACT', House.Spain, 50, 50),  // belongs to enemy
      makeStructure('POWR', House.USSR, 52, 50),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.endgame).toBe(true);
  });
});

// =============================================================================
// 3. Fire Sale — C++ house.cpp:7322-7335
// =============================================================================

describe('Fire Sale — sell all buildings (house.cpp:7322-7335)', () => {
  it('marks all buildings as dead with rubble', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50),
      makeStructure('DOME', House.USSR, 54, 50),
    );

    const result = aiFireSale(ctx, House.USSR);

    expect(result).toBe(true);
    for (const s of ctx.structures) {
      expect(s.alive).toBe(false);
      expect(s.rubble).toBe(true);
    }
  });

  it('calls clearStructureFootprint for each sold building', () => {
    const clearFn = vi.fn();
    const ctx = makeMockAIContext({ clearStructureFootprint: clearFn });
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50),
    );

    aiFireSale(ctx, House.USSR);

    expect(clearFn).toHaveBeenCalledTimes(2);
  });

  it('gives partial refund for each building sold', () => {
    const ctx = makeMockAIContext();
    ctx.houseCredits.set(House.USSR, 0);
    const powrItem = PRODUCTION_ITEMS.find(p => p.type === 'POWR' && p.isStructure);
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));

    aiFireSale(ctx, House.USSR);

    const credits = ctx.houseCredits.get(House.USSR) ?? 0;
    // C++ Fire_Sale → Sell_Back(1): AI (IsHuman=false) gets 100% refund (techno.cpp:5743-5761)
    if (powrItem) {
      expect(credits).toBe(powrItem.cost);
    } else {
      // No prod item found — credits should still be 0
      expect(credits).toBe(0);
    }
  });

  it('returns false when no buildings to sell', () => {
    const ctx = makeMockAIContext();

    const result = aiFireSale(ctx, House.USSR);

    expect(result).toBe(false);
  });

  it('only sells buildings belonging to the specified house', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('POWR', House.Spain, 52, 50),
    );

    aiFireSale(ctx, House.USSR);

    // USSR building should be dead
    expect(ctx.structures[0].alive).toBe(false);
    // Spain building should still be alive
    expect(ctx.structures[1].alive).toBe(true);
  });

  it('does not sell already-dead buildings', () => {
    const clearFn = vi.fn();
    const ctx = makeMockAIContext({ clearStructureFootprint: clearFn });
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50, { alive: false }),
    );

    aiFireSale(ctx, House.USSR);

    // Only 1 building was alive to sell
    expect(clearFn).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 4. Do All To Hunt — C++ house.cpp:7354-7393
// =============================================================================

describe('Do All To Hunt — send all units to HUNT (house.cpp:7354-7393)', () => {
  it('sets all units of the house to HUNT mission', () => {
    const ctx = makeMockAIContext();
    const e1 = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    const e2 = new Entity(UnitType.I_E1, House.USSR, 300, 300);
    e1.mission = Mission.GUARD;
    e2.mission = Mission.AREA_GUARD;
    ctx.entities.push(e1, e2);

    aiDoAllToHunt(ctx, House.USSR);

    expect(e1.mission).toBe(Mission.HUNT);
    expect(e2.mission).toBe(Mission.HUNT);
  });

  it('does not affect units belonging to other houses', () => {
    const ctx = makeMockAIContext();
    const ussrUnit = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    const spainUnit = new Entity(UnitType.V_2TNK, House.Spain, 300, 300);
    ussrUnit.mission = Mission.GUARD;
    spainUnit.mission = Mission.GUARD;
    ctx.entities.push(ussrUnit, spainUnit);

    aiDoAllToHunt(ctx, House.USSR);

    expect(ussrUnit.mission).toBe(Mission.HUNT);
    expect(spainUnit.mission).toBe(Mission.GUARD);
  });

  it('does not affect dead units', () => {
    const ctx = makeMockAIContext();
    const alive = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    const dead = new Entity(UnitType.V_2TNK, House.USSR, 300, 300);
    alive.mission = Mission.GUARD;
    dead.mission = Mission.GUARD;
    dead.alive = false;
    ctx.entities.push(alive, dead);

    aiDoAllToHunt(ctx, House.USSR);

    expect(alive.mission).toBe(Mission.HUNT);
    expect(dead.mission).toBe(Mission.GUARD);
  });

  it('includes harvesters in the hunt order', () => {
    const ctx = makeMockAIContext();
    const harv = new Entity(UnitType.V_HARV, House.USSR, 200, 200);
    harv.mission = Mission.GUARD;
    ctx.entities.push(harv);

    aiDoAllToHunt(ctx, House.USSR);

    // C++ sends ALL units including harvesters
    expect(harv.mission).toBe(Mission.HUNT);
  });

  it('handles empty entity list gracefully', () => {
    const ctx = makeMockAIContext();

    expect(() => aiDoAllToHunt(ctx, House.USSR)).not.toThrow();
  });
});

// =============================================================================
// 5. ENDGAME triggers fire-sale and all-hunt via updateAIStrategicPlanner
// =============================================================================

describe('ENDGAME integrated — triggers fire-sale + all-hunt in planner', () => {
  it('entering ENDGAME sells all buildings', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50),
    );
    const e1 = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    e1.mission = Mission.GUARD;
    ctx.entities.push(e1);
    ctx.entityById.set(e1.id, e1);

    updateAIStrategicPlanner(ctx);

    // All buildings sold
    for (const s of ctx.structures) {
      if (s.house === House.USSR) {
        expect(s.alive).toBe(false);
      }
    }
  });

  it('entering ENDGAME sends all units to HUNT', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    const e1 = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    const e2 = new Entity(UnitType.I_E1, House.USSR, 300, 300);
    e1.mission = Mission.GUARD;
    e2.mission = Mission.AREA_GUARD;
    ctx.entities.push(e1, e2);
    ctx.entityById.set(e1.id, e1);
    ctx.entityById.set(e2.id, e2);

    updateAIStrategicPlanner(ctx);

    expect(e1.mission).toBe(Mission.HUNT);
    expect(e2.mission).toBe(Mission.HUNT);
  });

  it('already-endgame state re-triggers fire-sale and all-hunt each tick', () => {
    const clearFn = vi.fn();
    const ctx = makeMockAIContext({ tick: 1, clearStructureFootprint: clearFn });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup', endgame: true });
    ctx.houseCredits.set(House.USSR, 1000);
    // Even with buildings added after endgame set (edge case)
    ctx.structures.push(makeStructure('POWR', House.USSR, 50, 50));
    const e1 = new Entity(UnitType.V_2TNK, House.USSR, 200, 200);
    e1.mission = Mission.GUARD;
    ctx.entities.push(e1);

    updateAIStrategicPlanner(ctx);

    // Fire-sale should have run
    expect(ctx.structures[0].alive).toBe(false);
    expect(e1.mission).toBe(Mission.HUNT);
    // Phase transitions should be skipped (endgame short-circuits)
    expect(state.endgame).toBe(true);
  });

  it('ENDGAME prevents construction', () => {
    const ctx = makeMockAIContext({ tick: 91 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', endgame: true,
      productionEnabled: true,
      buildQueue: ['POWR'],
    });
    ctx.houseCredits.set(House.USSR, 5000);
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));
    const initialCount = ctx.structures.length;

    updateAIConstruction(ctx);

    // No new structures built
    expect(ctx.structures.length).toBe(initialCount);
  });
});

// =============================================================================
// 6. aiCheckEndgame — pure function tests
// =============================================================================

describe('aiCheckEndgame — detection of lost production buildings', () => {
  it('returns true when only non-production buildings remain', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
      makeStructure('SILO', House.USSR, 52, 50),
    );

    expect(aiCheckEndgame(ctx, House.USSR)).toBe(true);
  });

  it('returns false when FACT exists', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));

    expect(aiCheckEndgame(ctx, House.USSR)).toBe(false);
  });

  it('returns false when no buildings at all', () => {
    const ctx = makeMockAIContext();

    expect(aiCheckEndgame(ctx, House.USSR)).toBe(false);
  });

  it('returns true when all production buildings are dead', () => {
    const ctx = makeMockAIContext();
    ctx.structures.push(
      makeStructure('FACT', House.USSR, 50, 50, { alive: false }),
      makeStructure('WEAP', House.USSR, 52, 50, { alive: false }),
      makeStructure('POWR', House.USSR, 54, 50), // alive non-production
    );

    expect(aiCheckEndgame(ctx, House.USSR)).toBe(true);
  });

  it('checks all 6 production types: FACT, TENT, BARR, WEAP, HPAD, AFLD', () => {
    const prodTypes = ['FACT', 'TENT', 'BARR', 'WEAP', 'HPAD', 'AFLD'];
    for (const prodType of prodTypes) {
      const ctx = makeMockAIContext();
      ctx.structures.push(
        makeStructure(prodType, House.USSR, 50, 50),
        makeStructure('POWR', House.USSR, 52, 50),
      );
      expect(aiCheckEndgame(ctx, House.USSR), `${prodType} should prevent endgame`).toBe(false);
    }
  });
});

// =============================================================================
// 7. Normal state transitions still work with new states
// =============================================================================

describe('Normal state transitions unaffected by new BROKE/ENDGAME states', () => {
  it('economy -> buildup still works when not broke and not endgame', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.houseCredits.set(House.USSR, 5000);
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);

    expect(state.phase).toBe('buildup');
    expect(state.broke).toBe(false);
    expect(state.endgame).toBe(false);
  });

  it('buildup -> attack still works normally', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, {
      iq: 3, phase: 'buildup', attackThreshold: 4,
    });
    ctx.houseCredits.set(House.USSR, 5000);
    state.attackPool = new Set([1, 2, 3, 4]);
    // Add a production building to prevent endgame
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));

    updateAIStrategicPlanner(ctx);

    expect(state.phase).toBe('attack');
    expect(state.endgame).toBe(false);
  });

  it('attack -> buildup still works normally', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'attack' });
    ctx.houseCredits.set(House.USSR, 5000);
    // Empty attack pool
    ctx.structures.push(makeStructure('FACT', House.USSR, 50, 50));

    updateAIStrategicPlanner(ctx);

    expect(state.phase).toBe('buildup');
    expect(state.endgame).toBe(false);
  });

  it('BROKE and phase transitions are independent', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'economy' });
    ctx.houseCredits.set(House.USSR, 5); // Will trigger broke
    ctx.structures.push(
      makeStructure('TENT', House.USSR, 45, 45),
      makeStructure('WEAP', House.USSR, 47, 45),
      makeStructure('POWR', House.USSR, 45, 47),
      makeStructure('POWR', House.USSR, 47, 47),
    );

    updateAIStrategicPlanner(ctx);

    // Phase still transitions normally
    expect(state.phase).toBe('buildup');
    // But broke is also set
    expect(state.broke).toBe(true);
  });

  it('multi-house: one enters ENDGAME while other continues normally', () => {
    const ctx = makeMockAIContext({ tick: 1 });

    // USSR: no production buildings → ENDGAME
    const ussrState = addAIHouse(ctx, House.USSR, { iq: 3, phase: 'buildup' });
    ctx.houseCredits.set(House.USSR, 1000);
    ctx.structures.push(
      makeStructure('POWR', House.USSR, 50, 50),
    );

    // Greece: has production buildings → normal
    const greeceState = addAIHouse(ctx, House.Greece, { iq: 3, phase: 'economy' });
    ctx.houseCredits.set(House.Greece, 5000);
    ctx.structures.push(
      makeStructure('TENT', House.Greece, 45, 45),
      makeStructure('WEAP', House.Greece, 47, 45),
      makeStructure('POWR', House.Greece, 45, 47),
      makeStructure('POWR', House.Greece, 47, 47),
    );

    updateAIStrategicPlanner(ctx);

    expect(ussrState.endgame).toBe(true);
    expect(greeceState.endgame).toBe(false);
    expect(greeceState.phase).toBe('buildup');
  });
});
