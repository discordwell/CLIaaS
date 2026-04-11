/**
 * C++ behavioral parity tests for TEVENT_MISSION_TIMER_EXPIRED (type=14).
 *
 * In the C++ Red Alert source (TEVENT.H / SCENARIO.CPP), event type 14
 * (TEVENT_MISSION_TIMER_EXPIRED) simply returns true when the global mission
 * timer has reached zero.  It ignores event.data entirely — the timer is a
 * single global flag, not parameterised.
 *
 * Our TypeScript implementation mirrors this:
 *   case TEVENT_MISSION_TIMER_EXPIRED:
 *     return state.missionTimerExpired;
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** Minimal valid TriggerGameState with sensible defaults. */
const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => ({
  gameTick: 0,
  globals: new Set(),
  triggerStartTick: 0,
  triggerName: 'test',
  playerEntered: false,
  enemyUnitsAlive: 0,
  enemyKillCount: 0,
  playerFactories: 0,
  missionTimerExpired: false,
  bridgesAlive: 0,
  unitsLeftMap: 0,
  structureTypes: new Set(),

  structureTypesByHouse: new Map([[1, new Set<string>()]]),

  triggerHouse: 1,
  builtStructureTypes: new Set(),
  builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
  destroyedTriggerNames: new Set(),
  attackedTriggerNames: new Set(),
  houseAlive: new Map(),
  houseUnitsAlive: new Map(),
  houseBuildingsAlive: new Map(),
  isLowPower: false,
  playerCredits: 0,
  buildingsDestroyedByHouse: new Map(),
  nBuildingsDestroyed: 0,
  playerFactoriesExist: true,
  civiliansEvacuated: 0,
  builtUnitTypes: new Set(),
  builtInfantryTypes: new Set(),
  builtAircraftTypes: new Set(),
  fakesExist: true,
  spiedBuildings: new Set(),
  isThieved: false,
  pendingDestroyedCount: 0,
  ...overrides,
});

const TEVENT_MISSION_TIMER_EXPIRED = 14;

describe('TEVENT_MISSION_TIMER_EXPIRED (type=14) — C++ parity', () => {
  it('constant value is 14 (matches C++ tevent.h enum)', () => {
    // Sanity-check: the event type literal we use matches the C++ enum ordinal.
    expect(TEVENT_MISSION_TIMER_EXPIRED).toBe(14);
  });

  it('returns false when the mission timer has NOT expired', () => {
    const event: TriggerEvent = { type: TEVENT_MISSION_TIMER_EXPIRED, team: -1, data: 0 };
    const state = createState({ missionTimerExpired: false });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when the mission timer HAS expired', () => {
    const event: TriggerEvent = { type: TEVENT_MISSION_TIMER_EXPIRED, team: -1, data: 0 };
    const state = createState({ missionTimerExpired: true });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('event.data is irrelevant — result depends only on state.missionTimerExpired', () => {
    // C++ ignores the data field for this event type.
    // Verify with several arbitrary data values.
    const dataValues = [0, 1, 42, 9999, -1];

    for (const data of dataValues) {
      const event: TriggerEvent = { type: TEVENT_MISSION_TIMER_EXPIRED, team: -1, data };

      const stateNotExpired = createState({ missionTimerExpired: false });
      expect(
        checkTriggerEvent(event, stateNotExpired),
        `data=${data}: should be false when timer not expired`,
      ).toBe(false);

      const stateExpired = createState({ missionTimerExpired: true });
      expect(
        checkTriggerEvent(event, stateExpired),
        `data=${data}: should be true when timer expired`,
      ).toBe(true);
    }
  });

  it('event.team is irrelevant — result depends only on state.missionTimerExpired', () => {
    // The mission timer is a global, not per-team.
    const teamValues = [-1, 0, 1, 2, 7];

    for (const team of teamValues) {
      const event: TriggerEvent = { type: TEVENT_MISSION_TIMER_EXPIRED, team, data: 0 };

      expect(
        checkTriggerEvent(event, createState({ missionTimerExpired: false })),
        `team=${team}: should be false when timer not expired`,
      ).toBe(false);

      expect(
        checkTriggerEvent(event, createState({ missionTimerExpired: true })),
        `team=${team}: should be true when timer expired`,
      ).toBe(true);
    }
  });

  it('other state fields do not influence the result', () => {
    // Vary unrelated state fields — the timer event should care only about missionTimerExpired.
    const event: TriggerEvent = { type: TEVENT_MISSION_TIMER_EXPIRED, team: -1, data: 0 };

    const stateNoisy = createState({
      missionTimerExpired: false,
      gameTick: 100_000,
      playerCredits: 50_000,
      enemyKillCount: 999,
      isLowPower: true,
      playerEntered: true,
    });
    expect(checkTriggerEvent(event, stateNoisy)).toBe(false);

    const stateNoisyExpired = createState({
      missionTimerExpired: true,
      gameTick: 0,
      playerCredits: 0,
      enemyKillCount: 0,
      isLowPower: false,
      playerEntered: false,
    });
    expect(checkTriggerEvent(event, stateNoisyExpired)).toBe(true);
  });
});
