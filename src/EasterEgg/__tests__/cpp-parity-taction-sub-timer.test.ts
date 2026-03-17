/**
 * C++ behavioral parity tests for TACTION_SUB_TIMER (action=26).
 *
 * In the original C++ Red Alert source (TRIGGER.CPP):
 *   - TACTION_SUB_TIMER subtracts time from the mission timer.
 *     The amount is taken from action.data (in 1/10th minute units).
 *
 * Our TypeScript implementation models this via:
 *   - result.timerSubtract = action.data
 *
 * The action produces an empty spawned array and no other side effects.
 */
import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

const TACTION_SUB_TIMER = 26;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_SUB_TIMER, team: -1, trigger: -1, data: 0, ...overrides };
}

const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

function exec(
  actionOverrides: Partial<TriggerAction> = {},
  opts: {
    teamTypes?: TeamType[];
    waypoints?: Map<number, { cx: number; cy: number }>;
    globals?: Set<number>;
    triggers?: ScenarioTrigger[];
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    makeAction(actionOverrides),
    opts.teamTypes ?? EMPTY_TEAMS,
    opts.waypoints ?? EMPTY_WAYPOINTS,
    opts.globals ?? EMPTY_GLOBALS,
    opts.triggers ?? EMPTY_TRIGGERS,
  );
}

// ===========================================================================
// TACTION_SUB_TIMER (action=26)
// ===========================================================================
describe('TACTION_SUB_TIMER (action=26) — C++ parity', () => {
  // ---- Constant value ----
  it('action constant is 26', () => {
    expect(TACTION_SUB_TIMER).toBe(26);
  });

  // ---- Core behavior: timerSubtract equals action.data ----
  it('sets result.timerSubtract to action.data (default 0)', () => {
    const result = exec();
    expect(result.timerSubtract).toBe(0);
  });

  it('sets result.timerSubtract to action.data when data is a positive value', () => {
    const result = exec({ data: 30 });
    expect(result.timerSubtract).toBe(30);
  });

  it('sets result.timerSubtract to action.data when data is 1', () => {
    const result = exec({ data: 1 });
    expect(result.timerSubtract).toBe(1);
  });

  it('sets result.timerSubtract to action.data for large values', () => {
    const result = exec({ data: 9999 });
    expect(result.timerSubtract).toBe(9999);
  });

  // ---- Spawned is empty ----
  it('result.spawned is an empty array', () => {
    const result = exec({ data: 10 });
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ---- No other side effects ----
  it('does not set win flag', () => {
    expect(exec({ data: 5 }).win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    expect(exec({ data: 5 }).lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    expect(exec({ data: 5 }).allowWin).toBeUndefined();
  });

  it('does not set allHunt', () => {
    expect(exec({ data: 5 }).allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    expect(exec({ data: 5 }).revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    expect(exec({ data: 5 }).revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    expect(exec({ data: 5 }).dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    expect(exec({ data: 5 }).creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    expect(exec({ data: 5 }).textMessage).toBeUndefined();
  });

  it('does not set setTimer', () => {
    expect(exec({ data: 5 }).setTimer).toBeUndefined();
  });

  it('does not set timerExtend', () => {
    expect(exec({ data: 5 }).timerExtend).toBeUndefined();
  });

  it('does not set startTimer', () => {
    expect(exec({ data: 5 }).startTimer).toBeUndefined();
  });

  it('does not set stopTimer', () => {
    expect(exec({ data: 5 }).stopTimer).toBeUndefined();
  });

  it('does not set autocreate', () => {
    expect(exec({ data: 5 }).autocreate).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    expect(exec({ data: 5 }).destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = exec({ data: 5 });
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not set airstrike or nuke', () => {
    const result = exec({ data: 5 });
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    expect(exec({ data: 5 }).centerView).toBeUndefined();
  });

  it('does not set fireSale', () => {
    expect(exec({ data: 5 }).fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    expect(exec({ data: 5 }).playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    expect(exec({ data: 5 }).revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    expect(exec({ data: 5 }).playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    expect(exec({ data: 5 }).preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    expect(exec({ data: 5 }).beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    expect(exec({ data: 5 }).destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = exec({ data: 5 });
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    exec({ data: 5 }, { globals });
    expect(globals).toEqual(before);
  });

  // ---- Result has exactly spawned + timerSubtract ----
  it('result has only spawned and timerSubtract keys', () => {
    const result = exec({ data: 10 });
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['spawned', 'timerSubtract'].sort());
  });

  // ---- Robustness: ignores unused parameters ----
  it('ignores team parameter', () => {
    const result = exec({ data: 15, team: 7 });
    expect(result.timerSubtract).toBe(15);
    expect(result.spawned).toEqual([]);
  });

  it('ignores trigger parameter', () => {
    const result = exec({ data: 15, trigger: 3 });
    expect(result.timerSubtract).toBe(15);
    expect(result.spawned).toEqual([]);
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
      action1: makeAction({ data: 20 }),
      action2: makeAction({ data: 20 }),
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    exec({ data: 20 }, { triggers });
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
