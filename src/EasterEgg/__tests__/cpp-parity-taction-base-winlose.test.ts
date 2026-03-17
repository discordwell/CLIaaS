/**
 * C++ behavioral parity tests for TACTION_BASE_BUILDING (30) and TACTION_WINLOSE (14).
 *
 * TACTION_BASE_BUILDING:
 *   C++ taction.cpp:403-409 — sets hptr->IsBaseBuilding = Data.Bool.
 *   Controls whether the AI house builds base structures.
 *   Action_Needs returns NEED_BOOL. Data.Bool is stored as action.data (0=false, nonzero=true).
 *   C++ house.cpp:936-940: when IsBaseBuilding goes true, also sets IsStarted=true, IsAlerted=true.
 *
 * TACTION_WINLOSE:
 *   C++ taction.h:60 — "Win if captured, lose if destroyed." (enum value 14)
 *   In RA taction.cpp, TACTION_WINLOSE falls through to default (noop — no case handler).
 *   However, in TD trigger.cpp:427-443 (the original C&C), ACTION_WINLOSE checks the
 *   triggering event: EVENT_DESTROYED → player loses, EVENT_PLAYER_ENTERED → player wins.
 *   Our TS implementation follows the TD behavior since the RA enum explicitly defines it
 *   with the same "Win if captured, lose if destroyed" description.
 */
import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

const TACTION_BASE_BUILDING = 30;
const TACTION_WINLOSE = 14;

/** Default empty scaffolding required by executeTriggerAction */
const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

// ============================================================
// Helpers
// ============================================================

function baseBuildingAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_BASE_BUILDING, team: -1, trigger: -1, data: 1, ...overrides };
}

function winLoseAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_WINLOSE, team: -1, trigger: -1, data: 0, ...overrides };
}

function exec(
  action: TriggerAction,
  triggerHouse?: number,
): TriggerActionResult {
  return executeTriggerAction(
    action,
    EMPTY_TEAMS,
    EMPTY_WAYPOINTS,
    EMPTY_GLOBALS,
    EMPTY_TRIGGERS,
    triggerHouse,
  );
}

// ============================================================
// TACTION_BASE_BUILDING (30)
// ============================================================

describe('TACTION_BASE_BUILDING (action=30) — C++ parity', () => {
  // ------------------------------------------------------------------
  // Constant value check — C++ taction.h enum order puts BASE_BUILDING at 30
  // ------------------------------------------------------------------
  it('TACTION_BASE_BUILDING constant equals 30', () => {
    expect(TACTION_BASE_BUILDING).toBe(30);
  });

  // ------------------------------------------------------------------
  // Core: result.baseBuilding is set with house + enabled=true when data=1
  // C++ taction.cpp:404: if (Data.Bool) hptr->IsBaseBuilding = true
  // ------------------------------------------------------------------
  it('sets result.baseBuilding.enabled=true when action.data=1 (Data.Bool=true)', () => {
    const result = exec(baseBuildingAction({ data: 1 }), 2);
    expect(result.baseBuilding).toBeDefined();
    expect(result.baseBuilding!.enabled).toBe(true);
  });

  // ------------------------------------------------------------------
  // Core: result.baseBuilding.enabled=false when data=0
  // C++ taction.cpp:406: else hptr->IsBaseBuilding = false
  // ------------------------------------------------------------------
  it('sets result.baseBuilding.enabled=false when action.data=0 (Data.Bool=false)', () => {
    const result = exec(baseBuildingAction({ data: 0 }), 2);
    expect(result.baseBuilding).toBeDefined();
    expect(result.baseBuilding!.enabled).toBe(false);
  });

  // ------------------------------------------------------------------
  // House comes from triggerHouse (C++ uses the trigger's house)
  // ------------------------------------------------------------------
  it('result.baseBuilding.house reflects the triggerHouse parameter', () => {
    const result = exec(baseBuildingAction({ data: 1 }), 5);
    expect(result.baseBuilding!.house).toBe(5);
  });

  it('result.baseBuilding.house defaults to 0 when triggerHouse is undefined', () => {
    const result = exec(baseBuildingAction({ data: 1 }));
    expect(result.baseBuilding!.house).toBe(0);
  });

  // ------------------------------------------------------------------
  // Nonzero values are truthy (Data.Bool is a union in C++)
  // ------------------------------------------------------------------
  it('treats nonzero action.data as enabled=true', () => {
    const result = exec(baseBuildingAction({ data: 42 }), 0);
    expect(result.baseBuilding!.enabled).toBe(true);
  });

  // ------------------------------------------------------------------
  // No spawned entities
  // ------------------------------------------------------------------
  it('result.spawned is an empty array', () => {
    const result = exec(baseBuildingAction());
    expect(result.spawned).toEqual([]);
  });

  // ------------------------------------------------------------------
  // No win/lose/allowWin flags set
  // ------------------------------------------------------------------
  it('does not set win, lose, or allowWin flags', () => {
    const result = exec(baseBuildingAction());
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // No timer/global side effects
  // ------------------------------------------------------------------
  it('does not modify timers', () => {
    const result = exec(baseBuildingAction());
    expect(result.setTimer).toBeUndefined();
    expect(result.timerExtend).toBeUndefined();
    expect(result.timerSubtract).toBeUndefined();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
  });

  it('does not modify globals', () => {
    const globals = new Set<number>([5, 10]);
    executeTriggerAction(
      baseBuildingAction(),
      EMPTY_TEAMS, EMPTY_WAYPOINTS, globals, EMPTY_TRIGGERS,
    );
    expect(globals.size).toBe(2);
    expect(globals.has(5)).toBe(true);
    expect(globals.has(10)).toBe(true);
  });

  // ------------------------------------------------------------------
  // No other side-effect flags
  // ------------------------------------------------------------------
  it('does not set allHunt, revealAll, autocreate, or fireSale', () => {
    const result = exec(baseBuildingAction());
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
  });

  it('does not set sound/speech/movie flags', () => {
    const result = exec(baseBuildingAction());
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.playMovie).toBeUndefined();
    expect(result.playMusic).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    const result = exec(baseBuildingAction());
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set preferredTarget or beginProduction', () => {
    const result = exec(baseBuildingAction());
    expect(result.preferredTarget).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Result has only spawned + baseBuilding keys
  // ------------------------------------------------------------------
  it('result has only spawned and baseBuilding keys', () => {
    const result = exec(baseBuildingAction({ data: 1 }), 0);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['baseBuilding', 'spawned']);
  });
});

// ============================================================
// TACTION_WINLOSE (14)
// ============================================================

describe('TACTION_WINLOSE (action=14) — C++ parity', () => {
  // ------------------------------------------------------------------
  // Constant value check — C++ taction.h enum order puts WINLOSE at 14
  // ------------------------------------------------------------------
  it('TACTION_WINLOSE constant equals 14', () => {
    expect(TACTION_WINLOSE).toBe(14);
  });

  // ------------------------------------------------------------------
  // Core: result.winLose is set to true
  // ------------------------------------------------------------------
  it('sets result.winLose = true', () => {
    const result = exec(winLoseAction());
    expect(result.winLose).toBe(true);
  });

  // ------------------------------------------------------------------
  // No spawned entities
  // ------------------------------------------------------------------
  it('result.spawned is an empty array', () => {
    const result = exec(winLoseAction());
    expect(result.spawned).toEqual([]);
  });

  // ------------------------------------------------------------------
  // WINLOSE does NOT directly set win or lose — the game loop checks
  // trigger event types to determine the outcome
  // ------------------------------------------------------------------
  it('does not directly set win flag (deferred to game loop)', () => {
    const result = exec(winLoseAction());
    expect(result.win).toBeUndefined();
  });

  it('does not directly set lose flag (deferred to game loop)', () => {
    const result = exec(winLoseAction());
    expect(result.lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    const result = exec(winLoseAction());
    expect(result.allowWin).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // No timer/global side effects
  // ------------------------------------------------------------------
  it('does not modify timers', () => {
    const result = exec(winLoseAction());
    expect(result.setTimer).toBeUndefined();
    expect(result.timerExtend).toBeUndefined();
    expect(result.timerSubtract).toBeUndefined();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
  });

  it('does not modify globals', () => {
    const globals = new Set<number>([3, 7]);
    executeTriggerAction(
      winLoseAction(),
      EMPTY_TEAMS, EMPTY_WAYPOINTS, globals, EMPTY_TRIGGERS,
    );
    expect(globals.size).toBe(2);
  });

  // ------------------------------------------------------------------
  // No other side-effect flags
  // ------------------------------------------------------------------
  it('does not set allHunt, revealAll, autocreate, or fireSale', () => {
    const result = exec(winLoseAction());
    expect(result.allHunt).toBeUndefined();
    expect(result.revealAll).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
  });

  it('does not set sound/speech/movie/music', () => {
    const result = exec(winLoseAction());
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
    expect(result.playMovie).toBeUndefined();
    expect(result.playMusic).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    const result = exec(winLoseAction());
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set preferredTarget or beginProduction', () => {
    const result = exec(winLoseAction());
    expect(result.preferredTarget).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
  });

  it('does not set baseBuilding', () => {
    const result = exec(winLoseAction());
    expect(result.baseBuilding).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Result has only spawned + winLose keys
  // ------------------------------------------------------------------
  it('result has only spawned and winLose keys', () => {
    const result = exec(winLoseAction());
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['spawned', 'winLose']);
  });

  // ------------------------------------------------------------------
  // WINLOSE is independent of action.data value
  // ------------------------------------------------------------------
  it('result.winLose is true regardless of action.data value', () => {
    expect(exec(winLoseAction({ data: 0 })).winLose).toBe(true);
    expect(exec(winLoseAction({ data: 5 })).winLose).toBe(true);
    expect(exec(winLoseAction({ data: -1 })).winLose).toBe(true);
  });
});
