/**
 * Tests for extended trigger system events and actions (Gap #3).
 * Verifies: new TEVENT constants, new TACTION constants, TriggerGameState fields.
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
  // Helper to create a minimal TriggerGameState
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
    ...overrides,
  });

  it('TEVENT_HOUSE_DISCOVERED: returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 3, team: -1, data: 0 }; // TEVENT_HOUSE_DISCOVERED = 3
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_LOW_POWER: returns true when isLowPower is true', () => {
    const event: TriggerEvent = { type: 15, team: -1, data: 0 }; // TEVENT_LOW_POWER = 15
    const stateNoPower = createState({ isLowPower: false });
    const stateLowPower = createState({ isLowPower: true });

    expect(checkTriggerEvent(event, stateNoPower)).toBe(false);
    expect(checkTriggerEvent(event, stateLowPower)).toBe(true);
  });

  it('TEVENT_THIEVED: always returns false (not implemented)', () => {
    const event: TriggerEvent = { type: 17, team: -1, data: 0 }; // TEVENT_THIEVED = 17
    const state = createState();
    expect(checkTriggerEvent(event, state)).toBe(false);
  });

  it('TEVENT_CROSS_HORIZONTAL: returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 21, team: -1, data: 0 }; // TEVENT_CROSS_HORIZONTAL = 21
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_CROSS_VERTICAL: returns true when playerEntered is true', () => {
    const event: TriggerEvent = { type: 22, team: -1, data: 0 }; // TEVENT_CROSS_VERTICAL = 22
    const stateNotEntered = createState({ playerEntered: false });
    const stateEntered = createState({ playerEntered: true });

    expect(checkTriggerEvent(event, stateNotEntered)).toBe(false);
    expect(checkTriggerEvent(event, stateEntered)).toBe(true);
  });

  it('TEVENT_UNITS_DESTROYED: returns true when enemyKillCount >= data', () => {
    const event: TriggerEvent = { type: 26, team: -1, data: 5 }; // TEVENT_UNITS_DESTROYED = 26
    const stateLow = createState({ enemyKillCount: 3 });
    const stateExact = createState({ enemyKillCount: 5 });
    const stateHigh = createState({ enemyKillCount: 7 });

    expect(checkTriggerEvent(event, stateLow)).toBe(false);
    expect(checkTriggerEvent(event, stateExact)).toBe(true);
    expect(checkTriggerEvent(event, stateHigh)).toBe(true);
  });

  it('TEVENT_CREDITS: returns true when playerCredits >= data', () => {
    const event: TriggerEvent = { type: 30, team: -1, data: 1000 }; // TEVENT_CREDITS = 30
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

  it('TACTION_AIRSTRIKE: sets airstrike flag in result', () => {
    const action: TriggerAction = { action: 9, team: -1, trigger: -1, data: 0 }; // TACTION_AIRSTRIKE = 9
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.airstrike).toBe(true);
  });

  it('TACTION_NUKE: sets nuke flag in result', () => {
    const action: TriggerAction = { action: 10, team: -1, trigger: -1, data: 0 }; // TACTION_NUKE = 10
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.nuke).toBe(true);
  });

  it('TACTION_REVEAL_MAP: sets revealAll flag in result', () => {
    const action: TriggerAction = { action: 16, team: -1, trigger: -1, data: 0 }; // TACTION_REVEAL_MAP = 16
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.revealAll).toBe(true);
  });

  it('TACTION_CENTER_VIEW: sets centerView to waypoint index', () => {
    const action: TriggerAction = { action: 18, team: -1, trigger: -1, data: 42 }; // TACTION_CENTER_VIEW = 18
    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    expect(result.centerView).toBe(42);
  });

  it('TACTION_CHANGE_HOUSE: logs warning (no-op for ant missions)', () => {
    const action: TriggerAction = { action: 26, team: -1, trigger: -1, data: 0 }; // TACTION_CHANGE_HOUSE = 26
    // Capture console.warn to verify warning is logged
    const originalWarn = console.warn;
    let warnMessage = '';
    console.warn = (msg: string) => { warnMessage = msg; };

    const result = executeTriggerAction(action, emptyTeamTypes, emptyWaypoints, emptyGlobals, emptyTriggers);

    console.warn = originalWarn; // Restore

    expect(warnMessage).toContain('TACTION_CHANGE_HOUSE');
    expect(result.spawned).toEqual([]); // no entities spawned
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
    };

    expect(state.isLowPower).toBe(true);
    expect(state.playerCredits).toBe(5000);
  });
});
