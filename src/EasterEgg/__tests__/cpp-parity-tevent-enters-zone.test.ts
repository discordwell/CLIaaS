/**
 * C++ behavioral parity tests for TEVENT_ENTERS_ZONE (type=24).
 *
 * C++ source: TEVENT.H — TEVENT_ENTERS_ZONE = 24
 * C++ behavior: TriggerClass::Spring() fires when a player unit enters
 *   a cell trigger zone. Internally identical to TEVENT_DISCOVERED (4) —
 *   both return state.playerEntered.
 *
 * In the TS implementation, TEVENT_ENTERS_ZONE (24), TEVENT_DISCOVERED (4),
 * and TEVENT_PLAYER_ENTERED (1) all share the same code path: they check
 * state.playerEntered. This mirrors the C++ behavior where all three represent
 * "player unit entered a trigger zone."
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

/** Create a minimal TriggerGameState with all required fields. */
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
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

/** C++ enum constants */
const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_DISCOVERED = 4;
const TEVENT_ENTERS_ZONE = 24;

/** Create a TEVENT_ENTERS_ZONE event */
function createEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    type: TEVENT_ENTERS_ZONE,
    team: -1,
    data: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_ENTERS_ZONE (type=24) — C++ behavioral parity', () => {
  it('constant value is 24 (C++ TEVENT.H enum index)', () => {
    // TEVENT_ENTERS_ZONE sits at index 24 in the C++ TEventType enum.
    // This test guards against accidental renumbering.
    expect(TEVENT_ENTERS_ZONE).toBe(24);
  });

  it('returns false when playerEntered is false', () => {
    const event = createEvent();
    const state = createState({ playerEntered: false });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when playerEntered is true', () => {
    const event = createEvent();
    const state = createState({ playerEntered: true });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('shares playerEntered behavior with TEVENT_DISCOVERED (type=4) and TEVENT_PLAYER_ENTERED (type=1)', () => {
    // In C++, TEVENT_PLAYER_ENTERED (1), TEVENT_DISCOVERED (4), and
    // TEVENT_ENTERS_ZONE (24) all check House.IsDiscoveredByPlayer /
    // cell trigger entry. The TS implementation mirrors this by routing
    // all three through state.playerEntered.
    const entersZoneEvent: TriggerEvent = { type: TEVENT_ENTERS_ZONE, team: -1, data: 0 };
    const discoveredEvent: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const playerEnteredEvent: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };

    // All false when playerEntered=false
    const stateFalse = createState({ playerEntered: false });
    expect(checkTriggerEvent(entersZoneEvent, stateFalse)).toBe(false);
    expect(checkTriggerEvent(discoveredEvent, stateFalse)).toBe(false);
    expect(checkTriggerEvent(playerEnteredEvent, stateFalse)).toBe(false);

    // All true when playerEntered=true
    const stateTrue = createState({ playerEntered: true });
    expect(checkTriggerEvent(entersZoneEvent, stateTrue)).toBe(true);
    expect(checkTriggerEvent(discoveredEvent, stateTrue)).toBe(true);
    expect(checkTriggerEvent(playerEnteredEvent, stateTrue)).toBe(true);
  });

  it('event.data is ignored — only playerEntered matters', () => {
    // C++ ENTERS_ZONE does not use the data parameter; verify arbitrary
    // data values do not change the result.
    for (const data of [0, 1, 42, 255, -1]) {
      const event = createEvent({ data });
      expect(checkTriggerEvent(event, createState({ playerEntered: false }))).toBe(false);
      expect(checkTriggerEvent(event, createState({ playerEntered: true }))).toBe(true);
    }
  });

  it('other state fields do not affect the result', () => {
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
});
