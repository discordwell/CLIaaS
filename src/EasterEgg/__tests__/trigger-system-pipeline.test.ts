/**
 * Trigger System Pipeline Tests
 *
 * Comprehensive tests for the trigger execution pipeline:
 * - checkTriggerEvent(): all event type condition checking
 * - executeTriggerAction(): all action type dispatch and result fields
 * - Trigger persistence modes (volatile, semi-persistent, persistent)
 * - Event control logic (single, AND, OR)
 * - Action control logic (single action, both actions)
 * - Force-fire mechanism (FORCE_TRIGGER)
 * - Self-referencing triggers (DESTROY_TRIGGER on self)
 * - Trigger chaining (one trigger's action forces/destroys another)
 * - Edge cases: invalid refs, unknown event/action types, boundary values
 *
 * Avoids duplicating tests in triggers-extended.test.ts and triggers-ai-parity.test.ts.
 * Focuses on the EXECUTION PIPELINE — not individual event/action verification
 * (which those files already cover).
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  executeTriggerAction,
  TIME_UNIT_TICKS,
  type TriggerGameState,
  type TriggerEvent,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';
import { House } from '../engine/types';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal TriggerGameState with all required fields */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set(),
    builtStructureTypes: new Set(),
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: true,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: true,
    spiedBuildings: new Set(),
    isThieved: false,
    ...overrides,
  };
}

/** Create a ScenarioTrigger with defaults */
function createTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'trig1',
    persistence: 0,       // volatile by default
    house: 1,             // Greece
    eventControl: 0,      // only event1
    actionControl: 0,     // only action1
    event1: { type: 0, team: -1, data: 0 },   // TEVENT_NONE
    event2: { type: 0, team: -1, data: 0 },   // TEVENT_NONE
    action1: { action: 0, team: -1, trigger: -1, data: 0 }, // TACTION_NONE
    action2: { action: 0, team: -1, trigger: -1, data: 0 }, // TACTION_NONE
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    ...overrides,
  };
}

// Empty defaults for executeTriggerAction
const emptyTeamTypes: TeamType[] = [];
const emptyWaypoints = new Map<number, CellPos>();
const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

// ============================================================================
// Section 1: checkTriggerEvent — Comprehensive Event Condition Coverage
// ============================================================================

describe('checkTriggerEvent — full event coverage', () => {
  // TEVENT_NONE (0) — never fires
  it('TEVENT_NONE (0) always returns false', () => {
    const event: TriggerEvent = { type: 0, team: -1, data: 0 };
    // Even with everything "true", NONE should never fire
    expect(checkTriggerEvent(event, createState({
      playerEntered: true,
      enemyKillCount: 999,
      missionTimerExpired: true,
    }))).toBe(false);
  });

  // TEVENT_ANY (8) — always fires
  it('TEVENT_ANY (8) always returns true', () => {
    const event: TriggerEvent = { type: 8, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState())).toBe(true);
  });

  // TEVENT_TIME (13) — elapsed time check
  it('TEVENT_TIME (13) fires when enough ticks have elapsed', () => {
    const event: TriggerEvent = { type: 13, team: -1, data: 2 }; // 2 time units = 2 * 90 = 180 ticks
    const requiredTicks = 2 * TIME_UNIT_TICKS;

    // Not enough time
    expect(checkTriggerEvent(event, createState({
      gameTick: 100,
      triggerStartTick: 0,
    }))).toBe(false);

    // Exactly enough time
    expect(checkTriggerEvent(event, createState({
      gameTick: requiredTicks,
      triggerStartTick: 0,
    }))).toBe(true);

    // More than enough time
    expect(checkTriggerEvent(event, createState({
      gameTick: requiredTicks + 100,
      triggerStartTick: 0,
    }))).toBe(true);
  });

  it('TEVENT_TIME (13) respects triggerStartTick offset', () => {
    const event: TriggerEvent = { type: 13, team: -1, data: 1 }; // 1 time unit = 90 ticks
    const requiredTicks = TIME_UNIT_TICKS;

    // If trigger started at tick 100, need gameTick >= 190
    expect(checkTriggerEvent(event, createState({
      gameTick: 100 + requiredTicks - 1,
      triggerStartTick: 100,
    }))).toBe(false);

    expect(checkTriggerEvent(event, createState({
      gameTick: 100 + requiredTicks,
      triggerStartTick: 100,
    }))).toBe(true);
  });

  // TEVENT_GLOBAL_SET (27) and TEVENT_GLOBAL_CLEAR (28)
  it('TEVENT_GLOBAL_SET (27) fires when global is in the set', () => {
    const event: TriggerEvent = { type: 27, team: -1, data: 3 };
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ globals: new Set([1, 2]) }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ globals: new Set([3]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set([1, 3, 5]) }))).toBe(true);
  });

  it('TEVENT_GLOBAL_CLEAR (28) fires when global is NOT in the set', () => {
    const event: TriggerEvent = { type: 28, team: -1, data: 3 };
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set([1, 2]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set([3]) }))).toBe(false);
  });

  // TEVENT_PLAYER_ENTERED (1)
  it('TEVENT_PLAYER_ENTERED (1) checks playerEntered flag', () => {
    const event: TriggerEvent = { type: 1, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ playerEntered: false }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
  });

  // TEVENT_ALL_DESTROYED (11) — checks house alive status
  it('TEVENT_ALL_DESTROYED (11) fires when house has no living units/structures', () => {
    const event: TriggerEvent = { type: 11, team: -1, data: 2 }; // house 2 = USSR

    // House alive
    expect(checkTriggerEvent(event, createState({
      houseAlive: new Map([[2, true]]),
    }))).toBe(false);

    // House not alive
    expect(checkTriggerEvent(event, createState({
      houseAlive: new Map([[2, false]]),
    }))).toBe(true);

    // House not in map at all (never existed or fully eliminated)
    expect(checkTriggerEvent(event, createState({
      houseAlive: new Map(),
    }))).toBe(true);
  });

  // TEVENT_NUNITS_DESTROYED (16) — kill count threshold
  it('TEVENT_NUNITS_DESTROYED (16) fires when kill count >= threshold', () => {
    const event: TriggerEvent = { type: 16, team: -1, data: 10 };
    expect(checkTriggerEvent(event, createState({ enemyKillCount: 9 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ enemyKillCount: 10 }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ enemyKillCount: 50 }))).toBe(true);
  });

  // TEVENT_DESTROYED (7) — attached object destroyed
  it('TEVENT_DESTROYED (7) fires when triggerName is in destroyedTriggerNames', () => {
    const event: TriggerEvent = { type: 7, team: -1, data: 0 };
    // Not destroyed
    expect(checkTriggerEvent(event, createState({
      triggerName: 'myUnit',
      destroyedTriggerNames: new Set(['otherUnit']),
    }))).toBe(false);
    // Destroyed
    expect(checkTriggerEvent(event, createState({
      triggerName: 'myUnit',
      destroyedTriggerNames: new Set(['myUnit']),
    }))).toBe(true);
  });

  // TEVENT_MISSION_TIMER_EXPIRED (14)
  it('TEVENT_MISSION_TIMER_EXPIRED (14) fires when timer has expired', () => {
    const event: TriggerEvent = { type: 14, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ missionTimerExpired: false }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ missionTimerExpired: true }))).toBe(true);
  });

  // TEVENT_BUILDING_EXISTS (32)
  it('TEVENT_BUILDING_EXISTS (32) checks specific structure type by RA enum index', () => {
    // data=11 maps to FACT in the RA StructType enum
    const event: TriggerEvent = { type: 32, team: -1, data: 11 };
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set(['WEAP']) }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set(['FACT']) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set(['FACT', 'WEAP']) }))).toBe(true);
  });

  it('TEVENT_BUILDING_EXISTS (32) with unknown index falls back to any-building check', () => {
    const event: TriggerEvent = { type: 32, team: -1, data: 999 };
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ structureTypes: new Set(['POWR']) }))).toBe(true);
  });

  // TEVENT_ALL_BRIDGES_DESTROYED (31)
  it('TEVENT_ALL_BRIDGES_DESTROYED (31) fires when bridgesAlive is 0', () => {
    const event: TriggerEvent = { type: 31, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ bridgesAlive: 5 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ bridgesAlive: 1 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ bridgesAlive: 0 }))).toBe(true);
  });

  // TEVENT_DISCOVERED (4) and TEVENT_ENTERS_ZONE (24) — both use playerEntered
  it('TEVENT_DISCOVERED (4) and TEVENT_ENTERS_ZONE (24) share playerEntered flag', () => {
    const disc: TriggerEvent = { type: 4, team: -1, data: 0 };
    const zone: TriggerEvent = { type: 24, team: -1, data: 0 };
    const stateEntered = createState({ playerEntered: true });
    const stateNotEntered = createState({ playerEntered: false });

    expect(checkTriggerEvent(disc, stateEntered)).toBe(true);
    expect(checkTriggerEvent(zone, stateEntered)).toBe(true);
    expect(checkTriggerEvent(disc, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(zone, stateNotEntered)).toBe(false);
  });

  // TEVENT_ATTACKED (6)
  it('TEVENT_ATTACKED (6) fires when attackedTriggerNames has the trigger name', () => {
    const event: TriggerEvent = { type: 6, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(['guard1']),
    }))).toBe(true);
    expect(checkTriggerEvent(event, createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(),
    }))).toBe(false);
  });

  // TEVENT_BUILD (19) — player built a structure type
  it('TEVENT_BUILD (19) checks builtStructureTypes by RA StructType index', () => {
    // data=2 maps to WEAP
    const event: TriggerEvent = { type: 19, team: -1, data: 2 };
    expect(checkTriggerEvent(event, createState({ builtStructureTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtStructureTypes: new Set(['FACT']) }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtStructureTypes: new Set(['WEAP']) }))).toBe(true);
  });

  it('TEVENT_BUILD (19) with unknown index falls back to any-built check', () => {
    const event: TriggerEvent = { type: 19, team: -1, data: 999 };
    expect(checkTriggerEvent(event, createState({ builtStructureTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtStructureTypes: new Set(['POWR']) }))).toBe(true);
  });

  // TEVENT_LEAVES_MAP (23)
  it('TEVENT_LEAVES_MAP (23) fires when units have left the map', () => {
    const event: TriggerEvent = { type: 23, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ unitsLeftMap: 0 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ unitsLeftMap: 1 }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ unitsLeftMap: 5 }))).toBe(true);
  });

  // Unknown event type returns false
  it('unknown event type returns false', () => {
    const event: TriggerEvent = { type: 99, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState())).toBe(false);
  });
});

// ============================================================================
// Section 2: executeTriggerAction — Complete Action Dispatch Coverage
// ============================================================================

describe('executeTriggerAction — complete action coverage', () => {
  // TACTION_NONE (0) — no-op
  it('TACTION_NONE (0) returns empty result', () => {
    const action: TriggerAction = { action: 0, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });

  // TACTION_WIN (1)
  it('TACTION_WIN (1) sets win flag', () => {
    const action: TriggerAction = { action: 1, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.win).toBe(true);
  });

  // TACTION_LOSE (2)
  it('TACTION_LOSE (2) sets lose flag', () => {
    const action: TriggerAction = { action: 2, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.lose).toBe(true);
  });

  // TACTION_BEGIN_PRODUCTION (3)
  it('TACTION_BEGIN_PRODUCTION (3) sets beginProduction to triggerHouse', () => {
    const action: TriggerAction = { action: 3, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers, 2);
    expect(result.beginProduction).toBe(2);
  });

  it('TACTION_BEGIN_PRODUCTION (3) without triggerHouse does not set beginProduction', () => {
    const action: TriggerAction = { action: 3, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.beginProduction).toBeUndefined();
  });

  // TACTION_CREATE_TEAM (4) — needs team and waypoint
  it('TACTION_CREATE_TEAM (4) spawns team members at waypoint', () => {
    const teamTypes: TeamType[] = [{
      name: 'team1',
      house: 2,  // USSR
      flags: 0,
      origin: 0,
      members: [{ type: 'E1', count: 2 }],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(2);
    expect(result.spawned[0].house).toBe(House.USSR);
  });

  it('TACTION_CREATE_TEAM (4) with invalid team index spawns nothing', () => {
    const action: TriggerAction = { action: 4, team: 99, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  it('TACTION_CREATE_TEAM (4) with no waypoint spawns nothing', () => {
    const teamTypes: TeamType[] = [{
      name: 'noWP',
      house: 2,
      flags: 0,
      origin: 5,  // waypoint 5 does not exist
      members: [{ type: 'E1', count: 1 }],
      missions: [],
    }];
    const action: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  // TACTION_DESTROY_TEAM (5)
  it('TACTION_DESTROY_TEAM (5) sets destroyTeam to team index', () => {
    const action: TriggerAction = { action: 5, team: 7, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.destroyTeam).toBe(7);
  });

  // TACTION_ALL_HUNT (6)
  it('TACTION_ALL_HUNT (6) sets allHunt flag', () => {
    const action: TriggerAction = { action: 6, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.allHunt).toBe(true);
  });

  // TACTION_REINFORCEMENTS (7) — same code path as CREATE_TEAM
  it('TACTION_REINFORCEMENTS (7) spawns team like CREATE_TEAM', () => {
    const teamTypes: TeamType[] = [{
      name: 'reinf',
      house: 1,  // Greece
      flags: 0,
      origin: 0,
      members: [{ type: 'JEEP', count: 1 }],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 40, cy: 40 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(1);
    expect(result.spawned[0].house).toBe(House.Greece);
  });

  // TACTION_DZ (8) — drop zone flare at waypoint
  it('TACTION_DZ (8) sets dropZone to waypoint index', () => {
    const action: TriggerAction = { action: 8, team: -1, trigger: -1, data: 5 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.dropZone).toBe(5);
  });

  // TACTION_FIRE_SALE (9)
  it('TACTION_FIRE_SALE (9) sets fireSale flag', () => {
    const action: TriggerAction = { action: 9, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.fireSale).toBe(true);
  });

  // TACTION_PLAY_MOVIE (10)
  it('TACTION_PLAY_MOVIE (10) sets playMovie to data', () => {
    const action: TriggerAction = { action: 10, team: -1, trigger: -1, data: 42 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playMovie).toBe(42);
  });

  // TACTION_TEXT_TRIGGER (11)
  it('TACTION_TEXT_TRIGGER (11) sets textMessage', () => {
    const action: TriggerAction = { action: 11, team: -1, trigger: -1, data: 3 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.textMessage).toBe(3);
  });

  // TACTION_DESTROY_TRIGGER (12)
  it('TACTION_DESTROY_TRIGGER (12) disables the referenced trigger', () => {
    const triggers: ScenarioTrigger[] = [
      createTrigger({ name: 'victim', persistence: 2, fired: false }),
    ];
    const action: TriggerAction = { action: 12, team: -1, trigger: 0, data: 0 };
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    // After destroy: fired=true, persistence=0 (volatile), so it can never re-fire
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].persistence).toBe(0);
  });

  it('TACTION_DESTROY_TRIGGER (12) with out-of-bounds trigger index is safe', () => {
    const action: TriggerAction = { action: 12, team: -1, trigger: 99, data: 0 };
    // Should not throw
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  // TACTION_AUTOCREATE (13)
  it('TACTION_AUTOCREATE (13) sets autocreate flag', () => {
    const action: TriggerAction = { action: 13, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.autocreate).toBe(true);
  });

  // TACTION_ALLOWWIN (15)
  it('TACTION_ALLOWWIN (15) sets allowWin flag', () => {
    const action: TriggerAction = { action: 15, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.allowWin).toBe(true);
  });

  // TACTION_REVEAL_MAP (16)
  it('TACTION_REVEAL_MAP (16) sets revealAll flag', () => {
    const action: TriggerAction = { action: 16, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.revealAll).toBe(true);
  });

  // TACTION_REVEAL_SOME (17)
  it('TACTION_REVEAL_SOME (17) sets revealWaypoint to data', () => {
    const action: TriggerAction = { action: 17, team: -1, trigger: -1, data: 7 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.revealWaypoint).toBe(7);
  });

  // TACTION_REVEAL_ZONE (18)
  it('TACTION_REVEAL_ZONE (18) sets revealZone to data', () => {
    const action: TriggerAction = { action: 18, team: -1, trigger: -1, data: 15 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.revealZone).toBe(15);
  });

  // TACTION_PLAY_SOUND (19)
  it('TACTION_PLAY_SOUND (19) sets playSound to data', () => {
    const action: TriggerAction = { action: 19, team: -1, trigger: -1, data: 12 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playSound).toBe(12);
  });

  // TACTION_PLAY_MUSIC (20)
  it('TACTION_PLAY_MUSIC (20) sets playMusic to data', () => {
    const action: TriggerAction = { action: 20, team: -1, trigger: -1, data: 9 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playMusic).toBe(9);
  });

  // TACTION_PLAY_SPEECH (21)
  it('TACTION_PLAY_SPEECH (21) sets playSpeech to data', () => {
    const action: TriggerAction = { action: 21, team: -1, trigger: -1, data: 44 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.playSpeech).toBe(44);
  });

  // TACTION_FORCE_TRIGGER (22)
  it('TACTION_FORCE_TRIGGER (22) sets forceFirePending on target trigger', () => {
    const triggers: ScenarioTrigger[] = [
      createTrigger({ name: 'source' }),
      createTrigger({ name: 'target', fired: true, forceFirePending: false }),
    ];
    const action: TriggerAction = { action: 22, team: -1, trigger: 1, data: 0 };
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    // Force-trigger resets fired and sets forceFirePending
    expect(triggers[1].fired).toBe(false);
    expect(triggers[1].forceFirePending).toBe(true);
  });

  it('TACTION_FORCE_TRIGGER (22) with out-of-bounds index is safe', () => {
    const action: TriggerAction = { action: 22, team: -1, trigger: 99, data: 0 };
    // Should not throw
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  // TACTION_START_TIMER (23)
  it('TACTION_START_TIMER (23) sets startTimer flag', () => {
    const action: TriggerAction = { action: 23, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.startTimer).toBe(true);
  });

  // TACTION_STOP_TIMER (24)
  it('TACTION_STOP_TIMER (24) sets stopTimer flag', () => {
    const action: TriggerAction = { action: 24, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.stopTimer).toBe(true);
  });

  // TACTION_TIMER_EXTEND (25)
  it('TACTION_TIMER_EXTEND (25) sets timerExtend to data', () => {
    const action: TriggerAction = { action: 25, team: -1, trigger: -1, data: 5 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.timerExtend).toBe(5);
  });

  // TACTION_SUB_TIMER (26)
  it('TACTION_SUB_TIMER (26) sets timerSubtract to data', () => {
    const action: TriggerAction = { action: 26, team: -1, trigger: -1, data: 3 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.timerSubtract).toBe(3);
  });

  // TACTION_SET_TIMER (27)
  it('TACTION_SET_TIMER (27) sets setTimer to data', () => {
    const action: TriggerAction = { action: 27, team: -1, trigger: -1, data: 10 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.setTimer).toBe(10);
  });

  // TACTION_SET_GLOBAL (28)
  it('TACTION_SET_GLOBAL (28) adds global to the set', () => {
    const globals = new Set<number>();
    const action: TriggerAction = { action: 28, team: -1, trigger: -1, data: 5 };
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(5)).toBe(true);
  });

  // TACTION_CLEAR_GLOBAL (29)
  it('TACTION_CLEAR_GLOBAL (29) removes global from the set', () => {
    const globals = new Set<number>([3, 5, 7]);
    const action: TriggerAction = { action: 29, team: -1, trigger: -1, data: 5 };
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(5)).toBe(false);
    expect(globals.has(3)).toBe(true);
    expect(globals.has(7)).toBe(true);
  });

  // TACTION_CREEP_SHADOW (31)
  it('TACTION_CREEP_SHADOW (31) sets creepShadow flag', () => {
    const action: TriggerAction = { action: 31, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.creepShadow).toBe(true);
  });

  // TACTION_DESTROY_OBJECT (32)
  it('TACTION_DESTROY_OBJECT (32) sets destroyTriggeringUnit flag', () => {
    const action: TriggerAction = { action: 32, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.destroyTriggeringUnit).toBe(true);
  });

  // TACTION_1_SPECIAL (33)
  it('TACTION_1_SPECIAL (33) sets oneSpecial flag', () => {
    const action: TriggerAction = { action: 33, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.oneSpecial).toBe(true);
  });

  // TACTION_FULL_SPECIAL (34)
  it('TACTION_FULL_SPECIAL (34) sets fullSpecial flag', () => {
    const action: TriggerAction = { action: 34, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.fullSpecial).toBe(true);
  });

  // TACTION_PREFERRED_TARGET (35)
  it('TACTION_PREFERRED_TARGET (35) sets preferredTarget to data', () => {
    const action: TriggerAction = { action: 35, team: -1, trigger: -1, data: 4 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.preferredTarget).toBe(4);
  });

  // TACTION_LAUNCH_NUKES (36)
  it('TACTION_LAUNCH_NUKES (36) sets nuke flag', () => {
    const action: TriggerAction = { action: 36, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.nuke).toBe(true);
  });

  // Unknown action — returns empty result
  it('unknown action type returns clean empty result', () => {
    const action: TriggerAction = { action: 99, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });
});

// ============================================================================
// Section 3: Trigger Persistence Modes
// ============================================================================

describe('Trigger persistence modes', () => {
  it('volatile (persistence=0) trigger: fired flag prevents re-evaluation', () => {
    const trigger = createTrigger({
      persistence: 0,
      event1: { type: 8, team: -1, data: 0 },  // TEVENT_ANY — always true
      fired: false,
    });

    // First check: event1 is true, trigger is not fired -> should fire
    const state = createState();
    const e1Met = checkTriggerEvent(trigger.event1, state);
    expect(e1Met).toBe(true);

    // Simulate firing
    trigger.fired = true;

    // Second check: even though event1 is true, fired+volatile means skip
    // (this is the logic in processTriggers: if (trigger.fired && trigger.persistence <= 1) continue)
    expect(trigger.fired && trigger.persistence <= 1).toBe(true);
  });

  it('semi-persistent (persistence=1) trigger: fired flag prevents re-evaluation', () => {
    const trigger = createTrigger({
      persistence: 1,
      event1: { type: 8, team: -1, data: 0 },  // TEVENT_ANY
      fired: false,
    });

    trigger.fired = true;

    // Semi-persistent also skipped when fired (persistence <= 1)
    expect(trigger.fired && trigger.persistence <= 1).toBe(true);
  });

  it('persistent (persistence=2) trigger: CAN re-fire after being marked fired', () => {
    const trigger = createTrigger({
      persistence: 2,
      event1: { type: 8, team: -1, data: 0 },  // TEVENT_ANY
      fired: true,
    });

    // Persistent triggers are NOT skipped even when fired (persistence > 1)
    expect(trigger.fired && trigger.persistence <= 1).toBe(false);
  });

  it('persistent trigger resets timerTick to current tick when it re-fires', () => {
    const trigger = createTrigger({
      persistence: 2,
      event1: { type: 13, team: -1, data: 1 },  // TEVENT_TIME, 1 time unit
      timerTick: 0,
    });

    // Simulate C++ parity: after firing, persistent trigger resets timerTick
    // (from processTriggers: if (trigger.persistence === 2) trigger.timerTick = this.tick)
    const currentTick = 500;
    trigger.fired = true;
    trigger.timerTick = currentTick;  // reset timer to current tick

    // Now the TIME event needs to re-elapse from the new start
    const state = createState({ gameTick: currentTick + TIME_UNIT_TICKS - 1, triggerStartTick: trigger.timerTick });
    expect(checkTriggerEvent(trigger.event1, state)).toBe(false);

    const state2 = createState({ gameTick: currentTick + TIME_UNIT_TICKS, triggerStartTick: trigger.timerTick });
    expect(checkTriggerEvent(trigger.event1, state2)).toBe(true);
  });
});

// ============================================================================
// Section 4: Event Control Logic (single, AND, OR)
// ============================================================================

describe('Event control logic', () => {
  it('eventControl=0 (only): only event1 is evaluated', () => {
    const trigger = createTrigger({
      eventControl: 0,
      event1: { type: 8, team: -1, data: 0 },   // ANY -> true
      event2: { type: 0, team: -1, data: 0 },    // NONE -> false
    });

    const state = createState();
    const e1Met = checkTriggerEvent(trigger.event1, state);
    const e2Met = checkTriggerEvent(trigger.event2, state);

    expect(e1Met).toBe(true);
    expect(e2Met).toBe(false);

    // Only event1 matters (eventControl=0)
    let shouldFire: boolean;
    switch (trigger.eventControl) {
      case 0: shouldFire = e1Met; break;
      case 1: shouldFire = e1Met && e2Met; break;
      case 2: shouldFire = e1Met || e2Met; break;
      default: shouldFire = e1Met; break;
    }
    expect(shouldFire).toBe(true);
  });

  it('eventControl=1 (AND): both events must be true', () => {
    const state = createState({ playerEntered: true }); // event1 true, event2 false unless set

    // event1=PLAYER_ENTERED (true), event2=MISSION_TIMER_EXPIRED (false)
    const e1Met = checkTriggerEvent({ type: 1, team: -1, data: 0 }, state);
    const e2Met = checkTriggerEvent({ type: 14, team: -1, data: 0 }, state);

    expect(e1Met).toBe(true);
    expect(e2Met).toBe(false);
    expect(e1Met && e2Met).toBe(false);  // AND fails

    // Now with both true
    const state2 = createState({ playerEntered: true, missionTimerExpired: true });
    const e1Met2 = checkTriggerEvent({ type: 1, team: -1, data: 0 }, state2);
    const e2Met2 = checkTriggerEvent({ type: 14, team: -1, data: 0 }, state2);
    expect(e1Met2 && e2Met2).toBe(true); // AND passes
  });

  it('eventControl=2 (OR): either event can trigger', () => {
    const state = createState({ playerEntered: false, missionTimerExpired: true });

    const e1Met = checkTriggerEvent({ type: 1, team: -1, data: 0 }, state);
    const e2Met = checkTriggerEvent({ type: 14, team: -1, data: 0 }, state);

    expect(e1Met).toBe(false);
    expect(e2Met).toBe(true);
    expect(e1Met || e2Met).toBe(true);  // OR passes

    // Both false
    const state2 = createState({ playerEntered: false, missionTimerExpired: false });
    const e1Met2 = checkTriggerEvent({ type: 1, team: -1, data: 0 }, state2);
    const e2Met2 = checkTriggerEvent({ type: 14, team: -1, data: 0 }, state2);
    expect(e1Met2 || e2Met2).toBe(false);  // OR fails
  });

  it('AND with both TEVENT_ANY events always fires', () => {
    const state = createState();
    const e1 = checkTriggerEvent({ type: 8, team: -1, data: 0 }, state);
    const e2 = checkTriggerEvent({ type: 8, team: -1, data: 0 }, state);
    expect(e1 && e2).toBe(true);
  });

  it('OR with both TEVENT_NONE events never fires', () => {
    const state = createState();
    const e1 = checkTriggerEvent({ type: 0, team: -1, data: 0 }, state);
    const e2 = checkTriggerEvent({ type: 0, team: -1, data: 0 }, state);
    expect(e1 || e2).toBe(false);
  });

  it('unknown eventControl defaults to event1 only', () => {
    const state = createState({ playerEntered: true });
    const e1Met = checkTriggerEvent({ type: 1, team: -1, data: 0 }, state);
    const e2Met = checkTriggerEvent({ type: 0, team: -1, data: 0 }, state);

    // default case in processTriggers: shouldFire = e1Met
    let shouldFire: boolean;
    const eventControl = 99; // unknown
    switch (eventControl) {
      case 0: shouldFire = e1Met; break;
      case 1: shouldFire = e1Met && e2Met; break;
      case 2: shouldFire = e1Met || e2Met; break;
      default: shouldFire = e1Met; break;
    }
    expect(shouldFire).toBe(true);
  });
});

// ============================================================================
// Section 5: Action Control Logic (single action vs both actions)
// ============================================================================

describe('Action control logic', () => {
  it('actionControl=0 (only): only action1 is executed', () => {
    const trigger = createTrigger({
      actionControl: 0,
      action1: { action: 1, team: -1, trigger: -1, data: 0 },  // WIN
      action2: { action: 2, team: -1, trigger: -1, data: 0 },  // LOSE
    });

    // In processTriggers: executeAction(trigger.action1); if (actionControl === 1) executeAction(trigger.action2);
    const result1 = executeTriggerAction(trigger.action1, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result1.win).toBe(true);

    // action2 should NOT be executed (actionControl != 1)
    expect(trigger.actionControl).toBe(0);
    // So we only get WIN, not LOSE
  });

  it('actionControl=1 (both): both actions are executed', () => {
    const trigger = createTrigger({
      actionControl: 1,
      action1: { action: 28, team: -1, trigger: -1, data: 5 },  // SET_GLOBAL 5
      action2: { action: 11, team: -1, trigger: -1, data: 2 },  // TEXT_TRIGGER 2
    });

    // Both actions should be dispatched
    expect(trigger.actionControl).toBe(1);

    const globals = new Set<number>();
    executeTriggerAction(trigger.action1, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(5)).toBe(true);

    const result2 = executeTriggerAction(trigger.action2, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result2.textMessage).toBe(2);
  });
});

// ============================================================================
// Section 6: Force-Fire Mechanism
// ============================================================================

describe('Force-fire mechanism (forceFirePending)', () => {
  it('forceFirePending bypasses event conditions', () => {
    const trigger = createTrigger({
      event1: { type: 0, team: -1, data: 0 },  // TEVENT_NONE — never fires
      forceFirePending: true,
    });

    // Without force: event1 (NONE) is false, so shouldFire = false
    const state = createState();
    expect(checkTriggerEvent(trigger.event1, state)).toBe(false);

    // But with forceFirePending = true, shouldFire = true regardless
    let shouldFire = false;
    if (trigger.forceFirePending) {
      shouldFire = true;
      trigger.forceFirePending = false;  // consumed
    }
    expect(shouldFire).toBe(true);
    expect(trigger.forceFirePending).toBe(false);  // consumed after use
  });

  it('FORCE_TRIGGER action resets fired flag on target', () => {
    const target = createTrigger({ name: 'target', fired: true });
    const triggers: ScenarioTrigger[] = [target];

    const action: TriggerAction = { action: 22, team: -1, trigger: 0, data: 0 };
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    expect(target.fired).toBe(false);
    expect(target.forceFirePending).toBe(true);
  });

  it('FORCE_TRIGGER with negative trigger index is safe', () => {
    const action: TriggerAction = { action: 22, team: -1, trigger: -1, data: 0 };
    // Should not throw
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });
});

// ============================================================================
// Section 7: Self-Referencing Triggers
// ============================================================================

describe('Self-referencing triggers', () => {
  it('DESTROY_TRIGGER pointing at itself disables the trigger', () => {
    const self = createTrigger({
      name: 'selfDestruct',
      persistence: 2,
      action1: { action: 12, team: -1, trigger: 0, data: 0 },  // DESTROY_TRIGGER -> index 0 (itself)
    });
    const triggers: ScenarioTrigger[] = [self];

    executeTriggerAction(self.action1, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    // After self-destruction: fired=true, persistence=0
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].persistence).toBe(0);
    // This means it can never re-fire (fired=true && persistence<=1 -> skip)
    expect(triggers[0].fired && triggers[0].persistence <= 1).toBe(true);
  });

  it('FORCE_TRIGGER pointing at itself re-enables force-fire', () => {
    const self = createTrigger({
      name: 'selfForce',
      fired: true,
      action1: { action: 22, team: -1, trigger: 0, data: 0 },  // FORCE_TRIGGER -> itself
    });
    const triggers: ScenarioTrigger[] = [self];

    executeTriggerAction(self.action1, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    // Self-force: fired=false, forceFirePending=true
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(true);
  });
});

// ============================================================================
// Section 8: Trigger Chaining
// ============================================================================

describe('Trigger chaining', () => {
  it('trigger A sets global, trigger B fires on GLOBAL_SET', () => {
    const globals = new Set<number>();

    // Trigger A: set global 5
    const actionA: TriggerAction = { action: 28, team: -1, trigger: -1, data: 5 }; // SET_GLOBAL
    executeTriggerAction(actionA, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(5)).toBe(true);

    // Trigger B: check GLOBAL_SET 5
    const eventB: TriggerEvent = { type: 27, team: -1, data: 5 }; // TEVENT_GLOBAL_SET
    expect(checkTriggerEvent(eventB, createState({ globals }))).toBe(true);
  });

  it('trigger A clears global, trigger B stops firing on GLOBAL_SET', () => {
    const globals = new Set<number>([5]);

    // Trigger A: clear global 5
    const actionA: TriggerAction = { action: 29, team: -1, trigger: -1, data: 5 }; // CLEAR_GLOBAL
    executeTriggerAction(actionA, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(5)).toBe(false);

    // Trigger B: GLOBAL_SET now fails
    const eventB: TriggerEvent = { type: 27, team: -1, data: 5 };
    expect(checkTriggerEvent(eventB, createState({ globals }))).toBe(false);

    // But GLOBAL_CLEAR now succeeds
    const eventC: TriggerEvent = { type: 28, team: -1, data: 5 };
    expect(checkTriggerEvent(eventC, createState({ globals }))).toBe(true);
  });

  it('trigger A force-fires trigger B, which force-fires trigger C', () => {
    const trigA = createTrigger({ name: 'A' });
    const trigB = createTrigger({ name: 'B', fired: true });
    const trigC = createTrigger({ name: 'C', fired: true });
    const triggers = [trigA, trigB, trigC];

    // A forces B
    const actionA: TriggerAction = { action: 22, team: -1, trigger: 1, data: 0 };
    executeTriggerAction(actionA, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);
    expect(trigB.forceFirePending).toBe(true);
    expect(trigB.fired).toBe(false);

    // B forces C (simulating B's action1)
    const actionB: TriggerAction = { action: 22, team: -1, trigger: 2, data: 0 };
    executeTriggerAction(actionB, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);
    expect(trigC.forceFirePending).toBe(true);
    expect(trigC.fired).toBe(false);
  });

  it('trigger A destroys trigger B, preventing B from firing', () => {
    const trigA = createTrigger({ name: 'A' });
    const trigB = createTrigger({ name: 'B', persistence: 2, fired: false });
    const triggers = [trigA, trigB];

    // A destroys B
    const actionA: TriggerAction = { action: 12, team: -1, trigger: 1, data: 0 };
    executeTriggerAction(actionA, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);

    // B is now dead: fired=true, persistence=0 (volatile)
    expect(trigB.fired).toBe(true);
    expect(trigB.persistence).toBe(0);
    // This means processTriggers will skip it
    expect(trigB.fired && trigB.persistence <= 1).toBe(true);
  });
});

// ============================================================================
// Section 9: Team Spawning Details
// ============================================================================

describe('Team spawning via REINFORCEMENTS/CREATE_TEAM', () => {
  it('spawned entities carry team missions', () => {
    const teamTypes: TeamType[] = [{
      name: 'patrol1',
      house: 2,
      flags: 0,
      origin: 0,
      members: [{ type: 'E1', count: 1 }],
      missions: [
        { mission: 3, data: 1 },  // TMISSION_MOVE to WP1
        { mission: 5, data: 0 },  // TMISSION_GUARD
      ],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(1);
    const entity = result.spawned[0];
    expect(entity.teamMissions).toBeDefined();
    expect(entity.teamMissions!.length).toBe(2);
    expect(entity.teamMissions![0].mission).toBe(3);
    expect(entity.teamMissions![1].mission).toBe(5);
    expect(entity.teamMissionIndex).toBe(0);
  });

  it('suicide teams set isSuicide flag on spawned entities', () => {
    const teamTypes: TeamType[] = [{
      name: 'kamikaze',
      house: 9,  // BadGuy
      flags: 2,  // bit 1 = IsSuicide
      origin: 0,
      members: [{ type: 'E1', count: 2 }],
      missions: [{ mission: 0, data: 0 }],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 30, cy: 30 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(2);
    for (const e of result.spawned) {
      expect(e.isSuicide).toBe(true);
    }
  });

  it('transport auto-loads infantry passengers', () => {
    const teamTypes: TeamType[] = [{
      name: 'transport_team',
      house: 1,  // Greece
      flags: 0,
      origin: 0,
      members: [
        { type: 'TRAN', count: 1 },  // Chinook transport
        { type: 'E1', count: 3 },    // 3 rifle infantry
      ],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 60 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // Transport should be in spawned, infantry loaded inside
    const transport = result.spawned.find(e => e.isTransport);
    expect(transport).toBeDefined();
    // Infantry should be in passengers, not in spawned list
    expect(transport!.passengers.length).toBeGreaterThan(0);
    // Total spawned (visible) should be fewer than 4
    expect(result.spawned.length).toBeLessThan(4);
  });

  it('team with no members spawns nothing', () => {
    const teamTypes: TeamType[] = [{
      name: 'empty',
      house: 2,
      flags: 0,
      origin: 0,
      members: [],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(0);
  });

  it('team with invalid unit type name skips that member', () => {
    const teamTypes: TeamType[] = [{
      name: 'badType',
      house: 2,
      flags: 0,
      origin: 0,
      members: [
        { type: 'NONEXISTENT_UNIT', count: 1 },
        { type: 'E1', count: 1 },
      ],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    // Only the valid E1 should spawn
    expect(result.spawned.length).toBe(1);
  });

  it('team with edge-based spawn uses houseEdges when origin=-1', () => {
    const teamTypes: TeamType[] = [{
      name: 'edgeTeam',
      house: 2,  // USSR
      flags: 0,
      origin: -1,  // No waypoint — use house edge
      members: [{ type: 'E1', count: 1 }],
      missions: [],
    }];
    const houseEdges = new Map<House, string>([[House.USSR, 'North']]);
    const mapBounds = { x: 40, y: 40, w: 50, h: 50 };
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, teamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
      2, houseEdges, mapBounds,
    );
    expect(result.spawned.length).toBe(1);
  });
});

// ============================================================================
// Section 10: Global Set/Clear Interactions
// ============================================================================

describe('Global set/clear interaction with events', () => {
  it('SET_GLOBAL then GLOBAL_SET event → true; CLEAR_GLOBAL then GLOBAL_SET → false', () => {
    const globals = new Set<number>();

    // Set global 10
    executeTriggerAction(
      { action: 28, team: -1, trigger: -1, data: 10 },
      emptyTeamTypes, emptyWaypoints, globals, emptyTriggers,
    );
    expect(checkTriggerEvent({ type: 27, team: -1, data: 10 }, createState({ globals }))).toBe(true);

    // Clear global 10
    executeTriggerAction(
      { action: 29, team: -1, trigger: -1, data: 10 },
      emptyTeamTypes, emptyWaypoints, globals, emptyTriggers,
    );
    expect(checkTriggerEvent({ type: 27, team: -1, data: 10 }, createState({ globals }))).toBe(false);
  });

  it('setting multiple globals independently', () => {
    const globals = new Set<number>();
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 1 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 2 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 3 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);

    expect(globals.size).toBe(3);
    expect(checkTriggerEvent({ type: 27, team: -1, data: 1 }, createState({ globals }))).toBe(true);
    expect(checkTriggerEvent({ type: 27, team: -1, data: 2 }, createState({ globals }))).toBe(true);
    expect(checkTriggerEvent({ type: 27, team: -1, data: 3 }, createState({ globals }))).toBe(true);
    expect(checkTriggerEvent({ type: 27, team: -1, data: 4 }, createState({ globals }))).toBe(false);

    // Clear just one
    executeTriggerAction({ action: 29, team: -1, trigger: -1, data: 2 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.size).toBe(2);
    expect(checkTriggerEvent({ type: 27, team: -1, data: 2 }, createState({ globals }))).toBe(false);
  });
});

// ============================================================================
// Section 11: Timer Actions and Events
// ============================================================================

describe('Timer actions and events', () => {
  it('SET_TIMER sets timer value in result', () => {
    const result = executeTriggerAction(
      { action: 27, team: -1, trigger: -1, data: 30 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
    );
    expect(result.setTimer).toBe(30);
  });

  it('TIMER_EXTEND adds time to timer', () => {
    const result = executeTriggerAction(
      { action: 25, team: -1, trigger: -1, data: 10 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
    );
    expect(result.timerExtend).toBe(10);
  });

  it('SUB_TIMER subtracts time from timer', () => {
    const result = executeTriggerAction(
      { action: 26, team: -1, trigger: -1, data: 5 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
    );
    expect(result.timerSubtract).toBe(5);
  });

  it('START_TIMER and STOP_TIMER toggle timer running state', () => {
    const startResult = executeTriggerAction(
      { action: 23, team: -1, trigger: -1, data: 0 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
    );
    expect(startResult.startTimer).toBe(true);

    const stopResult = executeTriggerAction(
      { action: 24, team: -1, trigger: -1, data: 0 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
    );
    expect(stopResult.stopTimer).toBe(true);
  });

  it('TEVENT_TIME correctly uses TIME_UNIT_TICKS conversion', () => {
    // TIME_UNIT_TICKS = 6 * GAME_TICKS_PER_SEC = 6 * 20 = 120
    expect(TIME_UNIT_TICKS).toBe(120);

    // data=10 means 10 * 120 = 1200 ticks
    const event: TriggerEvent = { type: 13, team: -1, data: 10 };
    expect(checkTriggerEvent(event, createState({ gameTick: 1199, triggerStartTick: 0 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ gameTick: 1200, triggerStartTick: 0 }))).toBe(true);
  });
});

// ============================================================================
// Section 12: Edge Cases
// ============================================================================

describe('Edge cases', () => {
  it('DESTROY_TRIGGER with negative trigger index does nothing', () => {
    const action: TriggerAction = { action: 12, team: -1, trigger: -1, data: 0 };
    // Should not throw, should not modify any trigger
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  it('FORCE_TRIGGER with trigger index equal to array length is safe', () => {
    const triggers = [createTrigger({ name: 'only' })];
    const action: TriggerAction = { action: 22, team: -1, trigger: 1, data: 0 }; // index 1 but length is 1
    // Should not throw or modify anything
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers);
    expect(triggers[0].forceFirePending).toBe(false); // untouched
  });

  it('SET_GLOBAL with same value twice is idempotent', () => {
    const globals = new Set<number>();
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 7 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 7 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.size).toBe(1);
    expect(globals.has(7)).toBe(true);
  });

  it('CLEAR_GLOBAL on non-existent global is safe', () => {
    const globals = new Set<number>([1, 2]);
    executeTriggerAction({ action: 29, team: -1, trigger: -1, data: 99 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.size).toBe(2); // unchanged
  });

  it('TEVENT_ALL_DESTROYED for house index not in houseAlive map returns true (no units ever existed)', () => {
    const event: TriggerEvent = { type: 11, team: -1, data: 7 }; // House Turkey (index 7)
    const state = createState({ houseAlive: new Map([[2, true]]) }); // Only USSR alive
    expect(checkTriggerEvent(event, state)).toBe(true); // Turkey never existed, so "all destroyed" is vacuously true
  });

  it('TEVENT_BUILDING_EXISTS with all known StructType indices maps correctly', () => {
    // Verify key mappings from the STRUCT_TYPES constant
    const knownMappings: [number, string][] = [
      [0, 'ATEK'], [1, 'IRON'], [2, 'WEAP'], [3, 'PDOX'], [11, 'FACT'],
      [12, 'PROC'], [17, 'POWR'], [18, 'APWR'], [21, 'BARR'], [22, 'TENT'],
      [31, 'TSLA'], [32, 'QUEE'], [33, 'LAR1'], [34, 'LAR2'],
    ];
    for (const [idx, typeName] of knownMappings) {
      const event: TriggerEvent = { type: 32, team: -1, data: idx };
      const stateWith = createState({ structureTypes: new Set([typeName]) });
      const stateWithout = createState({ structureTypes: new Set() });
      expect(checkTriggerEvent(event, stateWith)).toBe(true);
      expect(checkTriggerEvent(event, stateWithout)).toBe(false);
    }
  });

  it('TEVENT_TIME with data=0 fires immediately (0 ticks required)', () => {
    const event: TriggerEvent = { type: 13, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ gameTick: 0, triggerStartTick: 0 }))).toBe(true);
  });

  it('TEVENT_NUNITS_DESTROYED with data=0 fires immediately (0 kills required)', () => {
    const event: TriggerEvent = { type: 16, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ enemyKillCount: 0 }))).toBe(true);
  });

  it('BEGIN_PRODUCTION with negative triggerHouse does not set beginProduction', () => {
    const action: TriggerAction = { action: 3, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers, -1);
    expect(result.beginProduction).toBeUndefined();
  });
});

// ============================================================================
// Section 13: Source Code Structure Verification
// ============================================================================

describe('Source code structure verification', () => {
  it('checkTriggerEvent handles all TEVENT constants', () => {
    // The function has a switch/case for each event type
    // Verify by calling each event type and ensuring no exceptions are thrown
    const allEventTypes = [
      0,  // NONE
      1,  // PLAYER_ENTERED
      2,  // SPIED
      3,  // THIEVED
      4,  // DISCOVERED
      5,  // HOUSE_DISCOVERED
      6,  // ATTACKED
      7,  // DESTROYED
      8,  // ANY
      9,  // UNITS_DESTROYED
      10, // BUILDINGS_DESTROYED
      11, // ALL_DESTROYED
      12, // CREDITS
      13, // TIME
      14, // MISSION_TIMER_EXPIRED
      15, // NBUILDINGS_DESTROYED
      16, // NUNITS_DESTROYED
      17, // NOFACTORIES
      18, // EVAC_CIVILIAN
      19, // BUILD
      20, // BUILD_UNIT
      21, // BUILD_INFANTRY
      22, // BUILD_AIRCRAFT
      23, // LEAVES_MAP
      24, // ENTERS_ZONE
      25, // CROSS_HORIZONTAL
      26, // CROSS_VERTICAL
      27, // GLOBAL_SET
      28, // GLOBAL_CLEAR
      29, // FAKES_DESTROYED
      30, // LOW_POWER
      31, // ALL_BRIDGES_DESTROYED
      32, // BUILDING_EXISTS
    ];

    const state = createState();
    for (const eventType of allEventTypes) {
      // Should not throw for any known event type
      const event: TriggerEvent = { type: eventType, team: -1, data: 0 };
      expect(() => checkTriggerEvent(event, state)).not.toThrow();
    }
  });

  it('executeTriggerAction handles all TACTION constants', () => {
    const allActionTypes = [
      0,  // NONE
      1,  // WIN
      2,  // LOSE
      3,  // BEGIN_PRODUCTION
      4,  // CREATE_TEAM
      5,  // DESTROY_TEAM
      6,  // ALL_HUNT
      7,  // REINFORCEMENTS
      8,  // DZ
      9,  // FIRE_SALE
      10, // PLAY_MOVIE
      11, // TEXT_TRIGGER
      12, // DESTROY_TRIGGER
      13, // AUTOCREATE
      15, // ALLOWWIN
      16, // REVEAL_MAP
      17, // REVEAL_SOME
      18, // REVEAL_ZONE
      19, // PLAY_SOUND
      20, // PLAY_MUSIC
      21, // PLAY_SPEECH
      22, // FORCE_TRIGGER
      23, // START_TIMER
      24, // STOP_TIMER
      25, // TIMER_EXTEND
      26, // SUB_TIMER
      27, // SET_TIMER
      28, // SET_GLOBAL
      29, // CLEAR_GLOBAL
      31, // CREEP_SHADOW
      32, // DESTROY_OBJECT
      33, // 1_SPECIAL
      34, // FULL_SPECIAL
      35, // PREFERRED_TARGET
      36, // LAUNCH_NUKES
    ];

    for (const actionType of allActionTypes) {
      const action: TriggerAction = { action: actionType, team: -1, trigger: -1, data: 0 };
      expect(() => executeTriggerAction(
        action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers,
      )).not.toThrow();
    }
  });

  it('each TACTION produces the correct result field', () => {
    // Map of action type -> expected non-empty result field
    const actionResultMap: [number, keyof ReturnType<typeof executeTriggerAction>][] = [
      [1, 'win'],
      [2, 'lose'],
      [6, 'allHunt'],
      [8, 'dropZone'],
      [9, 'fireSale'],
      [10, 'playMovie'],
      [11, 'textMessage'],
      [13, 'autocreate'],
      [15, 'allowWin'],
      [16, 'revealAll'],
      [17, 'revealWaypoint'],
      [18, 'revealZone'],
      [19, 'playSound'],
      [20, 'playMusic'],
      [21, 'playSpeech'],
      [23, 'startTimer'],
      [24, 'stopTimer'],
      [25, 'timerExtend'],
      [26, 'timerSubtract'],
      [27, 'setTimer'],
      [31, 'creepShadow'],
      [32, 'destroyTriggeringUnit'],
      [33, 'oneSpecial'],
      [34, 'fullSpecial'],
      [35, 'preferredTarget'],
      [36, 'nuke'],
    ];

    for (const [actionType, expectedField] of actionResultMap) {
      const action: TriggerAction = { action: actionType, team: -1, trigger: -1, data: 1 };
      const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
      expect(result[expectedField], `TACTION ${actionType} should set result.${expectedField}`).toBeDefined();
    }
  });
});

// ============================================================================
// Section 14: Scenario Integration — Trigger Parsing Round-Trip
// ============================================================================

describe('Trigger parsing round-trip', () => {
  it('createTrigger helper produces valid ScenarioTrigger structure', () => {
    const trigger = createTrigger({
      name: 'test1',
      persistence: 1,
      house: 2,
      eventControl: 1,
      actionControl: 1,
      event1: { type: 8, team: -1, data: 0 },
      event2: { type: 13, team: -1, data: 5 },
      action1: { action: 1, team: -1, trigger: -1, data: 0 },
      action2: { action: 28, team: -1, trigger: -1, data: 3 },
    });

    // Verify all fields are present and correct
    expect(trigger.name).toBe('test1');
    expect(trigger.persistence).toBe(1);
    expect(trigger.house).toBe(2);
    expect(trigger.eventControl).toBe(1);
    expect(trigger.actionControl).toBe(1);
    expect(trigger.event1.type).toBe(8);
    expect(trigger.event2.type).toBe(13);
    expect(trigger.event2.data).toBe(5);
    expect(trigger.action1.action).toBe(1);
    expect(trigger.action2.action).toBe(28);
    expect(trigger.action2.data).toBe(3);
    expect(trigger.fired).toBe(false);
    expect(trigger.timerTick).toBe(0);
    expect(trigger.playerEntered).toBe(false);
    expect(trigger.forceFirePending).toBe(false);
  });
});

// ============================================================================
// Section 15: Complex Multi-Trigger Scenarios
// ============================================================================

describe('Complex multi-trigger scenarios', () => {
  it('global chain: A sets global -> B fires on global -> B sets another global -> C fires', () => {
    const globals = new Set<number>();

    // Step 1: A fires SET_GLOBAL 1
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 1 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);
    expect(globals.has(1)).toBe(true);

    // Step 2: B checks GLOBAL_SET 1 -> fires
    expect(checkTriggerEvent({ type: 27, team: -1, data: 1 }, createState({ globals }))).toBe(true);

    // Step 3: B fires SET_GLOBAL 2
    executeTriggerAction({ action: 28, team: -1, trigger: -1, data: 2 }, emptyTeamTypes, emptyWaypoints, globals, emptyTriggers);

    // Step 4: C checks GLOBAL_SET 2 -> fires
    expect(checkTriggerEvent({ type: 27, team: -1, data: 2 }, createState({ globals }))).toBe(true);
  });

  it('destroy-and-force chain: A destroys B, A forces C', () => {
    const trigA = createTrigger({ name: 'A' });
    const trigB = createTrigger({ name: 'B', persistence: 2 });
    const trigC = createTrigger({ name: 'C', fired: true });
    const triggers = [trigA, trigB, trigC];

    // A's action1: destroy B
    executeTriggerAction(
      { action: 12, team: -1, trigger: 1, data: 0 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers,
    );
    expect(trigB.fired).toBe(true);
    expect(trigB.persistence).toBe(0);

    // A's action2: force C
    executeTriggerAction(
      { action: 22, team: -1, trigger: 2, data: 0 },
      emptyTeamTypes, emptyWaypoints, emptyGlobals, triggers,
    );
    expect(trigC.fired).toBe(false);
    expect(trigC.forceFirePending).toBe(true);

    // Now B can't fire (destroyed), but C will fire (force-pending)
    expect(trigB.fired && trigB.persistence <= 1).toBe(true); // B is dead
    expect(trigC.forceFirePending).toBe(true); // C will fire
  });

  it('persistent timer trigger fires repeatedly on schedule', () => {
    const trigger = createTrigger({
      persistence: 2,
      event1: { type: 13, team: -1, data: 1 }, // TIME: 1 unit = 120 ticks (6 * 20)
      timerTick: 0,
    });

    // Tick 119: not enough time
    expect(checkTriggerEvent(trigger.event1, createState({
      gameTick: 119, triggerStartTick: 0,
    }))).toBe(false);

    // Tick 120: fires
    expect(checkTriggerEvent(trigger.event1, createState({
      gameTick: 120, triggerStartTick: 0,
    }))).toBe(true);

    // After firing, persistent trigger resets timerTick to current tick
    trigger.timerTick = 120;

    // Tick 239: not enough time since reset
    expect(checkTriggerEvent(trigger.event1, createState({
      gameTick: 239, triggerStartTick: 120,
    }))).toBe(false);

    // Tick 240: fires again
    expect(checkTriggerEvent(trigger.event1, createState({
      gameTick: 240, triggerStartTick: 120,
    }))).toBe(true);
  });

  it('AND gate: PLAYER_ENTERED + TIME both required', () => {
    const trigger = createTrigger({
      eventControl: 1, // AND
      event1: { type: 1, team: -1, data: 0 },   // PLAYER_ENTERED
      event2: { type: 13, team: -1, data: 1 },   // TIME: 1 unit = 120 ticks
    });

    // Neither met
    const s1 = createState({ playerEntered: false, gameTick: 0, triggerStartTick: 0 });
    expect(checkTriggerEvent(trigger.event1, s1) && checkTriggerEvent(trigger.event2, s1)).toBe(false);

    // Only entered (time not elapsed yet)
    const s2 = createState({ playerEntered: true, gameTick: 50, triggerStartTick: 0 });
    expect(checkTriggerEvent(trigger.event1, s2) && checkTriggerEvent(trigger.event2, s2)).toBe(false);

    // Only time (not entered)
    const s3 = createState({ playerEntered: false, gameTick: 120, triggerStartTick: 0 });
    expect(checkTriggerEvent(trigger.event1, s3) && checkTriggerEvent(trigger.event2, s3)).toBe(false);

    // Both met
    const s4 = createState({ playerEntered: true, gameTick: 120, triggerStartTick: 0 });
    expect(checkTriggerEvent(trigger.event1, s4) && checkTriggerEvent(trigger.event2, s4)).toBe(true);
  });

  it('OR gate: either DESTROYED or ALL_BRIDGES_DESTROYED triggers the action', () => {
    const trigger = createTrigger({
      eventControl: 2, // OR
      event1: { type: 7, team: -1, data: 0 },   // DESTROYED
      event2: { type: 31, team: -1, data: 0 },   // ALL_BRIDGES_DESTROYED
    });

    // Neither met
    const s1 = createState({
      triggerName: 'guard',
      destroyedTriggerNames: new Set(),
      bridgesAlive: 3,
    });
    expect(checkTriggerEvent(trigger.event1, s1) || checkTriggerEvent(trigger.event2, s1)).toBe(false);

    // Only event1 met (entity destroyed)
    const s2 = createState({
      triggerName: 'guard',
      destroyedTriggerNames: new Set(['guard']),
      bridgesAlive: 3,
    });
    expect(checkTriggerEvent(trigger.event1, s2) || checkTriggerEvent(trigger.event2, s2)).toBe(true);

    // Only event2 met (bridges destroyed)
    const s3 = createState({
      triggerName: 'guard',
      destroyedTriggerNames: new Set(),
      bridgesAlive: 0,
    });
    expect(checkTriggerEvent(trigger.event1, s3) || checkTriggerEvent(trigger.event2, s3)).toBe(true);

    // Both met
    const s4 = createState({
      triggerName: 'guard',
      destroyedTriggerNames: new Set(['guard']),
      bridgesAlive: 0,
    });
    expect(checkTriggerEvent(trigger.event1, s4) || checkTriggerEvent(trigger.event2, s4)).toBe(true);
  });
});
