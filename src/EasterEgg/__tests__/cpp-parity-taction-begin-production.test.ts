/**
 * C++ Behavioral Parity: TACTION_BEGIN_PRODUCTION (action=3)
 *
 * Tests verify TACTION_BEGIN_PRODUCTION behavior matches C++ RA source code.
 * C++ behavior (taction.cpp):
 *   case TACTION_BEGIN_PRODUCTION:
 *     if (Data.House != HOUSE_NONE) {
 *       HouseClass * specified_house = HouseClass::As_Pointer(Data.House);
 *       specified_house->Begin_Production();
 *     }
 *
 * The action uses Data.House (action.data in TS), NOT the trigger's owner house.
 *
 * Source: TACTION.H (enum value 3), TACTION.CPP operator() switch case.
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

describe('TACTION_BEGIN_PRODUCTION sets result.beginProduction to action.data (Data.House)', () => {
  it('sets beginProduction to action.data=0 (Spain/GoodGuy)', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 0 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      5, // triggerHouse — should be IGNORED
    );
    expect(result.beginProduction).toBe(0);
  });

  it('sets beginProduction to action.data=1 (Greece)', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 1 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      0, // triggerHouse — should be IGNORED
    );
    expect(result.beginProduction).toBe(1);
  });

  it('sets beginProduction to action.data=5 (Germany)', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 5 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      0,
    );
    expect(result.beginProduction).toBe(5);
  });

  it('sets beginProduction to action.data=10 (high house index)', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 10 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      0,
    );
    expect(result.beginProduction).toBe(10);
  });
});

describe('TACTION_BEGIN_PRODUCTION uses action.data, not triggerHouse', () => {
  it('beginProduction reflects action.data even when triggerHouse differs', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 2 }), // USSR
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      1, // triggerHouse = Greece — must be IGNORED
    );
    expect(result.beginProduction).toBe(2);
    expect(result.beginProduction).not.toBe(1);
  });

  it('works when triggerHouse is undefined', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 3 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      undefined,
    );
    expect(result.beginProduction).toBe(3);
  });

  it('works when triggerHouse is -1', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 4 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      -1,
    );
    expect(result.beginProduction).toBe(4);
  });
});

describe('TACTION_BEGIN_PRODUCTION does not produce side effects', () => {
  it('spawned array is empty — no units created', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 3 }),
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
      beginProductionAction({ data: 3 }),
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
      beginProductionAction({ data: 3 }),
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
      beginProductionAction({ data: 3 }),
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
      beginProductionAction({ data: 3 }),
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

describe('TACTION_BEGIN_PRODUCTION action.team and action.trigger are ignored', () => {
  it('action.team does not affect beginProduction value', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 2, team: 5 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      7,
    );
    expect(result.beginProduction).toBe(2);
  });

  it('action.trigger does not affect beginProduction value', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 4, trigger: 3 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      1,
    );
    expect(result.beginProduction).toBe(4);
  });
});

describe('TACTION_BEGIN_PRODUCTION boundary: action.data === 0 is valid', () => {
  it('action.data=0 sets beginProduction (0 is a valid house index)', () => {
    const result = executeTriggerAction(
      beginProductionAction({ data: 0 }),
      emptyTeamTypes,
      emptyWaypoints,
      emptyGlobals,
      emptyTriggers,
      5,
    );
    // Critical boundary: house index 0 is a valid house
    expect(result.beginProduction).toBe(0);
  });
});
