/**
 * C++ Behavioral Parity Tests — TEVENT_CROSS_VERTICAL (type=26)
 *
 * C++ reference: TEVENT.H, foot.cpp:1434-1442, tevent.cpp:290-293
 *
 * TEVENT_CROSS_VERTICAL fires when a matching-house unit crosses the X column
 * of the trigger's cell. tevent.cpp:290-293 checks object->Owner() == Data.House.
 *
 * After parity fix #21, uses its own `crossedVertical` flag instead of
 * the generic `playerEntered`.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// ============================================================================
// Helpers
// ============================================================================

/** TEVENT_CROSS_VERTICAL constant value from C++ enum (TEVENT.H) */
const TEVENT_CROSS_VERTICAL = 26;

/** Create a minimal TriggerGameState with all required fields */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    objectDiscovered: false,
    houseDiscovered: new Map(),
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
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
  };
}

/** Create a TEVENT_CROSS_VERTICAL event */
function createEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    type: TEVENT_CROSS_VERTICAL,
    team: -1,
    data: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_CROSS_VERTICAL (type=26) — C++ parity', () => {
  it('returns false when crossedVertical is false', () => {
    const state = createState({ crossedVertical: false });
    const event = createEvent();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when crossedVertical is true', () => {
    const state = createState({ crossedVertical: true });
    const event = createEvent();
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('event.data is irrelevant — does not affect result', () => {
    // With crossedVertical=true, any data value should still return true
    const stateTrue = createState({ crossedVertical: true });
    expect(checkTriggerEvent(createEvent({ data: 0 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 1 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 42 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: -1 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 9999 }), stateTrue)).toBe(true);

    // With crossedVertical=false, any data value should still return false
    const stateFalse = createState({ crossedVertical: false });
    expect(checkTriggerEvent(createEvent({ data: 0 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: 1 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: 42 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: -1 }), stateFalse)).toBe(false);
  });

  it('other state fields do not affect result', () => {
    // crossedVertical=true with various other state mutations — should still return true
    const stateTrue = createState({
      crossedVertical: true,
      gameTick: 5000,
      enemyUnitsAlive: 10,
      enemyKillCount: 25,
      playerCredits: 9999,
      isLowPower: true,
      missionTimerExpired: true,
      bridgesAlive: 3,
      isThieved: true,
      nBuildingsDestroyed: 7,
    });
    expect(checkTriggerEvent(createEvent(), stateTrue)).toBe(true);

    // crossedVertical=false with the same mutations — should still return false
    const stateFalse = createState({
      crossedVertical: false,
      gameTick: 5000,
      enemyUnitsAlive: 10,
      enemyKillCount: 25,
      playerCredits: 9999,
      isLowPower: true,
      missionTimerExpired: true,
      bridgesAlive: 3,
      isThieved: true,
      nBuildingsDestroyed: 7,
    });
    expect(checkTriggerEvent(createEvent(), stateFalse)).toBe(false);
  });

  it('TEVENT_CROSS_VERTICAL constant value is 26', () => {
    // Verify the constant matches the C++ enum value (TEVENT.H)
    expect(TEVENT_CROSS_VERTICAL).toBe(26);

    // Also verify checkTriggerEvent handles type=26 correctly by passing raw value
    const state = createState({ crossedVertical: true });
    const event: TriggerEvent = { type: 26, team: -1, data: 0 };
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});
