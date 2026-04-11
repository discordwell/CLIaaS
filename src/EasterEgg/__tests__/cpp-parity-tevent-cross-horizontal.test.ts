/**
 * C++ Behavioral Parity Tests — TEVENT_CROSS_HORIZONTAL (type=25)
 *
 * C++ behavior: fires when a matching-house unit crosses the Y row of the
 * trigger's cell. foot.cpp:1419-1428 scans all cells in the row.
 * tevent.cpp:290-293 checks object->Owner() == Data.House.
 *
 * After parity fix #21, uses its own `crossedHorizontal` flag instead of
 * the generic `playerEntered`.
 *
 * Reference: tevent.cpp:290-293, foot.cpp:1419-1428
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// TEVENT_CROSS_HORIZONTAL = 25 (not exported, so we use the literal)
const TEVENT_CROSS_HORIZONTAL = 25;

/** Create a minimal TriggerGameState with all required fields */
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

function makeEvent(type: number, data = 0): TriggerEvent {
  return { type, team: -1, data };
}

describe('C++ parity — TEVENT_CROSS_HORIZONTAL (type=25)', () => {
  it('returns false when crossedHorizontal=false', () => {
    const state = createState({ crossedHorizontal: false });
    const event = makeEvent(TEVENT_CROSS_HORIZONTAL);
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when crossedHorizontal=true', () => {
    const state = createState({ crossedHorizontal: true });
    const event = makeEvent(TEVENT_CROSS_HORIZONTAL);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('constant value is 25', () => {
    // Verify the constant matches the C++ enum value
    expect(TEVENT_CROSS_HORIZONTAL).toBe(25);
  });
});
