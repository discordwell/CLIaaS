/**
 * C++ behavioral parity tests for TACTION_PLAY_SOUND (action=19) — play sound effect.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_PLAY_SOUND plays the sound
 * effect identified by action.data. The engine sets result.playSound to the
 * sound index and spawns nothing (the sound is an audio effect, not an entity).
 *
 * Constant value: 19  (C++ enum TACTION_PLAY_SOUND = 19)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('TACTION_PLAY_SOUND (action=19) — play sound effect', () => {
  const TACTION_PLAY_SOUND = 19;

  // Shared empty parameters — PLAY_SOUND needs no teams, waypoints, globals, or triggers
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  const exec = (action: TriggerAction) =>
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

  // -----------------------------------------------------------------------
  // Core: result.playSound === action.data
  // -----------------------------------------------------------------------

  it('sets result.playSound to action.data (sound index 0)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: 0 };
    const result = exec(action);
    expect(result.playSound).toBe(0);
  });

  it('sets result.playSound to action.data (sound index 5)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.playSound).toBe(5);
  });

  it('sets result.playSound to action.data (sound index 25 — high value)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: 25 };
    const result = exec(action);
    expect(result.playSound).toBe(25);
  });

  it('preserves exact sound index for arbitrary values', () => {
    for (const soundIndex of [1, 7, 13, 98]) {
      const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: soundIndex };
      const result = exec(action);
      expect(result.playSound, `sound index ${soundIndex}`).toBe(soundIndex);
    }
  });

  // -----------------------------------------------------------------------
  // Spawned array must be empty — PLAY_SOUND is an audio effect, not a unit
  // -----------------------------------------------------------------------

  it('spawns no entities (spawned array is empty)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: 3 };
    const result = exec(action);
    expect(result.spawned).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Constant value parity — C++ enum TACTION_PLAY_SOUND = 19
  // -----------------------------------------------------------------------

  it('constant value is 19 (matches C++ TACTION_PLAY_SOUND enum)', () => {
    expect(TACTION_PLAY_SOUND).toBe(19);
  });

  it('action 19 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 19, team: -1, trigger: -1, data: 42 };
    const result = exec(action);
    // If it fell through to default, playSound would be undefined
    expect(result.playSound).toBeDefined();
    expect(result.playSound).toBe(42);
  });

  // -----------------------------------------------------------------------
  // No side-effect leakage — only playSound should be set
  // -----------------------------------------------------------------------

  it('does not set unrelated result fields (no side-effect leakage)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_SOUND, team: -1, trigger: -1, data: 10 };
    const result = exec(action);

    // playSound should be set
    expect(result.playSound).toBe(10);

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
    expect(result.timerExtend).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.destroyTriggeringUnit).toBeUndefined();
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
