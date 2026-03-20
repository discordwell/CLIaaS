/**
 * C++ Behavioral Parity Tests — TEVENT_ALL_DESTROYED (type=11)
 *
 * C++ source: HouseClass::Is_All_Destroyed()
 * Returns true when ALL units AND structures of the specified house are destroyed.
 * event.data = RA house index.
 *
 * Implementation: !(state.houseAlive.get(houseIdx) ?? false)
 *   - houseAlive tracks whether a house has ANY living units or structures
 *   - When the map entry is false or missing, the house is considered destroyed
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal TriggerGameState with all required fields */
function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 200, // Must be >= 100 to pass C++ ScenarioInit guard
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
    builtStructureTypes: new Set(),
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
  };
}

// ============================================================================
// Constants
// ============================================================================

const TEVENT_UNITS_DESTROYED = 9;
const TEVENT_BUILDINGS_DESTROYED = 10;
const TEVENT_ALL_DESTROYED = 11;

// RA house indices
const HOUSE_SPAIN = 0;
const HOUSE_GREECE = 1;
const HOUSE_USSR = 2;
const HOUSE_ENGLAND = 3;
const HOUSE_UKRAINE = 4;
const HOUSE_GERMANY = 5;
const HOUSE_FRANCE = 6;
const HOUSE_TURKEY = 7;

// ============================================================================
// Tests
// ============================================================================

describe('TEVENT_ALL_DESTROYED (type=11) — C++ HouseClass::Is_All_Destroyed parity', () => {
  it('constant value is 11', () => {
    expect(TEVENT_ALL_DESTROYED).toBe(11);
  });

  it('returns true when house is not alive (map entry false)', () => {
    const event: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_USSR };
    const state = createState({
      houseAlive: new Map([[HOUSE_USSR, false]]),
    });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when house is not in map (undefined → not alive)', () => {
    const event: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_TURKEY };
    // houseAlive map has no entry for Turkey at all
    const state = createState({
      houseAlive: new Map([[HOUSE_USSR, true]]),
    });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns false when house is still alive (map entry true)', () => {
    const event: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_USSR };
    const state = createState({
      houseAlive: new Map([[HOUSE_USSR, true]]),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('different house indices are independent', () => {
    // USSR alive, Greece destroyed, England not in map
    const state = createState({
      houseAlive: new Map([
        [HOUSE_USSR, true],
        [HOUSE_GREECE, false],
      ]),
    });

    const ussrEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_USSR };
    const greeceEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_GREECE };
    const englandEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_ENGLAND };

    // USSR is alive — not destroyed
    expect(checkTriggerEvent(ussrEvent, state)).toBe(false);
    // Greece is explicitly false — destroyed
    expect(checkTriggerEvent(greeceEvent, state)).toBe(true);
    // England not in map — treated as destroyed (never existed or fully destroyed)
    expect(checkTriggerEvent(englandEvent, state)).toBe(true);
  });

  describe('distinction from UNITS_DESTROYED(9) and BUILDINGS_DESTROYED(10)', () => {
    it('ALL_DESTROYED checks houseAlive (both units + structures), not houseUnitsAlive or buildingsDestroyedByHouse', () => {
      // Scenario: house has no units left but still has buildings
      // UNITS_DESTROYED should fire, BUILDINGS_DESTROYED should NOT fire,
      // ALL_DESTROYED should NOT fire (house still alive)
      const state = createState({
        houseAlive: new Map([[HOUSE_USSR, true]]),            // still alive overall
        houseUnitsAlive: new Map([[HOUSE_USSR, false]]),      // no units left
        houseBuildingsAlive: new Map([[HOUSE_USSR, true]]),    // buildings still alive
        buildingsDestroyedByHouse: new Map([[HOUSE_USSR, false]]), // buildings NOT all destroyed
      });

      const unitsEvent: TriggerEvent = { type: TEVENT_UNITS_DESTROYED, team: -1, data: HOUSE_USSR };
      const buildingsEvent: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: HOUSE_USSR };
      const allEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_USSR };

      // Units destroyed — yes, no units alive
      expect(checkTriggerEvent(unitsEvent, state)).toBe(true);
      // Buildings destroyed — no, buildings still exist
      expect(checkTriggerEvent(buildingsEvent, state)).toBe(false);
      // All destroyed — no, house is still alive (has buildings)
      expect(checkTriggerEvent(allEvent, state)).toBe(false);
    });

    it('ALL_DESTROYED fires only when the house has NEITHER units NOR structures', () => {
      // Scenario: house has no buildings left but still has units
      // BUILDINGS_DESTROYED should fire, UNITS_DESTROYED should NOT fire,
      // ALL_DESTROYED should NOT fire (house still alive from units)
      const state = createState({
        houseAlive: new Map([[HOUSE_GREECE, true]]),           // still alive (units remain)
        houseUnitsAlive: new Map([[HOUSE_GREECE, true]]),      // units still alive
        houseBuildingsAlive: new Map([[HOUSE_GREECE, false]]),  // no buildings left
        buildingsDestroyedByHouse: new Map([[HOUSE_GREECE, true]]), // buildings all destroyed
      });

      const unitsEvent: TriggerEvent = { type: TEVENT_UNITS_DESTROYED, team: -1, data: HOUSE_GREECE };
      const buildingsEvent: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: HOUSE_GREECE };
      const allEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_GREECE };

      // Units destroyed — no, units still alive
      expect(checkTriggerEvent(unitsEvent, state)).toBe(false);
      // Buildings destroyed — yes, all buildings gone
      expect(checkTriggerEvent(buildingsEvent, state)).toBe(true);
      // All destroyed — no, house still alive (has units)
      expect(checkTriggerEvent(allEvent, state)).toBe(false);
    });

    it('ALL_DESTROYED fires when both units AND buildings are gone', () => {
      const state = createState({
        houseAlive: new Map([[HOUSE_FRANCE, false]]),           // fully dead
        houseUnitsAlive: new Map([[HOUSE_FRANCE, false]]),      // no units
        houseBuildingsAlive: new Map([[HOUSE_FRANCE, false]]),   // no buildings
        buildingsDestroyedByHouse: new Map([[HOUSE_FRANCE, true]]), // buildings all destroyed
      });

      const unitsEvent: TriggerEvent = { type: TEVENT_UNITS_DESTROYED, team: -1, data: HOUSE_FRANCE };
      const buildingsEvent: TriggerEvent = { type: TEVENT_BUILDINGS_DESTROYED, team: -1, data: HOUSE_FRANCE };
      const allEvent: TriggerEvent = { type: TEVENT_ALL_DESTROYED, team: -1, data: HOUSE_FRANCE };

      // All three should fire
      expect(checkTriggerEvent(unitsEvent, state)).toBe(true);
      expect(checkTriggerEvent(buildingsEvent, state)).toBe(true);
      expect(checkTriggerEvent(allEvent, state)).toBe(true);
    });
  });
});
