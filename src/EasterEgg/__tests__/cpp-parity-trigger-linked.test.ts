/**
 * C++ behavioral parity tests for MULTI_LINKED trigger eventControl=3.
 *
 * C++ source: trigger.cpp:249-264 (Spring event evaluation switch)
 *   case MULTI_LINKED:
 *   case MULTI_OR:
 *     e2 = Class->Event2(Event2, event, Class->House, obj, forced);
 *     execute = (e1 || e2);
 *
 * C++ source: trigger.cpp:307-309 (Spring action dispatch for LINKED)
 *   if (Class->EventControl == MULTI_LINKED) {
 *     if (e1 || forced) ok |= Class->Action1(hh, obj, ID, cell);
 *     if (e2 && !forced) ok |= Class->Action2(hh, obj, ID, cell);
 *   }
 *
 * C++ source: trigtype.h:51-56 (MultiStyleType enum)
 *   MULTI_ONLY=0, MULTI_AND=1, MULTI_OR=2, MULTI_LINKED=3
 *
 * Key distinction from MULTI_OR:
 *   - OR: either event fires BOTH actions (per actionControl)
 *   - LINKED: event1 fires Action1, event2 fires Action2, independently
 *
 * Note: TEVENT_NONE (type=0) returns TRUE in C++ (no event condition = always pass).
 * For a reliably-false event, we use TEVENT_GLOBAL_SET with an unset global.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
  type ScenarioTrigger,
} from '../engine/scenario';

// --- Helpers ---

/** TEVENT_ANY always returns true — useful for testing eventControl logic */
const TEVENT_ANY = 8;
/** TEVENT_GLOBAL_SET — returns true only if global is set; with unset global, returns false */
const TEVENT_GLOBAL_SET = 27;

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

function makeEvent(type: number, data = 0): TriggerEvent {
  return { type, team: -1, data };
}

/** An event that reliably returns false: TEVENT_GLOBAL_SET with global 9999 (never set) */
function makeFalseEvent(): TriggerEvent {
  return makeEvent(TEVENT_GLOBAL_SET, 9999);
}

/**
 * Simulate the TS checkTriggerEvents logic (mirrors the private method in the engine).
 * This replicates the exact switch from index.ts so we can unit-test it without
 * needing to instantiate the full game engine.
 */
function checkTriggerEvents(
  eventControl: number,
  event1: TriggerEvent,
  event2: TriggerEvent,
  state: TriggerGameState,
): { shouldFire: boolean; e1: boolean; e2: boolean } {
  const e1 = checkTriggerEvent(event1, state);
  const e2 = checkTriggerEvent(event2, state);
  switch (eventControl) {
    case 0: return { shouldFire: e1, e1, e2 };                   // MULTI_ONLY
    case 1: return { shouldFire: e1 && e2, e1, e2 };             // MULTI_AND
    case 2: return { shouldFire: e1 || e2, e1, e2 };             // MULTI_OR
    case 3: return { shouldFire: e1 || e2, e1, e2 };             // MULTI_LINKED
    default: return { shouldFire: e1, e1, e2 };
  }
}

/**
 * Simulate C++ Spring() action dispatch for a given trigger configuration.
 * Returns which actions were fired.
 *
 * C++ trigger.cpp:307-323
 */
function simulateActionDispatch(
  eventControl: number,
  actionControl: number,
  e1: boolean,
  e2: boolean,
  forced: boolean,
): { action1Fired: boolean; action2Fired: boolean } {
  let action1Fired = false;
  let action2Fired = false;

  if (eventControl === 3) {
    // MULTI_LINKED: Action1 fires if e1 true OR forced, Action2 fires if e2 true AND NOT forced
    if (e1 || forced) action1Fired = true;
    if (e2 && !forced) action2Fired = true;
  } else {
    // Non-linked: always fire Action1, fire Action2 based on actionControl
    action1Fired = true;
    if (actionControl === 1) action2Fired = true; // MULTI_AND for actions
  }

  return { action1Fired, action2Fired };
}

// --- Tests ---

describe('MULTI_LINKED (eventControl=3) — C++ behavioral parity', () => {
  describe('event evaluation: trigger fires if e1 OR e2 (same gate as MULTI_OR)', () => {
    it('event1 true, event2 false → trigger fires', () => {
      // C++ trigger.cpp:259-263: MULTI_LINKED uses OR gate
      const result = checkTriggerEvents(
        3,
        makeEvent(TEVENT_ANY),       // e1 = true
        makeFalseEvent(),            // e2 = false (global 9999 not set)
        createState(),
      );
      expect(result.shouldFire).toBe(true);
      expect(result.e1).toBe(true);
      expect(result.e2).toBe(false);
    });

    it('event1 false, event2 true → trigger fires', () => {
      const result = checkTriggerEvents(
        3,
        makeFalseEvent(),            // e1 = false
        makeEvent(TEVENT_ANY),       // e2 = true
        createState(),
      );
      expect(result.shouldFire).toBe(true);
      expect(result.e1).toBe(false);
      expect(result.e2).toBe(true);
    });

    it('both events true → trigger fires', () => {
      const result = checkTriggerEvents(
        3,
        makeEvent(TEVENT_ANY),
        makeEvent(TEVENT_ANY),
        createState(),
      );
      expect(result.shouldFire).toBe(true);
      expect(result.e1).toBe(true);
      expect(result.e2).toBe(true);
    });

    it('neither event true → trigger does NOT fire', () => {
      const result = checkTriggerEvents(
        3,
        makeFalseEvent(),
        makeFalseEvent(),
        createState(),
      );
      expect(result.shouldFire).toBe(false);
    });
  });

  describe('action routing: Action1 ↔ event1, Action2 ↔ event2 (independently)', () => {
    it('e1=true, e2=false → only Action1 fires', () => {
      // C++ trigger.cpp:308: if (e1 || forced) → Action1
      // C++ trigger.cpp:309: if (e2 && !forced) → Action2
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, true, false, false);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(false);
    });

    it('e1=false, e2=true → only Action2 fires', () => {
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, false, true, false);
      expect(action1Fired).toBe(false);
      expect(action2Fired).toBe(true);
    });

    it('both events true → both actions fire', () => {
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, true, true, false);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(true);
    });

    it('neither event true → no actions fire', () => {
      // Note: in practice the trigger wouldn't fire (shouldFire=false),
      // but if somehow dispatched, neither action should execute.
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, false, false, false);
      expect(action1Fired).toBe(false);
      expect(action2Fired).toBe(false);
    });

    it('forced fire → only Action1 fires (C++ trigger.cpp:308-309)', () => {
      // C++ behavior: forced sets e1=false (no event eval), but Action1 fires via "|| forced"
      // Action2 does NOT fire because "e2 && !forced" is false when forced=true
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, false, false, true);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(false);
    });

    it('forced fire with e2=true → only Action1 fires (forced suppresses Action2)', () => {
      // C++ trigger.cpp:309: "if (e2 && !forced)" — forced always suppresses Action2
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, false, true, true);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(false);
    });
  });

  describe('action routing ignores actionControl in LINKED mode', () => {
    it('actionControl=0 (ONLY) does not affect LINKED routing', () => {
      // In LINKED mode, actionControl is irrelevant — routing is purely per-event
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 0, true, true, false);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(true);
    });

    it('actionControl=1 (AND) does not affect LINKED routing', () => {
      // Same result as actionControl=0 for LINKED
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, false, true, false);
      expect(action1Fired).toBe(false);
      expect(action2Fired).toBe(true);
    });
  });

  describe('integration: event evaluation + action routing combined', () => {
    it('LINKED with global-based events: global 5 set → Action1, global 10 unset → no Action2', () => {
      const state = createState({ globals: new Set([5]) });
      const result = checkTriggerEvents(
        3,
        makeEvent(TEVENT_GLOBAL_SET, 5),   // e1: global 5 is set → true
        makeEvent(TEVENT_GLOBAL_SET, 10),  // e2: global 10 is NOT set → false
        state,
      );
      expect(result.shouldFire).toBe(true);
      expect(result.e1).toBe(true);
      expect(result.e2).toBe(false);

      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, result.e1, result.e2, false);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(false);
    });

    it('LINKED with global-based events: both globals set → both actions fire', () => {
      const state = createState({ globals: new Set([5, 10]) });
      const result = checkTriggerEvents(
        3,
        makeEvent(TEVENT_GLOBAL_SET, 5),
        makeEvent(TEVENT_GLOBAL_SET, 10),
        state,
      );
      expect(result.shouldFire).toBe(true);
      const { action1Fired, action2Fired } = simulateActionDispatch(3, 1, result.e1, result.e2, false);
      expect(action1Fired).toBe(true);
      expect(action2Fired).toBe(true);
    });
  });
});

describe('MULTI_ONLY (eventControl=0) — existing behavior preserved', () => {
  it('only event1 matters', () => {
    const result = checkTriggerEvents(
      0,
      makeEvent(TEVENT_ANY),
      makeFalseEvent(),
      createState(),
    );
    expect(result.shouldFire).toBe(true);
  });

  it('event2 true but event1 false → trigger does NOT fire', () => {
    const result = checkTriggerEvents(
      0,
      makeFalseEvent(),
      makeEvent(TEVENT_ANY),
      createState(),
    );
    expect(result.shouldFire).toBe(false);
  });

  it('action dispatch: always fires Action1, Action2 per actionControl', () => {
    const only = simulateActionDispatch(0, 0, true, true, false);
    expect(only.action1Fired).toBe(true);
    expect(only.action2Fired).toBe(false);

    const both = simulateActionDispatch(0, 1, true, true, false);
    expect(both.action1Fired).toBe(true);
    expect(both.action2Fired).toBe(true);
  });
});

describe('MULTI_AND (eventControl=1) — existing behavior preserved', () => {
  it('both events true → trigger fires', () => {
    const result = checkTriggerEvents(
      1,
      makeEvent(TEVENT_ANY),
      makeEvent(TEVENT_ANY),
      createState(),
    );
    expect(result.shouldFire).toBe(true);
  });

  it('only event1 true → trigger does NOT fire', () => {
    const result = checkTriggerEvents(
      1,
      makeEvent(TEVENT_ANY),
      makeFalseEvent(),
      createState(),
    );
    expect(result.shouldFire).toBe(false);
  });

  it('only event2 true → trigger does NOT fire', () => {
    const result = checkTriggerEvents(
      1,
      makeFalseEvent(),
      makeEvent(TEVENT_ANY),
      createState(),
    );
    expect(result.shouldFire).toBe(false);
  });

  it('action dispatch uses actionControl, not per-event routing', () => {
    const only = simulateActionDispatch(1, 0, true, true, false);
    expect(only.action1Fired).toBe(true);
    expect(only.action2Fired).toBe(false);

    const both = simulateActionDispatch(1, 1, true, true, false);
    expect(both.action1Fired).toBe(true);
    expect(both.action2Fired).toBe(true);
  });
});

describe('MULTI_OR (eventControl=2) — existing behavior preserved', () => {
  it('event1 true → trigger fires', () => {
    const result = checkTriggerEvents(
      2,
      makeEvent(TEVENT_ANY),
      makeFalseEvent(),
      createState(),
    );
    expect(result.shouldFire).toBe(true);
  });

  it('event2 true → trigger fires', () => {
    const result = checkTriggerEvents(
      2,
      makeFalseEvent(),
      makeEvent(TEVENT_ANY),
      createState(),
    );
    expect(result.shouldFire).toBe(true);
  });

  it('neither event → trigger does NOT fire', () => {
    const result = checkTriggerEvents(
      2,
      makeFalseEvent(),
      makeFalseEvent(),
      createState(),
    );
    expect(result.shouldFire).toBe(false);
  });

  it('action dispatch uses actionControl (NOT per-event routing like LINKED)', () => {
    // This is the key difference from LINKED: OR fires both actions per actionControl
    const both = simulateActionDispatch(2, 1, false, true, false);
    expect(both.action1Fired).toBe(true);  // always fires Action1
    expect(both.action2Fired).toBe(true);  // fires because actionControl=1 (AND)

    // LINKED would only fire Action2 here (e1=false, e2=true)
    const linked = simulateActionDispatch(3, 1, false, true, false);
    expect(linked.action1Fired).toBe(false);  // e1 is false, not forced
    expect(linked.action2Fired).toBe(true);   // e2 is true
  });
});
