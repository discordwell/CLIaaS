/**
 * C++ behavioral parity tests for the final 4 TACTIONs:
 *   TACTION_1_SPECIAL      (33) — charge one superweapon
 *   TACTION_FULL_SPECIAL    (34) — charge all superweapons
 *   TACTION_PREFERRED_TARGET(35) — designate preferred target for AI house
 *   TACTION_LAUNCH_NUKES    (36) — launch nuclear missiles from all silos
 *
 * Source: TACTION.H (enum values 33-36), TRIGGER.CPP Handle_Action switch cases.
 *
 * Each TACTION sets exactly one result flag and produces no other side effects:
 *   33 -> result.oneSpecial = true
 *   34 -> result.fullSpecial = true
 *   35 -> result.preferredTarget = action.data
 *   36 -> result.nuke = true
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

// ── Constants ────────────────────────────────────────────────────────────────────

const TACTION_1_SPECIAL = 33;
const TACTION_FULL_SPECIAL = 34;
const TACTION_PREFERRED_TARGET = 35;
const TACTION_LAUNCH_NUKES = 36;

// ── Helpers ──────────────────────────────────────────────────────────────────────

function makeAction(actionCode: number, overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: actionCode, team: -1, trigger: -1, data: 0, ...overrides };
}

function exec(actionCode: number, overrides: Partial<TriggerAction> = {}): TriggerActionResult {
  return executeTriggerAction(
    makeAction(actionCode, overrides),
    [],          // teamTypes
    new Map(),   // waypoints
    new Set(),   // globals
    [],          // triggers
  );
}

/** All side-effect flags that must be undefined when only one flag is set. */
function expectNoOtherSideEffects(
  result: TriggerActionResult,
  except: keyof TriggerActionResult,
): void {
  const allFlags: (keyof TriggerActionResult)[] = [
    'win', 'lose', 'allowWin', 'allHunt', 'revealAll', 'revealWaypoint',
    'dropZone', 'creepShadow', 'textMessage', 'setTimer', 'timerExtend',
    'autocreate', 'destroyTriggeringUnit', 'playSound', 'playSpeech',
    'airstrike', 'nuke', 'centerView', 'fireSale', 'playMovie',
    'revealZone', 'playMusic', 'preferredTarget', 'beginProduction',
    'destroyTeam', 'startTimer', 'stopTimer', 'timerSubtract',
    'oneSpecial', 'fullSpecial',
  ];

  for (const flag of allFlags) {
    if (flag === except || flag === 'spawned') continue;
    expect(result[flag], `expected result.${flag} to be undefined`).toBeUndefined();
  }
}

function makeTriggerFixture(action: TriggerAction): ScenarioTrigger {
  return {
    name: 'test',
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 0, team: -1, data: 0 },
    event2: { type: 0, team: -1, data: 0 },
    action1: action,
    action2: { action: 0, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
  };
}

// ══════════════════════════════════════════════════════════════════════════════════
// TACTION_1_SPECIAL (33) — charge one superweapon
// ══════════════════════════════════════════════════════════════════════════════════

describe('TACTION_1_SPECIAL constant value (TACTION.H)', () => {
  it('TACTION_1_SPECIAL has constant value 33', () => {
    expect(TACTION_1_SPECIAL).toBe(33);
    expect(makeAction(TACTION_1_SPECIAL).action).toBe(33);
  });
});

describe('TACTION_1_SPECIAL sets result.oneSpecial = true (trigger.cpp)', () => {
  it('result.oneSpecial is true', () => {
    const result = exec(TACTION_1_SPECIAL);
    expect(result.oneSpecial).toBe(true);
  });

  it('spawned array is empty', () => {
    const result = exec(TACTION_1_SPECIAL);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win is undefined', () => {
    expect(exec(TACTION_1_SPECIAL).win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    expect(exec(TACTION_1_SPECIAL).lose).toBeUndefined();
  });
});

describe('TACTION_1_SPECIAL ignores action parameters (trigger.cpp)', () => {
  it('result.oneSpecial is true regardless of team index', () => {
    expect(exec(TACTION_1_SPECIAL, { team: 0 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { team: 5 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { team: -1 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { team: 99 }).oneSpecial).toBe(true);
  });

  it('result.oneSpecial is true regardless of trigger index', () => {
    expect(exec(TACTION_1_SPECIAL, { trigger: 0 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { trigger: 3 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { trigger: -1 }).oneSpecial).toBe(true);
  });

  it('result.oneSpecial is true regardless of data field', () => {
    expect(exec(TACTION_1_SPECIAL, { data: 0 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { data: 42 }).oneSpecial).toBe(true);
    expect(exec(TACTION_1_SPECIAL, { data: 255 }).oneSpecial).toBe(true);
  });
});

describe('TACTION_1_SPECIAL produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = exec(TACTION_1_SPECIAL);
    expect(result.oneSpecial).toBe(true);
    expectNoOtherSideEffects(result, 'oneSpecial');
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      makeAction(TACTION_1_SPECIAL, { team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.oneSpecial).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      makeAction(TACTION_1_SPECIAL),
      [], new Map(), globals, [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger = makeTriggerFixture(makeAction(TACTION_1_SPECIAL));
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      makeAction(TACTION_1_SPECIAL),
      [], new Map(), new Set(), triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════
// TACTION_FULL_SPECIAL (34) — charge all superweapons
// ══════════════════════════════════════════════════════════════════════════════════

describe('TACTION_FULL_SPECIAL constant value (TACTION.H)', () => {
  it('TACTION_FULL_SPECIAL has constant value 34', () => {
    expect(TACTION_FULL_SPECIAL).toBe(34);
    expect(makeAction(TACTION_FULL_SPECIAL).action).toBe(34);
  });
});

describe('TACTION_FULL_SPECIAL sets result.fullSpecial = true (trigger.cpp)', () => {
  it('result.fullSpecial is true', () => {
    const result = exec(TACTION_FULL_SPECIAL);
    expect(result.fullSpecial).toBe(true);
  });

  it('spawned array is empty', () => {
    const result = exec(TACTION_FULL_SPECIAL);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win is undefined', () => {
    expect(exec(TACTION_FULL_SPECIAL).win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    expect(exec(TACTION_FULL_SPECIAL).lose).toBeUndefined();
  });
});

describe('TACTION_FULL_SPECIAL ignores action parameters (trigger.cpp)', () => {
  it('result.fullSpecial is true regardless of team index', () => {
    expect(exec(TACTION_FULL_SPECIAL, { team: 0 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { team: 5 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { team: -1 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { team: 99 }).fullSpecial).toBe(true);
  });

  it('result.fullSpecial is true regardless of trigger index', () => {
    expect(exec(TACTION_FULL_SPECIAL, { trigger: 0 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { trigger: 3 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { trigger: -1 }).fullSpecial).toBe(true);
  });

  it('result.fullSpecial is true regardless of data field', () => {
    expect(exec(TACTION_FULL_SPECIAL, { data: 0 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { data: 42 }).fullSpecial).toBe(true);
    expect(exec(TACTION_FULL_SPECIAL, { data: 255 }).fullSpecial).toBe(true);
  });
});

describe('TACTION_FULL_SPECIAL produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = exec(TACTION_FULL_SPECIAL);
    expect(result.fullSpecial).toBe(true);
    expectNoOtherSideEffects(result, 'fullSpecial');
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      makeAction(TACTION_FULL_SPECIAL, { team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.fullSpecial).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      makeAction(TACTION_FULL_SPECIAL),
      [], new Map(), globals, [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger = makeTriggerFixture(makeAction(TACTION_FULL_SPECIAL));
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      makeAction(TACTION_FULL_SPECIAL),
      [], new Map(), new Set(), triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════
// TACTION_PREFERRED_TARGET (35) — designate preferred target type for AI
// ══════════════════════════════════════════════════════════════════════════════════

describe('TACTION_PREFERRED_TARGET constant value (TACTION.H)', () => {
  it('TACTION_PREFERRED_TARGET has constant value 35', () => {
    expect(TACTION_PREFERRED_TARGET).toBe(35);
    expect(makeAction(TACTION_PREFERRED_TARGET).action).toBe(35);
  });
});

describe('TACTION_PREFERRED_TARGET sets result.preferredTarget = action.data (trigger.cpp)', () => {
  it('result.preferredTarget equals action.data when data=0', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 0 });
    expect(result.preferredTarget).toBe(0);
  });

  it('result.preferredTarget equals action.data when data=3', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 3 });
    expect(result.preferredTarget).toBe(3);
  });

  it('result.preferredTarget equals action.data when data=7 (quarry type)', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 7 });
    expect(result.preferredTarget).toBe(7);
  });

  it('result.preferredTarget equals action.data when data=255', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 255 });
    expect(result.preferredTarget).toBe(255);
  });

  it('spawned array is empty', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 5 });
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win is undefined', () => {
    expect(exec(TACTION_PREFERRED_TARGET, { data: 1 }).win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    expect(exec(TACTION_PREFERRED_TARGET, { data: 1 }).lose).toBeUndefined();
  });
});

describe('TACTION_PREFERRED_TARGET ignores non-data parameters (trigger.cpp)', () => {
  it('result.preferredTarget uses data regardless of team index', () => {
    expect(exec(TACTION_PREFERRED_TARGET, { team: 0, data: 4 }).preferredTarget).toBe(4);
    expect(exec(TACTION_PREFERRED_TARGET, { team: 5, data: 4 }).preferredTarget).toBe(4);
    expect(exec(TACTION_PREFERRED_TARGET, { team: -1, data: 4 }).preferredTarget).toBe(4);
    expect(exec(TACTION_PREFERRED_TARGET, { team: 99, data: 4 }).preferredTarget).toBe(4);
  });

  it('result.preferredTarget uses data regardless of trigger index', () => {
    expect(exec(TACTION_PREFERRED_TARGET, { trigger: 0, data: 2 }).preferredTarget).toBe(2);
    expect(exec(TACTION_PREFERRED_TARGET, { trigger: 3, data: 2 }).preferredTarget).toBe(2);
    expect(exec(TACTION_PREFERRED_TARGET, { trigger: -1, data: 2 }).preferredTarget).toBe(2);
  });
});

describe('TACTION_PREFERRED_TARGET produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = exec(TACTION_PREFERRED_TARGET, { data: 5 });
    expect(result.preferredTarget).toBe(5);
    expectNoOtherSideEffects(result, 'preferredTarget');
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      makeAction(TACTION_PREFERRED_TARGET, { team: 0, data: 3 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.preferredTarget).toBe(3);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      makeAction(TACTION_PREFERRED_TARGET, { data: 2 }),
      [], new Map(), globals, [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger = makeTriggerFixture(makeAction(TACTION_PREFERRED_TARGET, { data: 1 }));
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      makeAction(TACTION_PREFERRED_TARGET, { data: 1 }),
      [], new Map(), new Set(), triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════
// TACTION_LAUNCH_NUKES (36) — launch nuclear missiles from all silos
// ══════════════════════════════════════════════════════════════════════════════════

describe('TACTION_LAUNCH_NUKES constant value (TACTION.H)', () => {
  it('TACTION_LAUNCH_NUKES has constant value 36', () => {
    expect(TACTION_LAUNCH_NUKES).toBe(36);
    expect(makeAction(TACTION_LAUNCH_NUKES).action).toBe(36);
  });
});

describe('TACTION_LAUNCH_NUKES sets result.nuke = true (trigger.cpp)', () => {
  it('result.nuke is true', () => {
    const result = exec(TACTION_LAUNCH_NUKES);
    expect(result.nuke).toBe(true);
  });

  it('spawned array is empty', () => {
    const result = exec(TACTION_LAUNCH_NUKES);
    expect(result.spawned).toEqual([]);
    expect(result.spawned).toHaveLength(0);
  });

  it('result.win is undefined', () => {
    expect(exec(TACTION_LAUNCH_NUKES).win).toBeUndefined();
  });

  it('result.lose is undefined', () => {
    expect(exec(TACTION_LAUNCH_NUKES).lose).toBeUndefined();
  });
});

describe('TACTION_LAUNCH_NUKES ignores action parameters (trigger.cpp)', () => {
  it('result.nuke is true regardless of team index', () => {
    expect(exec(TACTION_LAUNCH_NUKES, { team: 0 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { team: 5 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { team: -1 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { team: 99 }).nuke).toBe(true);
  });

  it('result.nuke is true regardless of trigger index', () => {
    expect(exec(TACTION_LAUNCH_NUKES, { trigger: 0 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { trigger: 3 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { trigger: -1 }).nuke).toBe(true);
  });

  it('result.nuke is true regardless of data field', () => {
    expect(exec(TACTION_LAUNCH_NUKES, { data: 0 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { data: 42 }).nuke).toBe(true);
    expect(exec(TACTION_LAUNCH_NUKES, { data: 255 }).nuke).toBe(true);
  });
});

describe('TACTION_LAUNCH_NUKES produces no other side effects (trigger.cpp)', () => {
  it('no other TriggerActionResult flags are set', () => {
    const result = exec(TACTION_LAUNCH_NUKES);
    expect(result.nuke).toBe(true);
    expectNoOtherSideEffects(result, 'nuke');
  });

  it('spawned is empty even with teamTypes and waypoints available', () => {
    const teamTypes: TeamType[] = [
      { name: 'team0', house: 0, members: [], missions: [], origin: 0 },
    ];
    const waypoints = new Map([[0, { x: 10, y: 20 }]]);

    const result = executeTriggerAction(
      makeAction(TACTION_LAUNCH_NUKES, { team: 0 }),
      teamTypes,
      waypoints,
      new Set(),
      [],
    );

    expect(result.nuke).toBe(true);
    expect(result.spawned).toEqual([]);
  });

  it('does not mutate the globals set', () => {
    const globals = new Set<number>([5, 10, 15]);
    const before = new Set(globals);
    executeTriggerAction(
      makeAction(TACTION_LAUNCH_NUKES),
      [], new Map(), globals, [],
    );
    expect(globals).toEqual(before);
  });

  it('does not mutate the triggers array', () => {
    const trigger = makeTriggerFixture(makeAction(TACTION_LAUNCH_NUKES));
    const triggers = [trigger];
    const snapshot = JSON.stringify(triggers);
    executeTriggerAction(
      makeAction(TACTION_LAUNCH_NUKES),
      [], new Map(), new Set(), triggers,
    );
    expect(JSON.stringify(triggers)).toBe(snapshot);
  });
});
