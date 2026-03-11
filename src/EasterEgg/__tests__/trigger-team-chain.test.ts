/**
 * Trigger-team chain tests — verify C++ parity for DESTROYED event chaining.
 *
 * C++ behavior (ScenarioClass::Create_Army):
 *   When a team is spawned, each member gets the team's Trigger field assigned.
 *   When those units die, the DESTROYED event fires for the linked trigger,
 *   enabling spawn → kill → respawn chains (e.g., SCA02EA ant waves).
 *
 * C++ behavior (TriggerClass::Spring):
 *   DESTROYED is a one-shot event (Spring flag). After consumption, a NEW death
 *   must occur to re-arm. Persistent triggers don't fire every tick.
 *
 * Bugs fixed:
 *   1. TeamType.trigger field not parsed → spawned entities lacked triggerName
 *   2. DESTROYED event was cumulative (not one-shot) → persistent triggers
 *      fired every processTriggers tick instead of once per death
 */
import { describe, it, expect } from 'vitest';
import {
  checkTriggerEvent,
  executeTriggerAction,
  type TriggerGameState,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';
import { House } from '../engine/types';

function createState(overrides: Partial<TriggerGameState> = {}): TriggerGameState {
  return {
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
    fakesExist: false,
    spiedBuildings: new Set(),
    isThieved: false,
    destroyedConsumed: false,
    ...overrides,
  };
}

describe('TeamType trigger field parsing', () => {
  it('TeamType interface includes trigger field', () => {
    const team: TeamType = {
      name: 'ant3',
      house: 5,
      flags: 0,
      origin: 1,
      trigger: 8,
      members: [{ type: 'ANT3', count: 2 }],
      missions: [],
    };
    expect(team.trigger).toBe(8);
  });

  it('spawned entities get triggerName from team trigger field', () => {
    const triggers: ScenarioTrigger[] = [];
    // Create 9 dummy triggers so index 8 exists
    for (let i = 0; i < 9; i++) {
      triggers.push({
        name: i === 8 ? 'ant3' : `trig${i}`,
        persistence: 0, house: 0, eventControl: 0, actionControl: 0,
        event1: { type: 0, team: -1, data: 0 },
        event2: { type: 0, team: -1, data: 0 },
        action1: { action: 0, team: -1, trigger: -1, data: 0 },
        action2: { action: 0, team: -1, trigger: -1, data: 0 },
        fired: false, timerTick: 0, playerEntered: false, forceFirePending: false,
        destroyedConsumed: false,
      });
    }

    const teamTypes: TeamType[] = [{
      name: 'ant3',
      house: 5,     // Germany
      flags: 0,
      origin: 1,    // waypoint 1
      trigger: 8,   // trigger index 8 = "ant3"
      members: [{ type: 'ANT3', count: 2 }],
      missions: [],
    }];

    const waypoints = new Map<number, CellPos>();
    waypoints.set(1, { cx: 50, cy: 50 });

    const result = executeTriggerAction(
      { action: 7, team: 0, trigger: -1, data: -1 }, // REINFORCEMENTS team 0
      teamTypes, waypoints, new Set(), triggers, 0,
      new Map([[House.Germany, 'North']]),
      { x: 40, y: 10, w: 75, h: 80 },
    );

    expect(result.spawned.length).toBe(2);
    // Each spawned entity should have triggerName = "ant3" (triggers[8].name)
    for (const entity of result.spawned) {
      expect(entity.triggerName).toBe('ant3');
    }
  });

  it('spawned entities have NO triggerName when team trigger is -1', () => {
    const triggers: ScenarioTrigger[] = [{
      name: 'ant1', persistence: 0, house: 0, eventControl: 0, actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: { action: 0, team: -1, trigger: -1, data: 0 },
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false, timerTick: 0, playerEntered: false, forceFirePending: false,
      destroyedConsumed: false,
    }];

    const teamTypes: TeamType[] = [{
      name: 'ant1',
      house: 5, flags: 0, origin: 0,
      trigger: -1,   // no trigger assignment
      members: [{ type: 'ANT3', count: 1 }],
      missions: [],
    }];

    const waypoints = new Map<number, CellPos>();
    waypoints.set(0, { cx: 50, cy: 50 });

    const result = executeTriggerAction(
      { action: 7, team: 0, trigger: -1, data: -1 },
      teamTypes, waypoints, new Set(), triggers, 0,
    );

    expect(result.spawned.length).toBe(1);
    expect(result.spawned[0].triggerName).toBeUndefined();
  });
});

describe('DESTROYED event — C++ Spring() parity', () => {
  // TEVENT_DESTROYED = 7
  const DESTROYED_EVENT = { type: 7, team: -1, data: 0 };

  it('fires when trigger name is in destroyed set and not consumed', () => {
    const state = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant5']),
      destroyedConsumed: false,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(true);
  });

  it('does NOT fire when consumed (C++ Spring already consumed)', () => {
    const state = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant5']),
      destroyedConsumed: true,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(false);
  });

  it('does NOT fire when trigger name is not in destroyed set', () => {
    const state = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant6']),
      destroyedConsumed: false,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state)).toBe(false);
  });

  it('re-fires after consumed flag is cleared by new death', () => {
    // First check: fires (not consumed)
    const state1 = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant5']),
      destroyedConsumed: false,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state1)).toBe(true);

    // After trigger fires: consumed
    const state2 = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant5']),
      destroyedConsumed: true,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state2)).toBe(false);

    // New death clears consumed: fires again
    const state3 = createState({
      triggerName: 'ant5',
      destroyedTriggerNames: new Set(['ant5']),
      destroyedConsumed: false,
    });
    expect(checkTriggerEvent(DESTROYED_EVENT, state3)).toBe(true);
  });
});

describe('SCA02EA trigger chain structure', () => {
  it('verifies ant respawn chain: pre-placed ants → DESTROYED → spawn → triggerName → repeat', () => {
    // This tests the logical flow, not full game simulation:
    // 1. Pre-placed ants have triggerName="ant5"
    // 2. When they die, "ant5" enters destroyed set
    // 3. Trigger "ant5" DESTROYED fires → REINFORCEMENTS team 4
    // 4. Team 4 has trigger=10 (triggers[10].name="ant5")
    // 5. Spawned ants get triggerName="ant5"
    // 6. When THOSE ants die → step 2 repeats

    // Verify team ant5 (index 4) has trigger=10
    // From SCA02EA INI: ant5=9,0,7,0,0,1,10,1,ANT1:1,...
    // parts[6] = 10 → trigger index 10
    const teamAnt5: TeamType = {
      name: 'ant5',
      house: 9,     // BadGuy
      flags: 0,
      origin: 10,   // WP10
      trigger: 10,  // trigger index 10 (should be "ant5")
      members: [{ type: 'ANT1', count: 1 }],
      missions: [],
    };

    // Trigger index 10 should be named "ant5"
    const triggers: ScenarioTrigger[] = [];
    for (let i = 0; i < 11; i++) {
      triggers.push({
        name: i === 10 ? 'ant5' : `t${i}`,
        persistence: 2, house: 0, eventControl: 1, actionControl: 0,
        event1: { type: 7, team: -1, data: 0 }, // DESTROYED
        event2: { type: 27, team: -1, data: 7 }, // GLOBAL_SET(7)
        action1: { action: 7, team: 4, trigger: -1, data: -1 }, // REINFORCEMENTS
        action2: { action: 0, team: -1, trigger: -1, data: 0 },
        fired: false, timerTick: 0, playerEntered: false, forceFirePending: false,
        destroyedConsumed: false,
      });
    }

    const waypoints = new Map<number, CellPos>();
    waypoints.set(10, { cx: 60, cy: 60 });

    // Spawn team — entities should get triggerName="ant5"
    const result = executeTriggerAction(
      { action: 7, team: 0, trigger: -1, data: -1 },
      [teamAnt5], waypoints, new Set(), triggers, 0,
    );

    expect(result.spawned.length).toBe(1);
    expect(result.spawned[0].triggerName).toBe('ant5');
    // This entity, when killed, will put "ant5" back in the destroyed set,
    // allowing the ant5 trigger to fire again (after destroyedConsumed is cleared).
  });
});
