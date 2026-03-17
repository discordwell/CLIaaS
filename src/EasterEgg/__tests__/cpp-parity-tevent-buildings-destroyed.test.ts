/**
 * C++ Behavioral Parity Tests: TEVENT_BUILDINGS_DESTROYED (type=10)
 *
 * C++ behavior: Returns true when state.buildingsDestroyedByHouse.get(event.data) is true.
 * event.data is the RA house index. Fires when ALL buildings (structures only, excluding
 * walls) of the specified house are destroyed.
 *
 * Reference: TRIGGER.CPP, tevent.h — TEVENT_BUILDINGS_DESTROYED = 10
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

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

const TEVENT_BUILDINGS_DESTROYED = 10;

describe('TEVENT_BUILDINGS_DESTROYED (type=10) — C++ parity', () => {
  it('constant value is 10 (matches C++ tevent.h enum)', () => {
    // Verify that type=10 is handled as BUILDINGS_DESTROYED by checking
    // it returns true for the correct state and false for default state
    const event: TriggerEvent = { type: 10, team: -1, data: 0 };
    const stateDestroyed = createState({
      buildingsDestroyedByHouse: new Map([[0, true]]),
    });
    expect(checkTriggerEvent(event, stateDestroyed)).toBe(true);

    const stateDefault = createState();
    expect(checkTriggerEvent(event, stateDefault)).toBe(false);
  });

  it('returns false when house buildings are NOT all destroyed (map entry false)', () => {
    const houseIdx = 2; // Soviet house index
    const event: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: houseIdx };
    const state = createState({
      buildingsDestroyedByHouse: new Map([[houseIdx, false]]),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false when house not in map (undefined)', () => {
    const houseIdx = 5; // house index not present in map
    const event: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: houseIdx };
    // Empty map — no entry for house 5
    const state = createState({
      buildingsDestroyedByHouse: new Map(),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when all house buildings destroyed (map entry true)', () => {
    const houseIdx = 1; // Allied house index
    const event: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: houseIdx };
    const state = createState({
      buildingsDestroyedByHouse: new Map([[houseIdx, true]]),
    });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('different house indices are independent', () => {
    // House 0 destroyed, house 1 not destroyed, house 3 not in map
    const buildingsDestroyedByHouse = new Map([
      [0, true],
      [1, false],
    ]);
    const state = createState({ buildingsDestroyedByHouse });

    const eventHouse0: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: 0 };
    const eventHouse1: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: 1 };
    const eventHouse3: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: 3 };

    expect(checkTriggerEvent(eventHouse0, state)).toBe(true);
    expect(checkTriggerEvent(eventHouse1, state)).toBe(false);
    expect(checkTriggerEvent(eventHouse3, state)).toBe(false);
  });
});
