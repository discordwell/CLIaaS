/**
 * C++ behavioral parity tests for TEVENT_BUILD_AIRCRAFT (type=22).
 *
 * C++ reference: TRIGGER.CPP — TEVENT_BUILD_AIRCRAFT fires when the player builds
 * a specific aircraft type. event.data maps to AircraftType enum index, which is
 * resolved via AIRCRAFT_TYPE_NAMES to a string and checked against
 * state.builtAircraftTypes. If the index is unknown (no mapping), C++ falls back
 * to "has the player built ANY aircraft?" (builtAircraftTypes.size > 0).
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** TEVENT_BUILD_AIRCRAFT constant — must equal 22 per C++ tevent.h */
const TEVENT_BUILD_AIRCRAFT = 22;

/**
 * Full AIRCRAFT_TYPE_NAMES mapping (mirrors scenario.ts / C++ AircraftType enum).
 * Used here as the authoritative reference for index-to-name tests.
 */
const EXPECTED_AIRCRAFT_TYPE_NAMES: Record<number, string> = {
  0: 'TRAN', 1: 'BADR', 2: 'U2', 3: 'MIG', 4: 'YAK', 5: 'HELI', 6: 'HIND',
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

/** Helper: create a TEVENT_BUILD_AIRCRAFT event with the given data index. */
const buildAircraftEvent = (dataIndex: number): TriggerEvent => ({
  type: TEVENT_BUILD_AIRCRAFT,
  team: -1,
  data: dataIndex,
});

describe('C++ parity: TEVENT_BUILD_AIRCRAFT (type=22)', () => {
  // ── Constant verification ───────────────────────────────────────────
  it('TEVENT_BUILD_AIRCRAFT constant equals 22', () => {
    // Verify by calling checkTriggerEvent with type=22 and a matching state;
    // if the constant were wrong, this would return false via the default case.
    const event = buildAircraftEvent(0); // data=0 → 'TRAN'
    const state = createState({ builtAircraftTypes: new Set(['TRAN']) });
    expect(event.type).toBe(22);
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── False when aircraft not yet built ───────────────────────────────
  it('returns false when the specified aircraft type has NOT been built', () => {
    const event = buildAircraftEvent(3); // data=3 → 'MIG'
    const state = createState({ builtAircraftTypes: new Set() });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns false when a different aircraft type has been built', () => {
    const event = buildAircraftEvent(3); // data=3 → 'MIG'
    const state = createState({ builtAircraftTypes: new Set(['HELI', 'TRAN']) });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  // ── True when aircraft has been built ───────────────────────────────
  it('returns true when the specified aircraft type HAS been built', () => {
    const event = buildAircraftEvent(3); // data=3 → 'MIG'
    const state = createState({ builtAircraftTypes: new Set(['MIG']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('returns true when multiple types built and specified is among them', () => {
    const event = buildAircraftEvent(5); // data=5 → 'HELI'
    const state = createState({ builtAircraftTypes: new Set(['TRAN', 'MIG', 'HELI', 'HIND']) });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  // ── Correct index → name mapping for every defined entry ───────────
  describe('index-to-name mapping matches C++ AircraftType enum', () => {
    for (const [indexStr, expectedName] of Object.entries(EXPECTED_AIRCRAFT_TYPE_NAMES)) {
      const index = Number(indexStr);
      it(`data=${index} maps to '${expectedName}'`, () => {
        const event = buildAircraftEvent(index);
        // State where ONLY expectedName has been built
        const stateWithAircraft = createState({ builtAircraftTypes: new Set([expectedName]) });
        const stateWithout = createState({ builtAircraftTypes: new Set() });

        expect(
          checkTriggerEvent(event, stateWithAircraft),
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
  describe('fallback for unknown aircraft index (no AIRCRAFT_TYPE_NAMES entry)', () => {
    // C++ behavior: when event.data doesn't map to a known AircraftType name,
    // the trigger fires if ANY aircraft has been built (builtAircraftTypes.size > 0).
    const unknownIndex = 99; // well beyond defined range (0-6)

    it('returns false when unknown index and no aircraft built at all', () => {
      const event = buildAircraftEvent(unknownIndex);
      const state = createState({ builtAircraftTypes: new Set() });
      expect(checkTriggerEvent(event, state)).toBe(false);
    });

    it('returns true when unknown index and at least one aircraft has been built', () => {
      const event = buildAircraftEvent(unknownIndex);
      const state = createState({ builtAircraftTypes: new Set(['TRAN']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('returns true when unknown index and many aircraft built', () => {
      const event = buildAircraftEvent(unknownIndex);
      const state = createState({ builtAircraftTypes: new Set(['TRAN', 'MIG', 'HELI']) });
      expect(checkTriggerEvent(event, state)).toBe(true);
    });

    it('fallback applies for index just past last defined entry (7)', () => {
      const event = buildAircraftEvent(7);
      const stateEmpty = createState({ builtAircraftTypes: new Set() });
      const stateAny = createState({ builtAircraftTypes: new Set(['HIND']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });

    it('fallback applies for negative index (-1)', () => {
      const event = buildAircraftEvent(-1);
      const stateEmpty = createState({ builtAircraftTypes: new Set() });
      const stateAny = createState({ builtAircraftTypes: new Set(['YAK']) });
      expect(checkTriggerEvent(event, stateEmpty)).toBe(false);
      expect(checkTriggerEvent(event, stateAny)).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────
  it('does not cross-match with unit or infantry types in builtAircraftTypes', () => {
    // Even if units/infantry are built, BUILD_AIRCRAFT only checks builtAircraftTypes
    const event = buildAircraftEvent(0); // data=0 → 'TRAN'
    const state = createState({
      builtAircraftTypes: new Set(),
      builtUnitTypes: new Set(['HARV', '1TNK']),
      builtInfantryTypes: new Set(['E1', 'E2']),
    });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('first entry (data=0, TRAN) works correctly', () => {
    const event = buildAircraftEvent(0);
    expect(checkTriggerEvent(event, createState({ builtAircraftTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtAircraftTypes: new Set(['TRAN']) }))).toBe(true);
  });

  it('last defined entry (data=6, HIND) works correctly', () => {
    const event = buildAircraftEvent(6);
    expect(checkTriggerEvent(event, createState({ builtAircraftTypes: new Set() }))).toBe(false);
    expect(checkTriggerEvent(event, createState({ builtAircraftTypes: new Set(['HIND']) }))).toBe(true);
  });
});
