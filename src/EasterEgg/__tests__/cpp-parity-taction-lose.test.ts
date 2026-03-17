/**
 * C++ Behavioral Parity: TACTION_LOSE (action=2) — the "player loses" trigger action
 *
 * Tests verify TACTION_LOSE behavior matches C++ RA source code (trigger.cpp).
 * C++ behavior: TACTION_LOSE sets result.lose = true. No other side effects.
 *
 * Source: TACTION.H (enum value 2), TRIGGER.CPP executeTriggerAction switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal TACTION_LOSE action with optional overrides. */
function loseAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: 2, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Invoke executeTriggerAction with minimal valid arguments. */
function execLose(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? loseAction(),
    [],                        // teamTypes — empty, not needed for LOSE
    new Map(),                 // waypoints — empty
    new Set<number>(),         // globals — empty
    [],                        // triggers — empty
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TACTION_LOSE constant value (TACTION.H)', () => {
  it('TACTION_LOSE has constant value 2', () => {
    const action = loseAction();
    expect(action.action).toBe(2);
  });
});

describe('TACTION_LOSE sets result.lose = true', () => {
  it('result.lose is true', () => {
    const result = execLose();
    expect(result.lose).toBe(true);
  });

  it('result.win is undefined (lose does not imply win)', () => {
    const result = execLose();
    expect(result.win).toBeUndefined();
  });

  it('result.spawned is empty (no units spawned)', () => {
    const result = execLose();
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_LOSE has no other side effects', () => {
  it('result.allowWin is undefined', () => {
    const result = execLose();
    expect(result.allowWin).toBeUndefined();
  });

  it('result.allHunt is undefined', () => {
    const result = execLose();
    expect(result.allHunt).toBeUndefined();
  });

  it('result.revealAll is undefined', () => {
    const result = execLose();
    expect(result.revealAll).toBeUndefined();
  });

  it('result.revealWaypoint is undefined', () => {
    const result = execLose();
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('result.dropZone is undefined', () => {
    const result = execLose();
    expect(result.dropZone).toBeUndefined();
  });

  it('result.creepShadow is undefined', () => {
    const result = execLose();
    expect(result.creepShadow).toBeUndefined();
  });

  it('result.textMessage is undefined', () => {
    const result = execLose();
    expect(result.textMessage).toBeUndefined();
  });

  it('result.setTimer is undefined', () => {
    const result = execLose();
    expect(result.setTimer).toBeUndefined();
  });

  it('result.timerExtend is undefined', () => {
    const result = execLose();
    expect(result.timerExtend).toBeUndefined();
  });

  it('result.timerSubtract is undefined', () => {
    const result = execLose();
    expect(result.timerSubtract).toBeUndefined();
  });

  it('result.startTimer is undefined', () => {
    const result = execLose();
    expect(result.startTimer).toBeUndefined();
  });

  it('result.stopTimer is undefined', () => {
    const result = execLose();
    expect(result.stopTimer).toBeUndefined();
  });

  it('result.autocreate is undefined', () => {
    const result = execLose();
    expect(result.autocreate).toBeUndefined();
  });

  it('result.destroyTriggeringUnit is undefined', () => {
    const result = execLose();
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('result.playSound is undefined', () => {
    const result = execLose();
    expect(result.playSound).toBeUndefined();
  });

  it('result.playSpeech is undefined', () => {
    const result = execLose();
    expect(result.playSpeech).toBeUndefined();
  });

  it('result.airstrike is undefined', () => {
    const result = execLose();
    expect(result.airstrike).toBeUndefined();
  });

  it('result.nuke is undefined', () => {
    const result = execLose();
    expect(result.nuke).toBeUndefined();
  });

  it('result.centerView is undefined', () => {
    const result = execLose();
    expect(result.centerView).toBeUndefined();
  });

  it('result.fireSale is undefined', () => {
    const result = execLose();
    expect(result.fireSale).toBeUndefined();
  });

  it('result.playMovie is undefined', () => {
    const result = execLose();
    expect(result.playMovie).toBeUndefined();
  });

  it('result.revealZone is undefined', () => {
    const result = execLose();
    expect(result.revealZone).toBeUndefined();
  });

  it('result.playMusic is undefined', () => {
    const result = execLose();
    expect(result.playMusic).toBeUndefined();
  });

  it('result.preferredTarget is undefined', () => {
    const result = execLose();
    expect(result.preferredTarget).toBeUndefined();
  });

  it('result.beginProduction is undefined', () => {
    const result = execLose();
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.destroyTeam is undefined', () => {
    const result = execLose();
    expect(result.destroyTeam).toBeUndefined();
  });

  it('result.oneSpecial is undefined', () => {
    const result = execLose();
    expect(result.oneSpecial).toBeUndefined();
  });

  it('result.fullSpecial is undefined', () => {
    const result = execLose();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('globals set is not mutated', () => {
    const globals = new Set<number>([5, 10]);
    executeTriggerAction(loseAction(), [], new Map(), globals, []);
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
    executeTriggerAction(loseAction(), [], new Map(), new Set(), triggers);
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(false);
  });
});

describe('TACTION_LOSE is independent of action parameters', () => {
  it('result.lose is true regardless of action.data', () => {
    expect(execLose(loseAction({ data: 0 })).lose).toBe(true);
    expect(execLose(loseAction({ data: 42 })).lose).toBe(true);
    expect(execLose(loseAction({ data: 255 })).lose).toBe(true);
  });

  it('result.lose is true regardless of action.team', () => {
    expect(execLose(loseAction({ team: -1 })).lose).toBe(true);
    expect(execLose(loseAction({ team: 0 })).lose).toBe(true);
    expect(execLose(loseAction({ team: 5 })).lose).toBe(true);
  });

  it('result.lose is true regardless of action.trigger', () => {
    expect(execLose(loseAction({ trigger: -1 })).lose).toBe(true);
    expect(execLose(loseAction({ trigger: 0 })).lose).toBe(true);
    expect(execLose(loseAction({ trigger: 3 })).lose).toBe(true);
  });
});
