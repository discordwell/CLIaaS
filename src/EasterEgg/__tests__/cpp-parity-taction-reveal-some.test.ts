/**
 * C++ behavioral parity tests for TACTION_REVEAL_SOME (action=17) — reveal
 * area around a specific waypoint.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_REVEAL_SOME lifts the
 * shroud in a radius around the waypoint specified by action.data. The engine
 * sets result.revealWaypoint to the waypoint index and spawns nothing (the
 * reveal is a map-visibility effect, not an entity).
 *
 * Constant value: 17  (C++ enum TACTION_REVEAL_SOME = 17)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('TACTION_REVEAL_SOME (action=17) — reveal area around waypoint', () => {
  const TACTION_REVEAL_SOME = 17;

  // Shared empty parameters — REVEAL_SOME needs no teams, waypoints, globals, or triggers
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  const exec = (action: TriggerAction) =>
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

  // -----------------------------------------------------------------------
  // Core: result.revealWaypoint === action.data
  // -----------------------------------------------------------------------

  it('sets result.revealWaypoint to action.data (waypoint index 0)', () => {
    const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: 0 };
    const result = exec(action);
    expect(result.revealWaypoint).toBe(0);
  });

  it('sets result.revealWaypoint to action.data (waypoint index 5)', () => {
    const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.revealWaypoint).toBe(5);
  });

  it('sets result.revealWaypoint to action.data (waypoint index 25 — high value)', () => {
    const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: 25 };
    const result = exec(action);
    expect(result.revealWaypoint).toBe(25);
  });

  it('preserves exact waypoint index for various values', () => {
    for (const wpIndex of [1, 7, 13, 50, 98]) {
      const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: wpIndex };
      const result = exec(action);
      expect(result.revealWaypoint, `waypoint ${wpIndex}`).toBe(wpIndex);
    }
  });

  // -----------------------------------------------------------------------
  // Spawned array must be empty — REVEAL_SOME is a visibility effect, not a unit
  // -----------------------------------------------------------------------

  it('spawns no entities (spawned array is empty)', () => {
    const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: 3 };
    const result = exec(action);
    expect(result.spawned).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Constant value parity — C++ enum TACTION_REVEAL_SOME = 17
  // -----------------------------------------------------------------------

  it('constant value is 17 (matches C++ TACTION_REVEAL_SOME enum)', () => {
    expect(TACTION_REVEAL_SOME).toBe(17);
  });

  it('action 17 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 17, team: -1, trigger: -1, data: 42 };
    const result = exec(action);
    // If it fell through to default, revealWaypoint would be undefined
    expect(result.revealWaypoint).toBeDefined();
    expect(result.revealWaypoint).toBe(42);
  });

  // -----------------------------------------------------------------------
  // No side-effect leakage — only revealWaypoint should be set
  // -----------------------------------------------------------------------

  it('does not set unrelated result fields (no side-effect leakage)', () => {
    const action: TriggerAction = { action: TACTION_REVEAL_SOME, team: -1, trigger: -1, data: 10 };
    const result = exec(action);

    // revealWaypoint should be set
    expect(result.revealWaypoint).toBe(10);

    // Nothing else should be set
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.spawned).toEqual([]);
  });
});
