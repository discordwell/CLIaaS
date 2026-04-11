/**
 * C++ behavioral parity tests for TEVENT_DESTROYED (type=7).
 *
 * C++ behavior (trigger.cpp Spring()):
 *   Returns true when BOTH conditions are met:
 *     1. state.pendingDestroyedCount > 0
 *     2. state.destroyedTriggerNames contains state.triggerName
 *
 *   This is the most important trigger — fires when an entity/structure
 *   with this trigger attached is destroyed. pendingDestroyedCount tracks
 *   unprocessed deaths for Spring() parity.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

describe('TEVENT_DESTROYED (type=7) — C++ Spring() parity', () => {
  // Helper to create a minimal TriggerGameState with all required fields
  const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => ({
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
  });

  const DESTROYED_EVENT: TriggerEvent = { type: 7, team: -1, data: 0 };

  it('constant value is 7', () => {
    // TEVENT_DESTROYED must be 7 to match C++ tevent.h enum
    expect(DESTROYED_EVENT.type).toBe(7);
    // Verify checkTriggerEvent actually handles type 7 (doesn't fall through to default)
    const stateTrue = createState({
      pendingDestroyedCount: 1,
      destroyedTriggerNames: new Set(['test']),
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, stateTrue)).toBe(true);
  });

  it('returns false when both pendingDestroyedCount=0 and destroyedTriggerNames is empty', () => {
    const state = createState({
      pendingDestroyedCount: 0,
      destroyedTriggerNames: new Set(),
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(false);
  });

  it('returns false when pendingDestroyedCount > 0 but triggerName NOT in destroyedTriggerNames', () => {
    const state = createState({
      triggerName: 'myTrigger',
      pendingDestroyedCount: 3,
      destroyedTriggerNames: new Set(['otherTrigger', 'anotherTrigger']),
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(false);
  });

  it('returns false when triggerName IS in destroyedTriggerNames but pendingDestroyedCount=0', () => {
    const state = createState({
      triggerName: 'myTrigger',
      pendingDestroyedCount: 0,
      destroyedTriggerNames: new Set(['myTrigger']),
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(false);
  });

  it('returns true when BOTH pendingDestroyedCount > 0 AND triggerName in destroyedTriggerNames', () => {
    const state = createState({
      triggerName: 'myTrigger',
      pendingDestroyedCount: 1,
      destroyedTriggerNames: new Set(['myTrigger']),
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(true);
  });

  it('multiple destroyed triggers — only fires for matching triggerName', () => {
    const destroyedNames = new Set(['alpha', 'bravo', 'charlie']);

    // Trigger named 'bravo' — should fire (name is in set, count > 0)
    const stateBravo = createState({
      triggerName: 'bravo',
      pendingDestroyedCount: 1,
      destroyedTriggerNames: destroyedNames,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, stateBravo)).toBe(true);

    // Trigger named 'delta' — should NOT fire (name not in set)
    const stateDelta = createState({
      triggerName: 'delta',
      pendingDestroyedCount: 1,
      destroyedTriggerNames: destroyedNames,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, stateDelta)).toBe(false);

    // Trigger named 'alpha' — should fire
    const stateAlpha = createState({
      triggerName: 'alpha',
      pendingDestroyedCount: 2,
      destroyedTriggerNames: destroyedNames,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, stateAlpha)).toBe(true);

    // Trigger named 'charlie' — should fire
    const stateCharlie = createState({
      triggerName: 'charlie',
      pendingDestroyedCount: 1,
      destroyedTriggerNames: destroyedNames,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, stateCharlie)).toBe(true);
  });

  it('pendingDestroyedCount > 1 still returns true (multiple deaths pending)', () => {
    // C++ Spring() fires once per call when count > 0; the count tracks
    // how many unprocessed deaths remain. Any count above 0 should return true.
    for (const count of [1, 2, 5, 10, 100]) {
      const state = createState({
        triggerName: 'test',
        pendingDestroyedCount: count,
        destroyedTriggerNames: new Set(['test']),
      });
      expect(
        checkTriggerEvent(DESTROYED_EVENT, state),
        `pendingDestroyedCount=${count} should return true`,
      ).toBe(true);
    }
  });
});
