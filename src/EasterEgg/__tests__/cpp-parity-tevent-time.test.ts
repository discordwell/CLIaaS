/**
 * C++ Behavioral Parity: TEVENT_TIME (type=13) Trigger Event
 *
 * Tests verify that the TEVENT_TIME trigger event matches C++ RA source code.
 *
 * C++ behavior (TRIGGER.CPP):
 *   Returns true when (state.gameTick - state.triggerStartTick) >= event.data * TIME_UNIT_TICKS
 *   event.data is time in "time units" (1/10th of a minute in C++).
 *   TIME_UNIT_TICKS converts time units to game ticks.
 *
 * These tests verify observable outcomes only — not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  TIME_UNIT_TICKS,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// TEVENT_TIME constant from C++ trigger event enum
const TEVENT_TIME = 13;

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

/** Create a TEVENT_TIME trigger event */
function timeEvent(data: number): TriggerEvent {
  return { type: TEVENT_TIME, team: -1, data };
}

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_TIME (type=13) — C++ parity', () => {
  it('returns false when not enough time has elapsed', () => {
    // event.data=5 means 5 time units = 5 * TIME_UNIT_TICKS ticks required
    const event = timeEvent(5);
    const requiredTicks = 5 * TIME_UNIT_TICKS;
    const state = createState({ gameTick: requiredTicks - 1, triggerStartTick: 0 });

    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when exactly enough time has elapsed', () => {
    const event = timeEvent(5);
    const requiredTicks = 5 * TIME_UNIT_TICKS;
    const state = createState({ gameTick: requiredTicks, triggerStartTick: 0 });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when more than enough time has elapsed', () => {
    const event = timeEvent(5);
    const requiredTicks = 5 * TIME_UNIT_TICKS;
    const state = createState({ gameTick: requiredTicks + 100, triggerStartTick: 0 });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('event.data=0 returns true immediately (0 ticks required)', () => {
    const event = timeEvent(0);
    // gameTick == triggerStartTick, so elapsed = 0, required = 0 => 0 >= 0 => true
    const state = createState({ gameTick: 0, triggerStartTick: 0 });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('triggerStartTick offsets the countdown correctly', () => {
    const event = timeEvent(3);
    const requiredTicks = 3 * TIME_UNIT_TICKS;

    // Trigger started at tick 500. Need 500 + requiredTicks to satisfy.
    const triggerStartTick = 500;

    // One tick short — should be false
    const stateBefore = createState({
      gameTick: triggerStartTick + requiredTicks - 1,
      triggerStartTick,
    });
    expect(checkTriggerEvent(event, stateBefore)).toBe(false);

    // Exactly at threshold — should be true
    const stateExact = createState({
      gameTick: triggerStartTick + requiredTicks,
      triggerStartTick,
    });
    expect(checkTriggerEvent(event, stateExact)).toBe(true);

    // Past threshold — should be true
    const stateAfter = createState({
      gameTick: triggerStartTick + requiredTicks + 50,
      triggerStartTick,
    });
    expect(checkTriggerEvent(event, stateAfter)).toBe(true);
  });

  it('TIME_UNIT_TICKS constant value is 90', () => {
    // C++ RA: 1 time unit = 1/10th minute. At 15 Hz that is 6 seconds * 15 = 90 ticks.
    // Our engine preserves 90 for proportional pacing even at 20 Hz tick rate.
    expect(TIME_UNIT_TICKS).toBe(90);
  });

  it('TEVENT_TIME type constant is 13', () => {
    // C++ enum value for TEVENT_TIME is 13
    expect(TEVENT_TIME).toBe(13);
    // Verify a type=13 event actually hits the TIME code path
    const event: TriggerEvent = { type: 13, team: -1, data: 1 };
    const stateFalse = createState({ gameTick: 0, triggerStartTick: 0 });
    const stateTrue = createState({ gameTick: TIME_UNIT_TICKS, triggerStartTick: 0 });
    expect(checkTriggerEvent(event, stateFalse)).toBe(false);
    expect(checkTriggerEvent(event, stateTrue)).toBe(true);
  });
});
