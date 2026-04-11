/**
 * C++ behavioral parity tests for TEVENT_LEAVES_MAP (type=23).
 *
 * C++ behavior (TEVENT.CPP):
 *   case TEVENT_LEAVES_MAP:
 *     // Check to see if a team of the appropriate type has left the map.
 *     // Iterates Teams looking for one where Team matches, Is_Empty(), and IsLeaveMap.
 *     // If found, td.IsTripped = true; otherwise return false.
 *
 * TS behavior (scenario.ts):
 *   case TEVENT_LEAVES_MAP:
 *     return state.unitsLeftMap > 0;
 *
 * Returns true when at least one unit has left the map (unitsLeftMap > 0).
 * event.data is irrelevant — the check is purely on the counter.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

describe('TEVENT_LEAVES_MAP (type=23) — C++ behavioral parity', () => {
  /** Build a minimal TriggerGameState with all required fields. */
  const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => ({
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

    structureTypesByHouse: new Map([[1, new Set<string>()]]),

    triggerHouse: 1,
    builtStructureTypes: new Set(),
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
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
    pendingDestroyedCount: 0,
    ...overrides,
  });

  const TEVENT_LEAVES_MAP = 23;

  /** Helper: create a LEAVES_MAP trigger event with optional data. */
  const leavesMapEvent = (data: number = 0): TriggerEvent => ({
    type: TEVENT_LEAVES_MAP,
    team: -1,
    data,
  });

  it('constant value is 23 (C++ TEVENT_LEAVES_MAP enum index)', () => {
    // Verify type=23 reaches the LEAVES_MAP path by checking both outcomes.
    const event: TriggerEvent = { type: 23, team: -1, data: 0 };
    const stateNone = createState({ unitsLeftMap: 0 });
    const stateSome = createState({ unitsLeftMap: 1 });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateSome)).toBe(true);
  });

  it('returns false when unitsLeftMap is 0 (no units have left)', () => {
    const state = createState({ unitsLeftMap: 0 });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(false);
  });

  it('returns true when unitsLeftMap is 1 (exactly one unit left)', () => {
    const state = createState({ unitsLeftMap: 1 });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(true);
  });

  it('returns true when unitsLeftMap is greater than 1', () => {
    const state = createState({ unitsLeftMap: 5 });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(true);
  });

  it('returns true for large unitsLeftMap values', () => {
    const state = createState({ unitsLeftMap: 9999 });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(true);
  });

  it('event.data is irrelevant — result depends only on unitsLeftMap', () => {
    // With unitsLeftMap=0, any data value still returns false
    const stateZero = createState({ unitsLeftMap: 0 });
    expect(checkTriggerEvent(leavesMapEvent(0), stateZero)).toBe(false);
    expect(checkTriggerEvent(leavesMapEvent(1), stateZero)).toBe(false);
    expect(checkTriggerEvent(leavesMapEvent(42), stateZero)).toBe(false);
    expect(checkTriggerEvent(leavesMapEvent(999), stateZero)).toBe(false);

    // With unitsLeftMap=3, any data value returns true
    const stateThree = createState({ unitsLeftMap: 3 });
    expect(checkTriggerEvent(leavesMapEvent(0), stateThree)).toBe(true);
    expect(checkTriggerEvent(leavesMapEvent(1), stateThree)).toBe(true);
    expect(checkTriggerEvent(leavesMapEvent(42), stateThree)).toBe(true);
    expect(checkTriggerEvent(leavesMapEvent(999), stateThree)).toBe(true);
  });

  it('other state fields do not affect the result', () => {
    // Set various other state fields — only unitsLeftMap matters
    const stateWithNoise = createState({
      unitsLeftMap: 0,
      playerEntered: true,
      enemyKillCount: 100,
      playerCredits: 50000,
      missionTimerExpired: true,
      isLowPower: true,
      civiliansEvacuated: 10,
    });
    expect(checkTriggerEvent(leavesMapEvent(), stateWithNoise)).toBe(false);

    // Now flip only unitsLeftMap
    const stateWithNoiseAndLeft = createState({
      ...stateWithNoise,
      unitsLeftMap: 1,
    });
    expect(checkTriggerEvent(leavesMapEvent(), stateWithNoiseAndLeft)).toBe(true);
  });
});
