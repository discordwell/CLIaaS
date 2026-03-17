/**
 * C++ Behavioral Parity: AI Harvester Management (updateAIHarvesters)
 *
 * Tests verify that the AI harvester counting and force-produce logic
 * matches C++ RA source code behavior from house.cpp/aadata.cpp.
 *
 * C++ reference: HouseClass::AI_Harvester() — counts harvesters per house,
 * updates refinery count, and force-produces a replacement harvester when
 * all harvesters are lost but a refinery + war factory remain.
 *
 * Observable outcomes: tick gating, harvester/refinery counting, production
 * gating on productionEnabled, force-produce conditions, credit deduction.
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
  updateAIHarvesters,
  spawnAIUnit,
  aiCountStructure,
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
    map, tick: 0, playerHouse: House.Spain,
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

function makeHarvester(house: House, alive = true): Entity {
  const e = new Entity(UnitType.V_HARV, house, 200, 200);
  e.alive = alive;
  return e;
}

function makeVehicle(type: UnitType, house: House, alive = true): Entity {
  const e = new Entity(type, house, 200, 200);
  e.alive = alive;
  return e;
}

/** Get the HARV production item cost from PRODUCTION_ITEMS */
const HARV_COST = PRODUCTION_ITEMS.find(p => p.type === 'HARV')!.cost;

// =============================================================================
// 1. Tick Gating (C++ HouseClass::AI() — harvester AI runs every 60 ticks)
// =============================================================================

describe('tick gating — C++ HouseClass::AI() runs harvester check every 60 ticks', () => {
  it('does nothing on tick 1 (not divisible by 60)', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99; // sentinel value
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(99); // unchanged — function early-returned
  });

  it('does nothing on tick 59', () => {
    const ctx = makeMockAIContext({ tick: 59 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(99);
  });

  it('runs on tick 0 (0 % 60 === 0)', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(0); // reset to 0, no harvesters in entities
  });

  it('runs on tick 60', () => {
    const ctx = makeMockAIContext({ tick: 60 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(0);
  });

  it('runs on tick 120', () => {
    const ctx = makeMockAIContext({ tick: 120 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(0);
  });

  it('does nothing on tick 61', () => {
    const ctx = makeMockAIContext({ tick: 61 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 99;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(99);
  });
});

// =============================================================================
// 2. Harvester Count Reset (C++ always resets before counting)
// =============================================================================

describe('harvester count resets to 0 each call — C++ HouseClass::AI_Harvester()', () => {
  it('resets harvesterCount from a previous nonzero value', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 5;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(0);
  });

  it('harvesterCount stays 0 when already 0 and no harvesters exist', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true });
    state.harvesterCount = 0;
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(0);
  });
});

// =============================================================================
// 3. Counts Alive Harvesters for Correct House
// =============================================================================

describe('counts alive V_HARV entities matching house — C++ house.cpp unit scan', () => {
  it('counts 1 alive harvester for USSR', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    const harv = makeHarvester(House.USSR);
    ctx.entities.push(harv);
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(1);
  });

  it('counts 3 alive harvesters for USSR', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.entities.push(makeHarvester(House.USSR));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(3);
  });
});

// =============================================================================
// 4. Dead Harvesters Excluded
// =============================================================================

describe('dead harvesters excluded from count — C++ checks IsActive/Strength', () => {
  it('dead V_HARV is not counted', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    const dead = makeHarvester(House.USSR, false);
    ctx.entities.push(dead);
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(0);
  });

  it('mix of alive and dead: only alive counted', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeHarvester(House.USSR, true));
    ctx.entities.push(makeHarvester(House.USSR, false));
    ctx.entities.push(makeHarvester(House.USSR, true));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(2);
  });
});

// =============================================================================
// 5. Other House Harvesters Excluded
// =============================================================================

describe('harvesters from other houses excluded — C++ checks Owner==this', () => {
  it('Spain harvesters not counted for USSR AI', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeHarvester(House.Spain));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(0);
  });

  it('Ukraine harvesters not counted for USSR AI', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeHarvester(House.Ukraine));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(0);
  });
});

// =============================================================================
// 6. Non-Harvester Vehicles Excluded
// =============================================================================

describe('non-V_HARV unit types excluded — C++ checks UNIT_HARVESTER type', () => {
  it('V_1TNK not counted as harvester', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeVehicle(UnitType.V_1TNK, House.USSR));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(0);
  });

  it('I_E1 infantry not counted as harvester', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeVehicle(UnitType.I_E1, House.USSR));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(0);
  });
});

// =============================================================================
// 7. Refinery Count Updated
// =============================================================================

describe('refineryCount updated via aiCountStructure(PROC) — C++ house.cpp', () => {
  it('refineryCount = 1 with one alive PROC', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(1);
  });

  it('refineryCount = 2 with two alive PROCs', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('PROC', House.USSR, 55, 55));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(2);
  });

  it('refineryCount = 0 with no PROCs', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(0);
  });
});

// =============================================================================
// 8. Dead Refineries Excluded
// =============================================================================

describe('dead PROC structures excluded — C++ checks IsActive', () => {
  it('dead PROC not counted in refineryCount', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50, { alive: false }));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(0);
  });

  it('mix of alive and dead PROCs: only alive counted', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50, { alive: true }));
    ctx.structures.push(makeStructure('PROC', House.USSR, 55, 55, { alive: false }));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(1);
  });
});

// =============================================================================
// 9. productionEnabled Gate
// =============================================================================

describe('productionEnabled gate — C++ HouseClass::AI_Harvester() skips force-produce', () => {
  it('does not force-produce when productionEnabled=false even with all conditions met', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: false });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    // No harvesters, has refinery + WEAP + credits, but production disabled
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// =============================================================================
// 10. Force-Produce Condition (all three: 0 harv, refinery > 0, WEAP > 0)
// =============================================================================

describe('force-produce requires harvesterCount=0 AND refineryCount>0 AND WEAP>0 — C++ house.cpp', () => {
  it('force-produces when all conditions met', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    // Should have spawned a harvester
    const harvs = ctx.entities.filter(e => e.type === UnitType.V_HARV && e.house === House.USSR);
    expect(harvs.length).toBe(1);
  });
});

// =============================================================================
// 11. No Force-Produce With Existing Harvester
// =============================================================================

describe('no force-produce with existing harvester — C++ only when CurHarvesters==0', () => {
  it('does not force-produce when 1 alive harvester exists', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    // Only the original harvester should exist
    expect(ctx.entities.length).toBe(1);
  });
});

// =============================================================================
// 12. No Force-Produce Without Refinery
// =============================================================================

describe('no force-produce without refinery — C++ checks CurRefinery > 0', () => {
  it('does not force-produce when no PROC exists', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    // WEAP exists, credits exist, no harvesters, but no PROC
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// =============================================================================
// 13. No Force-Produce Without WEAP
// =============================================================================

describe('no force-produce without WEAP — C++ checks war factory exists', () => {
  it('does not force-produce when no WEAP exists', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    // PROC exists, credits exist, no harvesters, but no WEAP
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// =============================================================================
// 14. Credits Check — Needs credits >= HARV cost (1400)
// =============================================================================

describe('credits check — C++ checks Available_Money() >= cost', () => {
  it('HARV cost is 1400 credits in PRODUCTION_ITEMS', () => {
    expect(HARV_COST).toBe(1400);
  });

  it('force-produces when credits exactly equal HARV cost', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, HARV_COST); // exactly 1400
    updateAIHarvesters(ctx);
    const harvs = ctx.entities.filter(e => e.type === UnitType.V_HARV && e.house === House.USSR);
    expect(harvs.length).toBe(1);
  });

  it('force-produces when credits exceed HARV cost', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, HARV_COST + 1000);
    updateAIHarvesters(ctx);
    const harvs = ctx.entities.filter(e => e.type === UnitType.V_HARV && e.house === House.USSR);
    expect(harvs.length).toBe(1);
  });
});

// =============================================================================
// 15. Insufficient Credits
// =============================================================================

describe('insufficient credits prevent force-produce — C++ cost gate', () => {
  it('does not force-produce when credits < HARV cost', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, HARV_COST - 1); // 1399
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('does not force-produce with 0 credits', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 0);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('does not force-produce when credits map has no entry for house (defaults to 0)', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    // houseCredits has no entry for USSR — defaults to 0 via ?? 0
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });
});

// =============================================================================
// 16. Successful Force-Produce Creates V_HARV Entity
// =============================================================================

describe('successful force-produce creates V_HARV entity — C++ HouseClass::AI_Harvester()', () => {
  it('spawned entity is V_HARV type', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_HARV);
  });

  it('spawned entity belongs to the correct house', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities[0].house).toBe(House.USSR);
  });

  it('spawned entity is alive', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities[0].alive).toBe(true);
  });
});

// =============================================================================
// 17. Credit Deduction Amount
// =============================================================================

describe('credit deduction — C++ deducts exactly harvItem.cost', () => {
  it('deducts exactly 1400 credits after force-produce', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(5000 - HARV_COST);
  });

  it('credits reach 0 when starting with exactly HARV cost', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, HARV_COST);
    updateAIHarvesters(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(0);
  });

  it('credits unchanged when force-produce does not happen', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    // Has harvester -> no force-produce
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(5000);
  });
});

// =============================================================================
// 18. New Harvester Added to entities Array
// =============================================================================

describe('force-produced harvester added to ctx.entities — C++ ObjectClass::Limbo()', () => {
  it('entities array grows by 1 after force-produce', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    const before = ctx.entities.length;
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(before + 1);
  });

  it('force-produced harvester is also in entityById map', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    const spawned = ctx.entities[0];
    expect(ctx.entityById.get(spawned.id)).toBe(spawned);
  });
});

// =============================================================================
// 19. Multiple Houses Tracked Independently
// =============================================================================

describe('multiple AI houses tracked independently — C++ per-house iteration', () => {
  it('USSR and Ukraine get independent harvester counts', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    addAIHouse(ctx, House.Ukraine, { productionEnabled: true });
    // 2 USSR harvesters, 1 Ukraine harvester
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.entities.push(makeHarvester(House.Ukraine));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.harvesterCount).toBe(2);
    expect(ctx.aiStates.get(House.Ukraine)!.harvesterCount).toBe(1);
  });

  it('USSR and Ukraine get independent refinery counts', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    addAIHouse(ctx, House.Ukraine, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('PROC', House.USSR, 52, 52));
    ctx.structures.push(makeStructure('PROC', House.Ukraine, 54, 54));
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(2);
    expect(ctx.aiStates.get(House.Ukraine)!.refineryCount).toBe(1);
  });

  it('force-produce only for house that lost all harvesters', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    addAIHouse(ctx, House.Ukraine, { productionEnabled: true });
    // USSR has a harvester, Ukraine does not
    ctx.entities.push(makeHarvester(House.USSR));
    // Both have PROC + WEAP
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 52, 52));
    ctx.structures.push(makeStructure('PROC', House.Ukraine, 54, 54));
    ctx.structures.push(makeStructure('WEAP', House.Ukraine, 56, 56));
    ctx.houseCredits.set(House.USSR, 5000);
    ctx.houseCredits.set(House.Ukraine, 5000);
    updateAIHarvesters(ctx);
    // USSR had a harvester so no force-produce; Ukraine had none so force-produce
    const ussrHarvs = ctx.entities.filter(e => e.type === UnitType.V_HARV && e.house === House.USSR);
    const ukrHarvs = ctx.entities.filter(e => e.type === UnitType.V_HARV && e.house === House.Ukraine);
    expect(ussrHarvs.length).toBe(1); // original only
    expect(ukrHarvs.length).toBe(1); // force-produced
  });
});

// =============================================================================
// 20. Counting Happens Regardless of productionEnabled
// =============================================================================

describe('counting always occurs even when productionEnabled=false — C++ house.cpp', () => {
  it('harvesterCount updated when productionEnabled=false', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: false });
    ctx.entities.push(makeHarvester(House.USSR));
    ctx.entities.push(makeHarvester(House.USSR));
    updateAIHarvesters(ctx);
    expect(state.harvesterCount).toBe(2);
  });

  it('refineryCount updated when productionEnabled=false', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: false });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    updateAIHarvesters(ctx);
    expect(state.refineryCount).toBe(1);
  });
});

// =============================================================================
// 21. Edge Cases and Boundary Conditions
// =============================================================================

describe('edge cases — missing HARV in production items, WEAP dead, etc.', () => {
  it('no force-produce when scenarioProductionItems has no HARV entry', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      scenarioProductionItems: PRODUCTION_ITEMS.filter(p => p.type !== 'HARV'),
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
    expect(ctx.houseCredits.get(House.USSR)).toBe(5000); // unchanged
  });

  it('dead WEAP does not count — no force-produce', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55, { alive: false }));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('other-house WEAP does not satisfy own force-produce condition', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.USSR, 50, 50));
    ctx.structures.push(makeStructure('WEAP', House.Ukraine, 55, 55)); // wrong house
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.entities.length).toBe(0);
  });

  it('other-house PROC does not satisfy own refinery count', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    addAIHouse(ctx, House.USSR, { productionEnabled: true });
    ctx.structures.push(makeStructure('PROC', House.Ukraine, 50, 50)); // wrong house
    ctx.structures.push(makeStructure('WEAP', House.USSR, 55, 55));
    ctx.houseCredits.set(House.USSR, 5000);
    updateAIHarvesters(ctx);
    expect(ctx.aiStates.get(House.USSR)!.refineryCount).toBe(0);
    expect(ctx.entities.length).toBe(0);
  });
});
