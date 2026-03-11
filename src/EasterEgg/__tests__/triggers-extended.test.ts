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

  it('TEVENT_THIEVED (3): returns true when isThieved is set (C++ House.IsThieved)', () => {
    const event: TriggerEvent = { type: 3, team: -1, data: 0 }; // C++ TEVENT_THIEVED = 3
    const stateNotThieved = createState({ isThieved: false });
    expect(checkTriggerEvent(event, stateNotThieved)).toBe(false);
    const stateThieved = createState({ isThieved: true });
    expect(checkTriggerEvent(event, stateThieved)).toBe(true);
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

  it('TEVENT_UNITS_DESTROYED (9): returns true when house units all destroyed (not buildings)', () => {
    // C++ TEVENT_UNITS_DESTROYED = 9, data = house index
    const event: TriggerEvent = { type: 9, team: -1, data: 2 };
    // Units alive → false
    const stateAlive = createState({ houseUnitsAlive: new Map([[2, true]]) });
    expect(checkTriggerEvent(event, stateAlive)).toBe(false);
    // Units dead → true (even if houseAlive is true due to buildings)
    const stateUnitsDeadBuildingsAlive = createState({
      houseUnitsAlive: new Map([[2, false]]),
      houseAlive: new Map([[2, true]]),
    });
    expect(checkTriggerEvent(event, stateUnitsDeadBuildingsAlive)).toBe(true);
    // No units ever → true
    const stateNoUnits = createState({ houseUnitsAlive: new Map() });
    expect(checkTriggerEvent(event, stateNoUnits)).toBe(true);
  });

  it('TEVENT_DESTROYED (7): fires when attached entity triggerName is in destroyedTriggerNames', () => {
    const event: TriggerEvent = { type: 7, team: -1, data: 0 }; // C++ TEVENT_DESTROYED = 7
    // Trigger named 'eins' — entity with triggerName='eins' was destroyed
    const stateNotDestroyed = createState({ triggerName: 'eins', destroyedTriggerNames: new Set() });
    const stateDestroyed = createState({ triggerName: 'eins', destroyedTriggerNames: new Set(['eins']), pendingDestroyedCount: 1 });

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
  it('includes isLowPower, playerCredits, and new tracking fields', () => {
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
      attackedTriggerNames: new Set(['trig1']),
      houseAlive: new Map(),
      houseUnitsAlive: new Map([[2, true]]),
      houseBuildingsAlive: new Map([[2, true]]),
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
      isThieved: false,
    };

    expect(state.isLowPower).toBe(true);
    expect(state.playerCredits).toBe(5000);
    expect(state.attackedTriggerNames.has('trig1')).toBe(true);
    expect(state.houseUnitsAlive.get(2)).toBe(true);
    expect(state.houseBuildingsAlive.get(2)).toBe(true);
  });
});

describe('Trigger Audit Fixes', () => {
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
    ...overrides,
  });

  const emptyTeamTypes: TeamType[] = [];
  const emptyWaypoints = new Map<number, CellPos>();
  const emptyGlobals = new Set<number>();
  const emptyTriggers: ScenarioTrigger[] = [];

  // --- Event fixes ---

  it('TEVENT_ATTACKED (6): fires only when attackedTriggerNames contains trigger name', () => {
    const event: TriggerEvent = { type: 6, team: -1, data: 0 };
    // Not attacked yet — should not fire even with high kill count
    const stateNotAttacked = createState({
      triggerName: 'myTrig',
      attackedTriggerNames: new Set(),
      enemyKillCount: 99,
    });
    expect(checkTriggerEvent(event, stateNotAttacked)).toBe(false);
    // Attacked — should fire
    const stateAttacked = createState({
      triggerName: 'myTrig',
      attackedTriggerNames: new Set(['myTrig']),
    });
    expect(checkTriggerEvent(event, stateAttacked)).toBe(true);
    // Different trigger name attacked — should not fire
    const stateOtherAttacked = createState({
      triggerName: 'myTrig',
      attackedTriggerNames: new Set(['otherTrig']),
    });
    expect(checkTriggerEvent(event, stateOtherAttacked)).toBe(false);
  });

  it('TEVENT_BUILDINGS_DESTROYED (10): fires when buildingsDestroyedByHouse has house=true', () => {
    const event: TriggerEvent = { type: 10, team: -1, data: 2 }; // house index 2 = USSR
    const stateNotDestroyed = createState({ buildingsDestroyedByHouse: new Map() });
    expect(checkTriggerEvent(event, stateNotDestroyed)).toBe(false);
    const stateDestroyed = createState({ buildingsDestroyedByHouse: new Map([[2, true]]) });
    expect(checkTriggerEvent(event, stateDestroyed)).toBe(true);
  });

  it('TEVENT_NBUILDINGS_DESTROYED (15): fires when count >= threshold', () => {
    const event: TriggerEvent = { type: 15, team: -1, data: 5 };
    const stateBelowThreshold = createState({ nBuildingsDestroyed: 4 });
    expect(checkTriggerEvent(event, stateBelowThreshold)).toBe(false);
    const stateAtThreshold = createState({ nBuildingsDestroyed: 5 });
    expect(checkTriggerEvent(event, stateAtThreshold)).toBe(true);
    const stateAboveThreshold = createState({ nBuildingsDestroyed: 10 });
    expect(checkTriggerEvent(event, stateAboveThreshold)).toBe(true);
  });

  it('TEVENT_SPIED (2): fires when spiedBuildings contains trigger name', () => {
    const event: TriggerEvent = { type: 2, team: -1, data: 0 };
    const stateNotSpied = createState({ triggerName: 'spyTarget', spiedBuildings: new Set() });
    expect(checkTriggerEvent(event, stateNotSpied)).toBe(false);
    const stateSpied = createState({ triggerName: 'spyTarget', spiedBuildings: new Set(['spyTarget']) });
    expect(checkTriggerEvent(event, stateSpied)).toBe(true);
  });

  // --- New action types ---

  it('TACTION_DESTROY_TEAM (5): sets destroyTeam in result', () => {
    const action: TriggerAction = { action: 5, team: 3, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.destroyTeam).toBe(3);
  });

  it('TACTION_START_TIMER (23): sets startTimer flag', () => {
    const action: TriggerAction = { action: 23, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.startTimer).toBe(true);
  });

  it('TACTION_STOP_TIMER (24): sets stopTimer flag', () => {
    const action: TriggerAction = { action: 24, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.stopTimer).toBe(true);
  });

  it('TACTION_SUB_TIMER (26): sets timerSubtract in result', () => {
    const action: TriggerAction = { action: 26, team: -1, trigger: -1, data: 10 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.timerSubtract).toBe(10);
  });

  it('TACTION_1_SPECIAL (33): sets oneSpecial flag', () => {
    const action: TriggerAction = { action: 33, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.oneSpecial).toBe(true);
  });

  it('TACTION_FULL_SPECIAL (34): sets fullSpecial flag', () => {
    const action: TriggerAction = { action: 34, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.fullSpecial).toBe(true);
  });

  it('TACTION_DESTROY_OBJECT (32): sets destroyTriggeringUnit flag', () => {
    const action: TriggerAction = { action: 32, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);
    expect(result.destroyTriggeringUnit).toBe(true);
  });
});
