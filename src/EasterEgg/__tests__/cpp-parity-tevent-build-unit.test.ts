/**
 * C++ behavioral parity tests for TEVENT_BUILD_UNIT (type=20).
 *
 * C++ reference: TRIGGER.CPP — TEVENT_BUILD_UNIT fires when the player builds
 * a specific unit type. event.data maps to UnitType enum index, which is
 * resolved via UNIT_TYPE_NAMES to a string and checked against
 * state.builtUnitTypes. If the index is unknown (no mapping), C++ falls back
 * to "has the player built ANY unit?" (builtUnitTypes.size > 0).
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** TEVENT_BUILD_UNIT constant — must equal 20 per C++ tevent.h */
const TEVENT_BUILD_UNIT = 20;

/**
 * Full UNIT_TYPE_NAMES mapping (mirrors scenario.ts / C++ UnitType enum).
 * Used here as the authoritative reference for index-to-name tests.
 */
const EXPECTED_UNIT_TYPE_NAMES: Record<number, string> = {
  0: 'HARV', 1: '1TNK', 2: '2TNK', 3: '3TNK', 4: '4TNK', 5: 'APC',
  6: 'MNLY', 7: 'JEEP', 8: 'TRUK', 9: 'ARTY', 10: 'MCV',
  11: 'V2RL', 12: 'CTNK', 13: 'TTNK', 14: 'STNK', 15: 'QTNK', 16: 'DTRK',
};

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

/** Helper: create a TEVENT_BUILD_UNIT event with the given data index. */
const buildUnitEvent = (dataIndex: number): TriggerEvent => ({
  type: TEVENT_BUILD_UNIT,
  team: -1,
  data: dataIndex,
});

describe('C++ parity: TEVENT_BUILD_UNIT (type=20)', () => {
  // ── Constant verification ───────────────────────────────────────────
  it('TEVENT_BUILD_UNIT constant equals 20', () => {
    // Verify by calling checkTriggerEvent with type=20 and a matching state;
    // if the constant were wrong, this would return false via the default case.
    const event = buildUnitEvent(0); // data=0 → 'HARV'
    const state = createState({ builtUnitTypes: new Set(['HARV']) });
    expect(event.type).toBe(20);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── False when unit not yet built ───────────────────────────────────
  it('returns false when the specified unit type has NOT been built', () => {
    const event = buildUnitEvent(1); // data=1 → '1TNK'
    const state = createState({ builtUnitTypes: new Set() });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false when a different unit type has been built', () => {
    const event = buildUnitEvent(1); // data=1 → '1TNK'
    const state = createState({ builtUnitTypes: new Set(['2TNK', 'HARV']) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // ── True when unit has been built ───────────────────────────────────
  it('returns true when the specified unit type HAS been built', () => {
    const event = buildUnitEvent(1); // data=1 → '1TNK'
    const state = createState({ builtUnitTypes: new Set(['1TNK']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when multiple types built and specified is among them', () => {
    const event = buildUnitEvent(4); // data=4 → '4TNK'
    const state = createState({ builtUnitTypes: new Set(['HARV', '1TNK', '4TNK', 'APC']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── Correct index → name mapping for every defined entry ───────────
  describe('index-to-name mapping matches C++ UnitType enum', () => {
    for (const [indexStr, expectedName] of Object.entries(EXPECTED_UNIT_TYPE_NAMES)) {
      const index = Number(indexStr);
      it(`data=${index} maps to '${expectedName}'`, () => {
        const event = buildUnitEvent(index);
        // State where ONLY expectedName has been built
        const stateWithUnit = createState({ builtUnitTypes: new Set([expectedName]) });
        const stateWithout = createState({ builtUnitTypes: new Set() });

        expect(
          checkTriggerEvent(event, stateWithUnit),
          `data=${index} should match '${expectedName}' when built`,
        ).toBe(true);
        expect(
          checkTriggerEvent(event, stateWithout),
          `data=${index} should NOT match when '${expectedName}' not built`,
        ).toBe(false);
      });
    }
  });

  // ── Fallback for unknown / unmapped index ──────────────────────────
  describe('fallback for unknown unit index (no UNIT_TYPE_NAMES entry)', () => {
    // C++ behavior: when event.data doesn't map to a known UnitType name,
    // the trigger fires if ANY unit has been built (builtUnitTypes.size > 0).
    const unknownIndex = 99; // well beyond defined range (0-16)

    it('returns false when unknown index and no units built at all', () => {
      const event = buildUnitEvent(unknownIndex);
      const state = createState({ builtUnitTypes: new Set() });
      expect(checkTriggerEvent(event, state)).toBe(false);
    });

    it('returns true when unknown index and at least one unit has been built', () => {
      const event = buildUnitEvent(unknownIndex);
      const state = createState({ builtUnitTypes: new Set(['HARV']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('returns true when unknown index and many units built', () => {
      const event = buildUnitEvent(unknownIndex);
      const state = createState({ builtUnitTypes: new Set(['HARV', '1TNK', 'APC']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('fallback applies for index just past last defined entry (17)', () => {
      const event = buildUnitEvent(17);
      const stateEmpty = createState({ builtUnitTypes: new Set() });
      const stateAny = createState({ builtUnitTypes: new Set(['MCV']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });

    it('fallback applies for negative index (-1)', () => {
      const event = buildUnitEvent(-1);
      const stateEmpty = createState({ builtUnitTypes: new Set() });
      const stateAny = createState({ builtUnitTypes: new Set(['ARTY']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────
  it('does not cross-match with infantry or aircraft types in builtUnitTypes', () => {
    // Even if infantry/aircraft are built, BUILD_UNIT only checks builtUnitTypes
    const event = buildUnitEvent(0); // data=0 → 'HARV'
    const state = createState({
      builtUnitTypes: new Set(),
      builtInfantryTypes: new Set(['E1', 'E2']),
      builtAircraftTypes: new Set(['HELI', 'MIG']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('first entry (data=0, HARV) works correctly', () => {
    const event = buildUnitEvent(0);
    expect(checkTriggerEvent(event, createState({ builtUnitTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtUnitTypes: new Set(['HARV']) }))).toBe(true);
  });

  it('last defined entry (data=16, DTRK) works correctly', () => {
    const event = buildUnitEvent(16);
    expect(checkTriggerEvent(event, createState({ builtUnitTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtUnitTypes: new Set(['DTRK']) }))).toBe(true);
  });
});
