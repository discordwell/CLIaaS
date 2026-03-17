/**
 * C++ behavioral parity tests for TACTION_START_TIMER (action=23)
 * and TACTION_STOP_TIMER (action=24).
 *
 * In the original C++ Red Alert source (TRIGGER.CPP):
 *   - TACTION_START_TIMER simply sets the mission timer running.
 *   - TACTION_STOP_TIMER halts the mission timer.
 *
 * Our TypeScript implementation models this via boolean flags on the result:
 *   - START_TIMER: result.startTimer = true
 *   - STOP_TIMER:  result.stopTimer  = true
 *
 * Both actions produce an empty spawned array and no other side effects.
 */
import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

const TACTION_START_TIMER = 23;
const TACTION_STOP_TIMER = 24;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timerAction(
  actionCode: number,
  overrides: Partial<TriggerAction> = {},
): TriggerAction {
  return { action: actionCode, team: -1, trigger: -1, data: 0, ...overrides };
}

const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

function exec(
  actionCode: number,
  actionOverrides: Partial<TriggerAction> = {},
  opts: {
    teamTypes?: TeamType[];
    waypoints?: Map<number, { cx: number; cy: number }>;
    globals?: Set<number>;
    triggers?: ScenarioTrigger[];
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    timerAction(actionCode, actionOverrides),
    opts.teamTypes ?? EMPTY_TEAMS,
    opts.waypoints ?? EMPTY_WAYPOINTS,
    opts.globals ?? EMPTY_GLOBALS,
    opts.triggers ?? EMPTY_TRIGGERS,
  );
}

// ===========================================================================
// TACTION_START_TIMER (action=23)
// ===========================================================================
describe('TACTION_START_TIMER (action=23) — C++ parity', () => {
  // ---- Constant value ----
  it('action constant is 23', () => {
    expect(TACTION_START_TIMER).toBe(23);
  });

  // ---- Core behavior ----
  it('sets result.startTimer to true', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.startTimer).toBe(true);
  });

  // ---- Spawned is empty ----
  it('result.spawned is an empty array', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ---- No other side effects ----
  it('does not set win flag', () => {
    expect(exec(TACTION_START_TIMER).win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    expect(exec(TACTION_START_TIMER).lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    expect(exec(TACTION_START_TIMER).allowWin).toBeUndefined();
  });

  it('does not set allHunt', () => {
    expect(exec(TACTION_START_TIMER).allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    expect(exec(TACTION_START_TIMER).revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    expect(exec(TACTION_START_TIMER).revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    expect(exec(TACTION_START_TIMER).dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    expect(exec(TACTION_START_TIMER).creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    expect(exec(TACTION_START_TIMER).textMessage).toBeUndefined();
  });

  it('does not set setTimer', () => {
    expect(exec(TACTION_START_TIMER).setTimer).toBeUndefined();
  });

  it('does not set timerExtend', () => {
    expect(exec(TACTION_START_TIMER).timerExtend).toBeUndefined();
  });

  it('does not set timerSubtract', () => {
    expect(exec(TACTION_START_TIMER).timerSubtract).toBeUndefined();
  });

  it('does not set stopTimer', () => {
    expect(exec(TACTION_START_TIMER).stopTimer).toBeUndefined();
  });

  it('does not set autocreate', () => {
    expect(exec(TACTION_START_TIMER).autocreate).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    expect(exec(TACTION_START_TIMER).destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not set airstrike or nuke', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    expect(exec(TACTION_START_TIMER).centerView).toBeUndefined();
  });

  it('does not set fireSale', () => {
    expect(exec(TACTION_START_TIMER).fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    expect(exec(TACTION_START_TIMER).playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    expect(exec(TACTION_START_TIMER).revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    expect(exec(TACTION_START_TIMER).playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    expect(exec(TACTION_START_TIMER).preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    expect(exec(TACTION_START_TIMER).beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    expect(exec(TACTION_START_TIMER).destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    exec(TACTION_START_TIMER, {}, { globals });
    expect(globals).toEqual(before);
  });

  // ---- Result has exactly spawned + startTimer ----
  it('result has only spawned and startTimer keys', () => {
    const result = exec(TACTION_START_TIMER);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['spawned', 'startTimer'].sort());
  });

  // ---- Robustness: ignores unused parameters ----
  it('ignores team parameter', () => {
    const result = exec(TACTION_START_TIMER, { team: 7 });
    expect(result.startTimer).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('ignores trigger parameter', () => {
    const result = exec(TACTION_START_TIMER, { trigger: 3 });
    expect(result.startTimer).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('ignores data parameter', () => {
    const result = exec(TACTION_START_TIMER, { data: 42 });
    expect(result.startTimer).toBe(true);
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
      action1: timerAction(TACTION_START_TIMER),
      action2: timerAction(TACTION_START_TIMER),
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    exec(TACTION_START_TIMER, {}, { triggers });
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});

// ===========================================================================
// TACTION_STOP_TIMER (action=24)
// ===========================================================================
describe('TACTION_STOP_TIMER (action=24) — C++ parity', () => {
  // ---- Constant value ----
  it('action constant is 24', () => {
    expect(TACTION_STOP_TIMER).toBe(24);
  });

  // ---- Core behavior ----
  it('sets result.stopTimer to true', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.stopTimer).toBe(true);
  });

  // ---- Spawned is empty ----
  it('result.spawned is an empty array', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ---- No other side effects ----
  it('does not set win flag', () => {
    expect(exec(TACTION_STOP_TIMER).win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    expect(exec(TACTION_STOP_TIMER).lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    expect(exec(TACTION_STOP_TIMER).allowWin).toBeUndefined();
  });

  it('does not set allHunt', () => {
    expect(exec(TACTION_STOP_TIMER).allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    expect(exec(TACTION_STOP_TIMER).revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    expect(exec(TACTION_STOP_TIMER).revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    expect(exec(TACTION_STOP_TIMER).dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    expect(exec(TACTION_STOP_TIMER).creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    expect(exec(TACTION_STOP_TIMER).textMessage).toBeUndefined();
  });

  it('does not set setTimer', () => {
    expect(exec(TACTION_STOP_TIMER).setTimer).toBeUndefined();
  });

  it('does not set timerExtend', () => {
    expect(exec(TACTION_STOP_TIMER).timerExtend).toBeUndefined();
  });

  it('does not set timerSubtract', () => {
    expect(exec(TACTION_STOP_TIMER).timerSubtract).toBeUndefined();
  });

  it('does not set startTimer', () => {
    expect(exec(TACTION_STOP_TIMER).startTimer).toBeUndefined();
  });

  it('does not set autocreate', () => {
    expect(exec(TACTION_STOP_TIMER).autocreate).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    expect(exec(TACTION_STOP_TIMER).destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not set airstrike or nuke', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    expect(exec(TACTION_STOP_TIMER).centerView).toBeUndefined();
  });

  it('does not set fireSale', () => {
    expect(exec(TACTION_STOP_TIMER).fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    expect(exec(TACTION_STOP_TIMER).playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    expect(exec(TACTION_STOP_TIMER).revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    expect(exec(TACTION_STOP_TIMER).playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    expect(exec(TACTION_STOP_TIMER).preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    expect(exec(TACTION_STOP_TIMER).beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    expect(exec(TACTION_STOP_TIMER).destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    exec(TACTION_STOP_TIMER, {}, { globals });
    expect(globals).toEqual(before);
  });

  // ---- Result has exactly spawned + stopTimer ----
  it('result has only spawned and stopTimer keys', () => {
    const result = exec(TACTION_STOP_TIMER);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['spawned', 'stopTimer'].sort());
  });

  // ---- Robustness: ignores unused parameters ----
  it('ignores team parameter', () => {
    const result = exec(TACTION_STOP_TIMER, { team: 7 });
    expect(result.stopTimer).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('ignores trigger parameter', () => {
    const result = exec(TACTION_STOP_TIMER, { trigger: 3 });
    expect(result.stopTimer).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('ignores data parameter', () => {
    const result = exec(TACTION_STOP_TIMER, { data: 42 });
    expect(result.stopTimer).toBe(true);
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
      action1: timerAction(TACTION_STOP_TIMER),
      action2: timerAction(TACTION_STOP_TIMER),
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    exec(TACTION_STOP_TIMER, {}, { triggers });
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});

// ===========================================================================
// Cross-cutting: START and STOP are independent actions
// ===========================================================================
describe('TACTION_START_TIMER vs TACTION_STOP_TIMER — independence', () => {
  it('START_TIMER does not set stopTimer', () => {
    const result = exec(TACTION_START_TIMER);
    expect(result.startTimer).toBe(true);
    expect(result.stopTimer).toBeUndefined();
  });

  it('STOP_TIMER does not set startTimer', () => {
    const result = exec(TACTION_STOP_TIMER);
    expect(result.stopTimer).toBe(true);
    expect(result.startTimer).toBeUndefined();
  });

  it('constants are distinct and adjacent (23, 24)', () => {
    expect(TACTION_START_TIMER).toBe(23);
    expect(TACTION_STOP_TIMER).toBe(24);
    expect(TACTION_START_TIMER).not.toBe(TACTION_STOP_TIMER);
  });
});
