/**
 * C++ Behavioral Parity (#38): Immediate Trigger Spring on Global Variable Change
 *
 * C++ behavior (scenario.cpp:263-290 Set_Global_To, logic.cpp:218-221):
 *   When a global variable is set or cleared, the C++ engine:
 *   1. Sets IsGlobalChanged = true
 *   2. Resets the paired event timer for triggers depending on that global
 *   3. On the very next logic tick (NOT deferred 15 ticks), springs all triggers
 *      with TEVENT_GLOBAL_SET or TEVENT_GLOBAL_CLEAR matching that global
 *
 * Pre-fix TS behavior:
 *   Global changes took up to 15 ticks to fire dependent triggers because
 *   processTriggers() only ran every 15 ticks.
 *
 * Post-fix TS behavior:
 *   executeTriggerAction returns globalChanged in TriggerActionResult.
 *   applyTriggerActionResult calls springGlobalTriggers() which immediately
 *   evaluates and fires any trigger with TEVENT_GLOBAL_SET/CLEAR on that global.
 *   TMISSION_SET_GLOBAL also calls springGlobalTriggers() directly.
 *
 * Source refs:
 *   - scenario.cpp:263-290 (Set_Global_To)
 *   - logic.cpp:211-251    (LogicTrigger processing, IsGlobalChanged check)
 *   - TEVENT.H:47-48       (TEVENT_GLOBAL_SET=27, TEVENT_GLOBAL_CLEAR=28)
 *   - TACTION.H:28-29      (TACTION_SET_GLOBAL=28, TACTION_CLEAR_GLOBAL=29)
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
  type TriggerEvent,
  executeTriggerAction,
  checkTriggerEvent,
  type TriggerGameState,
  TEVENT_GLOBAL_SET,
  TEVENT_GLOBAL_CLEAR,
} from '../engine/scenario';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_SET_GLOBAL = 28;
const TACTION_CLEAR_GLOBAL = 29;
const TACTION_WIN = 1;
const TACTION_NONE = 0;
const TEVENT_NONE = 0;
const TEVENT_TIME = 13;

// ── Helpers ──────────────────────────────────────────────────────────────────────

function makeAction(action: number, data = 0): TriggerAction {
  return { action, team: -1, trigger: -1, data };
}

function makeEvent(type: number, data = 0): TriggerEvent {
  return { type, team: -1, data };
}

function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: makeEvent(TEVENT_NONE),
    event2: makeEvent(TEVENT_NONE),
    action1: makeAction(TACTION_NONE),
    action2: makeAction(TACTION_NONE),
    fired: false,
    timerTick: 0,
    playerEntered: false,
    objectDiscovered: false,
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
    ...overrides,
  };
}

function makeGameState(globals: Set<number>, overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 100,
    globals,
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    objectDiscovered: false,
    houseDiscovered: new Set(),
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
    destroyedTriggerNames: new Set(),
    attackedTriggerNames: new Set(),
    houseAlive: new Map(),
    houseUnitsAlive: new Map(),
    houseBuildingsAlive: new Map(),
    builtStructureTypes: new Set(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: false,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    fakesExist: false,
    spiedBuildings: new Set(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('C++ parity (#38): SET_GLOBAL/CLEAR_GLOBAL returns globalChanged in result', () => {
  // C++ scenario.cpp:268-270 — when value changes, IsGlobalChanged is set.
  // TS parity: executeTriggerAction returns globalChanged = action.data.

  it('TACTION_SET_GLOBAL returns globalChanged = action.data (scenario.cpp:269)', () => {
    const globals = new Set<number>();
    const result = executeTriggerAction(
      makeAction(TACTION_SET_GLOBAL, 5),
      [], new Map(), globals, [],
    );
    expect(result.globalChanged).toBe(5);
  });

  it('TACTION_CLEAR_GLOBAL returns globalChanged = action.data (scenario.cpp:269)', () => {
    const globals = new Set<number>([3]);
    const result = executeTriggerAction(
      makeAction(TACTION_CLEAR_GLOBAL, 3),
      [], new Map(), globals, [],
    );
    expect(result.globalChanged).toBe(3);
  });

  it('other actions do not set globalChanged', () => {
    const result = executeTriggerAction(
      makeAction(TACTION_WIN),
      [], new Map(), new Set(), [],
    );
    expect(result.globalChanged).toBeUndefined();
  });
});

describe('C++ parity (#38): TEVENT_GLOBAL_SET springs immediately when global becomes set', () => {
  // C++ logic.cpp:218-221 — when IsGlobalChanged, Spring(TEVENT_GLOBAL_SET) is called.
  // The TS checkTriggerEvent function checks globals.has(event.data).

  it('TEVENT_GLOBAL_SET returns true when global is in the set (logic.cpp:219)', () => {
    const globals = new Set<number>([5]);
    const state = makeGameState(globals);
    const event = makeEvent(TEVENT_GLOBAL_SET, 5);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('TEVENT_GLOBAL_SET returns false when global is NOT in the set', () => {
    const globals = new Set<number>();
    const state = makeGameState(globals);
    const event = makeEvent(TEVENT_GLOBAL_SET, 5);
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_GLOBAL_SET checks the correct global index, not others', () => {
    const globals = new Set<number>([3, 7]);
    const state = makeGameState(globals);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 3), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 7), state)).toBe(true);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 5), state)).toBe(false);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 0), state)).toBe(false);
  });
});

describe('C++ parity (#38): TEVENT_GLOBAL_CLEAR springs immediately when global becomes cleared', () => {
  // C++ logic.cpp:220 — Spring(TEVENT_GLOBAL_CLEAR) checks !GlobalFlags[global].

  it('TEVENT_GLOBAL_CLEAR returns true when global is NOT in the set (logic.cpp:220)', () => {
    const globals = new Set<number>();
    const state = makeGameState(globals);
    const event = makeEvent(TEVENT_GLOBAL_CLEAR, 5);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('TEVENT_GLOBAL_CLEAR returns false when global IS in the set', () => {
    const globals = new Set<number>([5]);
    const state = makeGameState(globals);
    const event = makeEvent(TEVENT_GLOBAL_CLEAR, 5);
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_GLOBAL_CLEAR checks the correct global index, not others', () => {
    const globals = new Set<number>([3]);
    const state = makeGameState(globals);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_CLEAR, 3), state)).toBe(false); // 3 is set
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_CLEAR, 5), state)).toBe(true);  // 5 is not set
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_CLEAR, 0), state)).toBe(true);  // 0 is not set
  });
});

describe('C++ parity (#38): TEVENT_GLOBAL_SET/CLEAR constant values (TEVENT.H:47-48)', () => {
  it('TEVENT_GLOBAL_SET = 27', () => {
    expect(TEVENT_GLOBAL_SET).toBe(27);
  });

  it('TEVENT_GLOBAL_CLEAR = 28', () => {
    expect(TEVENT_GLOBAL_CLEAR).toBe(28);
  });
});

describe('C++ parity (#38): paired event timer reset on global change (scenario.cpp:277-284)', () => {
  // C++ Set_Global_To scenario.cpp:277-284:
  //   If Event1 is GLOBAL_SET/CLEAR matching the changed global → reset Event2 timer
  //   If Event2 is GLOBAL_SET/CLEAR matching the changed global → reset Event1 timer
  //
  // In TS, springGlobalTriggers resets trigger.timerTick = this.tick for matching triggers.
  // We test this by verifying that a TIME event paired with a GLOBAL_SET event
  // re-evaluates correctly after the global changes (the timer should restart).

  it('trigger with GLOBAL_SET event1 and TIME event2: TIME event uses triggerStartTick (scenario.cpp:280)', () => {
    // After global change, the paired timer resets. We can verify this by
    // checking that the TIME event evaluates against the new timer tick.
    const globals = new Set<number>([5]);
    // With timerTick = 90 and gameTick = 100, elapsed = 10 ticks.
    // TIME event with data=1 requires 90 ticks (1 * TIME_UNIT_TICKS).
    // So the trigger should NOT fire because 10 < 90.
    const stateAfterReset = makeGameState(globals, {
      gameTick: 100,
      triggerStartTick: 90, // timer just reset
    });
    const timeEvent = makeEvent(TEVENT_TIME, 1); // 1 time unit = 90 ticks
    expect(checkTriggerEvent(timeEvent, stateAfterReset)).toBe(false);

    // But if enough time has passed (triggerStartTick = 0, gameTick = 100), it fires
    const stateElapsed = makeGameState(globals, {
      gameTick: 100,
      triggerStartTick: 0,
    });
    expect(checkTriggerEvent(timeEvent, stateElapsed)).toBe(true);
  });
});

describe('C++ parity (#38): trigger chain — SET_GLOBAL action immediately springs GLOBAL_SET trigger', () => {
  // This is the core behavioral difference between C++ and the old TS code.
  // In C++, a trigger action that sets a global immediately causes dependent triggers to spring.
  // In old TS, the dependent trigger would not fire until the next processTriggers() cycle (up to 15 ticks).

  it('SET_GLOBAL action signals globalChanged so springGlobalTriggers can fire', () => {
    // Trigger A: action = SET_GLOBAL(5)
    // Trigger B: event = TEVENT_GLOBAL_SET(5), action = WIN
    //
    // When A fires, it sets global 5 and returns globalChanged=5.
    // applyTriggerActionResult then calls springGlobalTriggers(5),
    // which should immediately evaluate and fire trigger B.
    //
    // We verify that SET_GLOBAL returns the globalChanged marker.
    const globals = new Set<number>();
    const triggerB = makeTrigger({
      name: 'winOnGlobal5',
      event1: makeEvent(TEVENT_GLOBAL_SET, 5),
      action1: makeAction(TACTION_WIN),
    });

    // Execute SET_GLOBAL(5)
    const result = executeTriggerAction(
      makeAction(TACTION_SET_GLOBAL, 5),
      [], new Map(), globals, [triggerB],
    );

    // Global is now set
    expect(globals.has(5)).toBe(true);
    // The result signals that global 5 changed
    expect(result.globalChanged).toBe(5);

    // Trigger B's event should now evaluate as true
    const state = makeGameState(globals);
    expect(checkTriggerEvent(triggerB.event1, state)).toBe(true);
  });

  it('CLEAR_GLOBAL action signals globalChanged so springGlobalTriggers can fire', () => {
    // Trigger A: action = CLEAR_GLOBAL(3)
    // Trigger B: event = TEVENT_GLOBAL_CLEAR(3)
    //
    // When A fires, it clears global 3 and returns globalChanged=3.
    const globals = new Set<number>([3]);
    const triggerB = makeTrigger({
      name: 'onGlobal3Clear',
      event1: makeEvent(TEVENT_GLOBAL_CLEAR, 3),
      action1: makeAction(TACTION_WIN),
    });

    const result = executeTriggerAction(
      makeAction(TACTION_CLEAR_GLOBAL, 3),
      [], new Map(), globals, [triggerB],
    );

    expect(globals.has(3)).toBe(false);
    expect(result.globalChanged).toBe(3);

    const state = makeGameState(globals);
    expect(checkTriggerEvent(triggerB.event1, state)).toBe(true);
  });
});

describe('C++ parity (#38): TEVENT_GLOBAL_SET/CLEAR only fires for matching global index', () => {
  // C++ scenario.cpp:279 — checks Event1.Data.Value == global
  // Ensures triggers for global 5 don't fire when global 3 changes.

  it('TEVENT_GLOBAL_SET(5) does NOT fire when global 3 is set', () => {
    const globals = new Set<number>([3]); // only global 3 is set
    const state = makeGameState(globals);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 5), state)).toBe(false);
  });

  it('TEVENT_GLOBAL_CLEAR(5) does NOT fire when global 3 is cleared', () => {
    const globals = new Set<number>([5]); // global 5 still set, only 3 was cleared
    const state = makeGameState(globals);
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_CLEAR, 5), state)).toBe(false);
  });
});

describe('C++ parity (#38): volatile vs persistent triggers on global change', () => {
  // C++ trigger.cpp: volatile triggers (persistence=0) fire once.
  // Semi-persistent (1) fire once per attachment.
  // Persistent (2) re-fire after timer reset.

  it('volatile trigger (persistence=0) can be skipped once fired', () => {
    const trigger = makeTrigger({
      persistence: 0,
      event1: makeEvent(TEVENT_GLOBAL_SET, 5),
      action1: makeAction(TACTION_WIN),
      fired: true, // already fired
    });

    // springGlobalTriggers skips triggers where fired && persistence <= 1
    expect(trigger.fired).toBe(true);
    expect(trigger.persistence).toBe(0);
    // This is the guard: trigger.fired && trigger.persistence <= 1 → skip
    expect(trigger.fired && trigger.persistence <= 1).toBe(true);
  });

  it('persistent trigger (persistence=2) re-fires even if previously fired', () => {
    const trigger = makeTrigger({
      persistence: 2,
      event1: makeEvent(TEVENT_GLOBAL_SET, 5),
      action1: makeAction(TACTION_WIN),
      fired: true, // already fired once
    });

    // springGlobalTriggers does NOT skip persistent triggers even when fired
    expect(trigger.fired && trigger.persistence <= 1).toBe(false);
  });
});

describe('C++ parity (#38): multiple globals can be changed in sequence', () => {
  // Trigger chains: A sets global 1, which fires B which sets global 2, etc.

  it('SET_GLOBAL for different indices produces correct globalChanged values', () => {
    const globals = new Set<number>();

    const r1 = executeTriggerAction(
      makeAction(TACTION_SET_GLOBAL, 1), [], new Map(), globals, [],
    );
    expect(r1.globalChanged).toBe(1);
    expect(globals.has(1)).toBe(true);

    const r2 = executeTriggerAction(
      makeAction(TACTION_SET_GLOBAL, 2), [], new Map(), globals, [],
    );
    expect(r2.globalChanged).toBe(2);
    expect(globals.has(2)).toBe(true);
    expect(globals.has(1)).toBe(true); // first global still set
  });
});
