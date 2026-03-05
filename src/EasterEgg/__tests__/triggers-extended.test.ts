/**
 * Tests for extended trigger system events and actions (Gap #3).
 * Verifies: TEVENT constants, TACTION constants, TriggerGameState fields.
 * Updated to match C++ tevent.h/taction.h enum indices (TR5 parity fix).
 */

import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  executeTriggerAction,
  type TriggerGameState,
  type TriggerEvent,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';

describe('Extended Trigger Events', () => {
  // Helper to create a minimal TriggerGameState with all required fields
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
    houseAlive: new Map(),
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
    ...overrides,
  });

  it('TEVENT_HOUSE_DISCOVERED (5): returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 5, team: -1, data: 0 }; // C++ TEVENT_HOUSE_DISCOVERED = 5
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_LOW_POWER (30): returns true when isLowPower is true', () => {
    const event: TriggerEvent = { type: 30, team: -1, data: 0 }; // C++ TEVENT_LOW_POWER = 30
    const stateNoPower = createState({ isLowPower: false });
    const stateLowPower = createState({ isLowPower: true });

    expect(checkTriggerEvent(event, stateNoPower)).toBe(false);
    expect(checkTriggerEvent(event, stateLowPower)).toBe(true);
  });

  it('TEVENT_THIEVED (3): always returns false (not implemented)', () => {
    const event: TriggerEvent = { type: 3, team: -1, data: 0 }; // C++ TEVENT_THIEVED = 3
    const state = createState();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_CROSS_HORIZONTAL (25): returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 25, team: -1, data: 0 }; // C++ TEVENT_CROSS_HORIZONTAL = 25
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_CROSS_VERTICAL (26): returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 26, team: -1, data: 0 }; // C++ TEVENT_CROSS_VERTICAL = 26
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_UNITS_DESTROYED (9): returns true when house units all destroyed', () => {
    // C++ TEVENT_UNITS_DESTROYED = 9, data = house index
    const event: TriggerEvent = { type: 9, team: -1, data: 2 };
    const stateAlive = createState({ houseAlive: new Map([[2, true]]) });
    const stateDestroyed = createState({ houseAlive: new Map([[2, false]]) });

    expect(checkTriggerEvent(event, stateAlive)).toBe(false);
    expect(checkTriggerEvent(event, stateDestroyed)).toBe(true);
  });

  it('TEVENT_DESTROYED (7): fires when attached entity triggerName is in destroyedTriggerNames', () => {
    const event: TriggerEvent = { type: 7, team: -1, data: 0 }; // C++ TEVENT_DESTROYED = 7
    // Trigger named 'eins' — entity with triggerName='eins' was destroyed
    const stateNotDestroyed = createState({ triggerName: 'eins', destroyedTriggerNames: new Set() });
    const stateDestroyed = createState({ triggerName: 'eins', destroyedTriggerNames: new Set(['eins']) });

    expect(checkTriggerEvent(event, stateNotDestroyed)).toBe(false);
    expect(checkTriggerEvent(event, stateDestroyed)).toBe(true);
  });

  it('TEVENT_CREDITS (12): returns true when playerCredits >= data', () => {
    const event: TriggerEvent = { type: 12, team: -1, data: 1000 }; // C++ TEVENT_CREDITS = 12
    const stateLow = createState({ playerCredits: 500 });
    const stateExact = createState({ playerCredits: 1000 });
    const stateHigh = createState({ playerCredits: 1500 });

    expect(checkTriggerEvent(event, stateLow)).toBe(false);
    expect(checkTriggerEvent(event, stateExact)).toBe(true);
    expect(checkTriggerEvent(event, stateHigh)).toBe(true);
  });
});

describe('Extended Trigger Actions', () => {
  // Helper to create minimal parameters for executeTriggerAction
  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  it('TACTION_FIRE_SALE (9): sets fireSale flag in result', () => {
    // C++ TACTION_FIRE_SALE = 9 (was TACTION_AIRSTRIKE at wrong index)
    const action: TriggerAction = { action: 9, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.fireSale).toBe(true);
  });

  it('TACTION_PLAY_MOVIE (10): sets playMovie in result', () => {
    // C++ TACTION_PLAY_MOVIE = 10 (was TACTION_NUKE at wrong index)
    const action: TriggerAction = { action: 10, team: -1, trigger: -1, data: 5 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.playMovie).toBe(5);
  });

  it('TACTION_REVEAL_MAP (16): sets revealAll flag in result', () => {
    const action: TriggerAction = { action: 16, team: -1, trigger: -1, data: 0 }; // TACTION_REVEAL_ALL = 16
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.revealAll).toBe(true);
  });

  it('TACTION_REVEAL_ZONE (18): sets revealZone in result', () => {
    // C++ TACTION_REVEAL_ZONE = 18 (was TACTION_CENTER_VIEW at wrong index)
    const action: TriggerAction = { action: 18, team: -1, trigger: -1, data: 42 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.revealZone).toBe(42);
  });

  it('TACTION_LAUNCH_NUKES (36): sets nuke flag in result', () => {
    // C++ TACTION_LAUNCH_NUKES = 36 (was TACTION_NUKE=10 at wrong index)
    const action: TriggerAction = { action: 36, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.nuke).toBe(true);
  });
});

describe('TriggerGameState Interface', () => {
  it('includes isLowPower and playerCredits fields', () => {
    const state: TriggerGameState = {
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
      houseAlive: new Map(),
      isLowPower: true,
      playerCredits: 5000,
      buildingsDestroyedByHouse: new Map(),
      nBuildingsDestroyed: 0,
      playerFactoriesExist: true,
      civiliansEvacuated: 0,
      builtUnitTypes: new Set(),
      builtInfantryTypes: new Set(),
      builtAircraftTypes: new Set(),
      fakesExist: true,
      spiedBuildings: new Set(),
    };

    expect(state.isLowPower).toBe(true);
    expect(state.playerCredits).toBe(5000);
  });
});
