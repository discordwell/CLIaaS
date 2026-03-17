/**
 * C++ Behavioral Parity: TACTION_ALLOWWIN (action=15) — gate that unlocks the win condition
 *
 * Tests verify TACTION_ALLOWWIN behavior matches C++ RA source code (trigger.cpp).
 * C++ behavior: sets result.allowWin = true. No other side effects — spawned is empty,
 * win/lose are undefined, and all other result fields are unset.
 *
 * Source: TACTION.H (enum value 15), TRIGGER.CPP Handle_Action switch case.
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

const TACTION_ALLOWWIN = 15;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_ALLOWWIN action with optional overrides. */
function allowWinAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_ALLOWWIN, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_ALLOWWIN action with minimal required parameters. */
function executeAllowWin(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? allowWinAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_ALLOWWIN constant value (TACTION.H)', () => {
  it('TACTION_ALLOWWIN has constant value 15', () => {
    expect(TACTION_ALLOWWIN).toBe(15);
    expect(allowWinAction().action).toBe(15);
  });
});

describe('TACTION_ALLOWWIN sets result.allowWin = true (trigger.cpp)', () => {
  it('result.allowWin is true', () => {
    const result = executeAllowWin();
    expect(result.allowWin).toBe(true);
  });

  it('result.win is undefined', () => {
    const result = executeAllowWin();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executeAllowWin();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeAllowWin();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_ALLOWWIN ignores action parameters (trigger.cpp)', () => {
  it('result.allowWin is true regardless of team index', () => {
    expect(executeAllowWin(allowWinAction({ team: 0 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ team: 5 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ team: -1 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ team: 99 })).allowWin).toBe(true);
  });

  it('result.allowWin is true regardless of trigger index', () => {
    expect(executeAllowWin(allowWinAction({ trigger: 0 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ trigger: 3 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ trigger: -1 })).allowWin).toBe(true);
  });

  it('result.allowWin is true regardless of data field', () => {
    expect(executeAllowWin(allowWinAction({ data: 0 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ data: 42 })).allowWin).toBe(true);
    expect(executeAllowWin(allowWinAction({ data: 255 })).allowWin).toBe(true);
  });
});

describe('TACTION_ALLOWWIN produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeAllowWin();

    // Verify only allowWin is set; everything else is undefined or default
    expect(result.allowWin).toBe(true);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
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
      allowWinAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.allowWin).toBe(true);
    expect(result.spawned).toEqual([]);
  });
});
