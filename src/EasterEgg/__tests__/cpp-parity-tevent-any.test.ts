/**
 * C++ Behavioral Parity Tests — TEVENT_ANY (type=8)
 *
 * C++ behavior: Always returns true regardless of state.
 * Used for triggers that should fire immediately or unconditionally.
 *
 * Reference: scenario.ts checkTriggerEvent(), C++ TriggerClass::Spring()
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// === Constants ===

const TEVENT_ANY = 8;

// === Helpers ===

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

function makeEvent(data = 0): TriggerEvent {
  return { type: TEVENT_ANY, team: -1, data };
}

// === Tests ===

describe('TEVENT_ANY (type=8) — C++ parity', () => {
  it('constant value is 8', () => {
    // The TEVENT_ANY enum must map to 8 to match the C++ trigger event table
    expect(TEVENT_ANY).toBe(8);
  });

  it('returns true with default empty state', () => {
    const result = checkTriggerEvent(makeEvent(), createState());
    expect(result).toBe(true);
  });

  it('returns true regardless of any state combination', () => {
    // Populate every state field with non-default values
    const busyState = createState({
      gameTick: 99999,
      globals: new Set([1, 2, 3]),
      triggerStartTick: 5000,
      triggerName: 'complex_trigger',
      playerEntered: true,
      enemyUnitsAlive: 50,
      enemyKillCount: 200,
      playerFactories: 3,
      missionTimerExpired: true,
      bridgesAlive: 5,
      unitsLeftMap: 10,
      structureTypes: new Set(['FACT', 'WEAP', 'TENT']),
      builtStructureTypes: new Set(['FACT', 'POWR']),
      destroyedTriggerNames: new Set(['trig1', 'trig2']),
      attackedTriggerNames: new Set(['trig3']),
      houseAlive: new Map([[0, true], [1, false], [2, true]]),
      houseUnitsAlive: new Map([[0, true], [1, false]]),
      houseBuildingsAlive: new Map([[0, false], [1, true]]),
      isLowPower: true,
      playerCredits: 50000,
      buildingsDestroyedByHouse: new Map([[0, true]]),
      nBuildingsDestroyed: 15,
      playerFactoriesExist: false,
      civiliansEvacuated: 7,
      builtUnitTypes: new Set(['1TNK', '2TNK']),
      builtInfantryTypes: new Set(['E1', 'E3']),
      builtAircraftTypes: new Set(['HELI', 'MIG']),
      fakesExist: false,
      spiedBuildings: new Set(['spy_trig']),
      isThieved: true,
      pendingDestroyedCount: 3,
    });

    const result = checkTriggerEvent(makeEvent(), busyState);
    expect(result).toBe(true);
  });

  it('returns true with event.data=0', () => {
    const result = checkTriggerEvent(makeEvent(0), createState());
    expect(result).toBe(true);
  });

  it('returns true with event.data=42', () => {
    const result = checkTriggerEvent(makeEvent(42), createState());
    expect(result).toBe(true);
  });
});
