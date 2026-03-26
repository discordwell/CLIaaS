/**
 * C++ Behavioral Parity Tests — TEVENT_NUNITS_DESTROYED (type=16)
 *
 * C++ behavior: returns state.enemyKillCount >= event.data
 * The trigger fires when the player has killed at least N enemy units,
 * where N is the threshold stored in event.data.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// TEVENT_NUNITS_DESTROYED constant from C++ (and scenario.ts)
const TEVENT_NUNITS_DESTROYED = 16;

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

function makeEvent(threshold: number): TriggerEvent {
  return { type: TEVENT_NUNITS_DESTROYED, team: -1, data: threshold };
}

describe('TEVENT_NUNITS_DESTROYED (type=16) — C++ parity', () => {
  it('constant value is 16', () => {
    expect(TEVENT_NUNITS_DESTROYED).toBe(16);
  });

  it('returns false when kills < threshold', () => {
    const state = createState({ enemyKillCount: 4 });
    expect(checkTriggerEvent(makeEvent(5), state)).toBe(false);
  });

  it('returns true when kills == threshold', () => {
    const state = createState({ enemyKillCount: 5 });
    expect(checkTriggerEvent(makeEvent(5), state)).toBe(true);
  });

  it('returns true when kills > threshold', () => {
    const state = createState({ enemyKillCount: 10 });
    expect(checkTriggerEvent(makeEvent(5), state)).toBe(true);
  });

  it('threshold=0 always returns true (0 >= 0)', () => {
    const state = createState({ enemyKillCount: 0 });
    expect(checkTriggerEvent(makeEvent(0), state)).toBe(true);
  });

  it('threshold=0 with positive kills returns true', () => {
    const state = createState({ enemyKillCount: 3 });
    expect(checkTriggerEvent(makeEvent(0), state)).toBe(true);
  });

  it('returns false when kills=0 and threshold > 0', () => {
    const state = createState({ enemyKillCount: 0 });
    expect(checkTriggerEvent(makeEvent(1), state)).toBe(false);
  });

  it('handles large threshold values', () => {
    const state = createState({ enemyKillCount: 999 });
    expect(checkTriggerEvent(makeEvent(1000), state)).toBe(false);

    const state2 = createState({ enemyKillCount: 1000 });
    expect(checkTriggerEvent(makeEvent(1000), state2)).toBe(true);
  });

  it('threshold=1 requires at least one kill', () => {
    expect(checkTriggerEvent(makeEvent(1), createState({ enemyKillCount: 0 }))).toBe(false);
    expect(checkTriggerEvent(makeEvent(1), createState({ enemyKillCount: 1 }))).toBe(true);
    expect(checkTriggerEvent(makeEvent(1), createState({ enemyKillCount: 2 }))).toBe(true);
  });

  it('SCA02EA los1 (threshold=8) should NOT fire at tick 0 with fresh killCount', () => {
    // Bug: killCount from SCA01EA carried into SCA02EA, causing instant loss.
    // After fix: killCount resets to 0 between missions.
    const state = createState({ enemyKillCount: 0, gameTick: 0 });
    expect(checkTriggerEvent(makeEvent(8), state)).toBe(false);
  });

  it('SCA02EA los1 fires only when 8+ kills achieved in current mission', () => {
    expect(checkTriggerEvent(makeEvent(8), createState({ enemyKillCount: 7 }))).toBe(false);
    expect(checkTriggerEvent(makeEvent(8), createState({ enemyKillCount: 8 }))).toBe(true);
  });
});
