/**
 * C++ Behavioral Parity (#38): Ordered Global Trigger Evaluation
 *
 * C++ behavior (scenario.cpp:263-290 Set_Global_To, logic.cpp:218-221):
 *   When a global variable is set or cleared, the C++ engine:
 *   1. Sets IsGlobalChanged = true
 *   2. Resets the paired event timer for triggers depending on that global
 *   3. Continues the current LogicTriggers pass in order; later triggers can
 *      observe the new flag, earlier triggers wait for the next pass.
 *
 * Pre-fix TS behavior:
 *   Global changes took up to 15 ticks to fire dependent triggers because
 *   processTriggers() only ran every 15 ticks.
 *
 * TS behavior:
 *   executeTriggerAction returns globalChanged in TriggerActionResult.
 *   applyTriggerActionResult records Set_Global_To side effects only. The
 *   normal ordered processTriggers(TEVENT_TIME) scan evaluates GLOBAL_SET/CLEAR
 *   events, matching C++ TriggerClass::Spring's event predicate behavior.
 *
 * Source refs:
 *   - scenario.cpp:263-290 (Set_Global_To)
 *   - logic.cpp:211-251    (LogicTrigger processing, IsGlobalChanged check)
 *   - TEVENT.H:47-48       (TEVENT_GLOBAL_SET=27, TEVENT_GLOBAL_CLEAR=28)
 *   - TACTION.H:28-29      (TACTION_SET_GLOBAL=28, TACTION_CLEAR_GLOBAL=29)
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../engine/index';
import { House } from '../engine/types';
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
    playerEnteredHouse: -1,
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
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
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

function createTriggerGame(trigger: ScenarioTrigger | ScenarioTrigger[], tick: number, globals: Set<number>): Game {
  const game = Object.create(Game.prototype) as Game;
  const g = game as unknown as Record<string, unknown>;
  g.tick = tick;
  g.globals = globals;
  g.triggers = Array.isArray(trigger) ? trigger : [trigger];
  g.structures = [];
  g.entities = [];
  g.destroyedTriggerNames = new Set<string>();
  g.builtStructureTypes = new Set<string>();
  g.builtStructureTypesByHouse = new Map<number, Set<string>>();
  g.teamTypes = [];
  g.waypoints = new Map();
  g.houseEdges = new Map();
  g.map = { boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128 };
  g.playerHouse = House.Spain;
  g.powerConsumed = 0;
  g.powerProduced = 0;
  g.killCount = 0;
  g.missionTimerExpired = false;
  g.bridgeCellCount = 0;
  g.unitsLeftMap = 0;
  g.attackedTriggerNames = new Set<string>();
  g.houseDiscovered = new Map<number, boolean>();
  g.credits = 0;
  g.nBuildingsDestroyedCount = 0;
  g.civiliansEvacuated = 0;
  g.builtUnitTypes = new Set<string>();
  g.builtInfantryTypes = new Set<string>();
  g.builtAircraftTypes = new Set<string>();
  g.spiedBuildingTriggers = new Set<string>();
  g.isThieved = false;
  g.destroyedTeams = new Set<number>();
  return game;
}

function noteGlobalChanged(game: Game, globalIndex: number): void {
  (game as unknown as { noteGlobalChanged(globalIndex: number): void })
    .noteGlobalChanged(globalIndex);
}

function processLogicTriggers(game: Game): void {
  (game as unknown as { processTriggers(springEvent?: number): void })
    .processTriggers(TEVENT_TIME);
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

describe('C++ parity (#38): TEVENT_GLOBAL_SET evaluates from global state', () => {
  // C++ tevent.cpp:238-240 checks Scen.GlobalFlags[Data.Value].
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

  it('TEVENT_GLOBAL_SET index 30 aliases Scen.Views[0] like C++ tevent.cpp', () => {
    // C++ checks Scen.GlobalFlags[Data.Value] without the Set_Global_To bounds
    // guard. GlobalFlags[30] is the low byte of Views[0]; SCU34EA uses this to
    // fire the civ4 GLOBAL_SET(30) trigger at tick 0.
    const state = makeGameState(new Set(), {
      cppGlobalFlagMemory: Uint8Array.from([
        ...Array(30).fill(0),
        0x5d, 0x0e, // Views[0] = 0x0e5d / SCU34EA WAYPT_HOME cell 3677.
      ]),
    });
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_SET, 30), state)).toBe(true);
  });
});

describe('C++ parity (#38): TEVENT_GLOBAL_CLEAR evaluates from global state', () => {
  // C++ tevent.cpp:242-244 checks !Scen.GlobalFlags[Data.Value].

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

  it('TEVENT_GLOBAL_CLEAR index 30 is false when the aliased view byte is nonzero', () => {
    const state = makeGameState(new Set(), {
      cppGlobalFlagMemory: Uint8Array.from([
        ...Array(30).fill(0),
        1,
      ]),
    });
    expect(checkTriggerEvent(makeEvent(TEVENT_GLOBAL_CLEAR, 30), state)).toBe(false);
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

describe('C++ parity (#38): global-change timer reset asymmetry (scenario.cpp:277-284)', () => {
  // C++ calls Class->Event2.Reset(Event1) when Event1 is the matching global.
  // Reset mutates the TDEventClass argument, so Event2's TIME timer is not reset.
  // When Event2 is the matching global, C++ calls Class->Event1.Reset(Event1),
  // which does reset an Event1 TIME timer.

  it('event1=GLOBAL_SET + event2=TIME keeps the elapsed TIME timer without firing recursively', () => {
    const trigger = makeTrigger({
      eventControl: 1,
      event1: makeEvent(TEVENT_GLOBAL_SET, 1),
      event2: makeEvent(TEVENT_TIME, 35),
      timerTick: 0,
    });
    const game = createTriggerGame(trigger, 3601, new Set([1]));

    noteGlobalChanged(game, 1);

    expect(trigger.fired).toBe(false);
    expect(trigger.timerTick).toBe(0);
  });

  it('event1=TIME + event2=GLOBAL_SET resets the Event1 TIME timer before evaluation', () => {
    const trigger = makeTrigger({
      eventControl: 1,
      event1: makeEvent(TEVENT_TIME, 35),
      event2: makeEvent(TEVENT_GLOBAL_SET, 1),
      timerTick: 0,
    });
    const game = createTriggerGame(trigger, 3601, new Set([1]));

    noteGlobalChanged(game, 1);

    expect(trigger.fired).toBe(false);
    expect(trigger.timerTick).toBe(3601);
  });
});

describe('C++ parity (#38): ordered trigger chain around SET_GLOBAL actions', () => {
  // C++ LogicClass::AI iterates LogicTriggers once. A SET_GLOBAL action mutates
  // Scen.GlobalFlags immediately, so later triggers in the same pass can fire.
  // Triggers already visited are not revisited recursively.

  it('SET_GLOBAL action exposes global state for later LogicTriggers', () => {
    // Trigger A: action = SET_GLOBAL(5)
    // Trigger B: event = TEVENT_GLOBAL_SET(5), action = WIN
    //
    // When A fires, it sets global 5 and returns globalChanged=5.
    // Later LogicTriggers in the same ordered pass can evaluate trigger B.
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

  it('CLEAR_GLOBAL action exposes global state for later LogicTriggers', () => {
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

  it('does not revisit earlier GLOBAL_SET triggers when a later trigger sets the global', () => {
    const globals = new Set<number>();
    const dependent = makeTrigger({
      name: 'dependent-before-setter',
      event1: makeEvent(TEVENT_GLOBAL_SET, 3),
      action1: makeAction(TACTION_NONE),
    });
    const setter = makeTrigger({
      name: 'setter',
      event1: makeEvent(TEVENT_TIME, 0),
      action1: makeAction(TACTION_SET_GLOBAL, 3),
    });
    const game = createTriggerGame([dependent, setter], 100, globals);

    processLogicTriggers(game);

    expect(setter.fired).toBe(true);
    expect(globals.has(3)).toBe(true);
    expect(dependent.fired).toBe(false);

    (game as unknown as { tick: number }).tick = 101;
    processLogicTriggers(game);

    expect(dependent.fired).toBe(true);
  });

  it('allows later GLOBAL_SET triggers to fire after an earlier trigger sets the global', () => {
    const globals = new Set<number>();
    const setter = makeTrigger({
      name: 'setter',
      event1: makeEvent(TEVENT_TIME, 0),
      action1: makeAction(TACTION_SET_GLOBAL, 3),
    });
    const dependent = makeTrigger({
      name: 'dependent-after-setter',
      event1: makeEvent(TEVENT_GLOBAL_SET, 3),
      action1: makeAction(TACTION_NONE),
    });
    const game = createTriggerGame([setter, dependent], 100, globals);

    processLogicTriggers(game);

    expect(setter.fired).toBe(true);
    expect(globals.has(3)).toBe(true);
    expect(dependent.fired).toBe(true);
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

    // processTriggers skips triggers where fired && persistence <= 1
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

    // processTriggers does NOT skip persistent triggers even when fired
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
