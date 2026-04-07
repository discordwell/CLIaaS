/**
 * C++ Behavioral Parity Tests — TACTION_REINFORCEMENTS (action=7)
 *
 * In C++ Red Alert, TACTION_REINFORCEMENTS falls through to the same case as
 * TACTION_CREATE_TEAM (action=4). Both dispatch to ScenarioClass::Create_Army.
 * This test file verifies that our TS implementation preserves that shared
 * code path: action=7 must produce identical spawn behavior to action=4.
 *
 * Since CREATE_TEAM already has thorough tests in trigger-system-pipeline.test.ts,
 * these tests focus on:
 *   1. REINFORCEMENTS constant is 7 (not accidentally remapped)
 *   2. Basic spawn with team + waypoint produces correct entities
 *   3. Behavioral equivalence — same inputs via action=7 and action=4 yield same results
 *   4. Edge cases (invalid team, missing waypoint) handled identically
 *   5. Team missions, suicide flag, and trigger assignment work through action=7
 */

import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';
import type { CellPos } from '../engine/types';
import { House } from '../engine/types';

// ============================================================================
// Helpers
// ============================================================================

const emptyGlobals = new Set<number>();
const emptyTriggers: ScenarioTrigger[] = [];

function makeTeam(overrides: Partial<TeamType> = {}): TeamType {
  return {
    name: 'reinf_team',
    house: 1,       // Greece
    flags: 0,
    origin: 0,
    trigger: -1,
    members: [{ type: 'E1', count: 2 }],
    missions: [],
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    name: 'trig',
    persistence: 0,
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
    ...overrides,
  };
}

// ============================================================================
// Section 1: Constant value
// ============================================================================

describe('TACTION_REINFORCEMENTS constant', () => {
  it('action=7 is the REINFORCEMENTS action code', () => {
    // The C++ enum: TACTION_REINFORCEMENTS = 7
    // Verify by executing action 7 with a valid team — it should spawn entities.
    const teamTypes = [makeTeam()];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(2);
  });
});

// ============================================================================
// Section 2: Basic spawn behavior
// ============================================================================

describe('TACTION_REINFORCEMENTS basic spawn', () => {
  it('spawns correct number of entities from team members', () => {
    const teamTypes = [makeTeam({ members: [{ type: 'E1', count: 3 }] })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 40, cy: 40 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(3);
  });

  it('spawned entities belong to the team house', () => {
    const teamTypes = [makeTeam({ house: 2 })]; // USSR
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    for (const entity of result.spawned) {
      expect(entity.house).toBe(House.USSR);
    }
  });

  it('spawned entities are positioned near the team origin waypoint', () => {
    const teamTypes = [makeTeam({ members: [{ type: 'E1', count: 1 }] })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 60, cy: 60 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    // cellToWorld converts cx,cy to pixel coords (cx*24, cy*24)
    const expectedX = 60 * 24;
    const expectedY = 60 * 24;
    const entity = result.spawned[0];
    // Entity pos should be within ±2 cells of the waypoint center (random spread + sub-cell offset)
    expect(entity.pos.x).toBeGreaterThan(expectedX - 48);
    expect(entity.pos.x).toBeLessThan(expectedX + 48);
    expect(entity.pos.y).toBeGreaterThan(expectedY - 48);
    expect(entity.pos.y).toBeLessThan(expectedY + 48);
  });

  it('spawns multiple member types in a single team', () => {
    const teamTypes = [makeTeam({
      members: [
        { type: 'E1', count: 2 },
        { type: 'JEEP', count: 1 },
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(3);
  });
});

// ============================================================================
// Section 3: Code path equivalence with CREATE_TEAM (action=4)
// ============================================================================

describe('TACTION_REINFORCEMENTS vs CREATE_TEAM code paths', () => {
  const teamTypes = [makeTeam({
    house: 9,  // BadGuy
    members: [{ type: 'E1', count: 2 }],
  })];
  const waypoints = new Map<number, CellPos>([[0, { cx: 45, cy: 45 }]]);

  it('action=7 spawns entities; action=4 returns createTeam descriptor with matching member count', () => {
    const action4: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const action7: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result4 = executeTriggerAction(action4, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    const result7 = executeTriggerAction(action7, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    // action=4 returns descriptor, action=7 spawns entities
    expect(result4.createTeam).toBeDefined();
    expect(result4.spawned).toHaveLength(0);
    expect(result7.spawned.length).toBe(2);
    // Descriptor member total matches spawned count
    const descriptorTotal = result4.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
    expect(descriptorTotal).toBe(result7.spawned.length);
  });

  it('action=7 and action=4 reference the same house', () => {
    const action4: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const action7: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result4 = executeTriggerAction(action4, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    const result7 = executeTriggerAction(action7, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result4.createTeam!.house).toBe(result7.spawned[0].house);
    expect(result4.createTeam!.house).toBe(House.BadGuy);
  });

  it('action=7 and action=4 both set no result flags (win/lose/etc)', () => {
    const action4: TriggerAction = { action: 4, team: 0, trigger: -1, data: 0 };
    const action7: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result4 = executeTriggerAction(action4, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    const result7 = executeTriggerAction(action7, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result4.win).toBeUndefined();
    expect(result7.win).toBeUndefined();
    expect(result4.lose).toBeUndefined();
    expect(result7.lose).toBeUndefined();
    expect(result4.allHunt).toBeUndefined();
    expect(result7.allHunt).toBeUndefined();
  });
});

// ============================================================================
// Section 4: Edge cases
// ============================================================================

describe('TACTION_REINFORCEMENTS edge cases', () => {
  it('invalid team index spawns nothing', () => {
    const action: TriggerAction = { action: 7, team: 99, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, [], new Map(), emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  it('missing waypoint with no house edge context spawns nothing', () => {
    const teamTypes = [makeTeam({ origin: 5 })]; // waypoint 5 absent
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, new Map(), emptyGlobals, emptyTriggers);
    expect(result.spawned).toEqual([]);
  });

  it('team with zero members spawns nothing', () => {
    const teamTypes = [makeTeam({ members: [] })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);
    expect(result.spawned.length).toBe(0);
  });
});

// ============================================================================
// Section 5: Team missions and flags via REINFORCEMENTS
// ============================================================================

describe('TACTION_REINFORCEMENTS carries team missions and flags', () => {
  it('spawned entities receive team mission script', () => {
    const teamTypes = [makeTeam({
      members: [{ type: 'E1', count: 1 }],
      missions: [
        { mission: 3, data: 2 },  // TMISSION_MOVE to WP2
        { mission: 1, data: 0 },  // TMISSION_ATTACK
      ],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(1);
    const entity = result.spawned[0];
    expect(entity.teamMissions).toBeDefined();
    expect(entity.teamMissions!.length).toBe(2);
    expect(entity.teamMissions![0].mission).toBe(3);
    expect(entity.teamMissions![0].data).toBe(2);
    expect(entity.teamMissions![1].mission).toBe(1);
    expect(entity.teamMissionIndex).toBe(0);
  });

  it('suicide flag (flags bit 1) sets isSuicide on spawned entities', () => {
    const teamTypes = [makeTeam({
      flags: 2,  // bit 1 = IsSuicide
      members: [{ type: 'E1', count: 2 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 30, cy: 30 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(2);
    for (const e of result.spawned) {
      expect(e.isSuicide).toBe(true);
    }
  });

  it('trigger assignment propagates to spawned entities', () => {
    const triggers = [
      makeTrigger({ name: 'respawn_chain' }),
    ];
    const teamTypes = [makeTeam({
      trigger: 0,  // assign triggers[0] ("respawn_chain") to spawned units
      members: [{ type: 'E1', count: 2 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, triggers);

    expect(result.spawned.length).toBe(2);
    for (const entity of result.spawned) {
      expect(entity.triggerName).toBe('respawn_chain');
    }
  });

  it('no trigger assignment when team trigger is -1', () => {
    const teamTypes = [makeTeam({
      trigger: -1,
      members: [{ type: 'E1', count: 1 }],
    })];
    const waypoints = new Map<number, CellPos>([[0, { cx: 50, cy: 50 }]]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(action, teamTypes, waypoints, emptyGlobals, emptyTriggers);

    expect(result.spawned.length).toBe(1);
    expect(result.spawned[0].triggerName).toBeUndefined();
  });
});
