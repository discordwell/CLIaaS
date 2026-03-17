/**
 * C++ behavioral parity tests for TACTION_DESTROY_TRIGGER (action=12).
 *
 * In the original C++ Red Alert source (TRIGGER.CPP), TACTION_DESTROY_TRIGGER
 * permanently disables a trigger by:
 *   1. Setting triggers[action.trigger].fired = true
 *   2. Setting triggers[action.trigger].persistence = 0 (volatile)
 *
 * This makes the trigger appear already-fired and volatile, so it can never
 * re-fire under any persistence mode. If the trigger index is out of range
 * the action is silently ignored (C++ bounds check).
 *
 * These tests verify that our TypeScript implementation matches that behavior.
 */
import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

const TACTION_DESTROY_TRIGGER = 12;

/** Build a TACTION_DESTROY_TRIGGER action descriptor */
function destroyTriggerAction(
  triggerIndex: number,
  overrides: Partial<TriggerAction> = {},
): TriggerAction {
  return {
    action: TACTION_DESTROY_TRIGGER,
    team: -1,
    trigger: triggerIndex,
    data: 0,
    ...overrides,
  };
}

/** Create a minimal ScenarioTrigger with controllable persistence and fired state */
function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 2,        // persistent by default
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 0, team: -1, data: 0 },
    event2: { type: 0, team: -1, data: 0 },
    action1: { action: 0, team: -1, trigger: -1, data: 0 },
    action2: { action: 0, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
    attachCount: 0,
    remainingAttachCount: 0,
    ...overrides,
  };
}

/** Default empty scaffolding required by executeTriggerAction */
const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();

function exec(
  triggerIndex: number,
  triggers: ScenarioTrigger[],
  actionOverrides: Partial<TriggerAction> = {},
): TriggerActionResult {
  return executeTriggerAction(
    destroyTriggerAction(triggerIndex, actionOverrides),
    EMPTY_TEAMS,
    EMPTY_WAYPOINTS,
    EMPTY_GLOBALS,
    triggers,
  );
}

describe('TACTION_DESTROY_TRIGGER (action=12) — C++ parity', () => {
  // ------------------------------------------------------------------
  // Constant value
  // ------------------------------------------------------------------
  it('action constant is 12', () => {
    expect(TACTION_DESTROY_TRIGGER).toBe(12);
  });

  // ------------------------------------------------------------------
  // Core behavior: target trigger gets fired=true and persistence=0
  // ------------------------------------------------------------------
  it('sets target trigger fired = true', () => {
    const target = makeTrigger({ fired: false });
    const triggers = [target];
    exec(0, triggers);
    expect(target.fired).toBe(true);
  });

  it('sets target trigger persistence = 0', () => {
    const target = makeTrigger({ persistence: 2 });
    const triggers = [target];
    exec(0, triggers);
    expect(target.persistence).toBe(0);
  });

  it('disables a semi-persistent trigger (persistence=1)', () => {
    const target = makeTrigger({ persistence: 1 });
    const triggers = [target];
    exec(0, triggers);
    expect(target.fired).toBe(true);
    expect(target.persistence).toBe(0);
  });

  it('disables a volatile trigger (persistence=0)', () => {
    const target = makeTrigger({ persistence: 0, fired: false });
    const triggers = [target];
    exec(0, triggers);
    expect(target.fired).toBe(true);
    expect(target.persistence).toBe(0);
  });

  it('disables an already-fired trigger (idempotent)', () => {
    const target = makeTrigger({ fired: true, persistence: 2 });
    const triggers = [target];
    exec(0, triggers);
    expect(target.fired).toBe(true);
    expect(target.persistence).toBe(0);
  });

  it('targets trigger at a non-zero index', () => {
    const t0 = makeTrigger({ name: 'keep' });
    const t1 = makeTrigger({ name: 'keep2' });
    const t2 = makeTrigger({ name: 'destroy-me', persistence: 2, fired: false });
    const triggers = [t0, t1, t2];
    exec(2, triggers);
    expect(t2.fired).toBe(true);
    expect(t2.persistence).toBe(0);
    // Other triggers untouched
    expect(t0.fired).toBe(false);
    expect(t0.persistence).toBe(2);
    expect(t1.fired).toBe(false);
    expect(t1.persistence).toBe(2);
  });

  // ------------------------------------------------------------------
  // Out-of-range trigger index is safe (C++ bounds check)
  // ------------------------------------------------------------------
  it('out-of-range positive index is safely ignored', () => {
    const t0 = makeTrigger();
    const triggers = [t0];
    const result = exec(99, triggers);
    // No crash, no mutation
    expect(t0.fired).toBe(false);
    expect(t0.persistence).toBe(2);
    expect(result.spawned).toEqual([]);
  });

  it('negative trigger index is safely ignored', () => {
    const t0 = makeTrigger();
    const triggers = [t0];
    const result = exec(-1, triggers);
    expect(t0.fired).toBe(false);
    expect(t0.persistence).toBe(2);
    expect(result.spawned).toEqual([]);
  });

  it('empty triggers array with index 0 is safely ignored', () => {
    const triggers: ScenarioTrigger[] = [];
    const result = exec(0, triggers);
    expect(result.spawned).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Result: spawned is always empty
  // ------------------------------------------------------------------
  it('result.spawned is an empty array', () => {
    const target = makeTrigger();
    const triggers = [target];
    const result = exec(0, triggers);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // No side-effect flags set on the result
  // ------------------------------------------------------------------
  it('does not set win flag', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.allowWin).toBeUndefined();
  });

  it('does not set allHunt', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.textMessage).toBeUndefined();
  });

  it('does not set setTimer', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.setTimer).toBeUndefined();
  });

  it('does not set timerExtend', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.timerExtend).toBeUndefined();
  });

  it('does not set timerSubtract', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.timerSubtract).toBeUndefined();
  });

  it('does not set startTimer or stopTimer', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
  });

  it('does not set autocreate', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.autocreate).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not trigger airstrike or nuke', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.centerView).toBeUndefined();
  });

  it('does not set fireSale', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = exec(0, [makeTrigger()]);
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Result has only the spawned key (no extraneous properties)
  // ------------------------------------------------------------------
  it('result has only the spawned key', () => {
    const result = exec(0, [makeTrigger()]);
    const keys = Object.keys(result);
    expect(keys).toEqual(['spawned']);
  });

  // ------------------------------------------------------------------
  // Globals are not mutated
  // ------------------------------------------------------------------
  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      destroyTriggerAction(0),
      EMPTY_TEAMS,
      EMPTY_WAYPOINTS,
      globals,
      [makeTrigger()],
    );
    expect(globals).toEqual(before);
  });

  // ------------------------------------------------------------------
  // Only the targeted trigger is mutated, not others
  // ------------------------------------------------------------------
  it('does not mutate non-targeted triggers', () => {
    const t0 = makeTrigger({ name: 'safe0', persistence: 1, fired: false });
    const t1 = makeTrigger({ name: 'target', persistence: 2, fired: false });
    const t2 = makeTrigger({ name: 'safe2', persistence: 2, fired: false });
    const triggers = [t0, t1, t2];

    const snap0 = JSON.stringify(t0);
    const snap2 = JSON.stringify(t2);

    exec(1, triggers);

    expect(JSON.stringify(t0)).toBe(snap0);
    expect(JSON.stringify(t2)).toBe(snap2);
    // Only t1 changed
    expect(t1.fired).toBe(true);
    expect(t1.persistence).toBe(0);
  });
});
