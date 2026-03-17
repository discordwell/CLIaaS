/**
 * C++ Behavioral Parity Tests — TEVENT_SPIED (type=2)
 *
 * C++ source: TEVENT.H:46-83, TRIGGER.CPP
 * TEVENT_SPIED fires when a Spy has infiltrated the building that has
 * this trigger attached. The check is:
 *   state.spiedBuildings.has(state.triggerName)
 *
 * The spiedBuildings set contains the trigger names of buildings that
 * have been spy-infiltrated. The trigger only fires when its own name
 * appears in that set — exact string match required.
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

const TEVENT_SPIED = 2;

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

/** Create a TEVENT_SPIED event (data is unused for this event type) */
function spiedEvent(): TriggerEvent {
  return { type: TEVENT_SPIED, team: -1, data: 0 };
}

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_SPIED (type=2) — C++ behavioral parity', () => {
  it('constant value is 2', () => {
    // C++ enum: TEVENT_SPIED = 2 (TEVENT.H)
    // Verify our local alias matches and that type=2 reaches the SPIED branch
    expect(TEVENT_SPIED).toBe(2);

    // Also verify the branch is reachable by checking a known-true case
    const state = createState({
      triggerName: 'probe',
      spiedBuildings: new Set(['probe']),
    });
    expect(checkTriggerEvent({ type: 2, team: -1, data: 0 }, state)).toBe(true);
  });

  it('returns false when spiedBuildings is empty', () => {
    const state = createState({
      triggerName: 'spyTrig',
      spiedBuildings: new Set(),
    });
    expect(checkTriggerEvent(spiedEvent(), state)).toBe(false);
  });

  it('returns false when spiedBuildings contains other trigger names but not this one', () => {
    const state = createState({
      triggerName: 'myTrigger',
      spiedBuildings: new Set(['otherTrig', 'anotherTrig', 'someTrig']),
    });
    expect(checkTriggerEvent(spiedEvent(), state)).toBe(false);
  });

  it('returns true when spiedBuildings contains this trigger\'s name', () => {
    const state = createState({
      triggerName: 'spyTarget',
      spiedBuildings: new Set(['spyTarget']),
    });
    expect(checkTriggerEvent(spiedEvent(), state)).toBe(true);
  });

  it('triggerName must match exactly — case sensitivity', () => {
    // C++ Set::has uses exact string comparison; 'SpyTrig' !== 'spytrig'
    const event = spiedEvent();

    const stateUpper = createState({
      triggerName: 'SpyTrig',
      spiedBuildings: new Set(['spytrig']),
    });
    expect(checkTriggerEvent(event, stateUpper)).toBe(false);

    const stateLower = createState({
      triggerName: 'spytrig',
      spiedBuildings: new Set(['SpyTrig']),
    });
    expect(checkTriggerEvent(event, stateLower)).toBe(false);

    // Exact match succeeds
    const stateExact = createState({
      triggerName: 'SpyTrig',
      spiedBuildings: new Set(['SpyTrig']),
    });
    expect(checkTriggerEvent(event, stateExact)).toBe(true);
  });

  it('triggerName must match exactly — whitespace and substrings', () => {
    const event = spiedEvent();

    // Substring of the trigger name should not match
    const stateSubstring = createState({
      triggerName: 'spyTrigger',
      spiedBuildings: new Set(['spyTrig']),
    });
    expect(checkTriggerEvent(event, stateSubstring)).toBe(false);

    // Superset string should not match
    const stateSuper = createState({
      triggerName: 'spy',
      spiedBuildings: new Set(['spyTrigger']),
    });
    expect(checkTriggerEvent(event, stateSuper)).toBe(false);

    // Leading/trailing whitespace should not match
    const stateWhitespace = createState({
      triggerName: 'spyTrig',
      spiedBuildings: new Set([' spyTrig', 'spyTrig ']),
    });
    expect(checkTriggerEvent(event, stateWhitespace)).toBe(false);
  });

  it('multiple spied buildings — only the matching one fires', () => {
    const event = spiedEvent();

    // Trigger A is in spiedBuildings along with several others
    const stateMatch = createState({
      triggerName: 'trigA',
      spiedBuildings: new Set(['trigB', 'trigA', 'trigC', 'trigD']),
    });
    expect(checkTriggerEvent(event, stateMatch)).toBe(true);

    // Trigger E is NOT in the set, even though the set has many entries
    const stateNoMatch = createState({
      triggerName: 'trigE',
      spiedBuildings: new Set(['trigB', 'trigA', 'trigC', 'trigD']),
    });
    expect(checkTriggerEvent(event, stateNoMatch)).toBe(false);
  });
});
