/**
 * C++ behavioral parity tests for TEVENT_LEAVES_MAP (type=23).
 *
 * C++ behavior (TEVENT.CPP):
 *   case TEVENT_LEAVES_MAP:
 *     // Check to see if a team of the appropriate type has left the map.
 *     // Iterates Teams looking for one where Team matches, Is_Empty(), and IsLeaveMap.
 *     // If found, td.IsTripped = true; otherwise return false.
 *
 * Returns true only when the event's TeamType index is present in the
 * left-map team set. The global unitsLeftMap counter is not sufficient.
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

  /** Helper: create a LEAVES_MAP trigger event for a TeamType index. */
  const leavesMapEvent = (team = 12): TriggerEvent => ({
    type: TEVENT_LEAVES_MAP,
    team,
    data: 0,
  });

  it('constant value is 23 (C++ TEVENT_LEAVES_MAP enum index)', () => {
    // Verify type=23 reaches the LEAVES_MAP path by checking both outcomes.
    const event: TriggerEvent = { type: 23, team: 12, data: 0 };
    const stateNone = createState({ unitsLeftMap: 0 });
    const stateSome = createState({ unitsLeftMap: 0, leftMapTeamTypes: new Set([12]) });

    expect(checkTriggerEvent(event, stateNone)).toBe(false);
    expect(checkTriggerEvent(event, stateSome)).toBe(true);
  });

  it('returns false when no matching team type left the map', () => {
    const state = createState({ unitsLeftMap: 5, leftMapTeamTypes: new Set([13]) });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(false);
  });

  it('returns true when the matching team type emptied off-map', () => {
    const state = createState({ unitsLeftMap: 1, leftMapTeamTypes: new Set([12]) });
    expect(checkTriggerEvent(leavesMapEvent(), state)).toBe(true);
  });

  it('team -1 does not match C++ TeamType lookup', () => {
    const state = createState({ unitsLeftMap: 1, leftMapTeamTypes: new Set([12]) });
    expect(checkTriggerEvent(leavesMapEvent(-1), state)).toBe(false);
  });

  it('other state fields do not affect the team match', () => {
    const stateWithNoise = createState({
      unitsLeftMap: 99,
      leftMapTeamTypes: new Set([14]),
      playerEntered: true,
      enemyKillCount: 100,
      playerCredits: 50000,
      missionTimerExpired: true,
      isLowPower: true,
      civiliansEvacuated: 10,
    });
    expect(checkTriggerEvent(leavesMapEvent(), stateWithNoise)).toBe(false);

    const stateWithMatchingTeam = createState({
      ...stateWithNoise,
      leftMapTeamTypes: new Set([12, 14]),
    });
    expect(checkTriggerEvent(leavesMapEvent(), stateWithMatchingTeam)).toBe(true);
  });
});
