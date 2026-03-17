/**
 * C++ Behavioral Parity: TACTION_SET_GLOBAL (action=28) & TACTION_CLEAR_GLOBAL (action=29)
 *
 * Tests verify SET_GLOBAL / CLEAR_GLOBAL behavior matches C++ RA source code (TRIGGER.CPP).
 * C++ behavior:
 *   SET_GLOBAL:   Scen.GlobalFlags[Data.Value] = true   (adds to globals set)
 *   CLEAR_GLOBAL: Scen.GlobalFlags[Data.Value] = false  (removes from globals set)
 *
 * TypeScript behavior:
 *   SET_GLOBAL:   globals.add(action.data)
 *   CLEAR_GLOBAL: globals.delete(action.data)
 *
 * These actions mutate the shared globals set in-place and produce no spawned entities
 * or other TriggerActionResult side effects.
 *
 * Source: TACTION.H (enum values 28, 29), TRIGGER.CPP Handle_Action switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_SET_GLOBAL = 28;
const TACTION_CLEAR_GLOBAL = 29;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_SET_GLOBAL action with the given global index and optional overrides. */
function setGlobalAction(globalIndex: number, overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: globalIndex, ...overrides };
}

/** Build a TACTION_CLEAR_GLOBAL action with the given global index and optional overrides. */
function clearGlobalAction(globalIndex: number, overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_CLEAR_GLOBAL, team: -1, trigger: -1, data: globalIndex, ...overrides };
}

/** Execute a trigger action against a globals set, returning both the result and the globals. */
function executeWithGlobals(
  action: TriggerAction,
  globals: Set<number> = new Set(),
): { result: TriggerActionResult; globals: Set<number> } {
  const result = executeTriggerAction(
    action,
    [],           // teamTypes
    new Map(),    // waypoints
    globals,
    [],           // triggers
  );
  return { result, globals };
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_SET_GLOBAL / TACTION_CLEAR_GLOBAL constant values (TACTION.H)', () => {
  it('TACTION_SET_GLOBAL has constant value 28', () => {
    expect(TACTION_SET_GLOBAL).toBe(28);
    expect(setGlobalAction(0).action).toBe(28);
  });

  it('TACTION_CLEAR_GLOBAL has constant value 29', () => {
    expect(TACTION_CLEAR_GLOBAL).toBe(29);
    expect(clearGlobalAction(0).action).toBe(29);
  });
});

describe('TACTION_SET_GLOBAL adds action.data to globals set (trigger.cpp)', () => {
  it('adds a global index to an empty set', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(5), globals);
    expect(globals.has(5)).toBe(true);
    expect(globals.size).toBe(1);
  });

  it('adds a global index to a set that already has other values', () => {
    const globals = new Set<number>([1, 2, 3]);
    executeWithGlobals(setGlobalAction(7), globals);
    expect(globals.has(7)).toBe(true);
    expect(globals.size).toBe(4);
    // Original values are preserved
    expect(globals.has(1)).toBe(true);
    expect(globals.has(2)).toBe(true);
    expect(globals.has(3)).toBe(true);
  });

  it('is idempotent — setting an already-set global does not duplicate it', () => {
    const globals = new Set<number>([5]);
    executeWithGlobals(setGlobalAction(5), globals);
    expect(globals.has(5)).toBe(true);
    expect(globals.size).toBe(1);
  });

  it('is idempotent — repeated SET_GLOBAL on same index keeps set size at 1', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(10), globals);
    executeWithGlobals(setGlobalAction(10), globals);
    executeWithGlobals(setGlobalAction(10), globals);
    expect(globals.has(10)).toBe(true);
    expect(globals.size).toBe(1);
  });

  it('spawned array is empty', () => {
    const { result } = executeWithGlobals(setGlobalAction(0));
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win and result.lose are undefined', () => {
    const { result } = executeWithGlobals(setGlobalAction(0));
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });
});

describe('TACTION_CLEAR_GLOBAL removes action.data from globals set (trigger.cpp)', () => {
  it('removes a global index that exists in the set', () => {
    const globals = new Set<number>([5, 10, 15]);
    executeWithGlobals(clearGlobalAction(10), globals);
    expect(globals.has(10)).toBe(false);
    expect(globals.size).toBe(2);
    // Other values are preserved
    expect(globals.has(5)).toBe(true);
    expect(globals.has(15)).toBe(true);
  });

  it('is idempotent — clearing an already-absent global is a no-op', () => {
    const globals = new Set<number>([1, 2]);
    executeWithGlobals(clearGlobalAction(99), globals);
    expect(globals.has(99)).toBe(false);
    expect(globals.size).toBe(2);
    expect(globals.has(1)).toBe(true);
    expect(globals.has(2)).toBe(true);
  });

  it('is idempotent — clearing from an empty set is a no-op', () => {
    const globals = new Set<number>();
    executeWithGlobals(clearGlobalAction(0), globals);
    expect(globals.size).toBe(0);
  });

  it('is idempotent — repeated CLEAR_GLOBAL on same index does not error', () => {
    const globals = new Set<number>([5]);
    executeWithGlobals(clearGlobalAction(5), globals);
    executeWithGlobals(clearGlobalAction(5), globals);
    executeWithGlobals(clearGlobalAction(5), globals);
    expect(globals.has(5)).toBe(false);
    expect(globals.size).toBe(0);
  });

  it('spawned array is empty', () => {
    const { result } = executeWithGlobals(clearGlobalAction(0));
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win and result.lose are undefined', () => {
    const { result } = executeWithGlobals(clearGlobalAction(0));
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });
});

describe('Different global indices are independent (trigger.cpp)', () => {
  it('setting global 3 does not affect global 5', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(3), globals);
    expect(globals.has(3)).toBe(true);
    expect(globals.has(5)).toBe(false);
  });

  it('clearing global 3 does not affect global 5', () => {
    const globals = new Set<number>([3, 5]);
    executeWithGlobals(clearGlobalAction(3), globals);
    expect(globals.has(3)).toBe(false);
    expect(globals.has(5)).toBe(true);
  });

  it('multiple SET_GLOBAL calls with different indices all persist', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(0), globals);
    executeWithGlobals(setGlobalAction(10), globals);
    executeWithGlobals(setGlobalAction(20), globals);
    executeWithGlobals(setGlobalAction(30), globals);
    expect(globals.size).toBe(4);
    expect(globals.has(0)).toBe(true);
    expect(globals.has(10)).toBe(true);
    expect(globals.has(20)).toBe(true);
    expect(globals.has(30)).toBe(true);
  });

  it('clearing one global does not affect others', () => {
    const globals = new Set<number>([0, 10, 20, 30]);
    executeWithGlobals(clearGlobalAction(20), globals);
    expect(globals.size).toBe(3);
    expect(globals.has(0)).toBe(true);
    expect(globals.has(10)).toBe(true);
    expect(globals.has(20)).toBe(false);
    expect(globals.has(30)).toBe(true);
  });

  it('SET then CLEAR on same index restores original state', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(7), globals);
    expect(globals.has(7)).toBe(true);
    executeWithGlobals(clearGlobalAction(7), globals);
    expect(globals.has(7)).toBe(false);
    expect(globals.size).toBe(0);
  });

  it('CLEAR then SET on same index leaves it set', () => {
    const globals = new Set<number>([7]);
    executeWithGlobals(clearGlobalAction(7), globals);
    expect(globals.has(7)).toBe(false);
    executeWithGlobals(setGlobalAction(7), globals);
    expect(globals.has(7)).toBe(true);
    expect(globals.size).toBe(1);
  });
});

describe('Globals set spawned empty (trigger.cpp)', () => {
  it('globals set starts empty by default', () => {
    const globals = new Set<number>();
    expect(globals.size).toBe(0);
  });

  it('SET_GLOBAL on a fresh empty globals set adds exactly one entry', () => {
    const globals = new Set<number>();
    executeWithGlobals(setGlobalAction(42), globals);
    expect(globals.size).toBe(1);
    expect(globals.has(42)).toBe(true);
  });

  it('CLEAR_GLOBAL on a fresh empty globals set leaves it empty', () => {
    const globals = new Set<number>();
    executeWithGlobals(clearGlobalAction(42), globals);
    expect(globals.size).toBe(0);
  });
});

describe('SET_GLOBAL / CLEAR_GLOBAL produce no other side effects (trigger.cpp)', () => {
  it('SET_GLOBAL sets no TriggerActionResult flags beyond spawned', () => {
    const { result } = executeWithGlobals(setGlobalAction(5));

    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.timerExtend).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.destroyTriggeringUnit).toBeUndefined();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.centerView).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.playMovie).toBeUndefined();
    expect(result.revealZone).toBeUndefined();
    expect(result.playMusic).toBeUndefined();
    expect(result.preferredTarget).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
    expect(result.destroyTeam).toBeUndefined();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
    expect(result.timerSubtract).toBeUndefined();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('CLEAR_GLOBAL sets no TriggerActionResult flags beyond spawned', () => {
    const { result } = executeWithGlobals(clearGlobalAction(5));

    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.timerExtend).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.destroyTriggeringUnit).toBeUndefined();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.centerView).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.playMovie).toBeUndefined();
    expect(result.revealZone).toBeUndefined();
    expect(result.playMusic).toBeUndefined();
    expect(result.preferredTarget).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
    expect(result.destroyTeam).toBeUndefined();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
    expect(result.timerSubtract).toBeUndefined();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('SET_GLOBAL does not mutate the triggers array', () => {
    const trigger: ScenarioTrigger = {
      name: 'test',
      persistence: 0,
      house: 0,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: setGlobalAction(5),
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      setGlobalAction(5),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });

  it('CLEAR_GLOBAL does not mutate the triggers array', () => {
    const trigger: ScenarioTrigger = {
      name: 'test',
      persistence: 0,
      house: 0,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: clearGlobalAction(5),
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      clearGlobalAction(5),
      [],
      new Map(),
      new Set<number>([5]),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const resultSet = executeTriggerAction(
      setGlobalAction(1, { team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );
    expect(resultSet.spawned).toEqual([]);

    const resultClear = executeTriggerAction(
      clearGlobalAction(1, { team: 0 }),
      teamTypes,
      waypoints,
      new Set<number>([1]),
      [],
    );
    expect(resultClear.spawned).toEqual([]);
  });
});
