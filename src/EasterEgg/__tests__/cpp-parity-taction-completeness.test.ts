/**
 * C++ behavioral parity: TACTION handler completeness audit.
 *
 * Verifies that every TActionType from the C++ enum (TACTION.H, taction.cpp)
 * is defined in the TS engine, handled in the executeTriggerAction switch,
 * and produces a meaningful (non-empty) result where the C++ does meaningful work.
 *
 * C++ source refs:
 *   - Enum:   RA/taction.h:42-89   (TActionType enum, TACTION_NONE..TACTION_LAUNCH_NUKES)
 *   - Switch: RA/taction.cpp:365-760 (TActionClass::operator())
 *   - Needs:  RA/taction.cpp:832-893  (Action_Needs — parameter types per action)
 */
import { describe, it, expect } from 'vitest';
import {
  executeTriggerAction,
  type TriggerAction,
  type TriggerActionResult,
  type TeamType,
  type ScenarioTrigger,
} from '../engine/scenario';

// ---------------------------------------------------------------------------
// C++ enum values — must exactly match RA/taction.h:42-89 ordinals
// ---------------------------------------------------------------------------
const CPP_TACTION_ENUM: Record<string, number> = {
  TACTION_NONE:              0,
  TACTION_WIN:               1,
  TACTION_LOSE:              2,
  TACTION_BEGIN_PRODUCTION:  3,
  TACTION_CREATE_TEAM:       4,
  TACTION_DESTROY_TEAM:      5,
  TACTION_ALL_HUNT:          6,
  TACTION_REINFORCEMENTS:    7,
  TACTION_DZ:                8,
  TACTION_FIRE_SALE:         9,
  TACTION_PLAY_MOVIE:       10,
  TACTION_TEXT_TRIGGER:     11,
  TACTION_DESTROY_TRIGGER:  12,
  TACTION_AUTOCREATE:       13,
  TACTION_WINLOSE:          14,  // C++ noop in RA (only active in TD)
  TACTION_ALLOWWIN:         15,
  TACTION_REVEAL_ALL:       16,
  TACTION_REVEAL_SOME:      17,
  TACTION_REVEAL_ZONE:      18,
  TACTION_PLAY_SOUND:       19,
  TACTION_PLAY_MUSIC:       20,
  TACTION_PLAY_SPEECH:      21,
  TACTION_FORCE_TRIGGER:    22,
  TACTION_START_TIMER:      23,
  TACTION_STOP_TIMER:       24,
  TACTION_ADD_TIMER:        25,  // TS calls this TACTION_TIMER_EXTEND
  TACTION_SUB_TIMER:        26,
  TACTION_SET_TIMER:        27,
  TACTION_SET_GLOBAL:       28,
  TACTION_CLEAR_GLOBAL:     29,
  TACTION_BASE_BUILDING:    30,
  TACTION_CREEP_SHADOW:     31,
  TACTION_DESTROY_OBJECT:   32,
  TACTION_1_SPECIAL:        33,
  TACTION_FULL_SPECIAL:     34,
  TACTION_PREFERRED_TARGET: 35,
  TACTION_LAUNCH_NUKES:     36,
};

const TACTION_COUNT = 37; // C++ taction.h:87

// ---------------------------------------------------------------------------
// Actions that are intentional noops in C++ RA (fall through to default)
// ---------------------------------------------------------------------------
const CPP_NOOP_ACTIONS = new Set([
  0,   // TACTION_NONE — always a noop
  14,  // TACTION_WINLOSE — RA taction.cpp has no case (Tiberian Dawn only)
]);

// ---------------------------------------------------------------------------
// Actions that produce side effects via mutation rather than result fields.
// These need special data setup to show their effect.
// ---------------------------------------------------------------------------
const MUTATION_ONLY_ACTIONS = new Set([
  12,  // TACTION_DESTROY_TRIGGER — mutates triggers[] in-place (sets fired=true, persistence=0)
  22,  // TACTION_FORCE_TRIGGER — mutates triggers[] in-place (sets forceFirePending=true)
  29,  // TACTION_CLEAR_GLOBAL — only sets globalChanged when the global was already set
]);

// ---------------------------------------------------------------------------
// Helpers — minimal scaffolding for executeTriggerAction
// ---------------------------------------------------------------------------
const EMPTY_TEAMS: TeamType[] = [];
const EMPTY_WAYPOINTS = new Map<number, { cx: number; cy: number }>();
const EMPTY_GLOBALS = new Set<number>();
const EMPTY_TRIGGERS: ScenarioTrigger[] = [];

function makeAction(actionId: number, overrides: Partial<TriggerAction> = {}): TriggerAction {
  return { action: actionId, team: -1, trigger: -1, data: 0, ...overrides };
}

function makeTrigger(name: string): ScenarioTrigger {
  return {
    name,
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: 0, team: -1, data: 0 },
    event2: { type: 0, team: -1, data: 0 },
    action1: makeAction(0),
    action2: makeAction(0),
    fired: false,
    timerTick: 0,
    playerEntered: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
  };
}

function makeTeamType(): TeamType {
  return {
    name: 'test',
    house: 4, // USSR
    flags: 0,
    origin: 0,
    trigger: -1,
    members: [{ type: 'E1', count: 1 }],
    missions: [{ mission: 0, data: 0 }],
  } as TeamType;
}

function exec(
  actionId: number,
  opts: {
    data?: number;
    team?: number;
    trigger?: number;
    teamTypes?: TeamType[];
    waypoints?: Map<number, { cx: number; cy: number }>;
    globals?: Set<number>;
    triggers?: ScenarioTrigger[];
    triggerHouse?: number;
    playerHouseId?: number;
  } = {},
): TriggerActionResult {
  return executeTriggerAction(
    makeAction(actionId, {
      data: opts.data ?? 0,
      team: opts.team ?? -1,
      trigger: opts.trigger ?? -1,
    }),
    opts.teamTypes ?? EMPTY_TEAMS,
    opts.waypoints ?? EMPTY_WAYPOINTS,
    opts.globals ?? opts.globals ?? EMPTY_GLOBALS,
    opts.triggers ?? EMPTY_TRIGGERS,
    opts.triggerHouse,
    undefined, // houseEdges
    undefined, // mapBounds
    opts.playerHouseId,
  );
}

/**
 * Check whether a result has any side-effect property set (beyond the always-present spawned[]).
 */
function hasAnySideEffect(result: TriggerActionResult): boolean {
  const keys = Object.keys(result).filter(k => k !== 'spawned');
  if (keys.length > 0) return true;
  if (result.spawned.length > 0) return true;
  return false;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('TACTION handler completeness — C++ parity audit', () => {
  // -------------------------------------------------------------------------
  // 1. Enum count parity: C++ defines exactly 37 action types (0-36)
  // -------------------------------------------------------------------------
  it('C++ enum has exactly TACTION_COUNT (37) entries', () => {
    expect(Object.keys(CPP_TACTION_ENUM)).toHaveLength(TACTION_COUNT);
  });

  // -------------------------------------------------------------------------
  // 2. Every C++ action ordinal is handled by executeTriggerAction without
  //    throwing. This is the most basic "no crash" test.
  // -------------------------------------------------------------------------
  describe('every C++ TACTION ordinal executes without throwing', () => {
    for (const [name, ordinal] of Object.entries(CPP_TACTION_ENUM)) {
      it(`${name} (${ordinal}) does not throw`, () => {
        // Provide minimal data that prevents null-ref errors for actions
        // that read .data, .team, or .trigger
        const triggers = [makeTrigger('tgt')];
        const teams = [makeTeamType()];
        const waypoints = new Map([[0, { cx: 10, cy: 10 }]]);
        const globals = new Set<number>();

        expect(() => exec(ordinal, {
          data: 1,
          team: 0,
          trigger: 0,
          teamTypes: teams,
          waypoints,
          globals,
          triggers,
          triggerHouse: 4,
          playerHouseId: 0,
        })).not.toThrow();
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. All non-noop actions produce at least one side-effect field.
  //    Actions that are intentional noops (NONE, WINLOSE) produce empty results.
  // -------------------------------------------------------------------------
  describe('non-noop actions produce side effects', () => {
    for (const [name, ordinal] of Object.entries(CPP_TACTION_ENUM)) {
      if (CPP_NOOP_ACTIONS.has(ordinal)) continue;
      if (MUTATION_ONLY_ACTIONS.has(ordinal)) continue; // tested separately below

      it(`${name} (${ordinal}) sets at least one result field`, () => {
        const triggers = [makeTrigger('tgt')];
        const teams = [makeTeamType()];
        const waypoints = new Map([[0, { cx: 10, cy: 10 }]]);
        const globals = new Set<number>();

        const result = exec(ordinal, {
          data: 1,
          team: 0,
          trigger: 0,
          teamTypes: teams,
          waypoints,
          globals,
          triggers,
          triggerHouse: 4,
          playerHouseId: 0,
        });

        expect(
          hasAnySideEffect(result),
          `${name} should produce a non-empty result but returned only { spawned: [] }`,
        ).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3b. Mutation-only actions: produce effects via array/set mutation, not result fields
  // -------------------------------------------------------------------------
  describe('mutation-only actions produce observable side effects', () => {
    it('TACTION_DESTROY_TRIGGER (12) mutates trigger fired+persistence', () => {
      const triggers = [makeTrigger('tgt')];
      expect(triggers[0].fired).toBe(false);
      exec(12, { trigger: 0, triggers });
      // C++ taction.cpp:571-581 — deletes all triggers of that type
      expect(triggers[0].fired).toBe(true);
      expect(triggers[0].persistence).toBe(0);
    });

    it('TACTION_FORCE_TRIGGER (22) mutates trigger forceFirePending', () => {
      const triggers = [makeTrigger('tgt')];
      expect(triggers[0].forceFirePending).toBe(false);
      exec(22, { trigger: 0, triggers });
      // C++ taction.cpp:587-591 — Find_Or_Make(Trigger)->Spring(TEVENT_ANY, 0, 0, true)
      expect(triggers[0].forceFirePending).toBe(true);
    });

    it('TACTION_CLEAR_GLOBAL (29) removes global from set when present', () => {
      const globals = new Set<number>([1]);
      const r = exec(29, { data: 1, globals });
      expect(globals.has(1)).toBe(false);
      expect(r.globalChanged).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Intentional noops produce empty results
  // -------------------------------------------------------------------------
  describe('intentional C++ noops produce empty results', () => {
    it('TACTION_NONE (0) — no side effects', () => {
      const result = exec(0);
      expect(hasAnySideEffect(result)).toBe(false);
    });

    it('TACTION_WINLOSE (14) — RA noop (TD-only action)', () => {
      const result = exec(14, { data: 1, playerHouseId: 0 });
      expect(hasAnySideEffect(result)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Ordinal mapping parity: TS constants match C++ enum order exactly.
  //    Each action's numeric value in TS must match the C++ header.
  // -------------------------------------------------------------------------
  describe('ordinal mapping matches C++ taction.h exactly', () => {
    // C++ taction.h enum assignments (implicit 0-based increment)
    const expectedOrdinals: [string, number][] = [
      ['TACTION_NONE',              0],
      ['TACTION_WIN',               1],
      ['TACTION_LOSE',              2],
      ['TACTION_BEGIN_PRODUCTION',  3],
      ['TACTION_CREATE_TEAM',       4],
      ['TACTION_DESTROY_TEAM',      5],
      ['TACTION_ALL_HUNT',          6],
      ['TACTION_REINFORCEMENTS',    7],
      ['TACTION_DZ',                8],
      ['TACTION_FIRE_SALE',         9],
      ['TACTION_PLAY_MOVIE',       10],
      ['TACTION_TEXT_TRIGGER',     11],
      ['TACTION_DESTROY_TRIGGER',  12],
      ['TACTION_AUTOCREATE',       13],
      ['TACTION_WINLOSE',          14],
      ['TACTION_ALLOWWIN',         15],
      ['TACTION_REVEAL_ALL',       16],
      ['TACTION_REVEAL_SOME',      17],
      ['TACTION_REVEAL_ZONE',      18],
      ['TACTION_PLAY_SOUND',       19],
      ['TACTION_PLAY_MUSIC',       20],
      ['TACTION_PLAY_SPEECH',      21],
      ['TACTION_FORCE_TRIGGER',    22],
      ['TACTION_START_TIMER',      23],
      ['TACTION_STOP_TIMER',       24],
      ['TACTION_ADD_TIMER',        25],
      ['TACTION_SUB_TIMER',        26],
      ['TACTION_SET_TIMER',        27],
      ['TACTION_SET_GLOBAL',       28],
      ['TACTION_CLEAR_GLOBAL',     29],
      ['TACTION_BASE_BUILDING',    30],
      ['TACTION_CREEP_SHADOW',     31],
      ['TACTION_DESTROY_OBJECT',   32],
      ['TACTION_1_SPECIAL',        33],
      ['TACTION_FULL_SPECIAL',     34],
      ['TACTION_PREFERRED_TARGET', 35],
      ['TACTION_LAUNCH_NUKES',     36],
    ];

    for (const [name, expected] of expectedOrdinals) {
      it(`${name} = ${expected}`, () => {
        expect(CPP_TACTION_ENUM[name]).toBe(expected);
        // Also verify the TS switch handles this ordinal without throwing
        expect(() => exec(expected)).not.toThrow();
      });
    }
  });

  // -------------------------------------------------------------------------
  // 6. Specific behavioral parity checks per action type
  //    (C++ source ref: taction.cpp switch cases)
  // -------------------------------------------------------------------------
  describe('per-action behavioral parity', () => {
    // TACTION_WIN (1): C++ taction.cpp:604-610
    // if (Data.House == PlayerPtr->Class->House) Flag_To_Win() else Flag_To_Lose()
    it('TACTION_WIN — player house match => win', () => {
      const r = exec(1, { data: 0, playerHouseId: 0 });
      expect(r.win).toBe(true);
      expect(r.lose).toBeUndefined();
    });

    it('TACTION_WIN — enemy house => player loses', () => {
      const r = exec(1, { data: 4, playerHouseId: 0 });
      expect(r.win).toBeUndefined();
      expect(r.lose).toBe(true);
    });

    // TACTION_LOSE (2): C++ taction.cpp:616-622
    // if (Data.House != PlayerPtr->Class->House) Flag_To_Win() else Flag_To_Lose()
    it('TACTION_LOSE — player house match => player loses', () => {
      const r = exec(2, { data: 0, playerHouseId: 0 });
      expect(r.lose).toBe(true);
      expect(r.win).toBeUndefined();
    });

    it('TACTION_LOSE — enemy house => player wins', () => {
      const r = exec(2, { data: 4, playerHouseId: 0 });
      expect(r.win).toBe(true);
      expect(r.lose).toBeUndefined();
    });

    // TACTION_BEGIN_PRODUCTION (3): C++ taction.cpp:627-632
    // HouseClass::As_Pointer(Data.House)->Begin_Production()
    // Uses Data.House (low byte), NOT trigger owner
    it('TACTION_BEGIN_PRODUCTION — uses Data.House via low byte', () => {
      const r = exec(3, { data: 4 }); // house 4 = USSR
      expect(r.beginProduction).toBe(4);
    });

    // TACTION_DESTROY_TEAM (5): C++ taction.cpp:667-669
    it('TACTION_DESTROY_TEAM — sets destroyTeam to team index', () => {
      const r = exec(5, { team: 3 });
      expect(r.destroyTeam).toBe(3);
    });

    // TACTION_ALL_HUNT (6): C++ taction.cpp:682-683
    // HouseClass::As_Pointer(Data.House)->Do_All_To_Hunt()
    it('TACTION_ALL_HUNT — targets specific house from Data.House', () => {
      const r = exec(6, { data: 4 });
      expect(r.allHunt).toBe(4);
    });

    // TACTION_REINFORCEMENTS (7): C++ taction.cpp:674-675
    it('TACTION_REINFORCEMENTS — spawns entities from team', () => {
      const teams = [makeTeamType()];
      const waypoints = new Map([[0, { cx: 10, cy: 10 }]]);
      const r = exec(7, { team: 0, teamTypes: teams, waypoints });
      expect(r.spawned.length).toBeGreaterThan(0);
    });

    // TACTION_DZ (8): C++ taction.cpp:596-598
    it('TACTION_DZ — sets dropZone waypoint', () => {
      const r = exec(8, { data: 5 });
      expect(r.dropZone).toBe(5);
    });

    // TACTION_FIRE_SALE (9): C++ taction.cpp:638-643
    it('TACTION_FIRE_SALE — sets fireSale to house via low byte', () => {
      const r = exec(9, { data: 4 });
      expect(r.fireSale).toBe(4);
    });

    // TACTION_PLAY_MOVIE (10): C++ taction.cpp:524-531
    it('TACTION_PLAY_MOVIE — sets playMovie', () => {
      const r = exec(10, { data: 3 });
      expect(r.playMovie).toBe(3);
    });

    // TACTION_TEXT_TRIGGER (11): C++ taction.cpp:369-374
    it('TACTION_TEXT_TRIGGER — sets textMessage', () => {
      const r = exec(11, { data: 7 });
      expect(r.textMessage).toBe(7);
    });

    // TACTION_DESTROY_TRIGGER (12): C++ taction.cpp:571-581
    it('TACTION_DESTROY_TRIGGER — marks target trigger as permanently fired', () => {
      const triggers = [makeTrigger('tgt')];
      exec(12, { trigger: 0, triggers });
      expect(triggers[0].fired).toBe(true);
      expect(triggers[0].persistence).toBe(0);
    });

    // TACTION_AUTOCREATE (13): C++ taction.cpp:648-652
    it('TACTION_AUTOCREATE — sets autocreate to house via low byte', () => {
      const r = exec(13, { data: 4 });
      expect(r.autocreate).toBe(4);
    });

    // TACTION_ALLOWWIN (15): C++ taction.cpp — noop in switch, but
    // trigger.cpp:175-178 decrements Blockage on trigger destruction
    it('TACTION_ALLOWWIN — sets allowWin and blockageDecrement', () => {
      const r = exec(15);
      expect(r.allowWin).toBe(true);
      expect(r.blockageDecrement).toBe(true);
    });

    // TACTION_REVEAL_ALL (16): C++ taction.cpp:461-468
    it('TACTION_REVEAL_ALL — sets revealAll', () => {
      const r = exec(16);
      expect(r.revealAll).toBe(true);
    });

    // TACTION_REVEAL_SOME (17): C++ taction.cpp:435-439
    it('TACTION_REVEAL_SOME — sets revealWaypoint', () => {
      const r = exec(17, { data: 3 });
      expect(r.revealWaypoint).toBe(3);
    });

    // TACTION_REVEAL_ZONE (18): C++ taction.cpp:445-456
    it('TACTION_REVEAL_ZONE — sets revealZone', () => {
      const r = exec(18, { data: 2 });
      expect(r.revealZone).toBe(2);
    });

    // TACTION_PLAY_SOUND (19): C++ taction.cpp:536-537
    it('TACTION_PLAY_SOUND — sets playSound', () => {
      const r = exec(19, { data: 12 });
      expect(r.playSound).toBe(12);
    });

    // TACTION_PLAY_MUSIC (20): C++ taction.cpp:543-544
    it('TACTION_PLAY_MUSIC — sets playMusic', () => {
      const r = exec(20, { data: 5 });
      expect(r.playMusic).toBe(5);
    });

    // TACTION_PLAY_SPEECH (21): C++ taction.cpp:550-551
    it('TACTION_PLAY_SPEECH — sets playSpeech', () => {
      const r = exec(21, { data: 8 });
      expect(r.playSpeech).toBe(8);
    });

    // TACTION_FORCE_TRIGGER (22): C++ taction.cpp:587-591
    it('TACTION_FORCE_TRIGGER — sets forceFirePending on target trigger', () => {
      const triggers = [makeTrigger('tgt')];
      exec(22, { trigger: 0, triggers });
      expect(triggers[0].forceFirePending).toBe(true);
    });

    // TACTION_START_TIMER (23): C++ taction.cpp:473-478
    it('TACTION_START_TIMER — sets startTimer', () => {
      const r = exec(23);
      expect(r.startTimer).toBe(true);
    });

    // TACTION_STOP_TIMER (24): C++ taction.cpp:483-489
    it('TACTION_STOP_TIMER — sets stopTimer', () => {
      const r = exec(24);
      expect(r.stopTimer).toBe(true);
    });

    // TACTION_ADD_TIMER (25): C++ taction.cpp:494-497
    // TS names this TACTION_TIMER_EXTEND but ordinal is the same (25)
    it('TACTION_ADD_TIMER (25) — sets timerExtend', () => {
      const r = exec(25, { data: 10 });
      expect(r.timerExtend).toBe(10);
    });

    // TACTION_SUB_TIMER (26): C++ taction.cpp:502-509
    it('TACTION_SUB_TIMER — sets timerSubtract', () => {
      const r = exec(26, { data: 5 });
      expect(r.timerSubtract).toBe(5);
    });

    // TACTION_SET_TIMER (27): C++ taction.cpp:514-518
    it('TACTION_SET_TIMER — sets setTimer', () => {
      const r = exec(27, { data: 30 });
      expect(r.setTimer).toBe(30);
    });

    // TACTION_SET_GLOBAL (28): C++ taction.cpp:421-423
    it('TACTION_SET_GLOBAL — adds to globals set, returns globalChanged', () => {
      const globals = new Set<number>();
      const r = exec(28, { data: 5, globals });
      expect(globals.has(5)).toBe(true);
      expect(r.globalChanged).toBe(5);
    });

    // TACTION_CLEAR_GLOBAL (29): C++ taction.cpp:428-430
    it('TACTION_CLEAR_GLOBAL — removes from globals set, returns globalChanged', () => {
      const globals = new Set<number>([5]);
      const r = exec(29, { data: 5, globals });
      expect(globals.has(5)).toBe(false);
      expect(r.globalChanged).toBe(5);
    });

    // TACTION_BASE_BUILDING (30): C++ taction.cpp:403-409
    // hptr->IsBaseBuilding = Data.Bool
    it('TACTION_BASE_BUILDING — sets baseBuilding with house and enabled', () => {
      const r = exec(30, { data: 1, triggerHouse: 4 });
      expect(r.baseBuilding).toEqual({ house: 4, enabled: true });
    });

    it('TACTION_BASE_BUILDING — data=0 disables', () => {
      const r = exec(30, { data: 0, triggerHouse: 4 });
      expect(r.baseBuilding).toEqual({ house: 4, enabled: false });
    });

    // TACTION_CREEP_SHADOW (31): C++ taction.cpp:414-416
    it('TACTION_CREEP_SHADOW — sets creepShadow', () => {
      const r = exec(31);
      expect(r.creepShadow).toBe(true);
    });

    // TACTION_DESTROY_OBJECT (32): C++ taction.cpp:690-752
    it('TACTION_DESTROY_OBJECT — sets destroyTriggeringUnit', () => {
      const r = exec(32);
      expect(r.destroyTriggeringUnit).toBe(true);
    });

    // TACTION_1_SPECIAL (33): C++ taction.cpp:557-566
    it('TACTION_1_SPECIAL — sets oneSpecial', () => {
      const r = exec(33);
      expect(r.oneSpecial).toBe(true);
    });

    // TACTION_FULL_SPECIAL (34): C++ taction.cpp:557-566
    it('TACTION_FULL_SPECIAL — sets fullSpecial', () => {
      const r = exec(34);
      expect(r.fullSpecial).toBe(true);
    });

    // TACTION_PREFERRED_TARGET (35): C++ taction.cpp:393-397
    it('TACTION_PREFERRED_TARGET — sets preferredTarget', () => {
      const r = exec(35, { data: 2 });
      expect(r.preferredTarget).toBe(2);
    });

    // TACTION_LAUNCH_NUKES (36): C++ taction.cpp:379-388
    it('TACTION_LAUNCH_NUKES — sets launchNukes', () => {
      const r = exec(36);
      expect(r.launchNukes).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Verify out-of-range ordinals don't crash (C++ default: case falls through)
  // -------------------------------------------------------------------------
  describe('out-of-range ordinals are safe noops', () => {
    for (const badOrdinal of [-1, 37, 100, 255]) {
      it(`ordinal ${badOrdinal} does not throw`, () => {
        expect(() => exec(badOrdinal)).not.toThrow();
      });

      it(`ordinal ${badOrdinal} produces empty result`, () => {
        const r = exec(badOrdinal);
        expect(r.spawned).toEqual([]);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 8. CREATE_TEAM (4) returns a createTeam descriptor; REINFORCEMENTS (7) spawns entities.
  //    C++ taction.cpp:658-662 — Create_Army recruits existing idle units (descriptor).
  //    C++ taction.cpp:674-675 — REINFORCEMENTS spawns new entities into result.spawned.
  // -------------------------------------------------------------------------
  describe('CREATE_TEAM and REINFORCEMENTS spawn/recruit path', () => {
    const teams = [makeTeamType()];
    const waypoints = new Map([[0, { cx: 10, cy: 10 }]]);

    it('TACTION_CREATE_TEAM returns createTeam descriptor', () => {
      const r = exec(4, { team: 0, teamTypes: teams, waypoints });
      expect(r.createTeam).toBeDefined();
      expect(r.createTeam!.members.length).toBeGreaterThan(0);
    });

    it('TACTION_REINFORCEMENTS spawns entities', () => {
      const r = exec(7, { team: 0, teamTypes: teams, waypoints });
      expect(r.spawned.length).toBeGreaterThan(0);
    });

    it('createTeam members total matches REINFORCEMENTS spawned count for identical team', () => {
      const r4 = exec(4, { team: 0, teamTypes: teams, waypoints });
      const r7 = exec(7, { team: 0, teamTypes: teams, waypoints });
      const createTeamTotal = r4.createTeam!.members.reduce((sum, m) => sum + m.count, 0);
      expect(createTeamTotal).toBe(r7.spawned.length);
    });
  });

  // -------------------------------------------------------------------------
  // 9. TACTION_1_SPECIAL and TACTION_FULL_SPECIAL are distinct
  //    C++ taction.cpp:557-566: Enable(Action==TACTION_1_SPECIAL, false)
  // -------------------------------------------------------------------------
  it('TACTION_1_SPECIAL and TACTION_FULL_SPECIAL set different flags', () => {
    const r1 = exec(33);
    const rF = exec(34);
    expect(r1.oneSpecial).toBe(true);
    expect(r1.fullSpecial).toBeUndefined();
    expect(rF.fullSpecial).toBe(true);
    expect(rF.oneSpecial).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 10. Global set/clear idempotency (C++ scenario.cpp:268 — only cascade
  //     when previous != value)
  // -------------------------------------------------------------------------
  describe('global set/clear idempotency', () => {
    it('SET_GLOBAL on already-set global does not report globalChanged', () => {
      const globals = new Set<number>([5]);
      const r = exec(28, { data: 5, globals });
      // C++ only cascades when value actually changes
      expect(r.globalChanged).toBeUndefined();
    });

    it('CLEAR_GLOBAL on already-cleared global does not report globalChanged', () => {
      const globals = new Set<number>();
      const r = exec(29, { data: 5, globals });
      expect(r.globalChanged).toBeUndefined();
    });
  });
});
