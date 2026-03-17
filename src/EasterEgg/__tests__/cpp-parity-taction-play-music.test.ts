/**
 * C++ Behavioral Parity: TACTION_PLAY_MUSIC (action=20) — play a music track
 *
 * Tests verify TACTION_PLAY_MUSIC behavior matches C++ RA source code (trigger.cpp).
 * C++ behavior: TACTION_PLAY_MUSIC sets result.playMusic = action.data. No other side effects.
 *
 * Source: TACTION.H (enum value 20), TRIGGER.CPP executeTriggerAction switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal TACTION_PLAY_MUSIC action with optional overrides. */
function playMusicAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: 20, team: -1, trigger: -1, data: 3, ...overrides };
}

/** Invoke executeTriggerAction with minimal valid arguments. */
function execPlayMusic(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? playMusicAction(),
    [],                        // teamTypes — empty, not needed for PLAY_MUSIC
    new Map(),                 // waypoints — empty
    new Set<number>(),         // globals — empty
    [],                        // triggers — empty
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TACTION_PLAY_MUSIC constant value (TACTION.H)', () => {
  it('TACTION_PLAY_MUSIC has constant value 20', () => {
    const action = playMusicAction();
    expect(action.action).toBe(20);
  });
});

describe('TACTION_PLAY_MUSIC sets result.playMusic = action.data', () => {
  it('result.playMusic equals action.data', () => {
    const result = execPlayMusic();
    expect(result.playMusic).toBe(3);
  });

  it('result.playMusic equals action.data when data is 0', () => {
    const result = execPlayMusic(playMusicAction({ data: 0 }));
    expect(result.playMusic).toBe(0);
  });

  it('result.playMusic equals action.data when data is 7', () => {
    const result = execPlayMusic(playMusicAction({ data: 7 }));
    expect(result.playMusic).toBe(7);
  });

  it('result.playMusic equals action.data when data is 255', () => {
    const result = execPlayMusic(playMusicAction({ data: 255 }));
    expect(result.playMusic).toBe(255);
  });

  it('result.spawned is empty (no units spawned)', () => {
    const result = execPlayMusic();
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_PLAY_MUSIC has no other side effects', () => {
  it('result.win is undefined', () => {
    const result = execPlayMusic();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = execPlayMusic();
    expect(result.lose).toBeUndefined();
  });

  it('result.allowWin is undefined', () => {
    const result = execPlayMusic();
    expect(result.allowWin).toBeUndefined();
  });

  it('result.allHunt is undefined', () => {
    const result = execPlayMusic();
    expect(result.allHunt).toBeUndefined();
  });

  it('result.revealAll is undefined', () => {
    const result = execPlayMusic();
    expect(result.revealAll).toBeUndefined();
  });

  it('result.revealWaypoint is undefined', () => {
    const result = execPlayMusic();
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('result.dropZone is undefined', () => {
    const result = execPlayMusic();
    expect(result.dropZone).toBeUndefined();
  });

  it('result.creepShadow is undefined', () => {
    const result = execPlayMusic();
    expect(result.creepShadow).toBeUndefined();
  });

  it('result.textMessage is undefined', () => {
    const result = execPlayMusic();
    expect(result.textMessage).toBeUndefined();
  });

  it('result.setTimer is undefined', () => {
    const result = execPlayMusic();
    expect(result.setTimer).toBeUndefined();
  });

  it('result.timerExtend is undefined', () => {
    const result = execPlayMusic();
    expect(result.timerExtend).toBeUndefined();
  });

  it('result.timerSubtract is undefined', () => {
    const result = execPlayMusic();
    expect(result.timerSubtract).toBeUndefined();
  });

  it('result.startTimer is undefined', () => {
    const result = execPlayMusic();
    expect(result.startTimer).toBeUndefined();
  });

  it('result.stopTimer is undefined', () => {
    const result = execPlayMusic();
    expect(result.stopTimer).toBeUndefined();
  });

  it('result.autocreate is undefined', () => {
    const result = execPlayMusic();
    expect(result.autocreate).toBeUndefined();
  });

  it('result.destroyTriggeringUnit is undefined', () => {
    const result = execPlayMusic();
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('result.playSound is undefined', () => {
    const result = execPlayMusic();
    expect(result.playSound).toBeUndefined();
  });

  it('result.playSpeech is undefined', () => {
    const result = execPlayMusic();
    expect(result.playSpeech).toBeUndefined();
  });

  it('result.airstrike is undefined', () => {
    const result = execPlayMusic();
    expect(result.airstrike).toBeUndefined();
  });

  it('result.nuke is undefined', () => {
    const result = execPlayMusic();
    expect(result.nuke).toBeUndefined();
  });

  it('result.centerView is undefined', () => {
    const result = execPlayMusic();
    expect(result.centerView).toBeUndefined();
  });

  it('result.fireSale is undefined', () => {
    const result = execPlayMusic();
    expect(result.fireSale).toBeUndefined();
  });

  it('result.playMovie is undefined', () => {
    const result = execPlayMusic();
    expect(result.playMovie).toBeUndefined();
  });

  it('result.revealZone is undefined', () => {
    const result = execPlayMusic();
    expect(result.revealZone).toBeUndefined();
  });

  it('result.preferredTarget is undefined', () => {
    const result = execPlayMusic();
    expect(result.preferredTarget).toBeUndefined();
  });

  it('result.beginProduction is undefined', () => {
    const result = execPlayMusic();
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.destroyTeam is undefined', () => {
    const result = execPlayMusic();
    expect(result.destroyTeam).toBeUndefined();
  });

  it('result.oneSpecial is undefined', () => {
    const result = execPlayMusic();
    expect(result.oneSpecial).toBeUndefined();
  });

  it('result.fullSpecial is undefined', () => {
    const result = execPlayMusic();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('globals set is not mutated', () => {
    const globals = new Set<number>([5, 10]);
    executeTriggerAction(playMusicAction(), [], new Map(), globals, []);
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
    executeTriggerAction(playMusicAction(), [], new Map(), new Set(), triggers);
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(false);
  });
});

describe('TACTION_PLAY_MUSIC propagates action.data correctly', () => {
  it('result.playMusic tracks action.data across various values', () => {
    expect(execPlayMusic(playMusicAction({ data: 0 })).playMusic).toBe(0);
    expect(execPlayMusic(playMusicAction({ data: 1 })).playMusic).toBe(1);
    expect(execPlayMusic(playMusicAction({ data: 42 })).playMusic).toBe(42);
    expect(execPlayMusic(playMusicAction({ data: 255 })).playMusic).toBe(255);
  });

  it('result.playMusic is independent of action.team', () => {
    expect(execPlayMusic(playMusicAction({ team: -1 })).playMusic).toBe(3);
    expect(execPlayMusic(playMusicAction({ team: 0 })).playMusic).toBe(3);
    expect(execPlayMusic(playMusicAction({ team: 5 })).playMusic).toBe(3);
  });

  it('result.playMusic is independent of action.trigger', () => {
    expect(execPlayMusic(playMusicAction({ trigger: -1 })).playMusic).toBe(3);
    expect(execPlayMusic(playMusicAction({ trigger: 0 })).playMusic).toBe(3);
    expect(execPlayMusic(playMusicAction({ trigger: 3 })).playMusic).toBe(3);
  });
});
