/**
 * C++ Behavioral Parity: TACTION_FIRE_SALE (action=9) — sell all buildings
 *
 * Tests verify TACTION_FIRE_SALE behavior matches C++ RA source code (TACTION.CPP).
 * C++ behavior:
 *   case TACTION_FIRE_SALE:
 *     if (Data.House != HOUSE_NONE) {
 *       HouseClass * specified_house = HouseClass::As_Pointer(Data.House);
 *       specified_house->State = STATE_ENDGAME;
 *     }
 *
 * The action uses Data.House (action.data in TS), NOT the trigger's owner house.
 * result.fireSale carries the target house index.
 *
 * Source: TACTION.H (enum value 9), TACTION.CPP operator() switch case.
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_FIRE_SALE = 9;

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Build a TACTION_FIRE_SALE action with optional overrides. */
function fireSaleAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_FIRE_SALE, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Execute a TACTION_FIRE_SALE action with minimal required parameters. */
function executeFireSale(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? fireSaleAction(),
    [],           // teamTypes
    new Map(),    // waypoints
    new Set(),    // globals
    [],           // triggers
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('TACTION_FIRE_SALE constant value (TACTION.H)', () => {
  it('TACTION_FIRE_SALE has constant value 9', () => {
    expect(TACTION_FIRE_SALE).toBe(9);
    expect(fireSaleAction().action).toBe(9);
  });
});

describe('TACTION_FIRE_SALE sets result.fireSale = action.data (taction.cpp)', () => {
  it('result.fireSale equals action.data (Data.House)', () => {
    const result = executeFireSale();
    // Default data=0, so fireSale = 0 (HOUSE_SPAIN)
    expect(result.fireSale).toBe(0);
  });

  it('result.win is undefined', () => {
    const result = executeFireSale();
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = executeFireSale();
    expect(result.lose).toBeUndefined();
  });

  it('spawned array is empty', () => {
    const result = executeFireSale();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });
});

describe('TACTION_FIRE_SALE uses action.data as house target (taction.cpp)', () => {
  it('result.fireSale reflects action.data regardless of team index', () => {
    expect(executeFireSale(fireSaleAction({ team: 0 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ team: 5 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ team: -1 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ team: 99 })).fireSale).toBe(0);
  });

  it('result.fireSale reflects action.data regardless of trigger index', () => {
    expect(executeFireSale(fireSaleAction({ trigger: 0 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ trigger: 3 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ trigger: -1 })).fireSale).toBe(0);
  });

  it('result.fireSale equals action.data for various house values', () => {
    expect(executeFireSale(fireSaleAction({ data: 0 })).fireSale).toBe(0);
    expect(executeFireSale(fireSaleAction({ data: 2 })).fireSale).toBe(2);
    expect(executeFireSale(fireSaleAction({ data: 5 })).fireSale).toBe(5);
  });
});

describe('TACTION_FIRE_SALE produces no other side effects (taction.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = executeFireSale();

    // Verify only fireSale is set; everything else is undefined or default
    expect(result.fireSale).toBe(0);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.revealWaypoint).toBeUndefined();
    expect(result.dropZone).toBeUndefined();
    expect(result.creepShadow).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.timerExtend).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.destroyTriggeringUnit).toBeUndefined();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
    expect(result.centerView).toBeUndefined();
    expect(result.playMovie).toBeUndefined();
    expect(result.revealZone).toBeUndefined();
    expect(result.playMusic).toBeUndefined();
    expect(result.preferredTarget).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
    expect(result.destroyTeam).toBeUndefined();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
    expect(result.timerSubtract).toBeUndefined();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, flags: 0, origin: 0, trigger: -1, members: [], missions: [] },
    ];
    const waypoints = new Map([[0, { cx: 10, cy: 20 }]]);

    const result = executeTriggerAction(
      fireSaleAction({ team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.fireSale).toBe(0);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      fireSaleAction(),
      [],
      new Map(),
      globals,
      [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger: ScenarioTrigger = {
      name: 'test',
      persistence: 0,
      house: 0,
      eventControl: 0,
      actionControl: 0,
      event1: { type: 0, team: -1, data: 0 },
      event2: { type: 0, team: -1, data: 0 },
      action1: fireSaleAction(),
      action2: { action: 0, team: -1, trigger: -1, data: 0 },
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      fireSaleAction(),
      [],
      new Map(),
      new Set(),
      triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
