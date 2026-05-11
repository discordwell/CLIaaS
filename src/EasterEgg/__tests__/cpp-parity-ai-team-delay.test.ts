/**
 * C++ Behavioral Parity: HouseClass::TeamTime cadence.
 *
 * C++ source:
 *   - rules.cpp:130,429: Rule.TeamDelay defaults/loads from [General] TeamDelay=.6
 *   - fixed.cpp:148, fixed.h:109: fixed(".6") raw=153; fixed*900 rounds to 538
 *   - house.cpp:644: HouseClass constructor seeds TeamTime from Rule.TeamDelay
 *   - house.cpp:1065-1073: non-alerted houses call Suggested_New_Team(false)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { House } from '../engine/types';
import { GameMap } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import { type TeamType } from '../engine/scenario';
import { clearAllTeams, getActiveTeams } from '../engine/team';
import {
  type AIContext,
  CPP_TEAM_DELAY_TICKS,
  aiPerTick,
  createAIHouseState,
} from '../engine/ai';

function makeTeamType(name: string): TeamType {
  return {
    name,
    house: 2, // USSR
    flags: 0, // non-autocreate; eligible for Suggested_New_Team(false)
    maxAllowed: 5,
    origin: 0,
    trigger: -1,
    members: [{ type: 'E1', count: 1 }],
    missions: [],
  };
}

function makeAIContext(teamTypes: TeamType[]): AIContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    map: new GameMap(),
    tick: 0,
    playerHouse: House.Greece,
    scenarioId: 'SCG02EA',
    difficulty: 'normal',
    aiStates: new Map(),
    houseCredits: new Map(),
    houseIQs: new Map([[House.USSR, 0]]),
    houseTechLevels: new Map([[House.USSR, 2]]),
    houseMaxUnits: new Map(),
    houseMaxInfantry: new Map(),
    houseMaxBuildings: new Map(),
    baseBlueprint: [],
    baseRebuildQueue: [],
    baseRebuildCooldown: 0,
    scenarioProductionItems: [],
    scenarioUnitStats: {},
    scenarioWeaponStats: {},
    nextWaveId: 0,
    autocreateEnabled: false,
    teamTypes,
    activeTeams: getActiveTeams(),
    destroyedTeams: new Set(),
    autocreateTeamCounts: new Map(),
    waypoints: new Map(),
    houseEdges: new Map(),
    effects: [],
    isAllied: (a, b) => a === b,
    isPlayerControlled: (entity) => entity.house === House.Greece,
    clearStructureFootprint: () => {},
  };
}

describe('HouseClass::TeamTime — non-alerted Suggested_New_Team cadence', () => {
  beforeEach(() => {
    clearAllTeams();
  });

  it('uses Rule.TeamDelay=.6 fixed-point timing, not AutocreateTime=5 minutes', () => {
    const ctx = makeAIContext([
      makeTeamType('NonAlertedA'),
      makeTeamType('NonAlertedB'),
    ]);
    const state = createAIHouseState(ctx, House.USSR);
    ctx.aiStates.set(House.USSR, state);

    expect(CPP_TEAM_DELAY_TICKS).toBe(538);

    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      tagLogging: ScenarioRandom._tagLogging,
      sourceTag: ScenarioRandom._sourceTag,
      entityTag: ScenarioRandom._entityTag,
      seedLog: ScenarioRandom._seedLog,
      taggedLog: ScenarioRandom._taggedLog,
    };

    try {
      ScenarioRandom.seed = 0x12345678;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._entityTag = 0;
      ScenarioRandom._seedLog = [];
      ScenarioRandom._taggedLog = [];

      for (let tick = 1; tick <= CPP_TEAM_DELAY_TICKS; tick++) {
        ctx.tick = tick;
        aiPerTick(ctx);
      }
      expect(ScenarioRandom._seedLog.some(([, tag]) => tag === 103)).toBe(false);

      ctx.tick = CPP_TEAM_DELAY_TICKS + 1;
      aiPerTick(ctx);

      const teamTimeCalls = ScenarioRandom._seedLog.filter(([, tag]) => tag === 103);
      expect(teamTimeCalls).toHaveLength(1);
      expect(state.teamTimer).toBe(CPP_TEAM_DELAY_TICKS);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._entityTag = saved.entityTag;
      ScenarioRandom._seedLog = saved.seedLog;
      ScenarioRandom._taggedLog = saved.taggedLog;
    }
  });

  it('Create_One_Of registers an empty TeamClass and blocks later MaxAllowed picks', () => {
    const ctx = makeAIContext([
      { ...makeTeamType('NonAlertedA'), maxAllowed: 1 },
      { ...makeTeamType('NonAlertedB'), maxAllowed: 1 },
    ]);
    const state = createAIHouseState(ctx, House.USSR);
    state.teamTimer = 1;
    ctx.aiStates.set(House.USSR, state);

    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      tagLogging: ScenarioRandom._tagLogging,
      sourceTag: ScenarioRandom._sourceTag,
      entityTag: ScenarioRandom._entityTag,
      seedLog: ScenarioRandom._seedLog,
      taggedLog: ScenarioRandom._taggedLog,
    };

    try {
      ScenarioRandom.seed = 0x12345678;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._tagLogging = true;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._entityTag = 0;
      ScenarioRandom._seedLog = [];
      ScenarioRandom._taggedLog = [];

      ctx.tick = 1;
      aiPerTick(ctx);

      expect(ScenarioRandom._seedLog.filter(([, tag]) => tag === 103)).toHaveLength(1);
      expect(getActiveTeams()).toHaveLength(1);
      expect(getActiveTeams()[0].total).toBe(0);
      expect(ctx.entities).toHaveLength(0);

      ScenarioRandom._seedLog = [];
      ScenarioRandom._taggedLog = [];
      state.teamTimer = 1;
      ctx.tick = 2;
      aiPerTick(ctx);

      expect(ScenarioRandom._seedLog.filter(([, tag]) => tag === 103)).toHaveLength(0);
      expect(getActiveTeams()).toHaveLength(2);

      ScenarioRandom._seedLog = [];
      ScenarioRandom._taggedLog = [];
      state.teamTimer = 1;
      ctx.tick = 3;
      aiPerTick(ctx);

      expect(ScenarioRandom._seedLog.filter(([, tag]) => tag === 103)).toHaveLength(0);
      expect(getActiveTeams()).toHaveLength(2);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._tagLogging = saved.tagLogging;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._entityTag = saved.entityTag;
      ScenarioRandom._seedLog = saved.seedLog;
      ScenarioRandom._taggedLog = saved.taggedLog;
    }
  });
});
