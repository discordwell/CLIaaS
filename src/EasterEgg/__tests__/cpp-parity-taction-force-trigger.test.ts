/**
 * C++ Behavioral Parity: TACTION_FORCE_TRIGGER (action=22)
 *
 * Tests verify FORCE_TRIGGER trigger action matches C++ RA source code.
 *
 * C++ behavior (scenario.cpp / trigger.cpp):
 *   When a trigger fires with action TACTION_FORCE_TRIGGER (22), the engine
 *   looks up the trigger at index action.trigger. If the index is valid
 *   (>= 0 and < triggers.length), it sets:
 *     triggers[action.trigger].fired = false
 *     triggers[action.trigger].forceFirePending = true
 *   This causes the target trigger to fire on its next evaluation cycle
 *   regardless of whether its event conditions are met. Out-of-range indices
 *   are silently ignored.
 *
 * These tests describe WHAT happens (observable outcomes: target trigger
 * state is mutated, spawned array is empty, action constant is 22), not HOW.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TeamType,
  type ScenarioTrigger,
  type TriggerAction,
  type TriggerEvent,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal empty teamTypes — FORCE_TRIGGER doesn't spawn anything */
const NO_TEAMS: TeamType[] = [];

/** Minimal waypoints map */
const NO_WAYPOINTS = new Map<number, CellPos>();

/** Minimal globals set */
const NO_GLOBALS = new Set<number>();

/** TACTION_FORCE_TRIGGER constant from C++ source */
const TACTION_FORCE_TRIGGER = 22;

/** Build a minimal trigger event stub */
function stubEvent(overrides?: Partial<TriggerEvent>): TriggerEvent {
  return { type: 0, team: -1, data: 0, ...overrides };
}

/** Build a minimal trigger action stub */
function stubAction(overrides?: Partial<TriggerAction>): TriggerAction {
  return { action: 0, team: -1, trigger: -1, data: -1, ...overrides };
}

/** Build a minimal ScenarioTrigger with configurable state */
function makeTrigger(overrides?: Partial<ScenarioTrigger>): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 1,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: stubEvent(),
    event2: stubEvent(),
    action1: stubAction(),
    action2: stubAction(),
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action Constant (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER action constant (scenario.cpp)', () => {
  it('action constant is 22', () => {
    expect(TACTION_FORCE_TRIGGER).toBe(22);
  });

  it('action=22 is accepted without error', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    expect(() =>
      executeTriggerAction(
        { action: 22, team: -1, trigger: 0, data: -1 },
        NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
      ),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Target trigger gets fired=false and forceFirePending=true (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER — sets fired=false, forceFirePending=true on target (scenario.cpp)', () => {
  it('target trigger with fired=true gets fired reset to false', () => {
    const triggers = [
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].fired).toBe(false);
  });

  it('target trigger with fired=false stays fired=false', () => {
    const triggers = [
      makeTrigger({ name: 'target', fired: false, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].fired).toBe(false);
  });

  it('target trigger gets forceFirePending set to true', () => {
    const triggers = [
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].forceFirePending).toBe(true);
  });

  it('target trigger already forceFirePending=true stays true', () => {
    const triggers = [
      makeTrigger({ name: 'target', fired: false, forceFirePending: true }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].forceFirePending).toBe(true);
  });

  it('works when targeting a non-zero trigger index', () => {
    const triggers = [
      makeTrigger({ name: 'first' }),
      makeTrigger({ name: 'second' }),
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 2, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[2].fired).toBe(false);
    expect(triggers[2].forceFirePending).toBe(true);
  });

  it('works on the last trigger in a multi-trigger array', () => {
    const triggers = [
      makeTrigger({ name: 'a' }),
      makeTrigger({ name: 'b' }),
      makeTrigger({ name: 'c' }),
      makeTrigger({ name: 'last', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 3, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[3].fired).toBe(false);
    expect(triggers[3].forceFirePending).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Out-of-range trigger index — safe, no crash (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER — out-of-range trigger index is safe (scenario.cpp)', () => {
  it('trigger index -1 does not crash', () => {
    const triggers = [makeTrigger({ name: 'only' })];
    expect(() =>
      executeTriggerAction(
        { action: TACTION_FORCE_TRIGGER, team: -1, trigger: -1, data: -1 },
        NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
      ),
    ).not.toThrow();
  });

  it('trigger index beyond array length does not crash', () => {
    const triggers = [makeTrigger({ name: 'only' })];
    expect(() =>
      executeTriggerAction(
        { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 99, data: -1 },
        NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
      ),
    ).not.toThrow();
  });

  it('trigger index -1 does not modify any trigger', () => {
    const triggers = [
      makeTrigger({ name: 'a', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].forceFirePending).toBe(false);
  });

  it('trigger index beyond array length does not modify any trigger', () => {
    const triggers = [
      makeTrigger({ name: 'a', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'b', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 5, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].forceFirePending).toBe(false);
    expect(triggers[1].fired).toBe(true);
    expect(triggers[1].forceFirePending).toBe(false);
  });

  it('empty triggers array does not crash', () => {
    expect(() =>
      executeTriggerAction(
        { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
        NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, [],
      ),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Other triggers are unmodified (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER — other triggers are unmodified (scenario.cpp)', () => {
  it('forcing trigger 1 does not alter trigger 0', () => {
    const triggers = [
      makeTrigger({ name: 'bystander', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    // Bystander unchanged
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].forceFirePending).toBe(false);
    // Target changed
    expect(triggers[1].fired).toBe(false);
    expect(triggers[1].forceFirePending).toBe(true);
  });

  it('forcing trigger 0 does not alter triggers 1 or 2', () => {
    const triggers = [
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'bystander1', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'bystander2', fired: false, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    // Target changed
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(true);
    // Bystanders unchanged
    expect(triggers[1].fired).toBe(true);
    expect(triggers[1].forceFirePending).toBe(false);
    expect(triggers[2].fired).toBe(false);
    expect(triggers[2].forceFirePending).toBe(false);
  });

  it('forcing middle trigger leaves both neighbors untouched', () => {
    const triggers = [
      makeTrigger({ name: 'before', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'target', fired: true, forceFirePending: false }),
      makeTrigger({ name: 'after', fired: true, forceFirePending: false }),
    ];
    executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(triggers[0].fired).toBe(true);
    expect(triggers[0].forceFirePending).toBe(false);
    expect(triggers[1].fired).toBe(false);
    expect(triggers[1].forceFirePending).toBe(true);
    expect(triggers[2].fired).toBe(true);
    expect(triggers[2].forceFirePending).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Spawned array is empty (scenario.cpp — FORCE_TRIGGER spawns nothing)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER — spawned is empty (scenario.cpp)', () => {
  it('spawned array is empty for valid trigger index', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.spawned).toHaveLength(0);
  });

  it('spawned array is empty for out-of-range trigger index', () => {
    const triggers = [makeTrigger({ name: 'only' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 99, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.spawned).toHaveLength(0);
  });

  it('spawned array is empty even with teamTypes defined', () => {
    const teamTypes: TeamType[] = [{
      name: 'squad1',
      house: 5,
      flags: 0,
      origin: 0,
      trigger: -1,
      members: [{ type: 'E1', count: 4 }],
      missions: [],
    }];
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: 0, trigger: 0, data: -1 },
      teamTypes, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.spawned).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No other side effects — only trigger mutation (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_FORCE_TRIGGER — no result side effects (scenario.cpp)', () => {
  it('win is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.win).toBeUndefined();
  });

  it('lose is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.lose).toBeUndefined();
  });

  it('allHunt is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.allHunt).toBeUndefined();
  });

  it('allowWin is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.allowWin).toBeUndefined();
  });

  it('revealAll is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.revealAll).toBeUndefined();
  });

  it('autocreate is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.autocreate).toBeUndefined();
  });

  it('destroyTeam is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.destroyTeam).toBeUndefined();
  });

  it('beginProduction is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.beginProduction).toBeUndefined();
  });

  it('fireSale is not set', () => {
    const triggers = [makeTrigger({ name: 'target' })];
    const result = executeTriggerAction(
      { action: TACTION_FORCE_TRIGGER, team: -1, trigger: 0, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, triggers,
    );
    expect(result.fireSale).toBeUndefined();
  });
});
