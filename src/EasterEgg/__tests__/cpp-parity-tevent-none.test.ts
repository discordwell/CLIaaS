/**
 * C++ Behavioral Parity: TEVENT_NONE (type=0) — the "no event" trigger event
 *
 * Tests verify TEVENT_NONE behavior matches C++ RA source code.
 * C++ behavior: TEVENT_NONE returns FALSE (confirmed via WASM). It acts as "no event condition
 * required" — the trigger fires unconditionally (unless gated by eventControl).
 *
 * Source: TEVENT.H:46 (enum value 0), scenario.cpp TriggerEventClass::operator()
 * In Red Alert C++, TEVENT_NONE is the "no event" case — triggers with it only fire
 * via TACTION_FORCE_TRIGGER. Reinforcement triggers (frc1/frc2) in Allied missions.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerEvent,
  type TriggerGameState,
  checkTriggerEvent,
} from '../engine/scenario';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a default TriggerGameState with sensible defaults, applying overrides. */
export function makeGameState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
    gameTick: 0,
    globals: new Set<number>(),
    triggerStartTick: 0,
    triggerName: 'TEST',
    playerEntered: false,
    enemyUnitsAlive: 0,
    enemyKillCount: 0,
    playerFactories: 0,
    missionTimerExpired: false,
    bridgesAlive: 0,
    unitsLeftMap: 0,
    structureTypes: new Set<string>(),
    builtStructureTypes: new Set<string>(),
    builtStructureTypesByHouse: new Map([[1, new Set<string>()]]),
    destroyedTriggerNames: new Set<string>(),
    attackedTriggerNames: new Set<string>(),
    houseAlive: new Map<number, boolean>(),
    houseUnitsAlive: new Map<number, boolean>(),
    houseBuildingsAlive: new Map<number, boolean>(),
    isLowPower: false,
    playerCredits: 0,
    buildingsDestroyedByHouse: new Map<number, boolean>(),
    nBuildingsDestroyed: 0,
    playerFactoriesExist: false,
    civiliansEvacuated: 0,
    builtUnitTypes: new Set<string>(),
    builtInfantryTypes: new Set<string>(),
    builtAircraftTypes: new Set<string>(),
    fakesExist: false,
    spiedBuildings: new Set<string>(),
    isThieved: false,
    pendingDestroyedCount: 0,
    ...overrides,
  };
}

/** A TEVENT_NONE event with default fields. */
function noneEvent(overrides: Partial<TriggerEvent> = {}): TriggerEvent {
  return { type: 0, team: -1, data: 0, ...overrides };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TEVENT_NONE constant value (TEVENT.H:46)', () => {
  it('TEVENT_NONE has constant value 0', () => {
    // The event type field for TEVENT_NONE must be 0
    const event = noneEvent();
    expect(event.type).toBe(0);
  });
});

describe('TEVENT_NONE returns false (no event = no trigger) (C++ scenario.cpp operator())', () => {
  it('returns false with default/empty game state', () => {
    const result = checkTriggerEvent(noneEvent(), makeGameState());
    expect(result).toBe(false);
  });

  it('returns false regardless of gameTick value', () => {
    expect(checkTriggerEvent(noneEvent(), makeGameState({ gameTick: 0 }))).toBe(false);
    expect(checkTriggerEvent(noneEvent(), makeGameState({ gameTick: 1 }))).toBe(false);
    expect(checkTriggerEvent(noneEvent(), makeGameState({ gameTick: 100 }))).toBe(false);
    expect(checkTriggerEvent(noneEvent(), makeGameState({ gameTick: 999999 }))).toBe(false);
  });

  it('returns false regardless of globals state', () => {
    expect(checkTriggerEvent(noneEvent(), makeGameState({ globals: new Set([0, 1, 2, 3, 27]) }))).toBe(false);
  });

  it('returns false regardless of triggerStartTick', () => {
    expect(checkTriggerEvent(noneEvent(), makeGameState({ triggerStartTick: 0 }))).toBe(false);
    expect(checkTriggerEvent(noneEvent(), makeGameState({ triggerStartTick: 5000 }))).toBe(false);
  });

  it('returns false even when playerEntered is true', () => {
    expect(checkTriggerEvent(noneEvent(), makeGameState({ playerEntered: true }))).toBe(false);
  });

  it('returns false even when missionTimerExpired is true', () => {
    expect(checkTriggerEvent(noneEvent(), makeGameState({ missionTimerExpired: true }))).toBe(false);
  });

  it('returns false even when every other condition is true', () => {
    const saturatedState = makeGameState({
      gameTick: 999999,
      globals: new Set([0, 1, 2, 3, 4, 5, 27, 28]),
      triggerStartTick: 0,
      triggerName: 'TEST',
      playerEntered: true,
      enemyUnitsAlive: 0,
      enemyKillCount: 500,
      playerFactories: 10,
      missionTimerExpired: true,
      bridgesAlive: 0,
      unitsLeftMap: 50,
      structureTypes: new Set(['FACT', 'WEAP', 'TENT', 'POWR']),
      builtStructureTypes: new Set(['FACT', 'WEAP', 'TENT']),
      destroyedTriggerNames: new Set(['TEST']),
      attackedTriggerNames: new Set(['TEST']),
      houseAlive: new Map([[0, false], [1, false]]),
      houseUnitsAlive: new Map([[0, false], [1, false]]),
      houseBuildingsAlive: new Map([[0, false], [1, false]]),
      isLowPower: true,
      playerCredits: 100000,
      buildingsDestroyedByHouse: new Map([[0, true], [1, true]]),
      nBuildingsDestroyed: 100,
      playerFactoriesExist: true,
      civiliansEvacuated: 10,
      builtUnitTypes: new Set(['2TNK', 'HARV']),
      builtInfantryTypes: new Set(['E1', 'E3']),
      builtAircraftTypes: new Set(['HELI', 'HIND']),
      fakesExist: false,
      spiedBuildings: new Set(['TEST']),
      isThieved: true,
      pendingDestroyedCount: 5,
    });
    expect(checkTriggerEvent(noneEvent(), saturatedState)).toBe(false);
  });

  it('returns false with non-zero event.data', () => {
    expect(checkTriggerEvent(noneEvent({ data: 42 }), makeGameState())).toBe(false);
    expect(checkTriggerEvent(noneEvent({ data: 255 }), makeGameState())).toBe(false);
  });

  it('returns false with non-default event.team', () => {
    expect(checkTriggerEvent(noneEvent({ team: 0 }), makeGameState())).toBe(false);
    expect(checkTriggerEvent(noneEvent({ team: 5 }), makeGameState())).toBe(false);
  });
});
