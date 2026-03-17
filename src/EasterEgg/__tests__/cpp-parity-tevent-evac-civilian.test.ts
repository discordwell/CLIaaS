/**
 * C++ Behavioral Parity: TEVENT_EVAC_CIVILIAN (type=18)
 *
 * Tests verify that the civilian evacuation trigger event matches C++ RA
 * source code behavior (tevent.h / scenario.cpp).
 *
 * C++ logic: TEVENT_EVAC_CIVILIAN fires when state.civiliansEvacuated > 0.
 * The event.data field is irrelevant — any non-zero evacuation count fires it.
 *
 * These tests describe WHAT happens (observable boolean result), not HOW
 * the code implements it. The same scenarios should produce identical
 * results in C++ and TypeScript.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// -- Helpers ------------------------------------------------------------------

const TEVENT_EVAC_CIVILIAN = 18;

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
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

// =============================================================================
//  TEVENT_EVAC_CIVILIAN constant value
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN constant (C++ tevent.h parity)', () => {

  it('type constant is 18 (matches C++ enum TEVENT_EVAC_CIVILIAN = 18)', () => {
    expect(TEVENT_EVAC_CIVILIAN).toBe(18);
  });
});

// =============================================================================
//  Core behavior: returns false when civiliansEvacuated == 0
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN returns false when no civilians evacuated', () => {

  it('returns false when civiliansEvacuated is 0', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 0 });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false with default state (civiliansEvacuated defaults to 0)', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });
});

// =============================================================================
//  Core behavior: returns true when civiliansEvacuated > 0
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN returns true when 1+ civilians evacuated', () => {

  it('returns true when civiliansEvacuated is 1', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 1 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when civiliansEvacuated is 2', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 2 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when civiliansEvacuated is 10', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 10 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when civiliansEvacuated is 100 (large count)', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 100 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});

// =============================================================================
//  event.data is irrelevant — C++ does not use it for this event type
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN ignores event.data (C++ parity)', () => {

  it('returns false regardless of event.data when civiliansEvacuated is 0', () => {
    const state = createState({ civiliansEvacuated: 0 });
    for (const data of [0, 1, 5, 42, 255]) {
      const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data };
      expect(
        checkTriggerEvent(event, state),
        `event.data=${data} should not cause true when civiliansEvacuated=0`,
      ).toBe(false);
    }
  });

  it('returns true regardless of event.data when civiliansEvacuated is 1', () => {
    const state = createState({ civiliansEvacuated: 1 });
    for (const data of [0, 1, 5, 42, 255]) {
      const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data };
      expect(
        checkTriggerEvent(event, state),
        `event.data=${data} should not prevent true when civiliansEvacuated=1`,
      ).toBe(true);
    }
  });

  it('event.data=0 and event.data=99 produce same result for 0 evacuated', () => {
    const state = createState({ civiliansEvacuated: 0 });
    const eventA: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const eventB: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 99 };
    expect(checkTriggerEvent(eventA, state)).toBe(checkTriggerEvent(eventB, state));
  });

  it('event.data=0 and event.data=99 produce same result for 5 evacuated', () => {
    const state = createState({ civiliansEvacuated: 5 });
    const eventA: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const eventB: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 99 };
    expect(checkTriggerEvent(eventA, state)).toBe(checkTriggerEvent(eventB, state));
  });
});

// =============================================================================
//  Boundary behavior: only 0 is false, everything > 0 is true
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN boundary: 0 vs 1 threshold', () => {

  it('civiliansEvacuated=0 -> false, civiliansEvacuated=1 -> true', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ civiliansEvacuated: 0 }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ civiliansEvacuated: 1 }))).toBe(true);
  });

  it('threshold is binary: does not compare against event.data as a count', () => {
    // In C++, TEVENT_EVAC_CIVILIAN checks > 0, not >= event.data.
    // So even if event.data is 5, one evacuation fires the trigger.
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 5 };
    const state = createState({ civiliansEvacuated: 1 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});

// =============================================================================
//  Other game state fields do not affect TEVENT_EVAC_CIVILIAN
// =============================================================================

describe('TEVENT_EVAC_CIVILIAN is independent of other state fields', () => {

  it('returns true with civiliansEvacuated=1 even when enemyUnitsAlive is high', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 1, enemyUnitsAlive: 999 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns false with civiliansEvacuated=0 even when many buildings destroyed', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 0, nBuildingsDestroyed: 50 });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true with civiliansEvacuated=3 regardless of gameTick', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 3, gameTick: 99999 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns false with civiliansEvacuated=0 regardless of playerEntered', () => {
    const event: TriggerEvent = { type: TEVENT_EVAC_CIVILIAN, team: -1, data: 0 };
    const state = createState({ civiliansEvacuated: 0, playerEntered: true });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });
});
