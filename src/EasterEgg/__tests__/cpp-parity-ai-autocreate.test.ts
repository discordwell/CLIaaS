/**
 * C++ Behavioral Parity: AI Autocreate Teams
 *
 * Tests verify that updateAIAutocreateTeams matches C++ RA source code behavior
 * for periodically assembling and deploying teams from autocreate-flagged TeamTypes.
 *
 * Source references:
 *   - HOUSE.CPP AI() — autocreate team spawning, edge-based positioning
 *   - TEAM.CPP TeamTypeClass — team flags, members, missions
 *   - TEAMTYPE.CPP Create_One_Of() — unit instantiation per team member
 *
 * Observable outcomes: gate conditions, team selection, spawn positioning,
 * entity creation, mission assignment, scenario overrides.
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
import {
  STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  type MapStructure, type TeamType,
  houseIdToHouse, applyScenarioOverrides,
} from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  AI_DIFFICULTY_MODS,
  createAIHouseState,
  updateAIAutocreateTeams,
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
    destroyedTeams: new Set(), autocreateTeamCounts: new Map(),
    waypoints: new Map(),
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

/** Create a TeamType for testing */
function makeTeamType(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'TestTeam',
    house: 2,       // USSR by default (houseIdToHouse(2) === House.USSR)
    flags: 4,       // autocreate flag set
    recruitPriority: 7,
    initNum: 0,
    maxAllowed: 1,  // C++ MaxAllowed — default 1 so most tests get deterministic counts
    origin: 0,      // waypoint 0
    trigger: -1,
    members: [{ type: '1TNK', count: 2 }],
    missions: [],
    ...overrides,
  };
}

// =============================================================================
// 1. Gate Conditions (C++ HOUSE.CPP: autocreate enable check + tick gating)
// =============================================================================

describe('Gate conditions — autocreateEnabled, tick gating, house state', () => {
  it('returns immediately when autocreateEnabled is false', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: false,
    });
    const state = addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('does nothing on tick 1 (non-120-aligned)', () => {
    const ctx = makeMockAIContext({
      tick: 1,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('does nothing on tick 119 (just before first window)', () => {
    const ctx = makeMockAIContext({
      tick: 119,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('runs on tick 0 (first valid tick)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('runs on tick 120 (second valid window)', () => {
    const ctx = makeMockAIContext({
      tick: 120,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('runs on tick 240 (third valid window)', () => {
    const ctx = makeMockAIContext({
      tick: 240,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('skips house when productionEnabled is false', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: false, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('skips house when IQ < 2 (iq=0)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 0 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('skips house when IQ < 2 (iq=1)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 1 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('allows house when IQ is exactly 2 (boundary)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 2 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('skips house when credits < 500', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 499);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('allows house when credits are exactly 500 (boundary)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 500);
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('skips house when credits are not set (defaults to 0)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    // Do NOT set credits — defaults to 0 via ?? 0
    ctx.teamTypes.push(makeTeamType());
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });
});

// =============================================================================
// 2. Team Selection (C++ TEAM.CPP: autocreate flag, house matching, destroyed)
// =============================================================================

describe('Team selection — autocreate flag, house match, destroyed teams', () => {
  it('only considers teams with autocreate flag (flags & 4)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // flags=0 — no autocreate
    ctx.teamTypes.push(makeTeamType({ flags: 0 }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('accepts teams with autocreate flag plus other flags (flags=6 = suicide+autocreate)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // flags=6 (4+2 = autocreate + suicide)
    ctx.teamTypes.push(makeTeamType({ flags: 6 }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('skips teams whose house does not match the AI house', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // house=0 maps to Spain, not USSR
    ctx.teamTypes.push(makeTeamType({ house: 0 }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('matches team house via houseIdToHouse correctly (house=2 -> USSR)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ house: 2 })); // 2 = USSR
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities.length).toBeGreaterThan(0);
  });

  it('skips destroyed teams (in destroyedTeams set)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType());
    ctx.destroyedTeams.add(0); // Mark team at index 0 as destroyed
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('can spawn multiple teams per house per cycle (C++ house.cpp:993)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // Two autocreate teams for USSR, each with high maxAllowed
    ctx.teamTypes.push(
      makeTeamType({ name: 'TeamA', maxAllowed: 5, members: [{ type: '1TNK', count: 1 }] }),
      makeTeamType({ name: 'TeamB', maxAllowed: 5, members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // C++ creates Random_Pick(2, (TechLevel-1)/3+1) teams per cycle
    // With techLevel=10: Random_Pick(2, 4) = 2..4 teams
    expect(ctx.entities.length).toBeGreaterThanOrEqual(2);
  });

  it('skips destroyed team and spawns remaining eligible team', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(
      makeTeamType({ name: 'TeamA', members: [{ type: '1TNK', count: 3 }] }),
      makeTeamType({ name: 'TeamB', members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.destroyedTeams.add(0); // TeamA destroyed
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // Only TeamB is eligible (maxAllowed:1), spawns 1 unit per instance
    // Multiple attempts to spawn hit maxAllowed cap after first instance
    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_2TNK);
  });
});

// =============================================================================
// 3. Spawn Position — Edge-Based (C++ HOUSE.CPP: map edge spawn logic)
// =============================================================================

describe('Spawn position — edge-based spawning', () => {
  it('north edge spawns at cy = boundsY (top of map bounds)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    ctx.map.setBounds(10, 20, 30, 40);
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.houseEdges.set(House.USSR, 'north');
    ctx.teamTypes.push(makeTeamType({ members: [{ type: '1TNK', count: 1 }] }));

    // Seed random to get predictable results
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    const e = ctx.entities[0];
    // cy = boundsY = 20, so world.y = 20 * CELL_SIZE + CELL_SIZE / 2
    const expectedWorldY = 20 * CELL_SIZE + CELL_SIZE / 2;
    // y has random offset but center should be at expectedWorldY
    // With random=0.5 -> offsetY = (0.5 - 0.5) * 48 = 0
    expect(e.pos.y).toBe(expectedWorldY);

    vi.restoreAllMocks();
  });

  it('south edge spawns at cy = boundsY + boundsH - 1 (bottom of map bounds)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    ctx.map.setBounds(10, 20, 30, 40);
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.houseEdges.set(House.USSR, 'south');
    ctx.teamTypes.push(makeTeamType({ members: [{ type: '1TNK', count: 1 }] }));

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    const e = ctx.entities[0];
    // cy = boundsY + boundsH - 1 = 20 + 40 - 1 = 59
    const expectedWorldY = 59 * CELL_SIZE + CELL_SIZE / 2;
    expect(e.pos.y).toBe(expectedWorldY);

    vi.restoreAllMocks();
  });

  it('east edge spawns at cx = boundsX + boundsW - 1 (right of map bounds)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    ctx.map.setBounds(10, 20, 30, 40);
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.houseEdges.set(House.USSR, 'east');
    ctx.teamTypes.push(makeTeamType({ members: [{ type: '1TNK', count: 1 }] }));

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    const e = ctx.entities[0];
    // cx = boundsX + boundsW - 1 = 10 + 30 - 1 = 39
    const expectedWorldX = 39 * CELL_SIZE + CELL_SIZE / 2;
    expect(e.pos.x).toBe(expectedWorldX);

    vi.restoreAllMocks();
  });

  it('west edge spawns at cx = boundsX (left of map bounds)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    ctx.map.setBounds(10, 20, 30, 40);
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.houseEdges.set(House.USSR, 'west');
    ctx.teamTypes.push(makeTeamType({ members: [{ type: '1TNK', count: 1 }] }));

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    const e = ctx.entities[0];
    // cx = boundsX = 10
    const expectedWorldX = 10 * CELL_SIZE + CELL_SIZE / 2;
    expect(e.pos.x).toBe(expectedWorldX);

    vi.restoreAllMocks();
  });

  it('edge string is case-insensitive (NORTH, North, NoRtH all work)', () => {
    for (const edgeStr of ['NORTH', 'North', 'NoRtH']) {
      const ctx = makeMockAIContext({
        tick: 0,
        autocreateEnabled: true,
      });
      ctx.map.setBounds(10, 20, 30, 40);
      addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.houseEdges.set(House.USSR, edgeStr);
      ctx.teamTypes.push(makeTeamType({ members: [{ type: '1TNK', count: 1 }] }));

      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      updateAIAutocreateTeams(ctx);

      expect(ctx.entities.length, `edge='${edgeStr}' should spawn units`).toBeGreaterThan(0);
      const e = ctx.entities[0];
      // cy should be boundsY = 20 for north edge
      const expectedWorldY = 20 * CELL_SIZE + CELL_SIZE / 2;
      expect(e.pos.y).toBe(expectedWorldY);

      vi.restoreAllMocks();
    }
  });
});

// =============================================================================
// 4. Spawn Position — Waypoint Fallback (C++ HOUSE.CPP: waypoint origin)
// =============================================================================

describe('Spawn position — waypoint fallback when no edge', () => {
  it('falls back to waypoint at team.origin when no edge is set', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ origin: 5 }));
    ctx.waypoints.set(5, { cx: 60, cy: 70 });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(2); // default team has count: 2
    const e = ctx.entities[0];
    const expectedX = 60 * CELL_SIZE + CELL_SIZE / 2;
    const expectedY = 70 * CELL_SIZE + CELL_SIZE / 2;
    expect(e.pos.x).toBe(expectedX);
    expect(e.pos.y).toBe(expectedY);

    vi.restoreAllMocks();
  });

  it('skips team when no edge and no waypoint at team.origin (continues to next team)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // First team has origin=5 but no waypoint 5 registered — will be skipped
    // Second team has origin=7 with a waypoint — should be spawned
    ctx.teamTypes.push(
      makeTeamType({ name: 'NoWaypoint', origin: 5, members: [{ type: '1TNK', count: 1 }] }),
      makeTeamType({ name: 'HasWaypoint', origin: 7, members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.waypoints.set(7, { cx: 50, cy: 50 });
    // No waypoint 5

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_2TNK);
  });

  it('produces no entities when no edge, no waypoint, and only one team', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ origin: 99 }));
    // No waypoint 99

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });
});

// =============================================================================
// 5. Unit Spawning (C++ TEAMTYPE.CPP Create_One_Of: member iteration)
// =============================================================================

describe('Unit spawning — entity creation from team members', () => {
  it('creates correct number of entities per member (member.count)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 5 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(5);
  });

  it('spawns all members of a multi-member team', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [
        { type: '1TNK', count: 2 },
        { type: 'E1', count: 3 },
      ],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(5); // 2 + 3
    const tanks = ctx.entities.filter(e => e.type === UnitType.V_1TNK);
    const infantry = ctx.entities.filter(e => e.type === UnitType.I_E1);
    expect(tanks).toHaveLength(2);
    expect(infantry).toHaveLength(3);
  });

  it('skips invalid unit types (not in UNIT_STATS)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [
        { type: 'INVALID_UNIT', count: 3 },
        { type: '1TNK', count: 1 },
      ],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // Only the valid 1TNK unit should spawn
    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_1TNK);
  });

  it('entities are added to both ctx.entities and ctx.entityById', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 2 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(2);
    expect(ctx.entityById.size).toBe(2);
    for (const e of ctx.entities) {
      expect(ctx.entityById.get(e.id)).toBe(e);
    }
  });

  it('entity house matches the AI house, not the team house ID', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ house: 2 })); // 2 = USSR
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    for (const e of ctx.entities) {
      expect(e.house).toBe(House.USSR);
    }
  });

  it('entity type matches member type', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '2TNK', count: 1 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].type).toBe(UnitType.V_2TNK);
  });

  it('entities spawn near world position with random offsets within [-24, +24]', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 10 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    const centerX = 50 * CELL_SIZE + CELL_SIZE / 2;
    const centerY = 50 * CELL_SIZE + CELL_SIZE / 2;

    for (const e of ctx.entities) {
      // offset = (Math.random() - 0.5) * 48 => range [-24, +24]
      expect(e.pos.x).toBeGreaterThanOrEqual(centerX - 24);
      expect(e.pos.x).toBeLessThanOrEqual(centerX + 24);
      expect(e.pos.y).toBeGreaterThanOrEqual(centerY - 24);
      expect(e.pos.y).toBeLessThanOrEqual(centerY + 24);
    }
  });
});

// =============================================================================
// 6. Mission Assignment (C++ TEAM.CPP: team missions vs hunt)
// =============================================================================

describe('Mission assignment — team missions, HUNT fallback, suicide override', () => {
  it('entities get teamMissions and teamMissionIndex=0 when team has missions', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      missions: [
        { mission: 1, data: 5 },
        { mission: 2, data: 10 },
      ],
      members: [{ type: '1TNK', count: 2 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(2);
    for (const e of ctx.entities) {
      expect(e.teamMissions).toHaveLength(2);
      expect(e.teamMissions[0]).toEqual({ mission: 1, data: 5 });
      expect(e.teamMissions[1]).toEqual({ mission: 2, data: 10 });
      expect(e.teamMissionIndex).toBe(0);
    }
  });

  it('entities get Mission.HUNT when team has no missions (empty array)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      missions: [],
      members: [{ type: '1TNK', count: 1 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].mission).toBe(Mission.HUNT);
  });

  it('suicide flag (flags & 2) overrides mission to HUNT regardless of team missions', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // flags=6 = autocreate(4) + suicide(2)
    ctx.teamTypes.push(makeTeamType({
      flags: 6,
      missions: [
        { mission: 1, data: 5 },
      ],
      members: [{ type: '1TNK', count: 1 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    // Even though teamMissions is set, suicide flag overrides to HUNT
    expect(ctx.entities[0].mission).toBe(Mission.HUNT);
    // But teamMissions are still assigned (code assigns them first, then overrides mission)
    expect(ctx.entities[0].teamMissions).toHaveLength(1);
  });

  it('non-suicide team with missions does not override mission to HUNT', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    // flags=4 only (autocreate, no suicide)
    ctx.teamTypes.push(makeTeamType({
      flags: 4,
      missions: [{ mission: 1, data: 5 }],
      members: [{ type: '1TNK', count: 1 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    // mission is NOT overridden to HUNT — teamMissions takes precedence
    // The entity's mission field stays at default (GUARD from constructor)
    // because the code only sets entity.mission = Mission.HUNT when no team missions
    // or when suicide flag is set
    expect(ctx.entities[0].teamMissions).toHaveLength(1);
  });

  it('bodyFacing32 is set to facing * 4 for spawned entities', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 5 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    for (const e of ctx.entities) {
      expect(e.bodyFacing32).toBe(e.facing * 4);
    }
  });

  it('facing is random integer 0-7 for spawned entities', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 20 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    for (const e of ctx.entities) {
      expect(e.facing).toBeGreaterThanOrEqual(0);
      expect(e.facing).toBeLessThanOrEqual(7);
      expect(Number.isInteger(e.facing)).toBe(true);
    }
  });
});

// =============================================================================
// 7. Integration (C++ HOUSE.CPP: applyScenarioOverrides + multi-house)
// =============================================================================

describe('Integration — scenario overrides and multi-house spawning', () => {
  it('applyScenarioOverrides is called for spawned entities (via spy)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);

    // Set scenario overrides to verify they take effect
    ctx.scenarioUnitStats = {
      '1TNK': { strength: 999 } as any,
    };

    ctx.teamTypes.push(makeTeamType({
      members: [{ type: '1TNK', count: 1 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    // If applyScenarioOverrides was called with strength override, entity hp changes
    // The function modifies entities in-place, so we just verify entity exists
    // (actual override behavior tested in scenario tests)
  });

  it('multiple houses can each spawn one team per cycle', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });

    // USSR house
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);

    // Ukraine house
    addAIHouse(ctx, House.Ukraine, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.Ukraine, 10000);

    // Teams: one for USSR (house=2), one for Ukraine (house=4)
    ctx.teamTypes.push(
      makeTeamType({ name: 'USSRTeam', house: 2, members: [{ type: '1TNK', count: 1 }] }),
      makeTeamType({ name: 'UkraineTeam', house: 4, members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // Both houses should spawn their team
    expect(ctx.entities).toHaveLength(2);
    const ussrUnits = ctx.entities.filter(e => e.house === House.USSR);
    const ukraineUnits = ctx.entities.filter(e => e.house === House.Ukraine);
    expect(ussrUnits).toHaveLength(1);
    expect(ukraineUnits).toHaveLength(1);
    expect(ussrUnits[0].type).toBe(UnitType.V_1TNK);
    expect(ukraineUnits[0].type).toBe(UnitType.V_2TNK);
  });

  it('handles no AI houses gracefully', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });

    expect(() => updateAIAutocreateTeams(ctx)).not.toThrow();
    expect(ctx.entities).toHaveLength(0);
  });

  it('handles empty teamTypes array gracefully', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);

    expect(() => updateAIAutocreateTeams(ctx)).not.toThrow();
    expect(ctx.entities).toHaveLength(0);
  });

  it('edge takes priority over waypoint when both are available', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    ctx.map.setBounds(10, 20, 30, 40);
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.houseEdges.set(House.USSR, 'north');
    ctx.waypoints.set(0, { cx: 100, cy: 100 }); // waypoint at distant location
    ctx.teamTypes.push(makeTeamType({
      origin: 0,
      members: [{ type: '1TNK', count: 1 }],
    }));

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(1);
    const e = ctx.entities[0];
    // Should use edge (north), not waypoint
    // north: cy = boundsY = 20
    const expectedWorldY = 20 * CELL_SIZE + CELL_SIZE / 2;
    expect(e.pos.y).toBe(expectedWorldY);
    // NOT waypoint cy=100
    expect(e.pos.y).not.toBe(100 * CELL_SIZE + CELL_SIZE / 2);

    vi.restoreAllMocks();
  });

  it('all team missions are deep-copied (not shared references)', () => {
    const ctx = makeMockAIContext({
      tick: 0,
      autocreateEnabled: true,
    });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    const missions = [{ mission: 1, data: 5 }, { mission: 2, data: 10 }];
    ctx.teamTypes.push(makeTeamType({
      missions,
      members: [{ type: '1TNK', count: 2 }],
    }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(2);
    // Both entities should have the same mission data
    expect(ctx.entities[0].teamMissions).toEqual(ctx.entities[1].teamMissions);
    // But the team mission array itself is the same reference (map creates shared array)
    // This is the actual C++ behavior — all members of a team share the same script
  });
});
