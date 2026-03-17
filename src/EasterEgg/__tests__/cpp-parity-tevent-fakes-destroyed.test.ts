/**
 * C++ Behavioral Parity: TEVENT_FAKES_DESTROYED (type=29) Trigger Event
 *
 * Tests verify that checkTriggerEvent returns the correct boolean for the
 * FAKES_DESTROYED event, matching C++ RA source (TEVENT.H / TRIGGER.CPP).
 *
 * C++ behavior: TEVENT_FAKES_DESTROYED fires when all fake structures have
 * been destroyed — i.e., no fake structures remain on the map.
 *   In C++: all fake structures gone (no fakes alive)
 *   In TS:  !state.fakesExist
 *
 * The event.data field is irrelevant — TEVENT_FAKES_DESTROYED is a pure
 * boolean check on whether any fake structures still exist.
 *
 * C++ enum: TEVENT_FAKES_DESTROYED = 29 (TEVENT.H)
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
    fakesExist: true,
    spiedBuildings: new Set<string>(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

const TEVENT_FAKES_DESTROYED = 29;

/** Build a TriggerEvent with type=29 (TEVENT_FAKES_DESTROYED). */
function makeFakesDestroyedEvent(data = 0, team = -1): TriggerEvent {
  return { type: TEVENT_FAKES_DESTROYED, team, data };
}

// =============================================================================
//  TEVENT_FAKES_DESTROYED — All fake structures destroyed (C++ TEVENT.H)
// =============================================================================

describe('TEVENT_FAKES_DESTROYED (type=29) — C++ behavioral parity', () => {

  // --------------------------------------------------------------------------
  //  1. Constant value
  // --------------------------------------------------------------------------

  it('TEVENT_FAKES_DESTROYED constant value is 29 (C++ TEVENT.H enum)', () => {
    expect(TEVENT_FAKES_DESTROYED).toBe(29);

    // Verify the switch case maps type 29 to fakesExist by confirming
    // opposite results for the two boolean states.
    const trueState = makeState({ fakesExist: false });
    const falseState = makeState({ fakesExist: true });
    const event: TriggerEvent = { type: 29, team: -1, data: 0 };

    expect(checkTriggerEvent(event, trueState)).toBe(true);
    expect(checkTriggerEvent(event, falseState)).toBe(false);
  });

  // --------------------------------------------------------------------------
  //  2. Returns true when no fakes exist (all destroyed)
  // --------------------------------------------------------------------------

  it('returns true when no fake structures exist (fakesExist=false)', () => {
    const state = makeState({ fakesExist: false });
    const event = makeFakesDestroyedEvent();
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // --------------------------------------------------------------------------
  //  3. Returns false when fakes still exist
  // --------------------------------------------------------------------------

  it('returns false when fake structures still exist (fakesExist=true)', () => {
    const state = makeState({ fakesExist: true });
    const event = makeFakesDestroyedEvent();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // --------------------------------------------------------------------------
  //  4. event.data is irrelevant — only fakesExist matters
  // --------------------------------------------------------------------------

  describe('event.data is irrelevant', () => {
    const dataValues = [0, 1, 5, 42, 255, -1];

    it('returns true regardless of event.data when fakesExist=false', () => {
      for (const data of dataValues) {
        const state = makeState({ fakesExist: false });
        expect(
          checkTriggerEvent(makeFakesDestroyedEvent(data), state),
          `data=${data}: should be true when no fakes exist`,
        ).toBe(true);
      }
    });

    it('returns false regardless of event.data when fakesExist=true', () => {
      for (const data of dataValues) {
        const state = makeState({ fakesExist: true });
        expect(
          checkTriggerEvent(makeFakesDestroyedEvent(data), state),
          `data=${data}: should be false when fakes still exist`,
        ).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  //  5. team field does not affect the result
  // --------------------------------------------------------------------------

  it('team field does not affect the result', () => {
    const teamValues = [-1, 0, 1, 7];

    for (const team of teamValues) {
      const event = makeFakesDestroyedEvent(0, team);

      const stateNoFakes = makeState({ fakesExist: false });
      expect(
        checkTriggerEvent(event, stateNoFakes),
        `team=${team}: should be true when no fakes exist`,
      ).toBe(true);

      const stateHasFakes = makeState({ fakesExist: true });
      expect(
        checkTriggerEvent(event, stateHasFakes),
        `team=${team}: should be false when fakes still exist`,
      ).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  //  6. Toggles correctly when fake state changes (destruction scenario)
  // --------------------------------------------------------------------------

  it('toggles correctly as fakes are destroyed and rebuilt', () => {
    const event = makeFakesDestroyedEvent();

    // Initially fakes exist
    const stateWithFakes = makeState({ fakesExist: true });
    expect(checkTriggerEvent(event, stateWithFakes)).toBe(false);

    // All fakes destroyed
    const stateNoFakes = makeState({ fakesExist: false });
    expect(checkTriggerEvent(event, stateNoFakes)).toBe(true);

    // Player rebuilds fake structures
    const stateRebuilt = makeState({ fakesExist: true });
    expect(checkTriggerEvent(event, stateRebuilt)).toBe(false);
  });
});
