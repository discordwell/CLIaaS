/**
 * C++ behavioral parity tests for TACTION_TEXT_TRIGGER (action=11) — display text message.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_TEXT_TRIGGER displays a text
 * message identified by action.data. The engine sets result.textMessage to the
 * text trigger ID (action.data) and spawns nothing (it is a UI display effect,
 * not an entity).
 *
 * Constant value: 11  (C++ enum TACTION_TEXT_TRIGGER = 11)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_TEXT_TRIGGER = 11;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_TEXT_TRIGGER action with optional overrides. */
function textTriggerAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_TEXT_TRIGGER, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_TEXT_TRIGGER action with minimal required parameters. */
function executeTextTrigger(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? textTriggerAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_TEXT_TRIGGER constant value (TACTION.H)', () => {
  it('TACTION_TEXT_TRIGGER has constant value 11', () => {
    expect(TACTION_TEXT_TRIGGER).toBe(11);
    expect(textTriggerAction().action).toBe(11);
  });

  it('action 11 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 11, team: -1, trigger: -1, data: 42 };
    const result = executeTextTrigger(action);
    // If it fell through to default, textMessage would be undefined
    expect(result.textMessage).toBeDefined();
    expect(result.textMessage).toBe(42);
  });
});

describe('TACTION_TEXT_TRIGGER sets result.textMessage = action.data (TRIGGER.CPP)', () => {
  it('sets result.textMessage to action.data (text ID 0)', () => {
    const result = executeTextTrigger(textTriggerAction({ data: 0 }));
    expect(result.textMessage).toBe(0);
  });

  it('sets result.textMessage to action.data (text ID 1)', () => {
    const result = executeTextTrigger(textTriggerAction({ data: 1 }));
    expect(result.textMessage).toBe(1);
  });

  it('sets result.textMessage to action.data (text ID 5)', () => {
    const result = executeTextTrigger(textTriggerAction({ data: 5 }));
    expect(result.textMessage).toBe(5);
  });

  it('sets result.textMessage to action.data (text ID 25 — high value)', () => {
    const result = executeTextTrigger(textTriggerAction({ data: 25 }));
    expect(result.textMessage).toBe(25);
  });

  it('preserves exact text ID for various values', () => {
    for (const textId of [2, 7, 13, 50, 98, 255]) {
      const result = executeTextTrigger(textTriggerAction({ data: textId }));
      expect(result.textMessage, `text ID ${textId}`).toBe(textId);
    }
  });
});

describe('TACTION_TEXT_TRIGGER spawns no entities (TRIGGER.CPP)', () => {
  it('spawned array is empty', () => {
    const result = executeTextTrigger();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('spawned is empty regardless of action.data value', () => {
    for (const data of [0, 1, 10, 99]) {
      const result = executeTextTrigger(textTriggerAction({ data }));
      expect(result.spawned, `data=${data}`).toEqual([]);
    }
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map<number, CellPos>([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      textTriggerAction({ team: 0, data: 3 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.textMessage).toBe(3);
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_TEXT_TRIGGER ignores team/trigger parameters (TRIGGER.CPP)', () => {
  it('result.textMessage equals action.data regardless of team index', () => {
    expect(executeTextTrigger(textTriggerAction({ team: 0, data: 7 })).textMessage).toBe(7);
    expect(executeTextTrigger(textTriggerAction({ team: 5, data: 7 })).textMessage).toBe(7);
    expect(executeTextTrigger(textTriggerAction({ team: -1, data: 7 })).textMessage).toBe(7);
    expect(executeTextTrigger(textTriggerAction({ team: 99, data: 7 })).textMessage).toBe(7);
  });

  it('result.textMessage equals action.data regardless of trigger index', () => {
    expect(executeTextTrigger(textTriggerAction({ trigger: 0, data: 12 })).textMessage).toBe(12);
    expect(executeTextTrigger(textTriggerAction({ trigger: 3, data: 12 })).textMessage).toBe(12);
    expect(executeTextTrigger(textTriggerAction({ trigger: -1, data: 12 })).textMessage).toBe(12);
  });
});

describe('TACTION_TEXT_TRIGGER produces no other side effects (TRIGGER.CPP)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeTextTrigger(textTriggerAction({ data: 4 }));

    // textMessage should be set
    expect(result.textMessage).toBe(4);

    // Everything else should be undefined or default
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
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
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      textTriggerAction({ data: 2 }),
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
      action1: textTriggerAction({ data: 1 }),
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
      textTriggerAction({ data: 1 }),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
