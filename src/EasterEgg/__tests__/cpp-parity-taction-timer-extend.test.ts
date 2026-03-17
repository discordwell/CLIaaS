/**
 * C++ behavioral parity tests for TACTION_TIMER_EXTEND (action=25).
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_TIMER_EXTEND (called
 * TACTION_ADD_TIMER in the C++ source) extends the mission countdown timer
 * by action.data units (1/10th minute each). The engine sets
 * result.timerExtend = action.data and spawns nothing.
 *
 * Constant value: 25  (C++ enum TACTION_ADD_TIMER = 25)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('TACTION_TIMER_EXTEND (action=25) — extend mission timer', () => {
  const TACTION_TIMER_EXTEND = 25;

  // Shared empty parameters — timer extend needs no teams, waypoints, globals, or triggers
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  const exec = (action: TriggerAction) =>
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

  // -----------------------------------------------------------------------
  // Core: result.timerExtend === action.data
  // -----------------------------------------------------------------------

  it('sets result.timerExtend to action.data (value 0)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 0 };
    const result = exec(action);
    expect(result.timerExtend).toBe(0);
  });

  it('sets result.timerExtend to action.data (value 5 — half a minute)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.timerExtend).toBe(5);
  });

  it('sets result.timerExtend to action.data (value 10 — one minute)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 10 };
    const result = exec(action);
    expect(result.timerExtend).toBe(10);
  });

  it('sets result.timerExtend to action.data (value 100 — ten minutes)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 100 };
    const result = exec(action);
    expect(result.timerExtend).toBe(100);
  });

  it('preserves exact data value for arbitrary inputs', () => {
    for (const val of [1, 3, 7, 15, 30, 60, 99, 255]) {
      const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: val };
      const result = exec(action);
      expect(result.timerExtend, `data=${val}`).toBe(val);
    }
  });

  // -----------------------------------------------------------------------
  // Spawned array must be empty — timer extend is a side-effect, not a unit
  // -----------------------------------------------------------------------

  it('spawns no entities (spawned array is empty)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.spawned).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Constant value parity — C++ enum TACTION_ADD_TIMER = 25
  // -----------------------------------------------------------------------

  it('constant value is 25 (matches C++ TACTION_ADD_TIMER enum)', () => {
    expect(TACTION_TIMER_EXTEND).toBe(25);
  });

  it('action 25 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 25, team: -1, trigger: -1, data: 42 };
    const result = exec(action);
    // If it fell through to default, timerExtend would be undefined
    expect(result.timerExtend).toBeDefined();
    expect(result.timerExtend).toBe(42);
  });

  // -----------------------------------------------------------------------
  // No side-effect leakage — only timerExtend should be set
  // -----------------------------------------------------------------------

  it('does not set unrelated result fields (no side-effect leakage)', () => {
    const action: TriggerAction = { action: TACTION_TIMER_EXTEND, team: -1, trigger: -1, data: 10 };
    const result = exec(action);

    // timerExtend should be set
    expect(result.timerExtend).toBe(10);

    // Nothing else should be set
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
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
    expect(result.spawned).toEqual([]);
  });
});
