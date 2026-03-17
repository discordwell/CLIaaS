/**
 * C++ Behavioral Parity: TACTION_BEGIN_PRODUCTION (action=3)
 *
 * Tests verify TACTION_BEGIN_PRODUCTION behavior matches C++ RA source code.
 * C++ behavior: When action=3 fires, it sets result.beginProduction = triggerHouse
 * for the house that owns the trigger, signalling that house's AI to begin
 * unit/structure production. If triggerHouse is undefined or < 0, no effect.
 *
 * Source: TACTION.H (enum value 3), TRIGGER.CPP executeTriggerAction switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ── Constants ────────────────────────────────────────────────────────────────

const TACTION_BEGIN_PRODUCTION = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

const emptyTeamTypes: TeamType[] = [];
const emptyWaypoints = new Map<number, CellPos>();
const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

/** Build a TACTION_BEGIN_PRODUCTION action with optional overrides. */
function beginProductionAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return {
    action: TACTION_BEGIN_PRODUCTION,
    team: -1,
    trigger: -1,
    data: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TACTION_BEGIN_PRODUCTION constant value (TACTION.H)', () => {
  it('TACTION_BEGIN_PRODUCTION has constant value 3', () => {
    expect(TACTION_BEGIN_PRODUCTION).toBe(3);
  });
});

describe('TACTION_BEGIN_PRODUCTION sets result.beginProduction to triggerHouse', () => {
  it('sets beginProduction to house index 0 (Spain/GoodGuy)', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      0, // triggerHouse = 0
    );
    expect(result.beginProduction).toBe(0);
  });

  it('sets beginProduction to house index 1 (Greece)', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      1,
    );
    expect(result.beginProduction).toBe(1);
  });

  it('sets beginProduction to house index 5 (USSR)', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      5,
    );
    expect(result.beginProduction).toBe(5);
  });

  it('sets beginProduction to house index 10 (high house index)', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      10,
    );
    expect(result.beginProduction).toBe(10);
  });
});

describe('TACTION_BEGIN_PRODUCTION does nothing when triggerHouse is missing or negative', () => {
  it('result.beginProduction is undefined when triggerHouse is undefined', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      undefined, // triggerHouse omitted
    );
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.beginProduction is undefined when triggerHouse is -1', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      -1,
    );
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.beginProduction is undefined when triggerHouse is -99', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      -99,
    );
    expect(result.beginProduction).toBeUndefined();
  });
});

describe('TACTION_BEGIN_PRODUCTION does not produce side effects', () => {
  it('spawned array is empty — no units created', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      3,
    );
    expect(result.spawned).toEqual([]);
  });

  it('globals set is not mutated', () => {
    const globals = new Set<number>([1, 2]);
    executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      globals,
      emptyTriggers,
      3,
    );
    expect(globals.size).toBe(2);
    expect(globals.has(1)).toBe(true);
    expect(globals.has(2)).toBe(true);
  });

  it('does not set win, lose, or allowWin', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      3,
    );
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
  });

  it('does not set allHunt or autocreate', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      3,
    );
    expect(result.allHunt).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
  });

  it('does not modify triggers array', () => {
    const triggers: ScenarioTrigger[] = [{
      name: 'other',
      persistence: 1,
      house: 0,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: { action: 0, team: -1, trigger: -1, data: 0 },
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    }];
    executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      triggers,
      3,
    );
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(false);
  });
});

describe('TACTION_BEGIN_PRODUCTION action.data and action.team are ignored', () => {
  it('action.data does not affect beginProduction value', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 42 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      7,
    );
    // beginProduction reflects triggerHouse, not action.data
    expect(result.beginProduction).toBe(7);
  });

  it('action.team does not affect beginProduction value', () => {
    const result = executeTriggerAction(
      beginProductionAction({ team: 5 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      2,
    );
    expect(result.beginProduction).toBe(2);
  });

  it('action.trigger does not affect beginProduction value', () => {
    const result = executeTriggerAction(
      beginProductionAction({ trigger: 3 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      4,
    );
    expect(result.beginProduction).toBe(4);
  });
});

describe('TACTION_BEGIN_PRODUCTION boundary: triggerHouse === 0 is valid', () => {
  it('triggerHouse=0 sets beginProduction (0 >= 0 is true)', () => {
    const result = executeTriggerAction(
      beginProductionAction(),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      0,
    );
    // Critical boundary: house index 0 is a valid house
    expect(result.beginProduction).toBe(0);
  });
});
