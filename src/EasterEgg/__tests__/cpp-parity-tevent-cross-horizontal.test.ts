/**
 * C++ Behavioral Parity Tests — TEVENT_CROSS_HORIZONTAL (type=25)
 *
 * C++ behavior: Returns true when state.playerEntered is true.
 * Player crossed a horizontal line — uses the playerEntered flag.
 *
 * Reference: SCENARIO.CPP — TriggerClass::Spring() switch on TEVENT_CROSS_HORIZONTAL
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

function makeEvent(type: number, data = 0): TriggerEvent {
  return { type, team: -1, data };
}

describe('C++ parity — TEVENT_CROSS_HORIZONTAL (type=25)', () => {
  it('returns false when playerEntered=false', () => {
    const state = createState({ playerEntered: false });
    const event = makeEvent(TEVENT_CROSS_HORIZONTAL);
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when playerEntered=true', () => {
    const state = createState({ playerEntered: true });
    const event = makeEvent(TEVENT_CROSS_HORIZONTAL);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('constant value is 25', () => {
    // Verify the constant matches the C++ enum value
    expect(TEVENT_CROSS_HORIZONTAL).toBe(25);
  });
});
