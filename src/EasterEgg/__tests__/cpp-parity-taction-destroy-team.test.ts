/**
 * C++ Behavioral Parity: TACTION_DESTROY_TEAM (action=5)
 *
 * Tests verify DESTROY_TEAM trigger action matches C++ RA source code.
 *
 * C++ behavior (scenario.cpp / trigger.cpp):
 *   When a trigger fires with action TACTION_DESTROY_TEAM (5), the result
 *   records the team index from action.team into result.destroyTeam.
 *   The game engine then uses this to mark the team as destroyed, preventing
 *   future CREATE_TEAM / REINFORCEMENTS from spawning that team.
 *
 * These tests describe WHAT happens (observable outcomes: result.destroyTeam
 * is set, spawned array is empty, action constant is 5), not HOW.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal empty triggers array — DESTROY_TEAM doesn't inspect triggers */
const NO_TRIGGERS: ScenarioTrigger[] = [];

/** Minimal empty teamTypes — DESTROY_TEAM doesn't spawn anything */
const NO_TEAMS: TeamType[] = [];

/** Minimal waypoints map */
const NO_WAYPOINTS = new Map<number, CellPos>();

/** Minimal globals set */
const NO_GLOBALS = new Set<number>();

/** TACTION_DESTROY_TEAM constant from C++ source */
const TACTION_DESTROY_TEAM = 5;

// ═══════════════════════════════════════════════════════════════════════════════
// Action Constant (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_DESTROY_TEAM action constant (scenario.cpp)', () => {
  it('action constant is 5', () => {
    expect(TACTION_DESTROY_TEAM).toBe(5);
  });

  it('action=5 sets destroyTeam on the result', () => {
    const result = executeTriggerAction(
      { action: 5, team: 0, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// result.destroyTeam equals action.team (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_DESTROY_TEAM — result.destroyTeam equals action.team (scenario.cpp)', () => {
  it('team index 0 → result.destroyTeam is 0', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 0, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBe(0);
  });

  it('team index 3 → result.destroyTeam is 3', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 3, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBe(3);
  });

  it('team index 7 → result.destroyTeam is 7', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 7, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBe(7);
  });

  it('team index 15 → result.destroyTeam is 15 (high index)', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 15, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBe(15);
  });

  it('team index -1 → result.destroyTeam is -1 (pass-through, no validation)', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: -1, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.destroyTeam).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Spawned array is empty (scenario.cpp — DESTROY_TEAM spawns nothing)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_DESTROY_TEAM — spawned is empty (scenario.cpp)', () => {
  it('spawned array is empty when destroying team 0', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 0, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
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

    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 0, trigger: -1, data: -1 },
      teamTypes, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.spawned).toHaveLength(0);
  });

  it('spawned array is empty for high team indices', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 99, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.spawned).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No side effects — only destroyTeam is set (scenario.cpp)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_DESTROY_TEAM — no other side effects (scenario.cpp)', () => {
  it('win is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.win).toBeUndefined();
  });

  it('lose is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.lose).toBeUndefined();
  });

  it('allHunt is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.allHunt).toBeUndefined();
  });

  it('allowWin is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.allowWin).toBeUndefined();
  });

  it('autocreate is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.autocreate).toBeUndefined();
  });

  it('fireSale is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.fireSale).toBeUndefined();
  });

  it('beginProduction is not set', () => {
    const result = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 2, trigger: -1, data: -1 },
      NO_TEAMS, NO_WAYPOINTS, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(result.beginProduction).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Distinction from CREATE_TEAM (action=4) — DESTROY_TEAM is the inverse
// ═══════════════════════════════════════════════════════════════════════════════

describe('TACTION_DESTROY_TEAM vs TACTION_CREATE_TEAM — inverse operations (scenario.cpp)', () => {
  it('CREATE_TEAM (action=4) spawns units; DESTROY_TEAM (action=5) does not', () => {
    const teamTypes: TeamType[] = [{
      name: 'guards',
      house: 5,
      flags: 0,
      origin: 0,
      trigger: -1,
      members: [{ type: 'E1', count: 2 }],
      missions: [],
    }];
    const waypoints = new Map<number, CellPos>();
    waypoints.set(0, { cx: 50, cy: 50 });

    const createResult = executeTriggerAction(
      { action: 4, team: 0, trigger: -1, data: -1 }, // CREATE_TEAM
      teamTypes, waypoints, NO_GLOBALS, NO_TRIGGERS, 0,
    );
    expect(createResult.spawned.length).toBeGreaterThan(0);
    expect(createResult.destroyTeam).toBeUndefined();

    const destroyResult = executeTriggerAction(
      { action: TACTION_DESTROY_TEAM, team: 0, trigger: -1, data: -1 },
      teamTypes, waypoints, NO_GLOBALS, NO_TRIGGERS,
    );
    expect(destroyResult.spawned).toHaveLength(0);
    expect(destroyResult.destroyTeam).toBe(0);
  });
});
