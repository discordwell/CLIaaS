/**
 * C++ Behavioral Parity: TACTION_DESTROY_OBJECT (action=32)
 *
 * Tests verify TACTION_DESTROY_OBJECT behavior matches C++ RA source code (TRIGGER.CPP).
 * C++ behavior: sets result.destroyTriggeringUnit = true, killing the unit/object
 * that triggered this event (e.g. units entering hazard zones). No other side effects.
 *
 * Source: TACTION.H (enum value 32), TRIGGER.CPP executeTriggerAction switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Constants ────────────────────────────────────────────────────────────────

const TACTION_DESTROY_OBJECT = 32;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal TACTION_DESTROY_OBJECT action with optional overrides. */
function destroyObjectAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_DESTROY_OBJECT, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Invoke executeTriggerAction with minimal valid arguments. */
function execDestroyObject(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? destroyObjectAction(),
    [],                        // teamTypes — empty, not needed for DESTROY_OBJECT
    new Map(),                 // waypoints — empty
    new Set<number>(),         // globals — empty
    [],                        // triggers — empty
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TACTION_DESTROY_OBJECT constant value (TACTION.H)', () => {
  it('TACTION_DESTROY_OBJECT has constant value 32', () => {
    const action = destroyObjectAction();
    expect(action.action).toBe(32);
  });
});

describe('TACTION_DESTROY_OBJECT sets result.destroyTriggeringUnit = true', () => {
  it('result.destroyTriggeringUnit is true', () => {
    const result = execDestroyObject();
    expect(result.destroyTriggeringUnit).toBe(true);
  });

  it('result.spawned is empty (no units spawned)', () => {
    const result = execDestroyObject();
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_DESTROY_OBJECT has no other side effects', () => {
  it('result.win is undefined', () => {
    const result = execDestroyObject();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = execDestroyObject();
    expect(result.lose).toBeUndefined();
  });

  it('result.allowWin is undefined', () => {
    const result = execDestroyObject();
    expect(result.allowWin).toBeUndefined();
  });

  it('result.allHunt is undefined', () => {
    const result = execDestroyObject();
    expect(result.allHunt).toBeUndefined();
  });

  it('result.revealAll is undefined', () => {
    const result = execDestroyObject();
    expect(result.revealAll).toBeUndefined();
  });

  it('result.revealWaypoint is undefined', () => {
    const result = execDestroyObject();
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('result.dropZone is undefined', () => {
    const result = execDestroyObject();
    expect(result.dropZone).toBeUndefined();
  });

  it('result.creepShadow is undefined', () => {
    const result = execDestroyObject();
    expect(result.creepShadow).toBeUndefined();
  });

  it('result.textMessage is undefined', () => {
    const result = execDestroyObject();
    expect(result.textMessage).toBeUndefined();
  });

  it('result.setTimer is undefined', () => {
    const result = execDestroyObject();
    expect(result.setTimer).toBeUndefined();
  });

  it('result.timerExtend is undefined', () => {
    const result = execDestroyObject();
    expect(result.timerExtend).toBeUndefined();
  });

  it('result.timerSubtract is undefined', () => {
    const result = execDestroyObject();
    expect(result.timerSubtract).toBeUndefined();
  });

  it('result.startTimer is undefined', () => {
    const result = execDestroyObject();
    expect(result.startTimer).toBeUndefined();
  });

  it('result.stopTimer is undefined', () => {
    const result = execDestroyObject();
    expect(result.stopTimer).toBeUndefined();
  });

  it('result.autocreate is undefined', () => {
    const result = execDestroyObject();
    expect(result.autocreate).toBeUndefined();
  });

  it('result.playSound is undefined', () => {
    const result = execDestroyObject();
    expect(result.playSound).toBeUndefined();
  });

  it('result.playSpeech is undefined', () => {
    const result = execDestroyObject();
    expect(result.playSpeech).toBeUndefined();
  });

  it('result.airstrike is undefined', () => {
    const result = execDestroyObject();
    expect(result.airstrike).toBeUndefined();
  });

  it('result.nuke is undefined', () => {
    const result = execDestroyObject();
    expect(result.nuke).toBeUndefined();
  });

  it('result.centerView is undefined', () => {
    const result = execDestroyObject();
    expect(result.centerView).toBeUndefined();
  });

  it('result.fireSale is undefined', () => {
    const result = execDestroyObject();
    expect(result.fireSale).toBeUndefined();
  });

  it('result.playMovie is undefined', () => {
    const result = execDestroyObject();
    expect(result.playMovie).toBeUndefined();
  });

  it('result.revealZone is undefined', () => {
    const result = execDestroyObject();
    expect(result.revealZone).toBeUndefined();
  });

  it('result.playMusic is undefined', () => {
    const result = execDestroyObject();
    expect(result.playMusic).toBeUndefined();
  });

  it('result.preferredTarget is undefined', () => {
    const result = execDestroyObject();
    expect(result.preferredTarget).toBeUndefined();
  });

  it('result.beginProduction is undefined', () => {
    const result = execDestroyObject();
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.destroyTeam is undefined', () => {
    const result = execDestroyObject();
    expect(result.destroyTeam).toBeUndefined();
  });

  it('result.oneSpecial is undefined', () => {
    const result = execDestroyObject();
    expect(result.oneSpecial).toBeUndefined();
  });

  it('result.fullSpecial is undefined', () => {
    const result = execDestroyObject();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('globals set is not mutated', () => {
    const globals = new Set<number>([5, 10]);
    executeTriggerAction(destroyObjectAction(), [], new Map(), globals, []);
    expect(globals.size).toBe(2);
    expect(globals.has(5)).toBe(true);
    expect(globals.has(10)).toBe(true);
  });

  it('triggers array is not mutated', () => {
    const triggers: ScenarioTrigger[] = [
      {
        name: 'trg1',
        house: 0,
        persistence: 1,
        event1: { type: 0, team: -1, data: 0 },
        event2: { type: 0, team: -1, data: 0 },
        eventLogic: 0,
        action1: { action: 0, team: -1, trigger: -1, data: 0 },
        action2: { action: 0, team: -1, trigger: -1, data: 0 },
        fired: false,
        timerTick: 0,
        playerEntered: false,
        forceFirePending: false,
        pendingDestroyedCount: 0,
      },
    ];
    executeTriggerAction(destroyObjectAction(), [], new Map(), new Set(), triggers);
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(false);
  });
});

describe('TACTION_DESTROY_OBJECT is independent of action parameters', () => {
  it('result.destroyTriggeringUnit is true regardless of action.data', () => {
    expect(execDestroyObject(destroyObjectAction({ data: 0 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ data: 42 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ data: 255 })).destroyTriggeringUnit).toBe(true);
  });

  it('result.destroyTriggeringUnit is true regardless of action.team', () => {
    expect(execDestroyObject(destroyObjectAction({ team: -1 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ team: 0 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ team: 5 })).destroyTriggeringUnit).toBe(true);
  });

  it('result.destroyTriggeringUnit is true regardless of action.trigger', () => {
    expect(execDestroyObject(destroyObjectAction({ trigger: -1 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ trigger: 0 })).destroyTriggeringUnit).toBe(true);
    expect(execDestroyObject(destroyObjectAction({ trigger: 3 })).destroyTriggeringUnit).toBe(true);
  });
});
