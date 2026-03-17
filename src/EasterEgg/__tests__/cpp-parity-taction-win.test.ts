/**
 * C++ Behavioral Parity: TACTION_WIN (action=1) — the "player wins" trigger action
 *
 * Tests verify TACTION_WIN behavior matches C++ RA source code (trigger.cpp).
 * C++ behavior: sets result.win = true. No other side effects — spawned is empty,
 * lose is undefined, and all other result fields are unset.
 *
 * Source: TACTION.H (enum value 1), TRIGGER.CPP Handle_Action switch case.
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

const TACTION_WIN = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_WIN action with optional overrides. */
function winAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_WIN, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_WIN action with minimal required parameters. */
function executeWin(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? winAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_WIN constant value (TACTION.H)', () => {
  it('TACTION_WIN has constant value 1', () => {
    expect(TACTION_WIN).toBe(1);
    expect(winAction().action).toBe(1);
  });
});

describe('TACTION_WIN sets result.win = true (trigger.cpp)', () => {
  it('result.win is true', () => {
    const result = executeWin();
    expect(result.win).toBe(true);
  });

  it('result.lose is undefined', () => {
    const result = executeWin();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeWin();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_WIN ignores action parameters (trigger.cpp)', () => {
  it('result.win is true regardless of team index', () => {
    expect(executeWin(winAction({ team: 0 })).win).toBe(true);
    expect(executeWin(winAction({ team: 5 })).win).toBe(true);
    expect(executeWin(winAction({ team: -1 })).win).toBe(true);
    expect(executeWin(winAction({ team: 99 })).win).toBe(true);
  });

  it('result.win is true regardless of trigger index', () => {
    expect(executeWin(winAction({ trigger: 0 })).win).toBe(true);
    expect(executeWin(winAction({ trigger: 3 })).win).toBe(true);
    expect(executeWin(winAction({ trigger: -1 })).win).toBe(true);
  });

  it('result.win is true regardless of data field', () => {
    expect(executeWin(winAction({ data: 0 })).win).toBe(true);
    expect(executeWin(winAction({ data: 42 })).win).toBe(true);
    expect(executeWin(winAction({ data: 255 })).win).toBe(true);
  });
});

describe('TACTION_WIN produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeWin();

    // Verify only win is set; everything else is undefined or default
    expect(result.win).toBe(true);
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

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      winAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.win).toBe(true);
    expect(result.spawned).toEqual([]);
  });
});
