/**
 * C++ Behavioral Parity: TACTION_SET_TIMER (action=27) — set mission timer
 *
 * Tests verify TACTION_SET_TIMER behavior matches C++ RA source code (TRIGGER.CPP).
 * C++ behavior: sets the mission timer to the value in action.data (1/10th minute units).
 * TypeScript behavior: sets result.setTimer = action.data. No other side effects —
 * spawned is empty, win/lose are undefined, and all other result fields are unset.
 *
 * Source: TACTION.H (enum value 27), TRIGGER.CPP Handle_Action switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_SET_TIMER = 27;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_SET_TIMER action with optional overrides. */
function setTimerAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_SET_TIMER, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Shared empty parameters — SET_TIMER needs no teams, waypoints, globals, or triggers */
const emptyTeamTypes: TeamType[] = [];
const emptyWaypoints = new Map<number, CellPos>();
const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

/** Execute a TACTION_SET_TIMER action with minimal required parameters. */
function executeSetTimer(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? setTimerAction(),
    emptyTeamTypes,
    emptyWaypoints,
    emptyGlobals,
    emptyTriggers,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_SET_TIMER constant value (TACTION.H)', () => {
  it('TACTION_SET_TIMER has constant value 27', () => {
    expect(TACTION_SET_TIMER).toBe(27);
    expect(setTimerAction().action).toBe(27);
  });

  it('action 27 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 27, team: -1, trigger: -1, data: 100 };
    const result = executeSetTimer(action);
    // If it fell through to default, setTimer would be undefined
    expect(result.setTimer).toBeDefined();
    expect(result.setTimer).toBe(100);
  });
});

describe('TACTION_SET_TIMER sets result.setTimer = action.data (trigger.cpp)', () => {
  it('result.setTimer equals action.data when data is 0', () => {
    const result = executeSetTimer(setTimerAction({ data: 0 }));
    expect(result.setTimer).toBe(0);
  });

  it('result.setTimer equals action.data when data is 10 (1 minute)', () => {
    const result = executeSetTimer(setTimerAction({ data: 10 }));
    expect(result.setTimer).toBe(10);
  });

  it('result.setTimer equals action.data when data is 50 (5 minutes)', () => {
    const result = executeSetTimer(setTimerAction({ data: 50 }));
    expect(result.setTimer).toBe(50);
  });

  it('result.setTimer equals action.data when data is 300 (30 minutes)', () => {
    const result = executeSetTimer(setTimerAction({ data: 300 }));
    expect(result.setTimer).toBe(300);
  });

  it('preserves exact timer value for arbitrary data values', () => {
    for (const timerVal of [1, 7, 13, 42, 98, 255, 600]) {
      const result = executeSetTimer(setTimerAction({ data: timerVal }));
      expect(result.setTimer, `timer value ${timerVal}`).toBe(timerVal);
    }
  });
});

describe('TACTION_SET_TIMER spawned array is empty (trigger.cpp)', () => {
  it('spawns no entities', () => {
    const result = executeSetTimer();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map<number, CellPos>([[0, { cx: 10, cy: 20 }]]);

    const result = executeTriggerAction(
      setTimerAction({ team: 0, data: 50 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.setTimer).toBe(50);
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_SET_TIMER ignores team/trigger parameters (trigger.cpp)', () => {
  it('result.setTimer is correct regardless of team index', () => {
    expect(executeSetTimer(setTimerAction({ team: 0, data: 20 })).setTimer).toBe(20);
    expect(executeSetTimer(setTimerAction({ team: 5, data: 20 })).setTimer).toBe(20);
    expect(executeSetTimer(setTimerAction({ team: -1, data: 20 })).setTimer).toBe(20);
    expect(executeSetTimer(setTimerAction({ team: 99, data: 20 })).setTimer).toBe(20);
  });

  it('result.setTimer is correct regardless of trigger index', () => {
    expect(executeSetTimer(setTimerAction({ trigger: 0, data: 30 })).setTimer).toBe(30);
    expect(executeSetTimer(setTimerAction({ trigger: 3, data: 30 })).setTimer).toBe(30);
    expect(executeSetTimer(setTimerAction({ trigger: -1, data: 30 })).setTimer).toBe(30);
  });
});

describe('TACTION_SET_TIMER produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeSetTimer(setTimerAction({ data: 42 }));

    // Verify setTimer is set correctly
    expect(result.setTimer).toBe(42);

    // Verify only setTimer is set; everything else is undefined or default
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
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

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      setTimerAction({ data: 60 }),
      [],
      new Map(),
      globals,
      [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger: ScenarioTrigger = {
      name: 'test',
      persistence: 0,
      house: 0,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: setTimerAction({ data: 30 }),
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
      setTimerAction({ data: 30 }),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
