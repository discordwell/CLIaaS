/**
 * C++ behavioral parity tests for TACTION_AUTOCREATE (action=13).
 *
 * In the original C++ Red Alert source (TACTION.CPP), TACTION_AUTOCREATE sets
 * the IsAlerted flag on the specified house, which enables autocreation of
 * teams from the AI base. The action requires NEED_HOUSE as its parameter
 * type. In our TypeScript implementation, executeTriggerAction sets
 * `result.autocreate = true`.
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

const TACTION_AUTOCREATE = 13;

/** Build a minimal TACTION_AUTOCREATE action descriptor */
function autocreateAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_AUTOCREATE, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Default empty scaffolding required by executeTriggerAction */
const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

function execAutocreate(
  actionOverrides: Partial<TriggerAction> = {},
  opts: {
    teamTypes?: TeamType[];
    waypoints?: Map<number, { cx: number; cy: number }>;
    globals?: Set<number>;
    triggers?: ScenarioTrigger[];
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    autocreateAction(actionOverrides),
    opts.teamTypes ?? EMPTY_TEAMS,
    opts.waypoints ?? EMPTY_WAYPOINTS,
    opts.globals ?? EMPTY_GLOBALS,
    opts.triggers ?? EMPTY_TRIGGERS,
  );
}

describe('TACTION_AUTOCREATE (action=13) — C++ parity', () => {
  // ------------------------------------------------------------------
  // Core: result.autocreate is set to true
  // ------------------------------------------------------------------
  it('sets result.autocreate to true', () => {
    const result = execAutocreate();
    expect(result.autocreate).toBe(true);
  });

  // ------------------------------------------------------------------
  // Spawned array is always empty (autocreate does not directly spawn)
  // ------------------------------------------------------------------
  it('result.spawned is an empty array', () => {
    const result = execAutocreate();
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Constant value check
  // ------------------------------------------------------------------
  it('TACTION_AUTOCREATE constant equals 13', () => {
    expect(TACTION_AUTOCREATE).toBe(13);
  });

  // ------------------------------------------------------------------
  // No win/lose/allowWin flags set
  // ------------------------------------------------------------------
  it('does not set win flag', () => {
    const result = execAutocreate();
    expect(result.win).toBeUndefined();
  });

  it('does not set lose flag', () => {
    const result = execAutocreate();
    expect(result.lose).toBeUndefined();
  });

  it('does not set allowWin flag', () => {
    const result = execAutocreate();
    expect(result.allowWin).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // No timer/global changes
  // ------------------------------------------------------------------
  it('does not set a mission timer (setTimer)', () => {
    const result = execAutocreate();
    expect(result.setTimer).toBeUndefined();
  });

  it('does not extend the mission timer (timerExtend)', () => {
    const result = execAutocreate();
    expect(result.timerExtend).toBeUndefined();
  });

  it('does not subtract from the mission timer (timerSubtract)', () => {
    const result = execAutocreate();
    expect(result.timerSubtract).toBeUndefined();
  });

  it('does not start or stop the timer', () => {
    const result = execAutocreate();
    expect(result.startTimer).toBeUndefined();
    expect(result.stopTimer).toBeUndefined();
  });

  it('does not modify globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    execAutocreate({}, { globals });
    expect(globals).toEqual(before);
  });

  // ------------------------------------------------------------------
  // No other side-effect flags
  // ------------------------------------------------------------------
  it('does not set allHunt', () => {
    const result = execAutocreate();
    expect(result.allHunt).toBeUndefined();
  });

  it('does not set revealAll', () => {
    const result = execAutocreate();
    expect(result.revealAll).toBeUndefined();
  });

  it('does not set revealWaypoint', () => {
    const result = execAutocreate();
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('does not set dropZone', () => {
    const result = execAutocreate();
    expect(result.dropZone).toBeUndefined();
  });

  it('does not set creepShadow', () => {
    const result = execAutocreate();
    expect(result.creepShadow).toBeUndefined();
  });

  it('does not set textMessage', () => {
    const result = execAutocreate();
    expect(result.textMessage).toBeUndefined();
  });

  it('does not set destroyTriggeringUnit', () => {
    const result = execAutocreate();
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('does not set playSound or playSpeech', () => {
    const result = execAutocreate();
    expect(result.playSound).toBeUndefined();
    expect(result.playSpeech).toBeUndefined();
  });

  it('does not trigger airstrike or nuke', () => {
    const result = execAutocreate();
    expect(result.airstrike).toBeUndefined();
    expect(result.nuke).toBeUndefined();
  });

  it('does not set centerView', () => {
    const result = execAutocreate();
    expect(result.centerView).toBeUndefined();
  });

  it('does not set fireSale', () => {
    const result = execAutocreate();
    expect(result.fireSale).toBeUndefined();
  });

  it('does not set playMovie', () => {
    const result = execAutocreate();
    expect(result.playMovie).toBeUndefined();
  });

  it('does not set revealZone', () => {
    const result = execAutocreate();
    expect(result.revealZone).toBeUndefined();
  });

  it('does not set playMusic', () => {
    const result = execAutocreate();
    expect(result.playMusic).toBeUndefined();
  });

  it('does not set preferredTarget', () => {
    const result = execAutocreate();
    expect(result.preferredTarget).toBeUndefined();
  });

  it('does not set beginProduction', () => {
    const result = execAutocreate();
    expect(result.beginProduction).toBeUndefined();
  });

  it('does not set destroyTeam', () => {
    const result = execAutocreate();
    expect(result.destroyTeam).toBeUndefined();
  });

  it('does not set oneSpecial or fullSpecial', () => {
    const result = execAutocreate();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Robustness: TACTION_AUTOCREATE ignores extraneous parameters
  // ------------------------------------------------------------------
  it('still sets autocreate when team parameter is present', () => {
    const result = execAutocreate({ team: 5 });
    expect(result.autocreate).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('still sets autocreate when trigger parameter is present', () => {
    const result = execAutocreate({ trigger: 3 });
    expect(result.autocreate).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('still sets autocreate when data parameter is present', () => {
    const result = execAutocreate({ data: 42 });
    expect(result.autocreate).toBe(true);
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
      action1: autocreateAction(),
      action2: autocreateAction(),
      fired: false,
      timerTick: 0,
      playerEntered: false,
      forceFirePending: false,
      pendingDestroyedCount: 0,
      triggeringEntityIds: [],
    };
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    execAutocreate({}, { triggers });
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });

  // ------------------------------------------------------------------
  // Combined: result has only spawned + autocreate keys
  // ------------------------------------------------------------------
  it('result has only spawned and autocreate keys (no extraneous properties)', () => {
    const result = execAutocreate();
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['autocreate', 'spawned']);
  });
});
