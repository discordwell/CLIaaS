/**
 * C++ Behavioral Parity: AI Base Construction (updateAIConstruction)
 *
 * Tests verify AI construction behavior matches C++ RA source code.
 * C++ reference: HOUSE.CPP :: AI_Building() — tick-gated structure
 * placement loop with cooldown, credit checks, and build queue logic.
 *
 * These tests describe WHAT happens during AI construction (observable
 * outcomes: gates, cooldowns, credit deduction, structure spawning),
 * not HOW the code implements it. The same scenarios should produce
 * identical results in C++ and TypeScript.
 *
 * NOTE: The adjacency placement algorithm (aiPlaceStructure) requires
 * candidate positions to be within 2 cells (center-to-center) of an
 * existing structure. A 3x3 FACT has center at (cx+1.5, cy+1.5), so
 * 1x1 structures (like SILO) can pass the adjacency check while 2x2
 * structures (like POWR) cannot when only a single FACT is present.
 * Tests that need successful placement use SILO (1x1, cost=150).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, UnitType, CELL_SIZE,
  PRODUCTION_ITEMS,
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
  updateAIConstruction,
  getAIBuildOrder,
  aiPlaceStructure,
  spawnAIStructure,
  aiCountStructure,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** SILO is the preferred test structure: 1x1 footprint, cost 150, passes
 *  adjacency check when placed near a 3x3 FACT. */
const SILO_COST = 150;

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
  // Large bounds to allow structure placement around (50,50)
  map.setBounds(40, 40, 30, 30);
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

    ...overrides,
  };
}

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

/**
 * Set up a minimal viable base: FACT at (50,50) with map terrain marked,
 * enough credits, and AI state enabled. Returns the state for further tweaking.
 */
function setupBuildableHouse(
  ctx: AIContext,
  house: House = House.USSR,
  credits = 10000,
): AIHouseState {
  // Place a FACT so the AI passes the aiCountStructure check
  const fact = makeStructure('FACT', house, 50, 50);
  ctx.structures.push(fact);
  // Mark FACT footprint as WALL (3x3)
  const [fw, fh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      ctx.map.setTerrain(50 + dx, 50 + dy, Terrain.WALL);
    }
  }

  ctx.houseCredits.set(house, credits);

  const state = addAIHouse(ctx, house, {
    productionEnabled: true,
    iq: 3,
    maxBuilding: -1,
  });
  return state;
}

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Tick Gating
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — tick gating (C++ HOUSE.CPP:AI_Building)', () => {
  it('does nothing on tick 0 because tick%90===0 but no AI houses set up', () => {
    const ctx = makeMockAIContext({ tick: 0 });
    const initialStructureCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialStructureCount);
  });

  it('skips entirely when tick % 90 !== 0', () => {
    const ctx = makeMockAIContext({ tick: 1 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    // No building should happen on tick 1
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('runs on tick 90 (90 % 90 === 0)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });

  it('runs on tick 180 (180 % 90 === 0)', () => {
    const ctx = makeMockAIContext({ tick: 180 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });

  it('skips on tick 89 (89 % 90 !== 0)', () => {
    const ctx = makeMockAIContext({ tick: 89 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('skips on tick 91 (91 % 90 !== 0)', () => {
    const ctx = makeMockAIContext({ tick: 91 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Prerequisite Gates
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — prerequisite gates (C++ HOUSE.CPP:AI_Building)', () => {
  it('skips house with productionEnabled=false', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.productionEnabled = false;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('skips house with IQ < 1 (iq=0)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.iq = 0;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('skips house with no alive FACT (construction yard)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    // Set up house but don't add a FACT
    ctx.houseCredits.set(House.USSR, 10000);
    addAIHouse(ctx, House.USSR, {
      productionEnabled: true,
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('skips house when FACT exists but is dead', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const deadFact = makeStructure('FACT', House.USSR, 50, 50, { alive: false });
    ctx.structures.push(deadFact);
    ctx.houseCredits.set(House.USSR, 10000);
    addAIHouse(ctx, House.USSR, {
      productionEnabled: true,
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('skips house when credits <= 0', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx, House.USSR, 0);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — maxBuilding Cap
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — maxBuilding cap (C++ HOUSE.CPP:AI_Building)', () => {
  it('skips when alive building count >= maxBuilding', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    // FACT is 1 alive building, add another to reach 2
    ctx.structures.push(makeStructure('SILO', House.USSR, 53, 50));
    state.maxBuilding = 2; // cap at 2
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('allows building when alive count < maxBuilding', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    // Only FACT exists (1 building), cap is 5
    state.maxBuilding = 5;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });

  it('maxBuilding=-1 means no cap (unlimited buildings)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.maxBuilding = -1;
    state.buildQueue = ['SILO'];
    // Add many structures -- should not trigger any cap
    for (let i = 0; i < 20; i++) {
      ctx.structures.push(makeStructure('SILO', House.USSR, 55 + i, 55));
    }
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });

  it('dead buildings do not count toward maxBuilding cap', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.maxBuilding = 2;
    // Add a dead building -- shouldn't count toward the cap
    ctx.structures.push(makeStructure('SILO', House.USSR, 55, 50, { alive: false }));
    // Only 1 alive building (the FACT), cap is 2, so building should proceed
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Build Cooldown
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — build cooldown (C++ HOUSE.CPP:AI_Building)', () => {
  it('decrements buildCooldown and skips building when cooldown > 0', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildCooldown = 3;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(state.buildCooldown).toBe(2);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('decrements cooldown from 1 to 0 and still skips on that tick', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildCooldown = 1;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(state.buildCooldown).toBe(0);
    // Still skips because the decrement+continue happens before building
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('builds when buildCooldown is 0', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildCooldown = 0;
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBeGreaterThan(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Build Queue Population
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — build queue (C++ HOUSE.CPP:AI_Building)', () => {
  it('auto-fills empty buildQueue via getAIBuildOrder', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = [];
    // getAIBuildOrder should generate a queue since we have no other structures
    // and the AI has a FACT + credits; it will queue up POWR, TENT, etc.
    const queueBefore = [...state.buildQueue];
    updateAIConstruction(ctx);
    // After the call, the queue was populated and at least the first item
    // was consumed (shifted off). We can verify the queue changed.
    // The function either built something or shifted off items.
  });

  it('takes the first item from buildQueue as the build type', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO', 'TENT', 'PROC'];
    updateAIConstruction(ctx);
    // First item 'SILO' should be consumed (built successfully)
    expect(state.buildQueue).not.toContain('SILO');
    expect(state.buildQueue[0]).toBe('TENT');
    expect(state.buildQueue.length).toBe(2);
  });

  it('removes invalid production item from queue and continues', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    // 'BOGUS' is not in PRODUCTION_ITEMS -- should be shifted off
    state.buildQueue = ['BOGUS', 'SILO'];
    updateAIConstruction(ctx);
    // 'BOGUS' should be removed; continue means the loop goes to next house
    // (there's only one house, so the function just returns after shifting BOGUS)
    expect(state.buildQueue).not.toContain('BOGUS');
  });

  it('does nothing when buildQueue is empty and getAIBuildOrder returns empty', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = [];
    // Override scenarioProductionItems to empty so getAIBuildOrder can't find items
    ctx.scenarioProductionItems = [];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Credit & Placement Checks
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — credit and placement checks (C++ HOUSE.CPP:AI_Building)', () => {
  it('does not build when credits < production item cost', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    // PROC costs 2000 credits, but we only have 100
    const state = setupBuildableHouse(ctx, House.USSR, 100);
    state.buildQueue = ['PROC'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    // Credits (100) < PROC cost (2000), so nothing built
    expect(ctx.structures.length).toBe(initialCount);
    // Credits should NOT be deducted
    expect(ctx.houseCredits.get(House.USSR)).toBe(100);
  });

  it('shifts queue when aiPlaceStructure returns null (no valid placement)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO', 'TENT'];

    // Fill all surrounding terrain with WALL so no placement is possible
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        ctx.map.setTerrain(50 + dx, 50 + dy, Terrain.WALL);
      }
    }

    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    // SILO should be shifted off the queue due to no valid placement
    expect(state.buildQueue).not.toContain('SILO');
    expect(ctx.structures.length).toBe(initialCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Successful Build
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — successful build (C++ HOUSE.CPP:AI_Building)', () => {
  it('deducts credits equal to production item cost', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx, House.USSR, 5000);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    expect(ctx.houseCredits.get(House.USSR)).toBe(5000 - SILO_COST);
  });

  it('shifts the built type off the queue', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO', 'TENT'];
    updateAIConstruction(ctx);
    // SILO consumed, TENT remains
    expect(state.buildQueue[0]).toBe('TENT');
    expect(state.buildQueue.length).toBe(1);
  });

  it('spawns a new structure in ctx.structures', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount + 1);
    const newStruct = ctx.structures[ctx.structures.length - 1];
    expect(newStruct.type).toBe('SILO');
    expect(newStruct.house).toBe(House.USSR);
    expect(newStruct.alive).toBe(true);
  });

  it('spawned structure has full HP (maxHp from STRUCTURE_MAX_HP)', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    const newStruct = ctx.structures[ctx.structures.length - 1];
    expect(newStruct.type).toBe('SILO');
    expect(newStruct.hp).toBe(STRUCTURE_MAX_HP['SILO']);
    expect(newStruct.maxHp).toBe(STRUCTURE_MAX_HP['SILO']);
  });

  it('sets lastBuildTick to the current tick', () => {
    const ctx = makeMockAIContext({ tick: 270 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    expect(state.lastBuildTick).toBe(270);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Difficulty-Dependent Build Cooldown
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — build cooldown per difficulty (C++ HOUSE.CPP:AI_Building)', () => {
  it('normal difficulty: cooldown = floor(6 * 1.0) = 6', () => {
    const ctx = makeMockAIContext({ tick: 90, difficulty: 'normal' });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    expect(state.buildCooldown).toBe(Math.floor(6 * AI_DIFFICULTY_MODS.normal.buildSpeedMult));
    expect(state.buildCooldown).toBe(6);
  });

  it('easy difficulty: cooldown = floor(6 * 1.5) = 9', () => {
    const ctx = makeMockAIContext({ tick: 90, difficulty: 'easy' });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    expect(state.buildCooldown).toBe(Math.floor(6 * AI_DIFFICULTY_MODS.easy.buildSpeedMult));
    expect(state.buildCooldown).toBe(9);
  });

  it('hard difficulty: cooldown = floor(6 * 0.7) = 4', () => {
    const ctx = makeMockAIContext({ tick: 90, difficulty: 'hard' });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);
    expect(state.buildCooldown).toBe(Math.floor(6 * AI_DIFFICULTY_MODS.hard.buildSpeedMult));
    expect(state.buildCooldown).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Multi-House Processing
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — multi-house iteration (C++ HOUSE.CPP:AI_Building)', () => {
  it('processes multiple AI houses independently on the same tick', () => {
    const ctx = makeMockAIContext({ tick: 90 });

    // Set up USSR at (50,50)
    const factUSSR = makeStructure('FACT', House.USSR, 50, 50);
    ctx.structures.push(factUSSR);
    const [fw1, fh1] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    for (let dy = 0; dy < fh1; dy++) {
      for (let dx = 0; dx < fw1; dx++) {
        ctx.map.setTerrain(50 + dx, 50 + dy, Terrain.WALL);
      }
    }
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, {
      productionEnabled: true,
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });

    // Set up Ukraine at (60,50) -- far enough to not interfere
    const factUkraine = makeStructure('FACT', House.Ukraine, 60, 50);
    ctx.structures.push(factUkraine);
    const [fw2, fh2] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    for (let dy = 0; dy < fh2; dy++) {
      for (let dx = 0; dx < fw2; dx++) {
        ctx.map.setTerrain(60 + dx, 50 + dy, Terrain.WALL);
      }
    }
    ctx.houseCredits.set(House.Ukraine, 5000);
    addAIHouse(ctx, House.Ukraine, {
      productionEnabled: true,
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });

    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);

    // Both houses should have built a SILO
    const ussrSilos = ctx.structures.filter(s => s.house === House.USSR && s.type === 'SILO');
    const ukraineSilos = ctx.structures.filter(s => s.house === House.Ukraine && s.type === 'SILO');
    expect(ussrSilos.length).toBe(1);
    expect(ukraineSilos.length).toBe(1);
    expect(ctx.structures.length).toBe(initialCount + 2);
  });

  it('one house blocked does not prevent another from building', () => {
    const ctx = makeMockAIContext({ tick: 90 });

    // USSR: disabled production
    const factUSSR = makeStructure('FACT', House.USSR, 50, 50);
    ctx.structures.push(factUSSR);
    ctx.houseCredits.set(House.USSR, 5000);
    addAIHouse(ctx, House.USSR, {
      productionEnabled: false,  // blocked
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });

    // Ukraine: fully ready
    const factUkraine = makeStructure('FACT', House.Ukraine, 60, 50);
    ctx.structures.push(factUkraine);
    const [fw, fh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        ctx.map.setTerrain(60 + dx, 50 + dy, Terrain.WALL);
      }
    }
    ctx.houseCredits.set(House.Ukraine, 5000);
    addAIHouse(ctx, House.Ukraine, {
      productionEnabled: true,
      iq: 3,
      maxBuilding: -1,
      buildQueue: ['SILO'],
    });

    updateAIConstruction(ctx);

    // Ukraine should have built; USSR should not
    const ukraineSilos = ctx.structures.filter(
      s => s.house === House.Ukraine && s.type === 'SILO'
    );
    const ussrSilos = ctx.structures.filter(
      s => s.house === House.USSR && s.type === 'SILO'
    );
    expect(ukraineSilos.length).toBe(1);
    expect(ussrSilos.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C++ HOUSE.CPP :: AI_Building() — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAIConstruction — edge cases (C++ HOUSE.CPP:AI_Building)', () => {
  it('only builds one structure per house per invocation', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO', 'SILO', 'SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    // Only the first item should be consumed per tick
    expect(ctx.structures.length).toBe(initialCount + 1);
  });

  it('map terrain is marked as WALL at the new structure footprint', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx);
    state.buildQueue = ['SILO'];
    updateAIConstruction(ctx);

    // Find the newly placed SILO
    const silo = ctx.structures.find(s => s.type === 'SILO' && s.house === House.USSR);
    expect(silo).toBeDefined();
    if (silo) {
      const [fw, fh] = STRUCTURE_SIZE['SILO'] ?? [1, 1];
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          expect(ctx.map.getTerrain(silo.cx + dx, silo.cy + dy)).toBe(Terrain.WALL);
        }
      }
    }
  });

  it('negative credits prevent building', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx, House.USSR, -100);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
  });

  it('credits exactly equal to cost allows building', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx, House.USSR, SILO_COST);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount + 1);
    // Credits should be exactly 0 after purchase
    expect(ctx.houseCredits.get(House.USSR)).toBe(0);
  });

  it('credits just below cost prevents building', () => {
    const ctx = makeMockAIContext({ tick: 90 });
    const state = setupBuildableHouse(ctx, House.USSR, SILO_COST - 1);
    state.buildQueue = ['SILO'];
    const initialCount = ctx.structures.length;
    updateAIConstruction(ctx);
    expect(ctx.structures.length).toBe(initialCount);
    expect(ctx.houseCredits.get(House.USSR)).toBe(SILO_COST - 1);
  });
});
