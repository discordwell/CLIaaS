/**
 * C++ behavioral parity tests for TEVENT_CREDITS (type=12).
 *
 * C++ behavior (TRIGGER.CPP):
 *   case TEVENT_CREDITS:
 *     return (PlayerPtr->Credits >= Data.Value);
 *
 * Returns true when the player's accumulated credits >= the threshold in event.data.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

describe('TEVENT_CREDITS (type=12) — C++ behavioral parity', () => {
  /** Build a minimal TriggerGameState with all required fields. */
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

  const TEVENT_CREDITS = 12;

  /** Helper: create a credits trigger event with the given threshold. */
  const creditsEvent = (threshold: number): TriggerEvent => ({
    type: TEVENT_CREDITS,
    team: -1,
    data: threshold,
  });

  it('constant value is 12 (C++ TEVENT_CREDITS enum index)', () => {
    // The constant must match the C++ enum value exactly.
    // We verify by calling checkTriggerEvent with type=12 and confirming
    // it evaluates the credits path (not a fallback / default).
    const event: TriggerEvent = { type: 12, team: -1, data: 100 };
    const stateBelowThreshold = createState({ playerCredits: 50 });
    const stateAtThreshold = createState({ playerCredits: 100 });

    expect(checkTriggerEvent(event, stateBelowThreshold)).toBe(false);
    expect(checkTriggerEvent(event, stateAtThreshold)).toBe(true);
  });

  it('returns false when credits < threshold', () => {
    const state = createState({ playerCredits: 999 });
    expect(checkTriggerEvent(creditsEvent(1000), state)).toBe(false);
  });

  it('returns true when credits == threshold (exact match)', () => {
    const state = createState({ playerCredits: 5000 });
    expect(checkTriggerEvent(creditsEvent(5000), state)).toBe(true);
  });

  it('returns true when credits > threshold', () => {
    const state = createState({ playerCredits: 7500 });
    expect(checkTriggerEvent(creditsEvent(5000), state)).toBe(true);
  });

  it('threshold=0 always returns true (credits >= 0)', () => {
    // With default playerCredits=0, 0 >= 0 is true
    const stateZero = createState({ playerCredits: 0 });
    expect(checkTriggerEvent(creditsEvent(0), stateZero)).toBe(true);

    // Any positive credits also satisfy threshold=0
    const statePositive = createState({ playerCredits: 1 });
    expect(checkTriggerEvent(creditsEvent(0), statePositive)).toBe(true);
  });

  it('large threshold values work correctly', () => {
    // C++ credits are typically in the 0–999999 range but use int/long storage
    const largeThreshold = 999999;

    const stateBelowLarge = createState({ playerCredits: largeThreshold - 1 });
    expect(checkTriggerEvent(creditsEvent(largeThreshold), stateBelowLarge)).toBe(false);

    const stateAtLarge = createState({ playerCredits: largeThreshold });
    expect(checkTriggerEvent(creditsEvent(largeThreshold), stateAtLarge)).toBe(true);

    const stateAboveLarge = createState({ playerCredits: largeThreshold + 1 });
    expect(checkTriggerEvent(creditsEvent(largeThreshold), stateAboveLarge)).toBe(true);
  });
});
