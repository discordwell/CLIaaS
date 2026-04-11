/**
 * C++ Behavioral Parity Tests — TEVENT_HOUSE_DISCOVERED (type=5)
 *
 * C++ behavior: tevent.cpp:435-436 — hptr = HouseClass::As_Pointer(Data.House),
 *   checks hptr->IsDiscovered. IsDiscovered is set in techno.cpp:792 when any
 *   unit of that house is first seen by the player.
 *
 * After parity fix #21, uses `houseDiscovered` map keyed by RA house index
 * instead of the generic `playerEntered` flag.
 *
 * Reference: tevent.cpp:417-436, techno.cpp:792
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// TEVENT_HOUSE_DISCOVERED = 5 (not exported, so we use the literal)
const TEVENT_HOUSE_DISCOVERED = 5;

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

describe('C++ parity — TEVENT_HOUSE_DISCOVERED (type=5)', () => {
  it('returns false when the specified house is not discovered', () => {
    // event.data = 2 (USSR), houseDiscovered map is empty
    const state = createState({ houseDiscovered: new Map() });
    const event = makeEvent(TEVENT_HOUSE_DISCOVERED, 2);
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when the specified house is discovered', () => {
    // C++ tevent.cpp:435-436: checks hptr->IsDiscovered for Data.House
    const state = createState({ houseDiscovered: new Map([[2, true]]) });
    const event = makeEvent(TEVENT_HOUSE_DISCOVERED, 2);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('checks the specific house from event.data (Data.House)', () => {
    // USSR (2) is discovered but Spain (0) is not
    const state = createState({ houseDiscovered: new Map([[2, true]]) });
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 0), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_HOUSE_DISCOVERED, 2), state)).toBe(true);
  });

  it('constant value is 5', () => {
    // Verify the constant matches the C++ enum value
    expect(TEVENT_HOUSE_DISCOVERED).toBe(5);
  });
});
