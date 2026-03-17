/**
 * C++ behavioral parity tests for TEVENT_ATTACKED (type=6).
 *
 * C++ source: TRIGGER.CPP — TriggerClass::Spring()
 * Returns true when state.attackedTriggerNames contains state.triggerName.
 * This fires when the entity/structure with this trigger attached has been damaged.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// === Constant under test ===
const TEVENT_ATTACKED = 6;

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

describe('TEVENT_ATTACKED (type=6) — C++ parity', () => {
  const event: TriggerEvent = { type: TEVENT_ATTACKED, team: -1, data: 0 };

  it('constant value is 6', () => {
    expect(TEVENT_ATTACKED).toBe(6);
  });

  it('returns false when attackedTriggerNames is empty', () => {
    const state = createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false when attackedTriggerNames has other names but not this trigger', () => {
    const state = createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(['patrol2', 'sentry3', 'base_def']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when attackedTriggerNames contains this trigger name', () => {
    const state = createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(['guard1']),
    });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('exact triggerName match required — no substring or prefix matching', () => {
    const state = createState({
      triggerName: 'guard',
      attackedTriggerNames: new Set(['guard1', 'guards', 'myguard']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);

    // Reverse: trigger name is the longer string
    const state2 = createState({
      triggerName: 'guard1',
      attackedTriggerNames: new Set(['guard']),
    });
    expect(checkTriggerEvent(event, state2)).toBe(false);
  });

  it('multiple attacked triggers — only the matching one fires', () => {
    const attacked = new Set(['alpha', 'bravo', 'charlie', 'delta']);

    // 'bravo' is in the set — should fire
    const stateBravo = createState({
      triggerName: 'bravo',
      attackedTriggerNames: attacked,
    });
    expect(checkTriggerEvent(event, stateBravo)).toBe(true);

    // 'echo' is NOT in the set — should not fire
    const stateEcho = createState({
      triggerName: 'echo',
      attackedTriggerNames: attacked,
    });
    expect(checkTriggerEvent(event, stateEcho)).toBe(false);
  });
});
