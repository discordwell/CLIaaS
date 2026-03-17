/**
 * C++ behavioral parity tests for TACTION_LAUNCH_NUKES (action type 36).
 *
 * C++ source: taction.cpp — TActionClass::operator()
 *   case TACTION_LAUNCH_NUKES:
 *     for(int index = 0; index < Buildings.Count(); index++) {
 *       BuildingClass *bldg = Buildings.Ptr(index);
 *       if (*bldg == STRUCT_MSLO) {
 *         bldg->Assign_Mission(MISSION_MISSILE);
 *       }
 *     }
 *     break;
 *
 * Key C++ behaviors:
 *   1. Iterates ALL buildings (not filtered by house)
 *   2. Only STRUCT_MSLO buildings are affected
 *   3. Each MSLO gets MISSION_MISSILE assigned
 *   4. Non-MSLO buildings are ignored
 *   5. Dead/destroyed buildings are skipped by the iterator
 *   6. No parameters (team, trigger, data) are used
 *
 * TS implementation: scenario.ts — executeTriggerAction()
 *   Sets result.launchNukes = true, consumed by Game.tick() in index.ts
 *   which iterates structures[], finds alive MSLOs, launches visual rockets.
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
} from '../engine/scenario';

const TACTION_LAUNCH_NUKES = 36;

function makeAction(overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: TACTION_LAUNCH_NUKES, team: -1, trigger: -1, data: 0, ...overrides };
}

function exec(overrides: Partial<TriggerAction> = {}): TriggerActionResult {
  return executeTriggerAction(
    makeAction(overrides),
    [],          // teamTypes
    new Map(),   // waypoints
    new Set(),   // globals
    [],          // triggers
  );
}

describe('TACTION_LAUNCH_NUKES (type 36) — C++ taction.cpp parity', () => {

  // ── C++ parity: action type constant ──────────────────────────────────────────

  it('action type constant is 36 (C++ enum TACTION_LAUNCH_NUKES)', () => {
    expect(TACTION_LAUNCH_NUKES).toBe(36);
  });

  // ── C++ parity: sets launchNukes flag ─────────────────────────────────────────

  it('executeTriggerAction sets result.launchNukes = true', () => {
    // C++ iterates Buildings[] and assigns MISSION_MISSILE to MSLOs.
    // TS sets the flag; the Game engine consumes it to iterate structures.
    const result = exec();
    expect(result.launchNukes).toBe(true);
  });

  it('spawned array is empty (C++ creates no new units)', () => {
    const result = exec();
    expect(result.spawned).toEqual([]);
  });

  // ── C++ parity: no parameters consumed ────────────────────────────────────────
  // C++ TACTION_LAUNCH_NUKES uses no parameters — no house, team, trigger, or data.

  it('ignores team parameter', () => {
    expect(exec({ team: 0 }).launchNukes).toBe(true);
    expect(exec({ team: 5 }).launchNukes).toBe(true);
    expect(exec({ team: -1 }).launchNukes).toBe(true);
  });

  it('ignores trigger parameter', () => {
    expect(exec({ trigger: 0 }).launchNukes).toBe(true);
    expect(exec({ trigger: 3 }).launchNukes).toBe(true);
    expect(exec({ trigger: -1 }).launchNukes).toBe(true);
  });

  it('ignores data parameter', () => {
    expect(exec({ data: 0 }).launchNukes).toBe(true);
    expect(exec({ data: 42 }).launchNukes).toBe(true);
    expect(exec({ data: 255 }).launchNukes).toBe(true);
  });

  // ── C++ parity: no other side effects ─────────────────────────────────────────

  it('does not set win/lose flags', () => {
    const result = exec();
    expect(result.win).toBeUndefined();
    expect(result.lose).toBeUndefined();
    expect(result.allowWin).toBeUndefined();
  });

  it('does not set any other action result flags', () => {
    const result = exec();
    // C++ TACTION_LAUNCH_NUKES only assigns MISSION_MISSILE to MSLOs;
    // it does not produce any other trigger action side effects.
    expect(result.revealAll).toBeUndefined();
    expect(result.allHunt).toBeUndefined();
    expect(result.textMessage).toBeUndefined();
    expect(result.setTimer).toBeUndefined();
    expect(result.oneSpecial).toBeUndefined();
    expect(result.fullSpecial).toBeUndefined();
    expect(result.preferredTarget).toBeUndefined();
    expect(result.fireSale).toBeUndefined();
    expect(result.beginProduction).toBeUndefined();
    expect(result.autocreate).toBeUndefined();
  });

  // ── C++ parity: MSLO-specific targeting ───────────────────────────────────────
  // The C++ code checks `*bldg == STRUCT_MSLO` — only missile silos are affected.
  // The old TS code incorrectly created a single explosion at map center.
  // The new TS code iterates structures[] for alive MSLO buildings.

  it('the old nuke field is no longer present on the result type', () => {
    const result = exec();
    // The field was renamed from 'nuke' to 'launchNukes' for C++ parity.
    // 'nuke' as a property should not exist on the result.
    expect((result as Record<string, unknown>)['nuke']).toBeUndefined();
  });

  // ── C++ parity: action does not filter by house ───────────────────────────────
  // C++ iterates ALL Buildings[], not just those owned by the trigger's house.
  // The triggerHouse parameter is irrelevant for this action.

  it('launchNukes is true regardless of triggerHouse', () => {
    // With triggerHouse undefined
    const r1 = executeTriggerAction(
      makeAction(), [], new Map(), new Set(), [],
    );
    expect(r1.launchNukes).toBe(true);

    // With triggerHouse = 0 (GoodGuy/Spain)
    const r2 = executeTriggerAction(
      makeAction(), [], new Map(), new Set(), [], 0,
    );
    expect(r2.launchNukes).toBe(true);

    // With triggerHouse = 2 (USSR)
    const r3 = executeTriggerAction(
      makeAction(), [], new Map(), new Set(), [], 2,
    );
    expect(r3.launchNukes).toBe(true);
  });
});
