/**
 * C++ behavioral parity tests for TACTION_PLAY_MOVIE (action=10) — play movie/cutscene.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_PLAY_MOVIE triggers playback
 * of a movie/cutscene identified by action.data (the movie ID). The engine sets
 * result.playMovie to the movie ID and spawns nothing (movies are a presentation
 * effect, not an entity).
 *
 * Constant value: 10  (C++ enum TACTION_PLAY_MOVIE = 10)
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('TACTION_PLAY_MOVIE (action=10) — play movie/cutscene', () => {
  const TACTION_PLAY_MOVIE = 10;

  // Shared empty parameters — PLAY_MOVIE needs no teams, waypoints, globals, or triggers
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  const exec = (action: TriggerAction) =>
    executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

  // -----------------------------------------------------------------------
  // Core: result.playMovie === action.data
  // -----------------------------------------------------------------------

  it('sets result.playMovie to action.data (movie ID 0)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 0 };
    const result = exec(action);
    expect(result.playMovie).toBe(0);
  });

  it('sets result.playMovie to action.data (movie ID 1)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 1 };
    const result = exec(action);
    expect(result.playMovie).toBe(1);
  });

  it('sets result.playMovie to action.data (movie ID 5)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 5 };
    const result = exec(action);
    expect(result.playMovie).toBe(5);
  });

  it('sets result.playMovie to action.data (movie ID 25 — high value)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 25 };
    const result = exec(action);
    expect(result.playMovie).toBe(25);
  });

  // -----------------------------------------------------------------------
  // Various data values — preserves exact movie ID for arbitrary inputs
  // -----------------------------------------------------------------------

  it('preserves exact movie ID for arbitrary data values', () => {
    for (const movieId of [2, 7, 13, 42, 99]) {
      const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: movieId };
      const result = exec(action);
      expect(result.playMovie, `movie ID ${movieId}`).toBe(movieId);
    }
  });

  // -----------------------------------------------------------------------
  // Spawned array must be empty — PLAY_MOVIE is a presentation effect
  // -----------------------------------------------------------------------

  it('spawns no entities (spawned array is empty)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 3 };
    const result = exec(action);
    expect(result.spawned).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Constant value parity — C++ enum TACTION_PLAY_MOVIE = 10
  // -----------------------------------------------------------------------

  it('constant value is 10 (matches C++ TACTION_PLAY_MOVIE enum)', () => {
    expect(TACTION_PLAY_MOVIE).toBe(10);
  });

  it('action 10 is handled (does not fall through to default/noop)', () => {
    const action: TriggerAction = { action: 10, team: -1, trigger: -1, data: 77 };
    const result = exec(action);
    // If it fell through to default, playMovie would be undefined
    expect(result.playMovie).toBeDefined();
    expect(result.playMovie).toBe(77);
  });

  // -----------------------------------------------------------------------
  // No side-effect leakage — only playMovie should be set
  // -----------------------------------------------------------------------

  it('does not set unrelated result fields (no side-effect leakage)', () => {
    const action: TriggerAction = { action: TACTION_PLAY_MOVIE, team: -1, trigger: -1, data: 10 };
    const result = exec(action);

    // playMovie should be set
    expect(result.playMovie).toBe(10);

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
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.centerView).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
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
