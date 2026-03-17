/**
 * C++ Behavioral Parity: TACTION_REVEAL_MAP (action=16) — reveal entire map
 *
 * Tests verify TACTION_REVEAL_MAP behavior matches C++ RA source code (TRIGGER.CPP).
 * C++ behavior: calls Map.Reveal_All(). The TypeScript implementation sets
 * result.revealAll = true so the renderer can act on it.
 *
 * No other side effects — spawned is empty, win/lose are undefined, and all
 * other result fields are unset.
 *
 * Source: TACTION.H (enum value 16, TACTION_REVEAL_ALL), TRIGGER.CPP Handle_Action.
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

const TACTION_REVEAL_MAP = 16;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_REVEAL_MAP action with optional overrides. */
function revealMapAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_REVEAL_MAP, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_REVEAL_MAP action with minimal required parameters. */
function executeRevealMap(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? revealMapAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_REVEAL_MAP constant value (TACTION.H)', () => {
  it('TACTION_REVEAL_MAP has constant value 16', () => {
    expect(TACTION_REVEAL_MAP).toBe(16);
    expect(revealMapAction().action).toBe(16);
  });
});

describe('TACTION_REVEAL_MAP sets result.revealAll = true (trigger.cpp)', () => {
  it('result.revealAll is true', () => {
    const result = executeRevealMap();
    expect(result.revealAll).toBe(true);
  });

  it('result.win is undefined', () => {
    const result = executeRevealMap();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executeRevealMap();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeRevealMap();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_REVEAL_MAP ignores action parameters (trigger.cpp)', () => {
  it('result.revealAll is true regardless of team index', () => {
    expect(executeRevealMap(revealMapAction({ team: 0 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ team: 5 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ team: -1 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ team: 99 })).revealAll).toBe(true);
  });

  it('result.revealAll is true regardless of trigger index', () => {
    expect(executeRevealMap(revealMapAction({ trigger: 0 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ trigger: 3 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ trigger: -1 })).revealAll).toBe(true);
  });

  it('result.revealAll is true regardless of data field', () => {
    expect(executeRevealMap(revealMapAction({ data: 0 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ data: 42 })).revealAll).toBe(true);
    expect(executeRevealMap(revealMapAction({ data: 255 })).revealAll).toBe(true);
  });
});

describe('TACTION_REVEAL_MAP produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeRevealMap();

    // Verify only revealAll is set; everything else is undefined or default
    expect(result.revealAll).toBe(true);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
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
      revealMapAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.revealAll).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      revealMapAction(),
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
      action1: revealMapAction(),
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
      revealMapAction(),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
