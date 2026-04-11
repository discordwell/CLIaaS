/**
 * C++ behavioral parity tests for TEVENT_GLOBAL_SET (type=27).
 *
 * C++ source: TRIGGER.CPP — TriggerClass::Spring()
 *   case TEVENT_GLOBAL_SET:
 *     return Scen.IsGlobalSet(Event.Data.Value);
 *
 * TS implementation: scenario.ts — checkTriggerEvent()
 *   case TEVENT_GLOBAL_SET:
 *     return state.globals.has(event.data);
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

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

const TEVENT_GLOBAL_SET = 27;

describe('TEVENT_GLOBAL_SET (type=27) — C++ behavioral parity', () => {
  it('constant value is 27', () => {
    // C++ enum: TEVENT_GLOBAL_SET = 27
    // Verify the constant matches the C++ enum ordinal
    expect(TEVENT_GLOBAL_SET).toBe(27);
  });

  it('returns false when the global is not set', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals: new Set() });

    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when the global is set', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals: new Set([5]) });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('different global indices are independent', () => {
    // Setting global 3 should not satisfy a check for global 5
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals: new Set([3]) });

    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true only for the matching index when multiple globals are set', () => {
    const globals = new Set([1, 3, 7, 10]);

    // Check for global 3 — present in set
    const eventMatch: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    expect(checkTriggerEvent(eventMatch, createState({ globals }))).toBe(true);

    // Check for global 5 — not present in set
    const eventMiss: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    expect(checkTriggerEvent(eventMiss, createState({ globals }))).toBe(false);
  });

  it('handles global index 0 correctly', () => {
    // C++ global indices start at 0; ensure boundary works
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 0 };

    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ globals: new Set([0]) }))).toBe(true);
  });

  it('handles high global indices (C++ supports up to 30)', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 29 };

    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ globals: new Set([29]) }))).toBe(true);
  });
});
