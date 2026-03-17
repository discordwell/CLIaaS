/**
 * C++ behavioral parity tests for TACTION_NONE (action=0).
 *
 * In the original C++ Red Alert source (TRIGGER.CPP), TACTION_NONE is a no-op
 * action that falls through the switch immediately. It produces an empty result
 * with no spawned entities and no side effects whatsoever.
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

const TACTION_NONE = 0;

/** Build a minimal TACTION_NONE action descriptor */
function noneAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_NONE, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Default empty scaffolding required by executeTriggerAction */
const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

function execNone(
  actionOverrides: Partial<TriggerAction> = {},
  opts: {
    teamTypes?: TeamType[];
    waypoints?: Map<number, { cx: number; cy: number }>;
    globals?: Set<number>;
    triggers?: ScenarioTrigger[];
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    noneAction(actionOverrides),
    opts.teamTypes ?? EMPTY_TEAMS,
    opts.waypoints ?? EMPTY_WAYPOINTS,
    opts.globals ?? EMPTY_GLOBALS,
    opts.triggers ?? EMPTY_TRIGGERS,
  );
}

describe('TACTION_NONE (action=0) — C++ parity', () => {
  // ------------------------------------------------------------------
  // Core: result.spawned is always an empty array
  // ------------------------------------------------------------------
  it('result.spawned is an empty array', () => {
    const result = execNone();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // No win/lose/allowWin flags set
  // ------------------------------------------------------------------
  it('does not set win flag', () => {
    const result = execNone();
    expect(result.win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    const result = execNone();
    expect(result.lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    const result = execNone();
    expect(result.allowWin).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // No timer/global changes
  // ------------------------------------------------------------------
  it('does not set a mission timer (setTimer)', () => {
    const result = execNone();
    expect(result.setTimer).toBeUndefined();
  });

  it('does not extend the mission timer (timerExtend)', () => {
    const result = execNone();
    expect(result.timerExtend).toBeUndefined();
  });

  it('does not subtract from the mission timer (timerSubtract)', () => {
    const result = execNone();
    expect(result.timerSubtract).toBeUndefined();
  });

  it('does not start or stop the timer', () => {
    const result = execNone();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
  });

  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    execNone({}, { globals });
    expect(globals).toEqual(before);
  });

  // ------------------------------------------------------------------
  // No other side-effect flags
  // ------------------------------------------------------------------
  it('does not set allHunt', () => {
    const result = execNone();
    expect(result.allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    const result = execNone();
    expect(result.revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    const result = execNone();
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    const result = execNone();
    expect(result.dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    const result = execNone();
    expect(result.creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    const result = execNone();
    expect(result.textMessage).toBeUndefined();
  });

  it('does not set autocreate', () => {
    const result = execNone();
    expect(result.autocreate).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    const result = execNone();
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = execNone();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not trigger airstrike or nuke', () => {
    const result = execNone();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    const result = execNone();
    expect(result.centerView).toBeUndefined();
  });

  // TR4 action results
  it('does not set fireSale', () => {
    const result = execNone();
    expect(result.fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    const result = execNone();
    expect(result.playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    const result = execNone();
    expect(result.revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    const result = execNone();
    expect(result.playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    const result = execNone();
    expect(result.preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    const result = execNone();
    expect(result.beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    const result = execNone();
    expect(result.destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = execNone();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // action.data constant (must equal 0)
  // ------------------------------------------------------------------
  it('action constant is 0', () => {
    expect(TACTION_NONE).toBe(0);
  });

  // ------------------------------------------------------------------
  // Robustness: TACTION_NONE ignores non-default parameters
  // ------------------------------------------------------------------
  it('ignores team parameter when present', () => {
    const result = execNone({ team: 5 });
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });

  it('ignores trigger parameter when present', () => {
    const result = execNone({ trigger: 3 });
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
  });

  it('ignores data parameter when present', () => {
    const result = execNone({ data: 42 });
    expect(result.spawned).toEqual([]);
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
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
      action1: noneAction(),
      action2: noneAction(),
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    execNone({}, { triggers });
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });

  // ------------------------------------------------------------------
  // Combined: only { spawned: [] } with no extra keys
  // ------------------------------------------------------------------
  it('result has only the spawned key (no extraneous properties)', () => {
    const result = execNone();
    const keys = Object.keys(result);
    expect(keys).toEqual(['spawned']);
  });
});
