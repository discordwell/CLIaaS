/**
 * C++ behavioral parity tests for TEVENT_DISCOVERED (type=4).
 *
 * C++ source: TEVENT.H line 50 — TEVENT_DISCOVERED = 4
 * C++ behavior: fires when an object with this trigger attached is first
 *   revealed by the opposing side. techno.cpp:786 calls
 *   Trigger->Spring(TEVENT_DISCOVERED, this) from Revealed().
 *   techno.cpp:3899 also calls it from Record_The_Kill().
 *
 * After parity fix #21, TEVENT_DISCOVERED uses its own `objectDiscovered` flag,
 * separate from TEVENT_PLAYER_ENTERED's `playerEntered`.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  type TriggerGameState,
  type TriggerEvent,
} from '../engine/scenario';

/** Minimal TriggerGameState factory with sensible defaults. */
const createState = (overrides: Partial<TriggerGameState> = {}): TriggerGameState => ({
  gameTick: 0,
  globals: new Set(),
  triggerStartTick: 0,
  triggerName: 'test',
  playerEntered: false,
  objectDiscovered: false,
  houseDiscovered: new Map(),
  enteredZone: false,
  crossedHorizontal: false,
  crossedVertical: false,
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

const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_DISCOVERED = 4;

describe('TEVENT_DISCOVERED (type=4) — C++ behavioral parity', () => {
  it('constant value is 4 (C++ TEVENT.H enum index)', () => {
    // TEVENT_DISCOVERED sits at index 4 in the C++ TEventType enum.
    // This test guards against accidental renumbering.
    expect(TEVENT_DISCOVERED).toBe(4);
  });

  it('returns false when objectDiscovered is false', () => {
    const event: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const state = createState({ objectDiscovered: false });
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('returns true when objectDiscovered is true', () => {
    // C++ techno.cpp:786: Trigger->Spring(TEVENT_DISCOVERED, this)
    const event: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const state = createState({ objectDiscovered: true });
    expect(checkTriggerEvent(event, state)).toBe(true);
  });

  it('uses objectDiscovered — independent from PLAYER_ENTERED (fix #21)', () => {
    // After fix #21, TEVENT_DISCOVERED uses objectDiscovered, not playerEntered.
    // TEVENT_PLAYER_ENTERED still uses playerEntered.
    const discoveredEvent: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data: 0 };
    const playerEnteredEvent: TriggerEvent = { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 };

    // objectDiscovered=true, playerEntered=false
    const stateDiscOnly = createState({ objectDiscovered: true, playerEntered: false });
    expect(checkTriggerEvent(discoveredEvent, stateDiscOnly)).toBe(true);
    expect(checkTriggerEvent(playerEnteredEvent, stateDiscOnly)).toBe(false);

    // playerEntered=true, objectDiscovered=false
    const stateEnteredOnly = createState({ playerEntered: true, objectDiscovered: false });
    expect(checkTriggerEvent(discoveredEvent, stateEnteredOnly)).toBe(false);
    expect(checkTriggerEvent(playerEnteredEvent, stateEnteredOnly)).toBe(true);
  });

  it('event.data is ignored — only objectDiscovered matters', () => {
    // C++ DISCOVERED does not use the data parameter in tevent.cpp operator();
    // the gate check only requires event == TEVENT_DISCOVERED.
    for (const data of [0, 1, 42, 255, -1]) {
      const event: TriggerEvent = { type: TEVENT_DISCOVERED, team: -1, data };
      expect(checkTriggerEvent(event, createState({ objectDiscovered: false }))).toBe(false);
      expect(checkTriggerEvent(event, createState({ objectDiscovered: true }))).toBe(true);
    }
  });
});
