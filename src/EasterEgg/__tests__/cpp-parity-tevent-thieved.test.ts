/**
 * C++ Behavioral Parity: TEVENT_THIEVED (type=3) Trigger Event
 *
 * Tests verify that checkTriggerEvent returns the correct boolean for the
 * THIEVED event, matching C++ RA source (TEVENT.H / TRIGGER.CPP).
 *
 * C++ behavior: TEVENT_THIEVED fires when House.IsThieved is true,
 * indicating a Thief unit has infiltrated a PROC or SILO building.
 * The event.data field is irrelevant — only state.isThieved matters.
 *
 * C++ enum: TEVENT_THIEVED = 3 (TEVENT.H:49)
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// -- Helpers ------------------------------------------------------------------

/** Minimal TriggerGameState with all required fields at safe defaults. */
function makeState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set<number>(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set<string>(),
    builtStructureTypes: new Set<string>(),
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
    destroyedTriggerNames: new Set<string>(),
    attackedTriggerNames: new Set<string>(),
    houseAlive: new Map<number, boolean>(),
    houseUnitsAlive: new Map<number, boolean>(),
    houseBuildingsAlive: new Map<number, boolean>(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map<number, boolean>(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: false,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set<string>(),
    builtInfantryTypes: new Set<string>(),
    builtAircraftTypes: new Set<string>(),
    fakesExist: false,
    spiedBuildings: new Set<string>(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

/** Build a TriggerEvent with type=3 (TEVENT_THIEVED). */
function makeThievedEvent(data = 0): TriggerEvent {
  return { type: 3, team: -1, data };
}

// =============================================================================
//  TEVENT_THIEVED — Thief infiltrated PROC/SILO (C++ TEVENT.H:49)
// =============================================================================

describe('TEVENT_THIEVED (type=3) — C++ parity', () => {

  // --------------------------------------------------------------------------
  //  1. Returns false when isThieved=false
  // --------------------------------------------------------------------------

  it('returns false when state.isThieved is false', () => {
    const state = makeState({ isThieved: false });
    const event = makeThievedEvent();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // --------------------------------------------------------------------------
  //  2. Returns true when isThieved=true
  // --------------------------------------------------------------------------

  it('returns true when state.isThieved is true', () => {
    const state = makeState({ isThieved: true });
    const event = makeThievedEvent();
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // --------------------------------------------------------------------------
  //  3. event.data is irrelevant — only isThieved matters
  // --------------------------------------------------------------------------

  describe('event.data is irrelevant', () => {

    it('returns true regardless of event.data=0 when isThieved=true', () => {
      const state = makeState({ isThieved: true });
      expect(checkTriggerEvent(makeThievedEvent(0), state)).toBe(true);
    });

    it('returns true regardless of event.data=42 when isThieved=true', () => {
      const state = makeState({ isThieved: true });
      expect(checkTriggerEvent(makeThievedEvent(42), state)).toBe(true);
    });

    it('returns true regardless of event.data=999 when isThieved=true', () => {
      const state = makeState({ isThieved: true });
      expect(checkTriggerEvent(makeThievedEvent(999), state)).toBe(true);
    });

    it('returns false regardless of event.data=0 when isThieved=false', () => {
      const state = makeState({ isThieved: false });
      expect(checkTriggerEvent(makeThievedEvent(0), state)).toBe(false);
    });

    it('returns false regardless of event.data=42 when isThieved=false', () => {
      const state = makeState({ isThieved: false });
      expect(checkTriggerEvent(makeThievedEvent(42), state)).toBe(false);
    });

    it('returns false regardless of event.data=999 when isThieved=false', () => {
      const state = makeState({ isThieved: false });
      expect(checkTriggerEvent(makeThievedEvent(999), state)).toBe(false);
    });

    it('returns false regardless of event.data=-1 when isThieved=false', () => {
      const state = makeState({ isThieved: false });
      expect(checkTriggerEvent(makeThievedEvent(-1), state)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  //  4. Constant value is 3 (C++ enum TEVENT_THIEVED = 3)
  // --------------------------------------------------------------------------

  it('TEVENT_THIEVED constant value is 3 (C++ TEVENT.H enum)', () => {
    // Verify the event type=3 routes to the thieved check by confirming
    // type=3 with isThieved=true returns true, and type=3 with isThieved=false
    // returns false — proving the switch case maps type 3 to isThieved.
    const trueState = makeState({ isThieved: true });
    const falseState = makeState({ isThieved: false });
    const event: TriggerEvent = { type: 3, team: -1, data: 0 };

    expect(checkTriggerEvent(event, trueState)).toBe(true);
    expect(checkTriggerEvent(event, falseState)).toBe(false);
  });
});
