/**
 * C++ behavioral parity tests for TACTION_DZ (action=8) — drop zone flare.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_DZ places a drop-zone flare
 * at the waypoint specified by action.data. The engine sets result.dropZone to
 * the waypoint index and spawns nothing (the flare is a visual/reveal effect,
 * not an entity).
 *
 * Constant value: 8  (C++ enum TACTION_DZ = 8)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('TACTION_DZ (action=8) — drop zone flare', () => {
  const TACTION_DZ = 8;

  // Shared empty parameters — DZ needs no teams, waypoints, globals, or triggers
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  const exec = (action: TriggerAction) =>
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

  // -----------------------------------------------------------------------
  // Core: result.dropZone === action.data
  // -----------------------------------------------------------------------

  it('sets result.dropZone to action.data (waypoint index 0)', () => {
    const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: 0 };
    const result = exec(action);
    expect(result.dropZone).toBe(0);
  });

  it('sets result.dropZone to action.data (waypoint index 5)', () => {
    const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.dropZone).toBe(5);
  });

  it('sets result.dropZone to action.data (waypoint index 25 — high value)', () => {
    const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: 25 };
    const result = exec(action);
    expect(result.dropZone).toBe(25);
  });

  it('preserves exact waypoint index for arbitrary values', () => {
    for (const wpIndex of [1, 7, 13, 98]) {
      const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: wpIndex };
      const result = exec(action);
      expect(result.dropZone, `waypoint ${wpIndex}`).toBe(wpIndex);
    }
  });

  // -----------------------------------------------------------------------
  // Spawned array must be empty — DZ is a visual/reveal effect, not a unit
  // -----------------------------------------------------------------------

  it('spawns no entities (spawned array is empty)', () => {
    const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: 3 };
    const result = exec(action);
    expect(result.spawned).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Constant value parity — C++ enum TACTION_DZ = 8
  // -----------------------------------------------------------------------

  it('constant value is 8 (matches C++ TACTION_DZ enum)', () => {
    expect(TACTION_DZ).toBe(8);
  });

  it('action 8 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 8, team: -1, trigger: -1, data: 42 };
    const result = exec(action);
    // If it fell through to default, dropZone would be undefined
    expect(result.dropZone).toBeDefined();
    expect(result.dropZone).toBe(42);
  });

  // -----------------------------------------------------------------------
  // No side-effect leakage — only dropZone should be set
  // -----------------------------------------------------------------------

  it('does not set unrelated result fields (no side-effect leakage)', () => {
    const action: TriggerAction = { action: TACTION_DZ, team: -1, trigger: -1, data: 10 };
    const result = exec(action);

    // dropZone should be set
    expect(result.dropZone).toBe(10);

    // Nothing else should be set
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.spawned).toEqual([]);
  });
});
