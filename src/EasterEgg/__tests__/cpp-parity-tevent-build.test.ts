/**
 * C++ behavioral parity tests for TEVENT_BUILD (type=19).
 *
 * C++ behavior (TRIGGER.CPP):
 *   case TEVENT_BUILD:
 *     // Checks if the player has built a structure of the specified StructType.
 *     // event.data is the RA StructType enum index (from BTYPE.H).
 *     // Maps the index to a structure type string, then checks
 *     // whether builtStructureTypes contains it.
 *     // Fallback for unknown index: returns true if ANY structure has been built.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

describe('TEVENT_BUILD (type=19) — C++ behavioral parity', () => {
  /** Build a minimal TriggerGameState with all required fields. */
  const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => {
    const merged: TriggerGameState = {
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
    };
    // Legacy test compat: when a test overrides builtStructureTypes but does not
    // supply the per-house map, mirror it onto the trigger's own house so the
    // per-house TEVENT_BUILD check (C++ JustBuiltStructure) sees the value.
    if (overrides.builtStructureTypes && !overrides.builtStructureTypesByHouse) {
      merged.builtStructureTypesByHouse = new Map([[merged.triggerHouse, overrides.builtStructureTypes]]);
    }
    return merged;
  };

  const TEVENT_BUILD = 19;

  /** Helper: create a BUILD trigger event with the given StructType index. */
  const buildEvent = (structTypeIndex: number): TriggerEvent => ({
    type: TEVENT_BUILD,
    team: -1,
    data: structTypeIndex,
  });

  // Full RA StructType enum mapping from BTYPE.H (as used in scenario.ts)
  const STRUCT_TYPE_MAP: [number, string][] = [
    [0, 'ATEK'],  [1, 'IRON'],  [2, 'WEAP'],  [3, 'PDOX'],  [4, 'PBOX'],
    [5, 'HBOX'],  [6, 'DOME'],  [7, 'GAP'],   [8, 'GUN'],   [9, 'AGUN'],
    [10, 'FTUR'], [11, 'FACT'], [12, 'PROC'], [13, 'SILO'], [14, 'HPAD'],
    [15, 'SAM'],  [16, 'AFLD'], [17, 'POWR'], [18, 'APWR'], [19, 'STEK'],
    [20, 'HOSP'], [21, 'BARR'], [22, 'TENT'], [23, 'KENN'], [24, 'FIX'],
    [25, 'BIO'],  [26, 'MISS'], [27, 'SYRD'], [28, 'SPEN'], [29, 'MSLO'],
    [30, 'FCOM'], [31, 'TSLA'], [32, 'QUEE'], [33, 'LAR1'], [34, 'LAR2'],
  ];

  it('constant value is 19 (C++ TEVENT_BUILD enum index)', () => {
    // Verify type=19 evaluates the build path, not a fallback/default.
    const event: TriggerEvent = { type: 19, team: -1, data: 11 }; // FACT
    const stateNotBuilt = createState();
    const stateBuilt = createState({ builtStructureTypes: new Set(['FACT']) });

    expect(checkTriggerEvent(event, stateNotBuilt)).toBe(false);
    expect(checkTriggerEvent(event, stateBuilt)).toBe(true);
  });

  it('returns false when the specified structure type has not been built', () => {
    // Player has not built anything
    const state = createState();
    expect(checkTriggerEvent(buildEvent(0), state)).toBe(false);  // ATEK
    expect(checkTriggerEvent(buildEvent(11), state)).toBe(false); // FACT
    expect(checkTriggerEvent(buildEvent(17), state)).toBe(false); // POWR
  });

  it('returns false when a different structure type has been built', () => {
    // Player built POWR (17) but trigger checks for FACT (11)
    const state = createState({ builtStructureTypes: new Set(['POWR']) });
    expect(checkTriggerEvent(buildEvent(11), state)).toBe(false);
  });

  it('returns true when the specified structure type has been built', () => {
    const state = createState({ builtStructureTypes: new Set(['FACT']) });
    expect(checkTriggerEvent(buildEvent(11), state)).toBe(true);
  });

  it('returns true when the specified type is among multiple built types', () => {
    const state = createState({
      builtStructureTypes: new Set(['POWR', 'FACT', 'BARR', 'WEAP']),
    });
    expect(checkTriggerEvent(buildEvent(11), state)).toBe(true);  // FACT
    expect(checkTriggerEvent(buildEvent(17), state)).toBe(true);  // POWR
    expect(checkTriggerEvent(buildEvent(21), state)).toBe(true);  // BARR
    expect(checkTriggerEvent(buildEvent(2), state)).toBe(true);   // WEAP
  });

  // Index-to-type mapping correctness: verify key entries
  describe('correct index-to-type mapping (RA StructType enum from BTYPE.H)', () => {
    const KEY_MAPPINGS: [number, string][] = [
      [0, 'ATEK'],   // Advanced Tech Center
      [11, 'FACT'],  // Construction Yard
      [17, 'POWR'],  // Power Plant
      [2, 'WEAP'],   // War Factory
      [18, 'APWR'],  // Advanced Power Plant
      [21, 'BARR'],  // Barracks (Soviet)
      [22, 'TENT'],  // Barracks (Allied)
      [31, 'TSLA'],  // Tesla Coil
      [29, 'MSLO'],  // Missile Silo
      [34, 'LAR2'],  // Larval stage 2 (last entry)
    ];

    for (const [index, typeName] of KEY_MAPPINGS) {
      it(`index ${index} maps to ${typeName}`, () => {
        const stateBuilt = createState({ builtStructureTypes: new Set([typeName]) });
        const stateNotBuilt = createState();

        expect(checkTriggerEvent(buildEvent(index), stateBuilt)).toBe(true);
        expect(checkTriggerEvent(buildEvent(index), stateNotBuilt)).toBe(false);
      });
    }
  });

  // Exhaustive mapping: all 35 entries
  describe('exhaustive mapping — all 35 StructType entries', () => {
    for (const [index, typeName] of STRUCT_TYPE_MAP) {
      it(`index ${index} → ${typeName}`, () => {
        const state = createState({ builtStructureTypes: new Set([typeName]) });
        expect(checkTriggerEvent(buildEvent(index), state)).toBe(true);
      });
    }
  });

  describe('fallback when unknown index — any structure built', () => {
    it('returns false when unknown index and nothing built', () => {
      const state = createState(); // builtStructureTypes is empty
      // Index 99 is not in the mapping
      expect(checkTriggerEvent(buildEvent(99), state)).toBe(false);
    });

    it('returns true when unknown index and any structure has been built', () => {
      const state = createState({ builtStructureTypes: new Set(['POWR']) });
      // Index 99 is not in the mapping — falls back to size > 0
      expect(checkTriggerEvent(buildEvent(99), state)).toBe(true);
    });

    it('returns true when unknown index and multiple structures built', () => {
      const state = createState({
        builtStructureTypes: new Set(['POWR', 'FACT', 'WEAP']),
      });
      expect(checkTriggerEvent(buildEvent(999), state)).toBe(true);
    });

    it('negative index triggers fallback', () => {
      const stateEmpty = createState();
      const stateBuilt = createState({ builtStructureTypes: new Set(['ATEK']) });

      expect(checkTriggerEvent(buildEvent(-1), stateEmpty)).toBe(false);
      expect(checkTriggerEvent(buildEvent(-1), stateBuilt)).toBe(true);
    });

    it('index 35 (one past last valid) triggers fallback', () => {
      // Valid indices are 0–34; index 35 should fall through to fallback
      const stateEmpty = createState();
      const stateBuilt = createState({ builtStructureTypes: new Set(['SILO']) });

      expect(checkTriggerEvent(buildEvent(35), stateEmpty)).toBe(false);
      expect(checkTriggerEvent(buildEvent(35), stateBuilt)).toBe(true);
    });
  });

  it('does not check structureTypes (alive buildings) — only builtStructureTypes', () => {
    // A building may exist on the map (structureTypes) but not have been built
    // by the player this game. TEVENT_BUILD checks builtStructureTypes only.
    const state = createState({
      structureTypes: new Set(['FACT']),       // FACT exists on map
      builtStructureTypes: new Set(),           // but player hasn't built it
    });
    expect(checkTriggerEvent(buildEvent(11), state)).toBe(false);
  });

  describe('per-trigger-house scoping (C++ JustBuiltStructure)', () => {
    // C++ parity: TEVENT_BUILD uses HouseClass::JustBuiltStructure, a per-house
    // bitmap. The trigger fires only when its OWN house built the structure.
    // A build completed by a different house must NOT satisfy the trigger.

    it('house A build does not satisfy a house B trigger', () => {
      // Trigger belongs to house B (index 2). House A (index 1) built FACT.
      // House B has built nothing → trigger must NOT fire.
      const state = createState({
        triggerHouse: 2,
        builtStructureTypesByHouse: new Map([
          [1, new Set(['FACT'])],    // house A built FACT
          [2, new Set<string>()],    // house B built nothing
        ]),
      });
      expect(checkTriggerEvent(buildEvent(11), state)).toBe(false); // FACT
    });

    it('trigger fires only for the trigger house that built the structure', () => {
      // Same layout but swap: house B built FACT, trigger is house B → fires.
      const state = createState({
        triggerHouse: 2,
        builtStructureTypesByHouse: new Map([
          [1, new Set<string>()],
          [2, new Set(['FACT'])],
        ]),
      });
      expect(checkTriggerEvent(buildEvent(11), state)).toBe(true);
    });

    it('unknown StructType fallback is also scoped per-house', () => {
      // Fallback (unknown StructType index) must honor per-house scoping too:
      // "any build by trigger.house" NOT "any build by any house".
      const stateHouseBEmpty = createState({
        triggerHouse: 2,
        builtStructureTypesByHouse: new Map([
          [1, new Set(['POWR', 'FACT'])],  // house A has builds
          [2, new Set<string>()],           // house B is empty
        ]),
      });
      // Index 999 (unknown) → fallback. House B built nothing → false.
      expect(checkTriggerEvent({ type: TEVENT_BUILD, team: -1, data: 999 }, stateHouseBEmpty))
        .toBe(false);

      const stateHouseBHasBuild = createState({
        triggerHouse: 2,
        builtStructureTypesByHouse: new Map([
          [1, new Set<string>()],
          [2, new Set(['POWR'])],
        ]),
      });
      expect(checkTriggerEvent({ type: TEVENT_BUILD, team: -1, data: 999 }, stateHouseBHasBuild))
        .toBe(true);
    });

    it('returns false when trigger house has no entry in the map at all', () => {
      // House 5 has no map entry whatsoever → return false, not a throw.
      const state = createState({
        triggerHouse: 5,
        builtStructureTypesByHouse: new Map([
          [1, new Set(['FACT'])],
        ]),
      });
      expect(checkTriggerEvent(buildEvent(11), state)).toBe(false);
    });
  });
});
