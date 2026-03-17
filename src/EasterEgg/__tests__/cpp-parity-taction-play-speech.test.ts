/**
 * C++ Behavioral Parity: TACTION_PLAY_SPEECH (action=21) — play EVA speech
 *
 * Tests verify TACTION_PLAY_SPEECH behavior matches C++ RA source code (TRIGGER.CPP).
 * C++ behavior: calls Speak(Data.Value) to play an EVA speech line.
 * TypeScript behavior: sets result.playSpeech = action.data. No other side effects —
 * spawned is empty, win/lose are undefined, and all other result fields are unset.
 *
 * Source: TACTION.H (enum value 21), TRIGGER.CPP Handle_Action switch case.
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

const TACTION_PLAY_SPEECH = 21;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_PLAY_SPEECH action with optional overrides. */
function playSpeechAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_PLAY_SPEECH, team: -1, trigger: -1, data: 5, ...overrides };
}

/** Execute a TACTION_PLAY_SPEECH action with minimal required parameters. */
function executePlaySpeech(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? playSpeechAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_PLAY_SPEECH constant value (TACTION.H)', () => {
  it('TACTION_PLAY_SPEECH has constant value 21', () => {
    expect(TACTION_PLAY_SPEECH).toBe(21);
    expect(playSpeechAction().action).toBe(21);
  });
});

describe('TACTION_PLAY_SPEECH sets result.playSpeech = action.data (trigger.cpp)', () => {
  it('result.playSpeech equals action.data', () => {
    const result = executePlaySpeech(playSpeechAction({ data: 7 }));
    expect(result.playSpeech).toBe(7);
  });

  it('result.playSpeech equals action.data for data=0', () => {
    const result = executePlaySpeech(playSpeechAction({ data: 0 }));
    expect(result.playSpeech).toBe(0);
  });

  it('result.playSpeech equals action.data for large values', () => {
    const result = executePlaySpeech(playSpeechAction({ data: 255 }));
    expect(result.playSpeech).toBe(255);
  });

  it('result.playSpeech equals action.data for various speech IDs', () => {
    for (const speechId of [1, 2, 10, 42, 100, 200]) {
      const result = executePlaySpeech(playSpeechAction({ data: speechId }));
      expect(result.playSpeech).toBe(speechId);
    }
  });

  it('spawned array is empty', () => {
    const result = executePlaySpeech();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win is undefined', () => {
    const result = executePlaySpeech();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executePlaySpeech();
    expect(result.lose).toBeUndefined();
  });
});

describe('TACTION_PLAY_SPEECH ignores team and trigger parameters (trigger.cpp)', () => {
  it('result.playSpeech equals action.data regardless of team index', () => {
    expect(executePlaySpeech(playSpeechAction({ team: 0, data: 3 })).playSpeech).toBe(3);
    expect(executePlaySpeech(playSpeechAction({ team: 5, data: 3 })).playSpeech).toBe(3);
    expect(executePlaySpeech(playSpeechAction({ team: -1, data: 3 })).playSpeech).toBe(3);
    expect(executePlaySpeech(playSpeechAction({ team: 99, data: 3 })).playSpeech).toBe(3);
  });

  it('result.playSpeech equals action.data regardless of trigger index', () => {
    expect(executePlaySpeech(playSpeechAction({ trigger: 0, data: 12 })).playSpeech).toBe(12);
    expect(executePlaySpeech(playSpeechAction({ trigger: 3, data: 12 })).playSpeech).toBe(12);
    expect(executePlaySpeech(playSpeechAction({ trigger: -1, data: 12 })).playSpeech).toBe(12);
  });
});

describe('TACTION_PLAY_SPEECH produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executePlaySpeech(playSpeechAction({ data: 5 }));

    // Verify only playSpeech is set; everything else is undefined or default
    expect(result.playSpeech).toBe(5);
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

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      playSpeechAction({ team: 0, data: 8 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.playSpeech).toBe(8);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      playSpeechAction(),
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
      action1: playSpeechAction(),
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
      playSpeechAction(),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
