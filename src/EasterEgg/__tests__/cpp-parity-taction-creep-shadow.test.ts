/**
 * C++ Behavioral Parity: TACTION_CREEP_SHADOW (action=31) — reshroud entire map
 *
 * In the original C++ Red Alert source (TRIGGER.CPP), TACTION_CREEP_SHADOW
 * triggers a full map reshroud. Used in SCA04EA (ant tunnel darkness) to
 * plunge the entire map back into fog of war. The action ignores all
 * parameters (team, trigger, data) and simply sets result.creepShadow = true.
 *
 * TypeScript behavior: sets result.creepShadow = true. No other side effects —
 * spawned is empty, win/lose are undefined, and all other result fields are unset.
 *
 * Source: TACTION.H (enum value 31), TRIGGER.CPP Handle_Action switch case.
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

const TACTION_CREEP_SHADOW = 31;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_CREEP_SHADOW action with optional overrides. */
function creepShadowAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_CREEP_SHADOW, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_CREEP_SHADOW action with minimal required parameters. */
function executeCreepShadow(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? creepShadowAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_CREEP_SHADOW constant value (TACTION.H)', () => {
  it('TACTION_CREEP_SHADOW has constant value 31', () => {
    expect(TACTION_CREEP_SHADOW).toBe(31);
    expect(creepShadowAction().action).toBe(31);
  });
});

describe('TACTION_CREEP_SHADOW sets result.creepShadow = true (trigger.cpp)', () => {
  it('result.creepShadow is true', () => {
    const result = executeCreepShadow();
    expect(result.creepShadow).toBe(true);
  });

  it('result.win is undefined', () => {
    const result = executeCreepShadow();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executeCreepShadow();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeCreepShadow();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_CREEP_SHADOW ignores action parameters (trigger.cpp)', () => {
  it('result.creepShadow is true regardless of team index', () => {
    expect(executeCreepShadow(creepShadowAction({ team: 0 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ team: 5 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ team: -1 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ team: 99 })).creepShadow).toBe(true);
  });

  it('result.creepShadow is true regardless of trigger index', () => {
    expect(executeCreepShadow(creepShadowAction({ trigger: 0 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ trigger: 3 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ trigger: -1 })).creepShadow).toBe(true);
  });

  it('result.creepShadow is true regardless of data field', () => {
    expect(executeCreepShadow(creepShadowAction({ data: 0 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ data: 42 })).creepShadow).toBe(true);
    expect(executeCreepShadow(creepShadowAction({ data: 255 })).creepShadow).toBe(true);
  });
});

describe('TACTION_CREEP_SHADOW produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeCreepShadow();

    // Verify only creepShadow is set; everything else is undefined or default
    expect(result.creepShadow).toBe(true);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
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
      creepShadowAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.creepShadow).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      creepShadowAction(),
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
      action1: creepShadowAction(),
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
      creepShadowAction(),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });

  it('result has only spawned and creepShadow keys', () => {
    const result = executeCreepShadow();
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['creepShadow', 'spawned']);
  });
});
