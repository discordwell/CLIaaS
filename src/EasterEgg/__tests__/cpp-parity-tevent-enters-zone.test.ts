/**
 * C++ behavioral parity tests for TEVENT_ENTERS_ZONE (type=24).
 *
 * C++ source: TEVENT.H — TEVENT_ENTERS_ZONE = 24
 * C++ behavior: TriggerClass::Spring() fires when a matching-house unit enters
 *   the same movement zone as the trigger's attached cell.
 *   tevent.cpp:290-293 checks object->Owner() == Data.House.
 *   foot.cpp:1447-1455 checks zone membership via Map[trigger->Cell].Zones[MZone].
 *
 * After parity fix #21, TEVENT_ENTERS_ZONE uses its own `enteredZone` flag,
 * separate from TEVENT_PLAYER_ENTERED's `playerEntered`.
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

  it('returns false when enteredZone is false', () => {
    const event = createEvent();
    const state = createState({ enteredZone: false });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when enteredZone is true', () => {
    const event = createEvent();
    const state = createState({ enteredZone: true });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('uses enteredZone (not playerEntered) — C++ parity fix #21', () => {
    // After fix #21, TEVENT_ENTERS_ZONE uses its own enteredZone flag.
    // TEVENT_PLAYER_ENTERED still uses playerEntered.
    // TEVENT_DISCOVERED uses objectDiscovered.
    const entersZoneEvent: TriggerEvent = { type: TEVENT_ENTERS_ZONE, team: -1, data: 0 };
    const discoveredEvent: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const playerEnteredEvent: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };

    // enteredZone=true, others false
    const stateZoneOnly = createState({ enteredZone: true, playerEntered: false, objectDiscovered: false });
    expect(checkTriggerEvent(entersZoneEvent, stateZoneOnly)).toBe(true);
    expect(checkTriggerEvent(discoveredEvent, stateZoneOnly)).toBe(false);
    expect(checkTriggerEvent(playerEnteredEvent, stateZoneOnly)).toBe(false);

    // playerEntered=true, enteredZone=false
    const statePlayerOnly = createState({ playerEntered: true, enteredZone: false, objectDiscovered: false });
    expect(checkTriggerEvent(entersZoneEvent, statePlayerOnly)).toBe(false);
    expect(checkTriggerEvent(playerEnteredEvent, statePlayerOnly)).toBe(true);
  });

  it('event.data is not checked by checkTriggerEvent — only enteredZone matters', () => {
    // C++ tevent.cpp:290-293 checks Data.House, but that ownership check happens
    // in the engine layer (checkZoneAndCrossTriggers) before setting enteredZone.
    // At the checkTriggerEvent level, only the boolean flag matters.
    for (const data of [0, 1, 42, 255, -1]) {
      const event = createEvent({ data });
      expect(checkTriggerEvent(event, createState({ enteredZone: false }))).toBe(false);
      expect(checkTriggerEvent(event, createState({ enteredZone: true }))).toBe(true);
    }
  });

  it('other state fields do not affect the result', () => {
    // enteredZone=true with various other state mutations — should still return true
    const stateTrue = createState({
      enteredZone: true,
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

    // enteredZone=false with the same mutations — should still return false
    const stateFalse = createState({
      enteredZone: false,
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
