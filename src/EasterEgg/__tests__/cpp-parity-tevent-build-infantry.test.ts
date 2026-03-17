/**
 * C++ behavioral parity tests for TEVENT_BUILD_INFANTRY (type=21).
 *
 * C++ reference: TRIGGER.CPP — TEVENT_BUILD_INFANTRY fires when the player builds
 * a specific infantry type. event.data maps to InfantryType enum index, which is
 * resolved via INFANTRY_TYPE_NAMES to a string and checked against
 * state.builtInfantryTypes. If the index is unknown (no mapping), C++ falls back
 * to "has the player built ANY infantry?" (builtInfantryTypes.size > 0).
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** TEVENT_BUILD_INFANTRY constant — must equal 21 per C++ tevent.h */
const TEVENT_BUILD_INFANTRY = 21;

/**
 * Full INFANTRY_TYPE_NAMES mapping (mirrors scenario.ts / C++ InfantryType enum).
 * Used here as the authoritative reference for index-to-name tests.
 */
const EXPECTED_INFANTRY_TYPE_NAMES: Record<number, string> = {
  0: 'E1', 1: 'E2', 2: 'E3', 3: 'E4', 4: 'E6',
  5: 'E7', 6: 'SPY', 7: 'THF', 8: 'MEDI', 9: 'GNRL',
  10: 'DOG', 11: 'C1', 12: 'C2', 13: 'C3', 14: 'C4', 15: 'C5',
  16: 'C6', 17: 'C7', 18: 'C8', 19: 'C9', 20: 'C10',
  21: 'EINSTEIN', 22: 'SHOK', 23: 'MECH', 24: 'CHAN',
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

/** Helper: create a TEVENT_BUILD_INFANTRY event with the given data index. */
const buildInfantryEvent = (dataIndex: number): TriggerEvent => ({
  type: TEVENT_BUILD_INFANTRY,
  team: -1,
  data: dataIndex,
});

describe('C++ parity: TEVENT_BUILD_INFANTRY (type=21)', () => {
  // ── Constant verification ───────────────────────────────────────────
  it('TEVENT_BUILD_INFANTRY constant equals 21', () => {
    // Verify by calling checkTriggerEvent with type=21 and a matching state;
    // if the constant were wrong, this would return false via the default case.
    const event = buildInfantryEvent(0); // data=0 → 'E1'
    const state = createState({ builtInfantryTypes: new Set(['E1']) });
    expect(event.type).toBe(21);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── False when infantry not yet built ─────────────────────────────
  it('returns false when the specified infantry type has NOT been built', () => {
    const event = buildInfantryEvent(2); // data=2 → 'E3'
    const state = createState({ builtInfantryTypes: new Set() });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false when a different infantry type has been built', () => {
    const event = buildInfantryEvent(2); // data=2 → 'E3'
    const state = createState({ builtInfantryTypes: new Set(['E1', 'E4']) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // ── True when infantry has been built ─────────────────────────────
  it('returns true when the specified infantry type HAS been built', () => {
    const event = buildInfantryEvent(2); // data=2 → 'E3'
    const state = createState({ builtInfantryTypes: new Set(['E3']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when multiple types built and specified is among them', () => {
    const event = buildInfantryEvent(6); // data=6 → 'SPY'
    const state = createState({ builtInfantryTypes: new Set(['E1', 'E3', 'SPY', 'DOG']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── Correct index → name mapping for every defined entry ──────────
  describe('index-to-name mapping matches C++ InfantryType enum', () => {
    for (const [indexStr, expectedName] of Object.entries(EXPECTED_INFANTRY_TYPE_NAMES)) {
      const index = Number(indexStr);
      it(`data=${index} maps to '${expectedName}'`, () => {
        const event = buildInfantryEvent(index);
        // State where ONLY expectedName has been built
        const stateWithInfantry = createState({ builtInfantryTypes: new Set([expectedName]) });
        const stateWithout = createState({ builtInfantryTypes: new Set() });

        expect(
          checkTriggerEvent(event, stateWithInfantry),
          `data=${index} should match '${expectedName}' when built`,
        ).toBe(true);
        expect(
          checkTriggerEvent(event, stateWithout),
          `data=${index} should NOT match when '${expectedName}' not built`,
        ).toBe(false);
      });
    }
  });

  // ── Fallback for unknown / unmapped index ─────────────────────────
  describe('fallback for unknown infantry index (no INFANTRY_TYPE_NAMES entry)', () => {
    // C++ behavior: when event.data doesn't map to a known InfantryType name,
    // the trigger fires if ANY infantry has been built (builtInfantryTypes.size > 0).
    const unknownIndex = 99; // well beyond defined range (0-24)

    it('returns false when unknown index and no infantry built at all', () => {
      const event = buildInfantryEvent(unknownIndex);
      const state = createState({ builtInfantryTypes: new Set() });
      expect(checkTriggerEvent(event, state)).toBe(false);
    });

    it('returns true when unknown index and at least one infantry has been built', () => {
      const event = buildInfantryEvent(unknownIndex);
      const state = createState({ builtInfantryTypes: new Set(['E1']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('returns true when unknown index and many infantry built', () => {
      const event = buildInfantryEvent(unknownIndex);
      const state = createState({ builtInfantryTypes: new Set(['E1', 'E3', 'SPY', 'DOG']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('fallback applies for index just past last defined entry (25)', () => {
      const event = buildInfantryEvent(25);
      const stateEmpty = createState({ builtInfantryTypes: new Set() });
      const stateAny = createState({ builtInfantryTypes: new Set(['MEDI']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });

    it('fallback applies for negative index (-1)', () => {
      const event = buildInfantryEvent(-1);
      const stateEmpty = createState({ builtInfantryTypes: new Set() });
      const stateAny = createState({ builtInfantryTypes: new Set(['E4']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });
  });

  // ── No cross-contamination with builtUnitTypes ────────────────────
  it('does not cross-match with unit or aircraft types in builtInfantryTypes', () => {
    // Even if units/aircraft are built, BUILD_INFANTRY only checks builtInfantryTypes
    const event = buildInfantryEvent(0); // data=0 → 'E1'
    const state = createState({
      builtInfantryTypes: new Set(),
      builtUnitTypes: new Set(['HARV', '1TNK', 'APC']),
      builtAircraftTypes: new Set(['HELI', 'MIG']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('unknown index fallback does not fire from builtUnitTypes having entries', () => {
    // The fallback checks builtInfantryTypes.size > 0, not builtUnitTypes
    const event = buildInfantryEvent(99);
    const state = createState({
      builtInfantryTypes: new Set(),
      builtUnitTypes: new Set(['HARV', '1TNK']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────
  it('first entry (data=0, E1) works correctly', () => {
    const event = buildInfantryEvent(0);
    expect(checkTriggerEvent(event, createState({ builtInfantryTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtInfantryTypes: new Set(['E1']) }))).toBe(true);
  });

  it('last defined entry (data=24, CHAN) works correctly', () => {
    const event = buildInfantryEvent(24);
    expect(checkTriggerEvent(event, createState({ builtInfantryTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtInfantryTypes: new Set(['CHAN']) }))).toBe(true);
  });
});
