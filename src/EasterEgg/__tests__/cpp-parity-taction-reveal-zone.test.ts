/**
 * C++ Behavioral Parity: TACTION_REVEAL_ZONE (action=18) — reveal all of specified zone.
 *
 * C++ reference: TACTION.CPP / TACTION.H — TACTION_REVEAL_ZONE reveals all cells
 * within the specified zone waypoint. The engine sets result.revealZone to
 * action.data (the zone waypoint index) and spawns nothing (reveal is a map
 * visibility effect, not an entity).
 *
 * Constant value: 18  (C++ enum TACTION_REVEAL_ZONE = 18)
 */

import { describe, it, expect } from 'vitest';
import {
  type TriggerAction,
  type TriggerActionResult,
  type ScenarioTrigger,
  executeTriggerAction,
} from '../engine/scenario';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal TACTION_REVEAL_ZONE action with optional overrides. */
function revealZoneAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: 18, team: -1, trigger: -1, data: 0, ...overrides };
}

/** Invoke executeTriggerAction with minimal valid arguments. */
function execRevealZone(action?: TriggerAction): TriggerActionResult {
  return executeTriggerAction(
    action ?? revealZoneAction(),
    [],                        // teamTypes — empty, not needed for REVEAL_ZONE
    new Map(),                 // waypoints — empty
    new Set<number>(),         // globals — empty
    [],                        // triggers — empty
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TACTION_REVEAL_ZONE constant value (TACTION.H)', () => {
  it('TACTION_REVEAL_ZONE has constant value 18', () => {
    const action = revealZoneAction();
    expect(action.action).toBe(18);
  });
});

describe('TACTION_REVEAL_ZONE sets result.revealZone = action.data', () => {
  it('result.revealZone equals action.data (zone waypoint 0)', () => {
    const result = execRevealZone(revealZoneAction({ data: 0 }));
    expect(result.revealZone).toBe(0);
  });

  it('result.revealZone equals action.data (zone waypoint 1)', () => {
    const result = execRevealZone(revealZoneAction({ data: 1 }));
    expect(result.revealZone).toBe(1);
  });

  it('result.revealZone equals action.data (zone waypoint 5)', () => {
    const result = execRevealZone(revealZoneAction({ data: 5 }));
    expect(result.revealZone).toBe(5);
  });

  it('result.revealZone equals action.data (zone waypoint 25 — high value)', () => {
    const result = execRevealZone(revealZoneAction({ data: 25 }));
    expect(result.revealZone).toBe(25);
  });

  it('preserves exact zone waypoint for arbitrary data values', () => {
    for (const zoneId of [2, 7, 13, 42, 99]) {
      const result = execRevealZone(revealZoneAction({ data: zoneId }));
      expect(result.revealZone, `zone waypoint ${zoneId}`).toBe(zoneId);
    }
  });

  it('result.spawned is empty (no units spawned)', () => {
    const result = execRevealZone(revealZoneAction({ data: 3 }));
    expect(result.spawned).toEqual([]);
  });
});

describe('TACTION_REVEAL_ZONE action 18 is handled (not default/noop)', () => {
  it('action 18 sets revealZone (does not fall through to default)', () => {
    const action: TriggerAction = { action: 18, team: -1, trigger: -1, data: 77 };
    const result = execRevealZone(action);
    expect(result.revealZone).toBeDefined();
    expect(result.revealZone).toBe(77);
  });
});

describe('TACTION_REVEAL_ZONE has no other side effects', () => {
  it('result.win is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.lose).toBeUndefined();
  });

  it('result.allowWin is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.allowWin).toBeUndefined();
  });

  it('result.allHunt is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.allHunt).toBeUndefined();
  });

  it('result.revealAll is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.revealAll).toBeUndefined();
  });

  it('result.revealWaypoint is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.revealWaypoint).toBeUndefined();
  });

  it('result.dropZone is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.dropZone).toBeUndefined();
  });

  it('result.creepShadow is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.creepShadow).toBeUndefined();
  });

  it('result.textMessage is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.textMessage).toBeUndefined();
  });

  it('result.setTimer is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.setTimer).toBeUndefined();
  });

  it('result.timerExtend is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.timerExtend).toBeUndefined();
  });

  it('result.timerSubtract is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.timerSubtract).toBeUndefined();
  });

  it('result.startTimer is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.startTimer).toBeUndefined();
  });

  it('result.stopTimer is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.stopTimer).toBeUndefined();
  });

  it('result.autocreate is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.autocreate).toBeUndefined();
  });

  it('result.destroyTriggeringUnit is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.destroyTriggeringUnit).toBeUndefined();
  });

  it('result.playSound is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.playSound).toBeUndefined();
  });

  it('result.playSpeech is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.playSpeech).toBeUndefined();
  });

  it('result.airstrike is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.airstrike).toBeUndefined();
  });

  it('result.nuke is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.nuke).toBeUndefined();
  });

  it('result.centerView is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.centerView).toBeUndefined();
  });

  it('result.fireSale is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.fireSale).toBeUndefined();
  });

  it('result.playMovie is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.playMovie).toBeUndefined();
  });

  it('result.playMusic is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.playMusic).toBeUndefined();
  });

  it('result.preferredTarget is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.preferredTarget).toBeUndefined();
  });

  it('result.beginProduction is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.beginProduction).toBeUndefined();
  });

  it('result.destroyTeam is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.destroyTeam).toBeUndefined();
  });

  it('result.oneSpecial is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.oneSpecial).toBeUndefined();
  });

  it('result.fullSpecial is undefined', () => {
    const result = execRevealZone(revealZoneAction({ data: 4 }));
    expect(result.fullSpecial).toBeUndefined();
  });

  it('globals set is not mutated', () => {
    const globals = new Set<number>([5, 10]);
    executeTriggerAction(revealZoneAction({ data: 3 }), [], new Map(), globals, []);
    expect(globals.size).toBe(2);
    expect(globals.has(5)).toBe(true);
    expect(globals.has(10)).toBe(true);
  });

  it('triggers array is not mutated', () => {
    const triggers: ScenarioTrigger[] = [
      {
        name: 'trg1',
        house: 0,
        persistence: 1,
        event1: { type: 0, team: -1, data: 0 },
        event2: { type: 0, team: -1, data: 0 },
        eventLogic: 0,
        action1: { action: 0, team: -1, trigger: -1, data: 0 },
        action2: { action: 0, team: -1, trigger: -1, data: 0 },
        fired: false,
        timerTick: 0,
        playerEntered: false,
        forceFirePending: false,
        pendingDestroyedCount: 0,
      },
    ];
    executeTriggerAction(revealZoneAction({ data: 3 }), [], new Map(), new Set(), triggers);
    expect(triggers[0].fired).toBe(false);
    expect(triggers[0].forceFirePending).toBe(false);
  });
});

describe('TACTION_REVEAL_ZONE is independent of team and trigger parameters', () => {
  it('result.revealZone is correct regardless of action.team', () => {
    expect(execRevealZone(revealZoneAction({ team: -1, data: 8 })).revealZone).toBe(8);
    expect(execRevealZone(revealZoneAction({ team: 0, data: 8 })).revealZone).toBe(8);
    expect(execRevealZone(revealZoneAction({ team: 5, data: 8 })).revealZone).toBe(8);
  });

  it('result.revealZone is correct regardless of action.trigger', () => {
    expect(execRevealZone(revealZoneAction({ trigger: -1, data: 12 })).revealZone).toBe(12);
    expect(execRevealZone(revealZoneAction({ trigger: 0, data: 12 })).revealZone).toBe(12);
    expect(execRevealZone(revealZoneAction({ trigger: 3, data: 12 })).revealZone).toBe(12);
  });
});
