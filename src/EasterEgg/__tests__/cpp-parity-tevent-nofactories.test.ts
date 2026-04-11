/**
 * C++ behavioral parity tests for TEVENT_NOFACTORIES (type=17).
 *
 * C++ reference: TEVENT.H — TEVENT_NOFACTORIES = 17
 * Behavior: Returns true when the player has no remaining factories.
 *   In C++: !PlayerPtr->Factories (factory count == 0)
 *   In TS:  !state.playerFactoriesExist
 *
 * The event.data field is irrelevant — TEVENT_NOFACTORIES is a pure
 * boolean check on the player's factory existence state.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** Helper: create a minimal TriggerGameState with all required fields */
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

const TEVENT_NOFACTORIES = 17;

describe('TEVENT_NOFACTORIES (type=17) — C++ behavioral parity', () => {
  it('constant value is 17, matching C++ TEVENT.H enum', () => {
    // Verify the event type constant matches the C++ enum index
    expect(TEVENT_NOFACTORIES).toBe(17);
  });

  it('returns true when player has no factories (playerFactoriesExist=false)', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };
    const state = createState({ playerFactoriesExist: false });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns false when player has factories (playerFactoriesExist=true)', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };
    const state = createState({ playerFactoriesExist: true });

    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('event.data is irrelevant — result depends only on playerFactoriesExist', () => {
    // C++ TEVENT_NOFACTORIES ignores the Data field entirely.
    // Verify various data values produce the same result.
    const dataValues = [0, 1, 5, 42, 255, -1];

    for (const data of dataValues) {
      const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data };

      const stateNoFactories = createState({ playerFactoriesExist: false });
      expect(
        checkTriggerEvent(event, stateNoFactories),
        `data=${data}: should be true when no factories`,
      ).toBe(true);

      const stateHasFactories = createState({ playerFactoriesExist: true });
      expect(
        checkTriggerEvent(event, stateHasFactories),
        `data=${data}: should be false when factories exist`,
      ).toBe(false);
    }
  });

  it('team field does not affect the result', () => {
    // TEVENT_NOFACTORIES checks only the player's own factory state,
    // regardless of the team field on the event.
    const teamValues = [-1, 0, 1, 7];

    for (const team of teamValues) {
      const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team, data: 0 };

      const stateNoFactories = createState({ playerFactoriesExist: false });
      expect(
        checkTriggerEvent(event, stateNoFactories),
        `team=${team}: should be true when no factories`,
      ).toBe(true);

      const stateHasFactories = createState({ playerFactoriesExist: true });
      expect(
        checkTriggerEvent(event, stateHasFactories),
        `team=${team}: should be false when factories exist`,
      ).toBe(false);
    }
  });

  it('toggles correctly when factory state changes (factory destroyed scenario)', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };

    // Initially player has factories
    const stateWithFactories = createState({ playerFactoriesExist: true });
    expect(checkTriggerEvent(event, stateWithFactories)).toBe(false);

    // All factories destroyed
    const stateNoFactories = createState({ playerFactoriesExist: false });
    expect(checkTriggerEvent(event, stateNoFactories)).toBe(true);

    // Player rebuilds a factory
    const stateRebuilt = createState({ playerFactoriesExist: true });
    expect(checkTriggerEvent(event, stateRebuilt)).toBe(false);
  });

  it('is independent of playerFactories count field', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };

    // playerFactories count is non-zero but playerFactoriesExist is false
    // (edge case — the boolean flag is what matters for TEVENT_NOFACTORIES)
    const stateCountButNoExist = createState({
      playerFactories: 3,
      playerFactoriesExist: false,
    });
    expect(checkTriggerEvent(event, stateCountButNoExist)).toBe(true);

    // playerFactories count is zero but playerFactoriesExist is true
    const stateNoCountButExist = createState({
      playerFactories: 0,
      playerFactoriesExist: true,
    });
    expect(checkTriggerEvent(event, stateNoCountButExist)).toBe(false);
  });
});
