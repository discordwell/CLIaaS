/**
 * C++ behavioral parity tests for TEVENT_NBUILDINGS_DESTROYED (type=15).
 *
 * C++ behavior (TEVENT.CPP):
 *   case TEVENT_NBUILDINGS_DESTROYED:
 *     return (HouseClass::As_Pointer(house)->BuildingsKilled >= Data);
 *
 * TypeScript implementation (scenario.ts):
 *   case TEVENT_NBUILDINGS_DESTROYED:
 *     return state.buildingsLostByHouse.get(state.triggerHouse) >= event.data;
 *
 * Tests verify: false when count < threshold, true when ==, true when >,
 * threshold=0 always true, and the constant is 15.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** TEVENT_NBUILDINGS_DESTROYED C++ enum value */
const TEVENT_NBUILDINGS_DESTROYED = 15;

/** Helper: create a minimal TriggerGameState with all required fields. */
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
  unitsLostByHouse: new Map(),
  buildingsLostByHouse: new Map(),
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

/** Helper: create a TriggerEvent for TEVENT_NBUILDINGS_DESTROYED. */
const makeEvent = (threshold: number): TriggerEvent => ({
  type: TEVENT_NBUILDINGS_DESTROYED,
  team: -1,
  data: threshold,
});

const buildingsLost = (count: number, house = 1): Map<number, number> => new Map([[house, count]]);

describe('TEVENT_NBUILDINGS_DESTROYED (type=15) — C++ parity', () => {
  it('constant value is 15 (matches C++ TEVENT_NBUILDINGS_DESTROYED enum)', () => {
    expect(TEVENT_NBUILDINGS_DESTROYED).toBe(15);
  });

  it('returns false when nBuildingsDestroyed < threshold', () => {
    const event = makeEvent(5);
    const state = createState({ buildingsLostByHouse: buildingsLost(4) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when nBuildingsDestroyed == threshold (exact match)', () => {
    const event = makeEvent(5);
    const state = createState({ buildingsLostByHouse: buildingsLost(5) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when nBuildingsDestroyed > threshold (overshoot)', () => {
    const event = makeEvent(5);
    const state = createState({ buildingsLostByHouse: buildingsLost(10) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('threshold=0 always returns true (0 >= 0)', () => {
    const event = makeEvent(0);
    // Even with zero buildings destroyed, 0 >= 0 is true
    const stateZero = createState({ nBuildingsDestroyed: 0 });
    expect(checkTriggerEvent(event, stateZero)).toBe(true);
    // And with some buildings destroyed, still true
    const stateSome = createState({ buildingsLostByHouse: buildingsLost(3) });
    expect(checkTriggerEvent(event, stateSome)).toBe(true);
  });

  it('threshold=1 with count=0 returns false', () => {
    const event = makeEvent(1);
    const state = createState({ buildingsLostByHouse: buildingsLost(0) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('threshold=1 with count=1 returns true', () => {
    const event = makeEvent(1);
    const state = createState({ buildingsLostByHouse: buildingsLost(1) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('large threshold requires matching large count', () => {
    const event = makeEvent(100);
    const stateLow = createState({ buildingsLostByHouse: buildingsLost(99) });
    expect(checkTriggerEvent(event, stateLow)).toBe(false);
    const stateExact = createState({ buildingsLostByHouse: buildingsLost(100) });
    expect(checkTriggerEvent(event, stateExact)).toBe(true);
    const stateHigh = createState({ buildingsLostByHouse: buildingsLost(200) });
    expect(checkTriggerEvent(event, stateHigh)).toBe(true);
  });
});
