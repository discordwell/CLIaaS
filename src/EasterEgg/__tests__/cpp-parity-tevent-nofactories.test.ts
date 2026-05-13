/**
 * C++ behavioral parity tests for TEVENT_NOFACTORIES (type=17).
 *
 * C++ reference: TEVENT.H — TEVENT_NOFACTORIES = 17
 * Behavior: Returns true when the trigger's owning house has no remaining
 * factory-class buildings.
 *   C++ tevent.cpp:340-341 checks `hptr->BScan` for
 *   STRUCTF_AIRSTRIP|STRUCTF_TENT|STRUCTF_WEAP|STRUCTF_BARRACKS|STRUCTF_CONST.
 *
 * The event.data field is irrelevant; the trigger's House field selects the
 * house whose BScan is inspected.
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

  it('returns true when the trigger house has no factory-class buildings', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };
    const state = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['FTUR', 'PROC', 'HPAD', 'SILO'])]]),
      playerFactoriesExist: true,
    });

    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns false when the trigger house still has a C++ factory type', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };
    for (const factory of ['FACT', 'TENT', 'BARR', 'WEAP', 'AFLD']) {
      const state = createState({
        triggerHouse: 9,
        structureTypesByHouse: new Map([[9, new Set(['FTUR', factory])]]),
        playerFactoriesExist: false,
      });

      expect(checkTriggerEvent(event, state), `${factory} blocks NOFACTORIES`).toBe(false);
    }
  });

  it('event.data is irrelevant — result depends on trigger-house factory state', () => {
    // C++ TEVENT_NOFACTORIES ignores the Data field entirely.
    // Verify various data values produce the same result.
    const dataValues = [0, 1, 5, 42, 255, -1];

    for (const data of dataValues) {
      const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data };

      const stateNoFactories = createState({
        triggerHouse: 9,
        structureTypesByHouse: new Map([[9, new Set(['FTUR', 'HPAD'])]]),
      });
      expect(
        checkTriggerEvent(event, stateNoFactories),
        `data=${data}: should be true when no factories`,
      ).toBe(true);

      const stateHasFactories = createState({
        triggerHouse: 9,
        structureTypesByHouse: new Map([[9, new Set(['FTUR', 'WEAP'])]]),
      });
      expect(
        checkTriggerEvent(event, stateHasFactories),
        `data=${data}: should be false when factories exist`,
      ).toBe(false);
    }
  });

  it('team field does not affect the result', () => {
    // TEVENT_NOFACTORIES checks the trigger house's factory state, regardless
    // of the team field on the event.
    const teamValues = [-1, 0, 1, 7];

    for (const team of teamValues) {
      const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team, data: 0 };

      const stateNoFactories = createState({
        triggerHouse: 9,
        structureTypesByHouse: new Map([[9, new Set(['FTUR'])]]),
      });
      expect(
        checkTriggerEvent(event, stateNoFactories),
        `team=${team}: should be true when no factories`,
      ).toBe(true);

      const stateHasFactories = createState({
        triggerHouse: 9,
        structureTypesByHouse: new Map([[9, new Set(['BARR'])]]),
      });
      expect(
        checkTriggerEvent(event, stateHasFactories),
        `team=${team}: should be false when factories exist`,
      ).toBe(false);
    }
  });

  it('toggles correctly when trigger-house factory state changes', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };

    const stateWithFactories = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['WEAP'])]]),
    });
    expect(checkTriggerEvent(event, stateWithFactories)).toBe(false);

    const stateNoFactories = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['FTUR'])]]),
    });
    expect(checkTriggerEvent(event, stateNoFactories)).toBe(true);

    const stateRebuilt = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['FTUR', 'AFLD'])]]),
    });
    expect(checkTriggerEvent(event, stateRebuilt)).toBe(false);
  });

  it('does not use the player factory fields', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };

    const playerHasFactoriesButTriggerHouseDoesNot = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['FTUR'])]]),
      playerFactories: 3,
      playerFactoriesExist: true,
    });
    expect(checkTriggerEvent(event, playerHasFactoriesButTriggerHouseDoesNot)).toBe(true);

    const playerHasNoFactoriesButTriggerHouseDoes = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([[9, new Set(['WEAP'])]]),
      playerFactories: 0,
      playerFactoriesExist: false,
    });
    expect(checkTriggerEvent(event, playerHasNoFactoriesButTriggerHouseDoes)).toBe(false);
  });

  it('checks triggerHouse, not event.data or player house, matching SCG14EA bfir', () => {
    const event: TriggerEvent = { type: TEVENT_NOFACTORIES, team: -1, data: 0 };
    const state = createState({
      triggerHouse: 9,
      structureTypesByHouse: new Map([
        [1, new Set<string>()],
        [9, new Set(['WEAP', 'BARR'])],
      ]),
      playerFactoriesExist: false,
    });

    expect(checkTriggerEvent(event, state)).toBe(false);
  });
});
