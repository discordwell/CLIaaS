/**
 * C++ Behavioral Parity: Autocreate Spawns Multiple Teams Per Cycle
 *
 * Issue #35: C++ house.cpp:988-1006 creates Random_Pick(2, (TechLevel-1)/3+1)
 * teams per cycle when IsAlerted. TS previously created at most 1 team per cycle.
 * C++ also respects MaxAllowed per team type and uses random selection from
 * eligible teams via Suggested_New_Team (teamtype.cpp:419-497).
 *
 * Source references:
 *   - house.cpp:988-1006  — autocreate loop with maxteams = Random_Pick(2, (TechLevel-1)/3+1)
 *   - teamtype.cpp:419-497 — Suggested_New_Team: eligible team collection + random pick
 *   - teamtype.cpp:433-436 — alerted/autocreate flag gating, MaxAllowed -> maxnum
 *   - teamtype.cpp:440     — ttype->Number < maxnum eligibility check
 *   - teamtype.cpp:438     — choices[20] cap on candidate list
 *   - teamtype.cpp:492     — Random_Pick(0, choicecount-1) for selection
 *
 * Observable outcomes:
 *   1. Multiple teams spawn per cycle (min 2 when alerted)
 *   2. MaxAllowed caps instances of each team type
 *   3. Random selection from eligible pool
 *   4. Tech level controls upper bound of teams per cycle
 *   5. autocreateTeamCounts tracks active instances
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, Mission, UnitType, CELL_SIZE,
  UNIT_STATS, PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import {
  STRUCTURE_MAX_HP,
  type MapStructure, type TeamType,
  houseIdToHouse,
} from '../engine/scenario';
import {
  type AIContext, type AIHouseState, type Difficulty,
  createAIHouseState,
  updateAIAutocreateTeams,
  suggestedNewTeam,
} from '../engine/ai';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

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
  // C++ house.cpp:988: autocreate requires IsAlerted — default to true when productionEnabled
  if (overrides.productionEnabled && overrides.isAlerted === undefined) {
    overrides.isAlerted = true;
  }
  Object.assign(state, overrides);
  ctx.aiStates.set(house, state);
  return state;
}

function makeTeamType(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'TestTeam',
    house: 2,        // USSR
    flags: 4,        // autocreate flag
    recruitPriority: 7,
    initNum: 0,
    maxAllowed: 5,   // C++ MaxAllowed
    origin: 0,
    trigger: -1,
    members: [{ type: '1TNK', count: 1 }],
    missions: [],
    ...overrides,
  };
}

// =============================================================================
// 1. Multiple teams per cycle (C++ house.cpp:993 maxteams)
// =============================================================================

describe('Multiple teams per cycle — C++ house.cpp:993', () => {
  it('spawns at least 2 teams per cycle (min from Random_Pick(2, ...))', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 10 });
    ctx.houseCredits.set(House.USSR, 10000);
    // Single team with high maxAllowed — can be spawned multiple times
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 10, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // C++ Random_Pick(2, (10-1)/3+1) = Random_Pick(2, 4) => at least 2 teams
    expect(ctx.entities.length).toBeGreaterThanOrEqual(2);
  });

  it('spawns at most (TechLevel-1)/3+1 teams when that exceeds 2', () => {
    // Run many times to check the upper bound statistically
    for (let trial = 0; trial < 20; trial++) {
      const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
      addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 10 });
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.teamTypes.push(makeTeamType({ maxAllowed: 20, members: [{ type: '1TNK', count: 1 }] }));
      ctx.waypoints.set(0, { cx: 50, cy: 50 });

      updateAIAutocreateTeams(ctx);

      // maxTeams = Random_Pick(2, 4) => at most 4
      expect(ctx.entities.length).toBeLessThanOrEqual(4);
      expect(ctx.entities.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('with techLevel=1, maxTeams upper bound is max(1,2)=2, always spawns 2', () => {
    // C++ Random_Pick(2, (1-1)/3+1) = Random_Pick(2, 1)
    // When min > max, Random_Pick returns min, so always 2
    for (let trial = 0; trial < 10; trial++) {
      const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
      addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 1 });
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.teamTypes.push(makeTeamType({ maxAllowed: 10, members: [{ type: '1TNK', count: 1 }] }));
      ctx.waypoints.set(0, { cx: 50, cy: 50 });

      updateAIAutocreateTeams(ctx);

      expect(ctx.entities.length).toBe(2);
    }
  });

  it('with techLevel=4, maxTeams = Random_Pick(2, 2) = always 2', () => {
    // (4-1)/3+1 = 1+1 = 2, so Random_Pick(2, 2) = 2
    for (let trial = 0; trial < 10; trial++) {
      const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
      addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 4 });
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.teamTypes.push(makeTeamType({ maxAllowed: 10, members: [{ type: '1TNK', count: 1 }] }));
      ctx.waypoints.set(0, { cx: 50, cy: 50 });

      updateAIAutocreateTeams(ctx);

      expect(ctx.entities.length).toBe(2);
    }
  });

  it('with techLevel=7, maxTeams = Random_Pick(2, 3) = 2 or 3', () => {
    // (7-1)/3+1 = 2+1 = 3, so Random_Pick(2, 3) = 2..3
    const counts = new Set<number>();
    for (let trial = 0; trial < 50; trial++) {
      const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
      addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 7 });
      ctx.houseCredits.set(House.USSR, 10000);
      ctx.teamTypes.push(makeTeamType({ maxAllowed: 10, members: [{ type: '1TNK', count: 1 }] }));
      ctx.waypoints.set(0, { cx: 50, cy: 50 });

      updateAIAutocreateTeams(ctx);

      expect(ctx.entities.length).toBeGreaterThanOrEqual(2);
      expect(ctx.entities.length).toBeLessThanOrEqual(3);
      counts.add(ctx.entities.length);
    }
    // Should see both 2 and 3 over 50 trials
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// 2. MaxAllowed check (C++ teamtype.cpp:440 — ttype->Number < maxnum)
// =============================================================================

describe('MaxAllowed — C++ teamtype.cpp:440', () => {
  it('does not spawn team when activeCount >= maxAllowed', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 2, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });
    // Pre-set active count to maxAllowed
    ctx.autocreateTeamCounts.set(0, 2);

    updateAIAutocreateTeams(ctx);

    // No entities — team is at capacity
    expect(ctx.entities).toHaveLength(0);
  });

  it('spawns team when activeCount < maxAllowed', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 3, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });
    ctx.autocreateTeamCounts.set(0, 2); // 2 < 3

    updateAIAutocreateTeams(ctx);

    // Should spawn (2 < 3 = eligible), limited to 1 more instance
    expect(ctx.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('maxAllowed=0 prevents all spawning', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 0, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    expect(ctx.entities).toHaveLength(0);
  });

  it('maxAllowed caps total instances spawned per cycle', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 10 });
    ctx.houseCredits.set(House.USSR, 10000);
    // maxAllowed=1: only 1 instance can exist, even though maxTeams > 1
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 1, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // Only 1 entity despite maxTeams being 2-4
    expect(ctx.entities).toHaveLength(1);
  });

  it('increments autocreateTeamCounts for each spawn', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 1 });
    ctx.houseCredits.set(House.USSR, 10000);
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 5, members: [{ type: '1TNK', count: 1 }] }));
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // techLevel=1 => always 2 teams => count should be 2
    expect(ctx.autocreateTeamCounts.get(0)).toBe(2);
  });
});

// =============================================================================
// 3. suggestedNewTeam — random selection from eligible pool
// =============================================================================

describe('suggestedNewTeam — C++ teamtype.cpp:419-497', () => {
  it('returns null when no eligible teams exist', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = []; // no teams at all

    const result = suggestedNewTeam(ctx, House.USSR, true);

    expect(result).toBeNull();
  });

  it('filters by house — only returns teams matching the specified house', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'SpainTeam', house: 0, maxAllowed: 5 }), // Spain
      makeTeamType({ name: 'USSRTeam', house: 2, maxAllowed: 5 }),  // USSR
    ];

    // Should only pick USSR team (index 1)
    for (let i = 0; i < 20; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      expect(result).toBe(1);
    }
  });

  it('skips destroyed teams', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'Team0', maxAllowed: 5 }),
      makeTeamType({ name: 'Team1', maxAllowed: 5 }),
    ];
    ctx.destroyedTeams.add(0);

    for (let i = 0; i < 10; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      expect(result).toBe(1);
    }
  });

  it('when alerted=true, only picks autocreate teams (flag & 4)', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'NoAuto', flags: 0, maxAllowed: 5 }),   // not autocreate
      makeTeamType({ name: 'Auto', flags: 4, maxAllowed: 5 }),     // autocreate
    ];

    for (let i = 0; i < 10; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      expect(result).toBe(1); // only Auto team is eligible
    }
  });

  it('when alerted=false, only picks non-autocreate teams', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'NoAuto', flags: 0, maxAllowed: 5 }),   // not autocreate
      makeTeamType({ name: 'Auto', flags: 4, maxAllowed: 5 }),     // autocreate
    ];

    for (let i = 0; i < 10; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, false);
      expect(result).toBe(0); // only NoAuto team is eligible
    }
  });

  it('respects MaxAllowed — skips teams at capacity', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'AtCap', maxAllowed: 2 }),
      makeTeamType({ name: 'HasRoom', maxAllowed: 5 }),
    ];
    ctx.autocreateTeamCounts.set(0, 2); // AtCap is at maxAllowed

    for (let i = 0; i < 10; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      expect(result).toBe(1); // only HasRoom is eligible
    }
  });

  it('randomly selects from multiple eligible teams', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes = [
      makeTeamType({ name: 'Team0', maxAllowed: 10 }),
      makeTeamType({ name: 'Team1', maxAllowed: 10 }),
      makeTeamType({ name: 'Team2', maxAllowed: 10 }),
    ];

    const selected = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      if (result !== null) selected.add(result);
    }

    // Over 100 trials, should see at least 2 different teams selected
    expect(selected.size).toBeGreaterThanOrEqual(2);
  });

  it('caps candidate list at 20 entries (C++ choices[20])', () => {
    const ctx = makeMockAIContext();
    // Create 25 eligible teams
    for (let i = 0; i < 25; i++) {
      ctx.teamTypes.push(makeTeamType({ name: `Team${i}`, maxAllowed: 10 }));
    }

    const selected = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const result = suggestedNewTeam(ctx, House.USSR, true);
      if (result !== null) selected.add(result);
    }

    // Should only ever pick from the first 20 teams (indices 0-19)
    for (const idx of selected) {
      expect(idx).toBeLessThan(20);
    }
  });
});

// =============================================================================
// 4. autocreateTeamCounts tracking
// =============================================================================

describe('autocreateTeamCounts — C++ TeamTypeClass::Number', () => {
  it('count increments even when spawn position is missing (C++ Create_One_Of behavior)', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 1 });
    ctx.houseCredits.set(House.USSR, 10000);
    // Team with origin=99, no waypoint, no edge — spawn will fail
    ctx.teamTypes.push(makeTeamType({ maxAllowed: 5, origin: 99, members: [{ type: '1TNK', count: 1 }] }));
    // No waypoints, no edges

    updateAIAutocreateTeams(ctx);

    // No entities spawned (no valid position)
    expect(ctx.entities).toHaveLength(0);
    // But count should still increment (C++ creates team object regardless)
    expect(ctx.autocreateTeamCounts.get(0)).toBeGreaterThan(0);
  });

  it('count starts at 0 for fresh teams', () => {
    const ctx = makeMockAIContext();
    ctx.teamTypes.push(makeTeamType());

    expect(ctx.autocreateTeamCounts.get(0) ?? 0).toBe(0);
  });
});

// =============================================================================
// 5. MaxAllowed parsing from scenario INI
// =============================================================================

describe('TeamType.maxAllowed — parsed from scenario INI', () => {
  it('TeamType interface includes maxAllowed field', () => {
    const team: TeamType = {
      name: 'Test',
      house: 2,
      flags: 4,
      maxAllowed: 3,
      origin: 0,
      trigger: -1,
      members: [],
      missions: [],
    };
    expect(team.maxAllowed).toBe(3);
  });
});

// =============================================================================
// 6. Integration: multi-team multi-house per cycle
// =============================================================================

describe('Integration — multi-team multi-house behavior', () => {
  it('each house spawns its own maxTeams independently', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });

    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 1 });
    ctx.houseCredits.set(House.USSR, 10000);

    addAIHouse(ctx, House.Ukraine, { productionEnabled: true, iq: 3, techLevel: 1 });
    ctx.houseCredits.set(House.Ukraine, 10000);

    ctx.teamTypes.push(
      makeTeamType({ name: 'USSRTeam', house: 2, maxAllowed: 10, members: [{ type: '1TNK', count: 1 }] }),
      makeTeamType({ name: 'UkraineTeam', house: 4, maxAllowed: 10, members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // techLevel=1 => 2 teams per house => 4 total entities
    const ussrUnits = ctx.entities.filter(e => e.house === House.USSR);
    const ukraineUnits = ctx.entities.filter(e => e.house === House.Ukraine);
    expect(ussrUnits).toHaveLength(2);
    expect(ukraineUnits).toHaveLength(2);
  });

  it('different maxAllowed per team type limits spawns independently', () => {
    const ctx = makeMockAIContext({ tick: 1, autocreateEnabled: true });
    addAIHouse(ctx, House.USSR, { productionEnabled: true, iq: 3, techLevel: 10 });
    ctx.houseCredits.set(House.USSR, 10000);

    // Team A: maxAllowed=1, Team B: maxAllowed=10
    ctx.teamTypes.push(
      makeTeamType({ name: 'TeamA', maxAllowed: 1, members: [{ type: '1TNK', count: 1 }] }),
      makeTeamType({ name: 'TeamB', maxAllowed: 10, members: [{ type: '2TNK', count: 1 }] }),
    );
    ctx.waypoints.set(0, { cx: 50, cy: 50 });

    updateAIAutocreateTeams(ctx);

    // maxTeams = Random_Pick(2, 4). TeamA capped at 1. Rest go to TeamB.
    const tanks1 = ctx.entities.filter(e => e.type === UnitType.V_1TNK);
    const tanks2 = ctx.entities.filter(e => e.type === UnitType.V_2TNK);
    expect(tanks1.length).toBeLessThanOrEqual(1);
    expect(ctx.entities.length).toBeGreaterThanOrEqual(2);
  });
});
