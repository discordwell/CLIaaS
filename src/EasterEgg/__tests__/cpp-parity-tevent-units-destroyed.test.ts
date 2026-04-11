/**
 * C++ behavioral parity tests for TEVENT_UNITS_DESTROYED (type=9).
 *
 * C++ behavior: Returns true when ALL units (entities only, not structures)
 * of the specified house have been destroyed. Checks
 * state.houseUnitsAlive.get(event.data) — returns true when the value
 * is false or undefined (i.e., no living units for that house).
 *
 * event.data is the RA house index.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// === Helpers ===

/** TEVENT_UNITS_DESTROYED constant — must equal C++ value 9 */
const TEVENT_UNITS_DESTROYED = 9;

/** Create a minimal TriggerGameState with defaults */
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

/** Create a TEVENT_UNITS_DESTROYED event for a given house index */
function unitsDestroyedEvent(houseIndex: number): TriggerEvent {
  return { type: TEVENT_UNITS_DESTROYED, team: -1, data: houseIndex };
}

// === Tests ===

describe('TEVENT_UNITS_DESTROYED (type=9) — C++ parity', () => {
  it('constant value is 9', () => {
    // C++ enum TEventType: TEVENT_UNITS_DESTROYED = 9
    expect(TEVENT_UNITS_DESTROYED).toBe(9);
  });

  it('returns true when house has no alive units (map entry is false)', () => {
    // House 2 explicitly marked as having no living units
    const state = createState({
      houseUnitsAlive: new Map([[2, false]]),
    });
    expect(checkTriggerEvent(unitsDestroyedEvent(2), state)).toBe(true);
  });

  it('returns true when house is not in map (undefined coalesces to false)', () => {
    // House 5 has no entry at all — undefined ?? false → false → !false → true
    const state = createState({
      houseUnitsAlive: new Map(), // empty — no house entries
    });
    expect(checkTriggerEvent(unitsDestroyedEvent(5), state)).toBe(true);
  });

  it('returns false when house still has alive units (map entry is true)', () => {
    // House 3 still has living units
    const state = createState({
      houseUnitsAlive: new Map([[3, true]]),
    });
    expect(checkTriggerEvent(unitsDestroyedEvent(3), state)).toBe(false);
  });

  it('different house indices are independent', () => {
    // House 0 has units alive, house 1 does not, house 2 is absent from map
    const state = createState({
      houseUnitsAlive: new Map([
        [0, true],
        [1, false],
        // house 2 intentionally absent
      ]),
    });

    // House 0: units alive → not destroyed → false
    expect(checkTriggerEvent(unitsDestroyedEvent(0), state)).toBe(false);
    // House 1: explicitly no units → destroyed → true
    expect(checkTriggerEvent(unitsDestroyedEvent(1), state)).toBe(true);
    // House 2: absent from map → undefined → destroyed → true
    expect(checkTriggerEvent(unitsDestroyedEvent(2), state)).toBe(true);
  });
});
