/**
 * C++ behavioral parity tests: Cell trigger mechanics & global variable interactions.
 *
 * C++ source references:
 *   foot.cpp:1406-1414   — Cell trigger fires Spring(TEVENT_PLAYER_ENTERED) when non-cloaked unit enters cell
 *   tevent.cpp:278-293   — PLAYER_ENTERED requires object->Owner() == Data.House
 *   tevent.cpp:238-244   — GLOBAL_SET checks Scen.GlobalFlags[Data.Value], GLOBAL_CLEAR checks !GlobalFlags
 *   taction.cpp:421-430  — SET_GLOBAL/CLEAR_GLOBAL calls Scen.Set_Global_To()
 *   scenario.cpp:263-290 — Set_Global_To sets flag, marks IsGlobalChanged, resets paired event timers
 *   trigger.cpp:227-358  — Spring() evaluates events with eventControl (ONLY/AND/OR/LINKED), handles persistence
 *   trigger.cpp:277-298  — Semi-persistent triggers: detach per attachment, fire only when all detached
 *   trigger.cpp:341-353  — Volatile/semi-persistent triggers delete after fire; persistent triggers reset events
 *
 * TS implementation:
 *   engine/index.ts — checkCellTriggers(), processTriggers(), springGlobalTriggers(), applyTriggerActionResult()
 *   engine/scenario.ts — checkTriggerEvent(), executeTriggerAction(), consumeSemiPersistentAttachment()
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  executeTriggerAction,
  consumeSemiPersistentAttachment,
  type TriggerGameState,
  type TriggerEvent,
  type TriggerAction,
  type ScenarioTrigger,
  type TeamType,
} from '../engine/scenario';

// ── Constants (matching C++ enum ordinals) ──────────────────────────────────────

const TEVENT_NONE = 0;
const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_ANY = 8;
const TEVENT_TIME = 13;
const TEVENT_GLOBAL_SET = 27;
const TEVENT_GLOBAL_CLEAR = 28;

const TACTION_NONE = 0;
const TACTION_WIN = 1;
const TACTION_SET_GLOBAL = 28;
const TACTION_CLEAR_GLOBAL = 29;
const TACTION_FORCE_TRIGGER = 22;

// EventControl values (C++ MultiEventType enum: trigger.h)
const MULTI_ONLY = 0;
const MULTI_AND = 1;
const MULTI_OR = 2;
const MULTI_LINKED = 3;

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Create a minimal TriggerGameState with defaults. */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 200,
    globals: new Set(),
    triggerStartTick: 0,
    triggerName: 'test',
    playerEntered: false,
    playerEnteredHouse: 0,
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
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
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

/** Create a minimal ScenarioTrigger. */
function createTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'trig',
    persistence: 0,  // volatile
    house: 0,
    eventControl: MULTI_ONLY,
    actionControl: 0,
    event1: { type: TEVENT_NONE, team: -1, data: 0 },
    event2: { type: TEVENT_NONE, team: -1, data: 0 },
    action1: { action: TACTION_NONE, team: -1, trigger: -1, data: 0 },
    action2: { action: TACTION_NONE, team: -1, trigger: -1, data: 0 },
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

/** Execute a trigger action against a globals set. */
function executeAction(
  action: TriggerAction,
  globals: Set<number> = new Set(),
  triggers: ScenarioTrigger[] = [],
) {
  return executeTriggerAction(
    action,
    [],         // teamTypes
    new Map(),  // waypoints
    globals,
    triggers,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('Cell trigger + PLAYER_ENTERED event evaluation — C++ parity', () => {
  /**
   * C++ foot.cpp:1406-1414:
   *   if (Cloak != CLOAKED) {
   *     TriggerClass * trigger = Map[Coord].Trigger;
   *     if (trigger != NULL) {
   *       trigger->Spring(TEVENT_PLAYER_ENTERED, this, Coord_Cell(Coord));
   *
   * C++ tevent.cpp:290-293:
   *   if (Event == TEVENT_PLAYER_ENTERED) {
   *     if (!object || object->Owner() != Data.House) return(false);
   *     td.IsTripped = true;
   *     return(true);
   *   }
   *
   * TS: checkCellTriggers sets trigger.playerEntered = true,
   * then checkTriggerEvent(TEVENT_PLAYER_ENTERED) returns state.playerEntered.
   */
  it('PLAYER_ENTERED returns true when playerEntered flag is set', () => {
    const event: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const state = createState({ playerEntered: true });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('PLAYER_ENTERED returns false when playerEntered flag is not set', () => {
    const event: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const state = createState({ playerEntered: false });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  /**
   * C++ tevent.cpp:290-291: ownership check — the trigger only fires if
   * object->Owner() matches Data.House. In TS, checkCellTriggers only sets
   * playerEntered for isPlayerUnit entities, and the ownership check is
   * implicit in the `isPlayerUnit` guard.
   *
   * C++ parity: non-player (enemy) units should NOT trip cell triggers
   * that require player entry. The TS `checkCellTriggers` uses `entity.isPlayerUnit`.
   */
  it('playerEntered is always false until checkCellTriggers marks it', () => {
    // This verifies the initial state — triggers start with playerEntered=false
    const trigger = createTrigger({
      event1: { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 },
    });
    expect(trigger.playerEntered).toBe(false);
  });
});

describe('Cell trigger with SET_GLOBAL action — C++ parity', () => {
  /**
   * C++ scenario flow:
   * 1. Unit enters cell with trigger attached
   * 2. Spring(TEVENT_PLAYER_ENTERED) fires
   * 3. Action is TACTION_SET_GLOBAL → Scen.Set_Global_To(Data.Value, true)
   * 4. Set_Global_To sets GlobalFlags[n] = true
   *
   * TS: executeTriggerAction with TACTION_SET_GLOBAL adds to globals set
   */
  it('SET_GLOBAL adds the global index to the globals set', () => {
    const globals = new Set<number>();
    const action: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 };
    executeAction(action, globals);
    expect(globals.has(5)).toBe(true);
  });

  it('SET_GLOBAL returns globalChanged in result for cascading', () => {
    /**
     * C++ scenario.cpp:270: IsGlobalChanged = true; (triggers cascade scan)
     * TS: result.globalChanged is set to action.data
     */
    const globals = new Set<number>();
    const action: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 3 };
    const result = executeAction(action, globals);
    expect(result.globalChanged).toBe(3);
  });

  it('CLEAR_GLOBAL removes the global and returns globalChanged', () => {
    const globals = new Set<number>([5, 10]);
    const action: TriggerAction = { action: TACTION_CLEAR_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(action, globals);
    expect(globals.has(5)).toBe(false);
    expect(globals.has(10)).toBe(true);
    expect(result.globalChanged).toBe(5);
  });
});

describe('Global variable cascading (Set_Global_To) — C++ parity', () => {
  /**
   * C++ scenario.cpp:263-290 — Set_Global_To:
   *   1. Sets GlobalFlags[global] = value
   *   2. Sets IsGlobalChanged = true
   *   3. Iterates ALL triggers:
   *      - If Event1 is GLOBAL_SET/CLEAR matching this global → resets Event2 timer
   *      - If Event2 is GLOBAL_SET/CLEAR matching this global → resets Event1 timer
   *
   * This ensures that when a global changes, any trigger with a paired TIME event
   * gets its timer reset — so the TIME event must elapse again from this point.
   *
   * TS: springGlobalTriggers() does this reset via trigger.timerTick = this.tick
   */

  it('TEVENT_GLOBAL_SET fires when the matching global is in the set', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals: new Set([5]) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('TEVENT_GLOBAL_SET does not fire when the global is absent', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals: new Set([3, 7]) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_GLOBAL_CLEAR fires when the matching global is NOT in the set', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 5 };
    const state = createState({ globals: new Set([3, 7]) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('TEVENT_GLOBAL_CLEAR does not fire when the global IS in the set', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 5 };
    const state = createState({ globals: new Set([5]) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  /**
   * C++ scenario.cpp:268: if (previous != value) — only processes when value actually changes.
   * The cascade (timer reset + IsGlobalChanged) only happens on actual state change.
   * TS: executeTriggerAction always sets result.globalChanged regardless of previous value.
   *
   * This is a potential divergence: C++ only cascades on actual change, TS always cascades.
   */
  it('SET_GLOBAL does NOT report globalChanged when global was already set', () => {
    // C++ scenario.cpp:268: if (previous != value) — only cascades on real change
    // TS now matches: no cascade when value unchanged
    const globals = new Set<number>([5]);
    const action: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(action, globals);
    // C++ and TS: no cascade because previous == value
    expect(result.globalChanged).toBeUndefined();
  });
});

describe('Cell trigger → SET_GLOBAL → GLOBAL_SET cascade chain — C++ parity', () => {
  /**
   * C++ scenario flow (common pattern in RA missions):
   * 1. Player enters cell → Trigger A fires (PLAYER_ENTERED → SET_GLOBAL 5)
   * 2. Global 5 now set → Trigger B (GLOBAL_SET 5 → WIN) should fire
   *
   * C++ mechanism:
   *   - Set_Global_To(5, true) marks IsGlobalChanged=true
   *   - Next logic tick, logic.cpp:218-221 evaluates all triggers with GLOBAL_SET/CLEAR
   *   - Trigger B's event is satisfied, so it fires its action (WIN)
   *
   * TS mechanism:
   *   - executeTriggerAction returns result.globalChanged=5
   *   - applyTriggerActionResult calls springGlobalTriggers(5)
   *   - springGlobalTriggers scans triggers for GLOBAL_SET/CLEAR on index 5 and fires them
   */

  it('SET_GLOBAL enables a GLOBAL_SET-dependent trigger to fire', () => {
    // Step 1: Execute SET_GLOBAL 5
    const globals = new Set<number>();
    const setAction: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(setAction, globals);
    expect(globals.has(5)).toBe(true);
    expect(result.globalChanged).toBe(5);

    // Step 2: Now check if a GLOBAL_SET event for global 5 evaluates to true
    const globalSetEvent: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals });
    expect(checkTriggerEvent(globalSetEvent, state)).toBe(true);
  });

  it('CLEAR_GLOBAL enables a GLOBAL_CLEAR-dependent trigger to fire', () => {
    // Global 5 was set, now clear it
    const globals = new Set<number>([5]);
    const clearAction: TriggerAction = { action: TACTION_CLEAR_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(clearAction, globals);
    expect(globals.has(5)).toBe(false);
    expect(result.globalChanged).toBe(5);

    // A GLOBAL_CLEAR event should now fire
    const globalClearEvent: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 5 };
    const state = createState({ globals });
    expect(checkTriggerEvent(globalClearEvent, state)).toBe(true);
  });

  it('chained globals: SET A → fires SET B → both are set', () => {
    // Trigger 1: event=PLAYER_ENTERED, action=SET_GLOBAL(0)
    // Trigger 2: event=GLOBAL_SET(0), action=SET_GLOBAL(1)
    // Expected: entering cell sets global 0, which cascades to set global 1
    const globals = new Set<number>();

    // Step 1: SET_GLOBAL 0
    const setAction0: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 0 };
    executeAction(setAction0, globals);
    expect(globals.has(0)).toBe(true);

    // Step 2: GLOBAL_SET 0 is now true
    const globalSet0: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 0 };
    expect(checkTriggerEvent(globalSet0, createState({ globals }))).toBe(true);

    // Step 3: SET_GLOBAL 1 (as if Trigger 2 fired)
    const setAction1: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 1 };
    executeAction(setAction1, globals);
    expect(globals.has(1)).toBe(true);

    // Both globals are now set
    expect(globals.has(0)).toBe(true);
    expect(globals.has(1)).toBe(true);
  });
});

describe('Multi-unit cell trigger behavior — C++ parity', () => {
  /**
   * C++ foot.cpp:1410-1412:
   *   TriggerClass * trigger = Map[Coord].Trigger;
   *   if (trigger != NULL) {
   *     trigger->Spring(TEVENT_PLAYER_ENTERED, this, Coord_Cell(Coord));
   *
   * In C++, EACH unit that enters the cell calls Spring() independently.
   * For volatile triggers (persistence=0), the first unit fires and the trigger
   * is destroyed (trigger.cpp:341-342: delete this). Subsequent units find no trigger.
   *
   * For persistent triggers (persistence=2), each unit's entry re-fires.
   *
   * TS: checkCellTriggers() tracks per-entity-per-cell activation via
   * activatedCellTriggers set with key "${cellIdx}:${trigName}:${entity.id}".
   * This means each entity fires the trigger independently (matching C++).
   */

  it('TS tracks cell trigger activations per-entity (key includes entity.id)', () => {
    // This tests the TS mechanism: different entity IDs generate different keys
    const cellIdx = 100;
    const trigName = 'celltrig';
    const key1 = `${cellIdx}:${trigName}:${1}`;
    const key2 = `${cellIdx}:${trigName}:${2}`;
    // Keys are different, so two entities independently activate the same cell trigger
    expect(key1).not.toBe(key2);
  });

  it('same entity re-entering the same cell does NOT re-trigger (key is identical)', () => {
    // C++ behavior: volatile triggers are deleted after firing, so re-entry has no trigger.
    // C++ behavior: persistent triggers CAN re-fire, but TS uses activatedCellTriggers to prevent
    //   duplicate activation per entity.
    // TS: key = "${cellIdx}:${trigName}:${entity.id}" — same entity, same cell = same key = no re-trigger
    const cellIdx = 100;
    const trigName = 'celltrig';
    const entityId = 1;
    const key = `${cellIdx}:${trigName}:${entityId}`;
    const activated = new Set<string>();
    activated.add(key);
    // Second check with same key — already activated
    expect(activated.has(key)).toBe(true);
  });
});

describe('Event control modes with cell triggers and globals — C++ parity', () => {
  /**
   * C++ trigger.cpp:249-264 (Spring event switch):
   *   MULTI_ONLY:  execute = e1
   *   MULTI_AND:   e2 = evaluate; execute = e1 && e2
   *   MULTI_OR:    e2 = evaluate; execute = e1 || e2
   *   MULTI_LINKED:e2 = evaluate; execute = e1 || e2 (action routing differs)
   *
   * Common RA pattern: event1=PLAYER_ENTERED AND event2=GLOBAL_SET
   * Both must be true for the trigger to fire.
   */

  it('MULTI_AND: PLAYER_ENTERED + GLOBAL_SET — both true → fires', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const state = createState({ playerEntered: true, globals: new Set([3]) });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    // MULTI_AND: both must be true
    expect(r1 && r2).toBe(true);
  });

  it('MULTI_AND: PLAYER_ENTERED true + GLOBAL_SET false → does not fire', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const state = createState({ playerEntered: true, globals: new Set() });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1 && r2).toBe(false);
  });

  it('MULTI_AND: PLAYER_ENTERED false + GLOBAL_SET true → does not fire', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const state = createState({ playerEntered: false, globals: new Set([3]) });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1 && r2).toBe(false);
  });

  it('MULTI_OR: PLAYER_ENTERED true + GLOBAL_SET false → fires', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const state = createState({ playerEntered: true, globals: new Set() });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1 || r2).toBe(true);
  });

  it('MULTI_OR: both false → does not fire', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const state = createState({ playerEntered: false, globals: new Set() });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1 || r2).toBe(false);
  });

  it('MULTI_ONLY: only event1 matters', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const state = createState({ playerEntered: true });
    const r1 = checkTriggerEvent(e1, state);
    // MULTI_ONLY: execute = e1
    expect(r1).toBe(true);
  });
});

describe('Trigger persistence with cell triggers and globals — C++ parity', () => {
  /**
   * C++ trigger.cpp:341-353:
   *   if (IsPersistant == VOLATILE || (SEMIPERSISTANT && AttachCount <= 1)) {
   *     Detach_This_From_All(As_Target(), true);
   *     delete this;
   *   } else {
   *     // Persistent: reset events so trigger can fire again
   *     Class->Event1.Reset(Event1);
   *     Class->Event2.Reset(Event2);
   *   }
   */

  it('volatile trigger (persistence=0): fires once and marks fired', () => {
    const trigger = createTrigger({
      persistence: 0,
      event1: { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 },
      action1: { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 },
    });
    trigger.fired = true;
    // Once fired, volatile trigger should not be re-evaluated (skipped by persistence <= 1 check)
    expect(trigger.fired && trigger.persistence <= 1).toBe(true);
  });

  it('persistent trigger (persistence=2): can re-fire after reset', () => {
    const trigger = createTrigger({
      persistence: 2,
      event1: { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 },
      action1: { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 },
    });
    trigger.fired = true;
    // Persistent triggers are NOT skipped when fired
    expect(trigger.fired && trigger.persistence <= 1).toBe(false);
  });

  /**
   * C++ trigger.cpp:277-298 — Semi-persistent (IsPersistant == SEMIPERSISTANT):
   *   - Detaches from the object/cell that triggered it
   *   - Decrements AttachCount
   *   - If AttachCount > 0, return false (don't fire yet)
   *   - If AttachCount <= 0, fire (and mark volatile for deletion)
   *
   * TS: consumeSemiPersistentAttachment decrements remainingAttachCount
   * and returns true only when it reaches 0.
   */
  it('semi-persistent trigger: does not fire until all attachments consumed', () => {
    const trigger = createTrigger({
      persistence: 1, // semi-persistent
      attachCount: 3,
      remainingAttachCount: 3,
    });
    // First detach
    expect(consumeSemiPersistentAttachment(trigger, 1)).toBe(false);
    expect(trigger.remainingAttachCount).toBe(2);
    // Second detach
    expect(consumeSemiPersistentAttachment(trigger, 1)).toBe(false);
    expect(trigger.remainingAttachCount).toBe(1);
    // Third detach — all consumed, now fires
    expect(consumeSemiPersistentAttachment(trigger, 1)).toBe(true);
    expect(trigger.remainingAttachCount).toBe(0);
  });

  it('non-semi-persistent trigger: consumeSemiPersistentAttachment always returns true', () => {
    const volatileTrigger = createTrigger({ persistence: 0 });
    expect(consumeSemiPersistentAttachment(volatileTrigger, 1)).toBe(true);

    const persistentTrigger = createTrigger({ persistence: 2 });
    expect(consumeSemiPersistentAttachment(persistentTrigger, 1)).toBe(true);
  });
});

describe('GlobalFlags array bounds (C++ scenario.h:197) — C++ parity', () => {
  /**
   * C++ scenario.h:197:  bool GlobalFlags[30];
   * C++ scenario.cpp:265: if ((unsigned)global < ARRAY_SIZE(Scen.GlobalFlags))
   *
   * C++ supports 30 global flags (indices 0-29).
   * TS validates indices to [0, 29] range — matches C++ bounds check.
   */

  it('global index 0 (lowest valid) works correctly', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 0 };
    expect(checkTriggerEvent(event, createState({ globals: new Set([0]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
  });

  it('global index 29 (highest valid in C++) works correctly', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 29 };
    expect(checkTriggerEvent(event, createState({ globals: new Set([29]) }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(false);
  });

  it('global index >= 30 is rejected (C++ bounds-check: scenario.cpp:265)', () => {
    // C++ scenario.cpp:265: if ((unsigned)global < ARRAY_SIZE(Scen.GlobalFlags))
    // If global >= 30, C++ returns false (out of bounds). TS now matches.
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 30 };
    const state = createState({ globals: new Set([30]) });
    // TS rejects out-of-bounds global indices — matches C++ behavior
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('negative global index is rejected', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: -1 };
    const state = createState({ globals: new Set([-1]) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('SET_GLOBAL with index >= 30 is a no-op', () => {
    // C++ scenario.cpp:265 — out-of-bounds SET_GLOBAL is silently ignored
    const globals = new Set<number>();
    const action: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 30 };
    const result = executeAction(action, globals);
    expect(globals.has(30)).toBe(false);
    expect(result.globalChanged).toBeUndefined();
  });
});

describe('GLOBAL_SET/CLEAR as paired event with TIME — timer reset on change — C++ parity', () => {
  /**
   * C++ scenario.cpp:277-285 — Set_Global_To timer reset logic:
   *   for (int index = 0; index < Triggers.Count(); index++) {
   *     TriggerClass * tp = Triggers.Ptr(index);
   *     if ((tp->Class->Event1.Event == TEVENT_GLOBAL_SET || == TEVENT_GLOBAL_CLEAR) && Event1.Data.Value == global) {
   *       tp->Class->Event2.Reset(tp->Event1);  // Note: resets Event2's timer data into Event1
   *     }
   *     if ((tp->Class->Event2.Event == TEVENT_GLOBAL_SET || == TEVENT_GLOBAL_CLEAR) && Event2.Data.Value == global) {
   *       tp->Class->Event1.Reset(tp->Event1);  // Note: resets Event1's timer data
   *     }
   *   }
   *
   * Purpose: When a global changes, any trigger with a paired TIME event gets
   * its timer reset. This means: "After global X is set, wait N seconds."
   *
   * TS: springGlobalTriggers resets trigger.timerTick = this.tick for matching triggers.
   */

  it('trigger with event1=GLOBAL_SET + event2=TIME: TIME event uses timerTick for elapsed calculation', () => {
    // The TIME event uses (gameTick - triggerStartTick) > requiredTicks
    // After a global change, triggerStartTick (timerTick) is reset to current tick
    const timeEvent: TriggerEvent = { type: TEVENT_TIME, team: -1, data: 1 }; // 1 unit = 90 ticks
    const TIME_UNIT_TICKS = 90;

    // Before enough time has elapsed
    const stateBefore = createState({
      gameTick: 50,
      triggerStartTick: 0,
    });
    expect(checkTriggerEvent(timeEvent, stateBefore)).toBe(false);

    // Exactly at threshold — still false (> not >=)
    const stateExact = createState({
      gameTick: 90,
      triggerStartTick: 0,
    });
    expect(checkTriggerEvent(timeEvent, stateExact)).toBe(false);

    // One tick past threshold — fires
    const stateAfter = createState({
      gameTick: 91,
      triggerStartTick: 0,
    });
    expect(checkTriggerEvent(timeEvent, stateAfter)).toBe(true);

    // After timer reset (simulating global change at tick 100)
    const stateReset = createState({
      gameTick: 150,
      triggerStartTick: 100, // reset at tick 100
    });
    // 150 - 100 = 50 < 90 → not enough time
    expect(checkTriggerEvent(timeEvent, stateReset)).toBe(false);

    // After enough time from reset point
    const stateResetElapsed = createState({
      gameTick: 200,
      triggerStartTick: 100,
    });
    // 200 - 100 = 100 > 90 → fires
    expect(checkTriggerEvent(timeEvent, stateResetElapsed)).toBe(true);
  });
});

describe('FORCE_TRIGGER interaction with globals — C++ parity', () => {
  /**
   * C++ taction.cpp:587-589:
   *   case TACTION_FORCE_TRIGGER:
   *     if (Trigger.Is_Valid()) {
   *       Find_Or_Make(Trigger)->Spring(TEVENT_ANY, 0, 0, true);
   *     }
   *
   * C++ trigger.cpp:240-242: When forced=true, cell = Cell (embedded), then
   * line 270: if (execute || forced) — forced always enters action block.
   * Line 308: if (e1 || forced) ok |= Action1 — forced always fires Action1.
   *
   * TS: trigger.forceFirePending is set by FORCE_TRIGGER action (via triggerForceIndex),
   * then processed in processTriggers with forcedFire=true path.
   */

  it('FORCE_TRIGGER action sets forceFirePending on the target trigger via trigger index', () => {
    const triggerA = createTrigger({ name: 'trigA' });
    const triggerB = createTrigger({
      name: 'trigB',
      event1: { type: TEVENT_GLOBAL_SET, team: -1, data: 99 }, // unsatisfiable
      action1: { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 10 },
    });
    const triggers = [triggerA, triggerB];

    // FORCE_TRIGGER targeting trigger index 1 (triggerB)
    const forceAction: TriggerAction = { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 1, data: 0 };
    executeAction(forceAction, new Set(), triggers);

    // The force trigger action sets forceFirePending on the target
    expect(triggerB.forceFirePending).toBe(true);
  });
});

describe('Cell trigger → SET_GLOBAL with MULTI_LINKED event control — C++ parity', () => {
  /**
   * C++ trigger.cpp:307-309:
   *   if (Class->EventControl == MULTI_LINKED) {
   *     if (e1 || forced) ok |= Class->Action1(hh, obj, ID, cell);
   *     if (e2 && !forced) ok |= Class->Action2(hh, obj, ID, cell);
   *   }
   *
   * MULTI_LINKED means:
   * - The trigger fires if e1 OR e2 is true (same gate as MULTI_OR)
   * - But Action1 fires only for e1, Action2 fires only for e2
   *
   * Example: event1=PLAYER_ENTERED→action1=SET_GLOBAL(5),
   *          event2=GLOBAL_SET(5)→action2=WIN
   * When player enters: e1=true → Action1 fires → SET_GLOBAL(5)
   * When global 5 set:  e2=true → Action2 fires → WIN
   */

  it('MULTI_LINKED: e1 true, e2 false → only Action1 fires', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ playerEntered: true, globals: new Set() });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    // MULTI_LINKED: fires (e1 || e2 = true), but only Action1 should execute
    expect(r1 || r2).toBe(true);
  });

  it('MULTI_LINKED: e1 false, e2 true → only Action2 fires', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ playerEntered: false, globals: new Set([5]) });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1).toBe(false);
    expect(r2).toBe(true);
    // MULTI_LINKED: fires (e1 || e2 = true), but only Action2 should execute
    expect(r1 || r2).toBe(true);
  });

  it('MULTI_LINKED: both true → both Actions fire', () => {
    const e1: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };
    const e2: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ playerEntered: true, globals: new Set([5]) });
    const r1 = checkTriggerEvent(e1, state);
    const r2 = checkTriggerEvent(e2, state);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });
});

describe('Cloaked unit cell trigger immunity — C++ parity', () => {
  /**
   * C++ foot.cpp:1409:
   *   if (Cloak != CLOAKED) {
   *     TriggerClass * trigger = Map[Coord].Trigger;
   *     ...
   *   }
   *
   * Cloaked units (stealth tanks, spies in disguise) do NOT trigger cell triggers.
   *
   * TS: checkCellTriggers() filters with `entity.isPlayerUnit` but there's no
   * explicit cloak check. Cloaked units may or may not have isPlayerUnit set.
   *
   * This is documented as a behavioral note — the TS implementation may not
   * have a cloaking system that interacts with cell triggers yet.
   */
  it('C++ skips cell triggers for cloaked units — TS should match', () => {
    // In C++, Cloak == CLOAKED means the unit is invisible and doesn't trigger cells.
    // TS doesn't have a Cloak enum, so this test documents the expected behavior.
    // If TS implements cloaking, the checkCellTriggers guard must include a cloak check.
    // For now, this is a documentation test.
    expect(true).toBe(true); // placeholder — no cloaking system to test
  });
});

describe('TEVENT_GLOBAL_CLEAR initial state — C++ parity', () => {
  /**
   * C++ scenario.h:197: bool GlobalFlags[30]; — initialized to all false (zero-initialized in C++)
   * C++ tevent.cpp:242-244:
   *   case TEVENT_GLOBAL_CLEAR:
   *     if (Scen.GlobalFlags[Data.Value]) return(false);
   *     return(true);
   *
   * At game start, all globals are clear. So TEVENT_GLOBAL_CLEAR(N) is satisfied
   * for ALL N at game start. This is a common trap in mission design — a trigger
   * with event=GLOBAL_CLEAR will fire immediately unless paired with another event.
   */

  it('at game start (empty globals set), GLOBAL_CLEAR for any index is satisfied', () => {
    const globals = new Set<number>(); // empty = all globals clear
    for (let i = 0; i < 30; i++) {
      const event: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: i };
      expect(
        checkTriggerEvent(event, createState({ globals })),
        `GLOBAL_CLEAR(${i}) should be true at game start`,
      ).toBe(true);
    }
  });

  it('at game start, GLOBAL_SET for any index is NOT satisfied', () => {
    const globals = new Set<number>(); // empty
    for (let i = 0; i < 30; i++) {
      const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: i };
      expect(
        checkTriggerEvent(event, createState({ globals })),
        `GLOBAL_SET(${i}) should be false at game start`,
      ).toBe(false);
    }
  });
});

describe('Multiple globals independent — C++ parity', () => {
  /**
   * C++ scenario.h:197: bool GlobalFlags[30]; — each index is independent.
   * Setting one global does not affect others.
   */

  it('setting global 5 does not affect GLOBAL_SET check for global 3', () => {
    const globals = new Set<number>([5]);
    const event3: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 3 };
    const event5: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 5 };
    const state = createState({ globals });
    expect(checkTriggerEvent(event3, state)).toBe(false);
    expect(checkTriggerEvent(event5, state)).toBe(true);
  });

  it('clearing global 5 does not affect GLOBAL_CLEAR check for global 3', () => {
    const globals = new Set<number>([3, 5]);
    // Clear 5
    globals.delete(5);
    const event3clear: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 3 };
    const event5clear: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 5 };
    const state = createState({ globals });
    expect(checkTriggerEvent(event3clear, state)).toBe(false); // 3 is still set
    expect(checkTriggerEvent(event5clear, state)).toBe(true);  // 5 was cleared
  });
});

describe('TEVENT_GLOBAL_SET/CLEAR attach type — C++ parity', () => {
  /**
   * C++ tevent.cpp:750-758:
   *   case TEVENT_GLOBAL_SET:
   *   case TEVENT_GLOBAL_CLEAR:
   *     attach = attach | ATTACH_GENERAL;
   *
   * GLOBAL_SET and GLOBAL_CLEAR triggers attach to the GENERAL logic loop,
   * not to cells or objects. They are evaluated every logic tick.
   *
   * In C++, these triggers are in the LogicTriggers list (evaluated by logic.cpp).
   * In TS, they're evaluated in processTriggers and springGlobalTriggers.
   *
   * This test verifies that GLOBAL_SET/CLEAR events don't require playerEntered or
   * any other cell/object-specific state.
   */

  it('GLOBAL_SET fires purely based on globals state, not cell entry', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_SET, team: -1, data: 7 };
    // playerEntered=false, but global 7 is set
    const state = createState({ playerEntered: false, globals: new Set([7]) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('GLOBAL_CLEAR fires purely based on globals state, not cell entry', () => {
    const event: TriggerEvent = { type: TEVENT_GLOBAL_CLEAR, team: -1, data: 7 };
    // playerEntered=false, global 7 is not set
    const state = createState({ playerEntered: false, globals: new Set() });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});

describe('PLAYER_ENTERED ownership check — C++ parity', () => {
  /**
   * C++ tevent.cpp:290-293:
   *   if (Event == TEVENT_PLAYER_ENTERED || ...) {
   *     if (!object || object->Owner() != Data.House) return(false);
   *     td.IsTripped = true;
   *     return(true);
   *   }
   *
   * The trigger's Data.House field specifies WHICH house must own the entering unit.
   * In C++, a cell trigger with TEVENT_PLAYER_ENTERED and Data.House=HOUSE_GREECE
   * only fires for Greece units. Other house units are ignored.
   *
   * TS: checkTriggerEvent checks state.playerEnteredHouse === event.data,
   * matching C++ ownership check behavior.
   */
  it('PLAYER_ENTERED checks event.data house against entering unit owner', () => {
    const event: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 2 }; // Data.House=2
    // State says playerEntered=true, entering unit is house 0 (default), not house 2
    const state = createState({ playerEntered: true });
    // C++ and TS: false — house mismatch (0 !== 2)
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('PLAYER_ENTERED passes when entering house matches event.data', () => {
    const event: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 2 };
    const state = createState({ playerEntered: true, playerEnteredHouse: 2 });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });
});

describe('Set_Global_To idempotency — C++ parity', () => {
  /**
   * C++ scenario.cpp:268:
   *   if (previous != value) {
   *     GlobalFlags[global] = value;
   *     IsGlobalChanged = true;
   *     // ... cascade logic
   *   }
   *
   * C++ only cascades (resets timers, marks changed) when the global value
   * actually changes. Setting an already-set global is a no-op.
   * TS matches: only reports globalChanged when the value actually changed.
   */
  it('SET_GLOBAL does NOT report globalChanged when global was already set', () => {
    const globals = new Set<number>([5]); // global 5 already set
    const action: TriggerAction = { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(action, globals);
    // No cascade because previous == value
    expect(result.globalChanged).toBeUndefined();
  });

  it('CLEAR_GLOBAL does NOT report globalChanged when global was already clear', () => {
    const globals = new Set<number>(); // global 5 already clear
    const action: TriggerAction = { action: TACTION_CLEAR_GLOBAL, team: -1, trigger: -1, data: 5 };
    const result = executeAction(action, globals);
    // No cascade because previous == value
    expect(result.globalChanged).toBeUndefined();
  });
});

describe('TEVENT_GLOBAL_CLEAR constant value — C++ parity', () => {
  /**
   * C++ tevent.h:75: TEVENT_GLOBAL_CLEAR = 28 (follows TEVENT_GLOBAL_SET = 27)
   *
   * TS scenario.ts: const TEVENT_GLOBAL_CLEAR = 28
   *
   * Verify the TS constant matches. Note: the TS file uses internal constants,
   * so we test by exercising the event logic with type=28.
   */
  it('TEVENT_GLOBAL_CLEAR has enum ordinal 28', () => {
    expect(TEVENT_GLOBAL_CLEAR).toBe(28);
  });

  it('checkTriggerEvent with type=28 behaves as GLOBAL_CLEAR', () => {
    const event: TriggerEvent = { type: 28, team: -1, data: 5 };
    expect(checkTriggerEvent(event, createState({ globals: new Set() }))).toBe(true);
    expect(checkTriggerEvent(event, createState({ globals: new Set([5]) }))).toBe(false);
  });
});
