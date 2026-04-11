/**
 * C++ Behavioral Parity Tests — TEVENT_PLAYER_ENTERED (type=1)
 *
 * C++ reference: TEVENT.H:46-83, TriggerClass::Spring() in TRIGGER.CPP
 *
 * TEVENT_PLAYER_ENTERED fires when a player unit enters a cell that has
 * a cell trigger attached. The engine sets state.playerEntered = true for
 * the trigger's evaluation frame.
 *
 * The event ignores event.data — the only thing that matters is the boolean
 * flag on the game state.
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

/** TEVENT_PLAYER_ENTERED constant value from C++ enum (TEVENT.H) */
const TEVENT_PLAYER_ENTERED = 1;

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
  };
}

/** Create a TEVENT_PLAYER_ENTERED event */
function createEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    type: TEVENT_PLAYER_ENTERED,
    team: -1,
    data: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_PLAYER_ENTERED (type=1) — C++ parity', () => {
  it('returns false when playerEntered is false', () => {
    const state = createState({ playerEntered: false });
    const event = createEvent();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when playerEntered is true', () => {
    const state = createState({ playerEntered: true });
    const event = createEvent();
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('event.data is irrelevant — does not affect result', () => {
    // With playerEntered=true, any data value should still return true
    const stateTrue = createState({ playerEntered: true });
    expect(checkTriggerEvent(createEvent({ data: 0 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 1 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 42 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: -1 }), stateTrue)).toBe(true);
    expect(checkTriggerEvent(createEvent({ data: 9999 }), stateTrue)).toBe(true);

    // With playerEntered=false, any data value should still return false
    const stateFalse = createState({ playerEntered: false });
    expect(checkTriggerEvent(createEvent({ data: 0 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: 1 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: 42 }), stateFalse)).toBe(false);
    expect(checkTriggerEvent(createEvent({ data: -1 }), stateFalse)).toBe(false);
  });

  it('other state fields do not affect result', () => {
    // playerEntered=true with various other state mutations — should still return true
    const stateTrue = createState({
      playerEntered: true,
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

    // playerEntered=false with the same mutations — should still return false
    const stateFalse = createState({
      playerEntered: false,
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

  it('TEVENT_PLAYER_ENTERED constant value is 1', () => {
    // Verify the constant matches the C++ enum value (TEVENT.H line 47)
    expect(TEVENT_PLAYER_ENTERED).toBe(1);

    // Also verify checkTriggerEvent handles type=1 correctly by passing raw value
    const state = createState({ playerEntered: true });
    const event: TriggerEvent = { type: 1, team: -1, data: 0 };
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});
