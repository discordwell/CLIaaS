/**
 * C++ Behavioral Parity: TACTION_ALL_HUNT (action=6) — force all units to hunt
 *
 * Tests verify TACTION_ALL_HUNT behavior matches C++ RA source code (TACTION.CPP).
 * C++ behavior: calls HouseClass::As_Pointer(Data.House)->Do_All_To_Hunt().
 * TypeScript behavior: sets result.allHunt = action.data (Data.House).
 * The result carries the target house index, not a boolean.
 *
 * Source: TACTION.H (enum value 6), TACTION.CPP operator() switch case.
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

const TACTION_ALL_HUNT = 6;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_ALL_HUNT action with optional overrides. */
function allHuntAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_ALL_HUNT, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_ALL_HUNT action with minimal required parameters. */
function executeAllHunt(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? allHuntAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_ALL_HUNT constant value (TACTION.H)', () => {
  it('TACTION_ALL_HUNT has constant value 6', () => {
    expect(TACTION_ALL_HUNT).toBe(6);
    expect(allHuntAction().action).toBe(6);
  });
});

describe('TACTION_ALL_HUNT sets result.allHunt = action.data (taction.cpp)', () => {
  it('result.allHunt equals action.data (Data.House)', () => {
    const result = executeAllHunt();
    // Default data=0, so allHunt should be 0 (HOUSE_SPAIN)
    expect(result.allHunt).toBe(0);
  });

  it('result.win is undefined', () => {
    const result = executeAllHunt();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executeAllHunt();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeAllHunt();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_ALL_HUNT uses action.data as house target (taction.cpp)', () => {
  it('result.allHunt reflects action.data regardless of team index', () => {
    expect(executeAllHunt(allHuntAction({ team: 0 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ team: 5 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ team: -1 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ team: 99 })).allHunt).toBe(0);
  });

  it('result.allHunt reflects action.data regardless of trigger index', () => {
    expect(executeAllHunt(allHuntAction({ trigger: 0 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ trigger: 3 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ trigger: -1 })).allHunt).toBe(0);
  });

  it('result.allHunt equals action.data for various house values', () => {
    expect(executeAllHunt(allHuntAction({ data: 0 })).allHunt).toBe(0);
    expect(executeAllHunt(allHuntAction({ data: 2 })).allHunt).toBe(2);
    expect(executeAllHunt(allHuntAction({ data: 5 })).allHunt).toBe(5);
  });
});

describe('TACTION_ALL_HUNT produces no other side effects (taction.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeAllHunt();

    // Verify only allHunt is set; everything else is undefined or default
    expect(result.allHunt).toBe(0);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
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
      allHuntAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.allHunt).toBe(0);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      allHuntAction(),
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
      action1: allHuntAction(),
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
      allHuntAction(),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
