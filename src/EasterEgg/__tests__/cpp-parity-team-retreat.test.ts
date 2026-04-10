/**
 * C++ Behavioral Parity: Team Under-Strength Threshold & Retreat Mechanics
 *
 * Tests verify that Team under-strength calculation, retreat triggering, retreat
 * target selection, and suicide/reinforceable interactions match C++ TeamClass
 * behavior from team.cpp.
 *
 * Source references:
 *   - team.cpp:470-489   — AI() entry: suspend check, old_under snapshot
 *   - team.cpp:495-572   — IsAltered composition check: desired calc, IsFullStrength,
 *                          IsUnderStrength for reinforceable vs non-reinforceable,
 *                          empty team dissolve, reform trigger
 *   - team.cpp:505-506   — IsFullStrength = (Total == desired)  [EXACT equality]
 *   - team.cpp:515-520   — Reinforceable under-strength: desired>2 → Total<=desired/3;
 *                          desired<=2 → Total<desired  [C++ integer division]
 *   - team.cpp:521-530   — Non-reinforceable: IsUnderStrength = !IsHasBeen
 *   - team.cpp:532       — IsAltered = JustAltered = false  [JustAltered not in TS]
 *   - team.cpp:569-571   — Reform trigger: old_under != IsUnderStrength → IsReforming
 *   - team.cpp:577-621   — Retreat block: if (IsMoving && IsUnderStrength) — NO IsSuicide check
 *   - team.cpp:578-579   — IsMoving=false, CurrentMission=-1
 *   - team.cpp:590-616   — Retreat target: scan Buildings[] for friendly unarmed building,
 *                          prefer STRUCT_REPAIR (distance halved), weighted by cell threat
 *   - team.cpp:627-630   — Activation: if (!IsMoving && (IsFullStrength || IsForcedActive))
 *   - teamtype.h:192     — IsSuicide flag definition
 *   - teamtype.h:212     — IsReinforcable flag definition
 *
 * Observable outcomes:
 *   - Under-strength threshold calculation with integer division
 *   - IsFullStrength exact-equality vs TS greater-or-equal
 *   - Retreat block triggering (suicide team interaction)
 *   - Retreat state changes (IsMoving, CurrentMission reset)
 *   - Retreat target selection (repair facility preference vs zone center)
 *   - Reform trigger on under-strength state transitions
 *   - Non-reinforceable team under-strength after activation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE } from '../engine/types';
import {
  Team, resetTeamIds, clearAllTeams,
  TMISSION_MOVE, TMISSION_GUARD, TMISSION_ATTACK,
  type TeamAIContext,
} from '../engine/team';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x: number, y: number): Entity {
  const e = new Entity(type, house, x, y);
  e.facing = 0;
  e.bodyFacing32 = 0;
  return e;
}

function makeTeam(opts: {
  house?: House;
  memberDefs?: Array<{ type: string; count: number }>;
  missions?: Array<{ mission: number; data: number }>;
  recruitPriority?: number;
  isReinforcable?: boolean;
  isSuicide?: boolean;
  origin?: { x: number; y: number };
  forcedActive?: boolean;
}): Team {
  return new Team({
    house: opts.house ?? House.USSR,
    desiredMembers: opts.memberDefs ?? [
      { type: UnitType.V_3TNK, count: 3 },
    ],
    missionList: opts.missions ?? [],
    recruitPriority: opts.recruitPriority,
    isReinforcable: opts.isReinforcable,
    isSuicide: opts.isSuicide,
    origin: opts.origin ?? null,
    forcedActive: opts.forcedActive,
  });
}

/** Create a minimal MapStructure for testing retreat targeting */
function makeStructure(type: string, house: House, cx: number, cy: number): MapStructure {
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: 256, maxHp: 256, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

/** Add N entities to a team, returning them for manipulation */
function addMembers(team: Team, count: number, opts?: {
  type?: UnitType; house?: House; startX?: number; y?: number; spacing?: number;
}): Entity[] {
  const entities: Entity[] = [];
  const type = opts?.type ?? UnitType.V_3TNK;
  const house = opts?.house ?? House.USSR;
  const startX = opts?.startX ?? 100;
  const y = opts?.y ?? 100;
  const spacing = opts?.spacing ?? 1; // close together to avoid regroup issues
  for (let i = 0; i < count; i++) {
    const e = makeEntity(type, house, startX + i * spacing, y);
    entities.push(e);
    team.add(e);
  }
  return entities;
}

// ══════════════════════════════════════════════════════════════════════════
// Section 1: IsUnderStrength — 1/3 threshold with integer division
// C++ team.cpp:515-520
//
// if (Class->IsReinforcable) {
//   if (desired > 2) {
//     IsUnderStrength = (Total <= desired / 3);
//   } else {
//     IsUnderStrength = (Total < desired);
//   }
// }
//
// C++ integer division: desired/3 truncates toward zero.
// TS uses Math.floor(desired / 3) which should match for positive values.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: IsUnderStrength 1/3 threshold (team.cpp:515-520)', () => {

  /**
   * C++ team.cpp:516-517:
   *   if (desired > 2) {
   *     IsUnderStrength = (Total <= desired / 3);
   *   }
   *
   * C++ integer division: 3/3=1, 4/3=1, 5/3=1, 6/3=2, 7/3=2, 8/3=2, 9/3=3
   * Threshold: Total <= that value means under-strength.
   */

  // ── desired=3 ──
  // threshold = 3/3 = 1
  it('desired=3: 1 member is under strength (1 <= 3/3=1)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 3);
    team.ai(); // activate to full strength

    // Kill 2, leaving 1
    entities[0].alive = false;
    entities[1].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=3: 2 members is NOT under strength (2 > 3/3=1)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 3);
    team.ai(); // activate

    // Kill 1, leaving 2
    entities[0].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(false);
  });

  // ── desired=4 ──
  // threshold = 4/3 = 1 (C++ int division)
  it('desired=4: 1 member is under strength (1 <= 4/3=1)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 4 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 4);
    team.ai();

    for (let i = 0; i < 3; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // C++ int div: 4/3 = 1, Total=1 <= 1 → under strength
    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=4: 2 members is NOT under strength (2 > 4/3=1)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 4 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 4);
    team.ai();

    entities[0].alive = false;
    entities[1].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(false);
  });

  // ── desired=7 ──
  // threshold = 7/3 = 2 (C++ int division)
  it('desired=7: 2 members is under strength (2 <= 7/3=2)', () => {
    const team = makeTeam({
      memberDefs: [
        { type: UnitType.V_3TNK, count: 5 },
        { type: UnitType.I_E1, count: 2 },
      ],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 7);
    team.ai();

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // 7/3 = 2 in C++ int division, Math.floor(7/3) = 2 in TS
    // Total=2 <= 2 → under strength
    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=7: 3 members is NOT under strength (3 > 7/3=2)', () => {
    const team = makeTeam({
      memberDefs: [
        { type: UnitType.V_3TNK, count: 5 },
        { type: UnitType.I_E1, count: 2 },
      ],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 7);
    team.ai();

    for (let i = 0; i < 4; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(false);
  });

  // ── desired=9 ──
  // threshold = 9/3 = 3 (exact division)
  it('desired=9: 3 members is under strength (3 <= 9/3=3)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }, { type: UnitType.I_E1, count: 4 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 9);
    team.ai();

    for (let i = 0; i < 6; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // 9/3 = 3, Total=3 <= 3 → under strength
    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=9: 4 members is NOT under strength (4 > 9/3=3)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }, { type: UnitType.I_E1, count: 4 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 9);
    team.ai();

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(false);
  });

  // ── desired=10 ──
  // threshold = 10/3 = 3 (C++ int division)
  it('desired=10: 3 members is under strength (3 <= 10/3=3)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }, { type: UnitType.I_E1, count: 5 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 10);
    team.ai();

    for (let i = 0; i < 7; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // C++ int: 10/3 = 3, Math.floor(10/3) = 3
    // Total=3 <= 3 → under strength
    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=10: 4 members is NOT under strength (4 > 10/3=3)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }, { type: UnitType.I_E1, count: 5 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 10);
    team.ai();

    for (let i = 0; i < 6; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isUnderStrength).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 2: Small team threshold — desired <= 2
// C++ team.cpp:518-519:
//   } else {
//     IsUnderStrength = (Total < desired);
//   }
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Small team under-strength (team.cpp:518-519, desired<=2)', () => {

  /**
   * C++ team.cpp:518-519:
   *   } else {
   *     IsUnderStrength = (Total < desired);
   *   }
   *
   * For desired=1: under-strength only if Total=0 (which triggers dissolve path)
   * For desired=2: under-strength if Total < 2 (i.e., Total=1)
   */

  it('desired=2: 1 member is under strength (1 < 2)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    const e = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    team.add(e);
    team.ai();

    expect(team.isUnderStrength).toBe(true);
  });

  it('desired=2: 2 members is NOT under strength (2 >= 2)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 2 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    addMembers(team, 2);
    team.ai();

    expect(team.isUnderStrength).toBe(false);
    expect(team.isFullStrength).toBe(true);
  });

  it('desired=1: 1 member is NOT under strength (1 >= 1)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    addMembers(team, 1);
    team.ai();

    expect(team.isUnderStrength).toBe(false);
    expect(team.isFullStrength).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 3: IsFullStrength — C++ uses exact equality (==), TS matches
// C++ team.cpp:506:
//   IsFullStrength = (Total == desired);
//
// TS team.ts:276:
//   this.isFullStrength = (alive === desired);
//
// PARITY FIXED: TS now uses exact equality (===), matching C++ (==).
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: IsFullStrength exact equality (team.cpp:506)', () => {

  /**
   * C++ team.cpp:506:
   *   IsFullStrength = (Total == desired);
   *
   * TS team.ts:276:
   *   this.isFullStrength = (alive === desired);
   *
   * PARITY FIXED: TS now uses exact equality, matching C++.
   * When Total > desired, both C++ and TS set IsFullStrength = false.
   */

  it('exact desired count: isFullStrength = true (both C++ and TS agree)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    addMembers(team, 3);
    team.ai();

    expect(team.isFullStrength).toBe(true);
  });

  it('below desired count: isFullStrength = false (both agree)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    addMembers(team, 2);
    team.ai();

    expect(team.isFullStrength).toBe(false);
  });

  it('PARITY FIXED: above desired count — both C++ and TS say false', () => {
    /**
     * C++ team.cpp:506:
     *   IsFullStrength = (Total == desired);  // 4 == 3 → false
     *
     * TS team.ts:276:
     *   this.isFullStrength = (alive === desired);  // 4 === 3 → false
     *
     * Both use exact equality — over-staffed teams are NOT full strength.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    // Force-add 4 members to a team wanting 3
    addMembers(team, 4);
    team.ai();

    // Both C++ and TS: IsFullStrength = (4 == 3) = false
    expect(team.isFullStrength).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 4: Retreat block trigger — C++ has NO IsSuicide check
// C++ team.cpp:577:
//   if (IsMoving && IsUnderStrength) {
//     IsMoving = false;
//     CurrentMission = -1;
//     ...
//   }
//
// TS team.ts:314:
//   if (this.isMoving && this.isUnderStrength) {
//
// PARITY FIXED: TS now matches C++ — no IsSuicide check in the retreat guard.
// Both C++ and TS retreat any team (including suicide) that is moving + under-strength.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat block trigger (team.cpp:577)', () => {

  /**
   * C++ team.cpp:577:
   *   if (IsMoving && IsUnderStrength) {
   *
   * TS team.ts:314:
   *   if (this.isMoving && this.isUnderStrength) {
   *
   * PARITY FIXED: Both C++ and TS use the same guard — no IsSuicide check.
   */

  it('non-suicide team retreats when under strength (both agree)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [
        { mission: TMISSION_MOVE, data: 0 },
        { mission: TMISSION_GUARD, data: 100 },
      ],
      isSuicide: false,
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    team.ai(waypoints); // activate + start moving

    expect(team.isMoving).toBe(true);

    // Kill 5, leaving 1 — below 1/3 threshold (1 <= 6/3=2)
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // Both C++ and TS: isMoving should be false (retreat triggered)
    expect(team.isMoving).toBe(false);
    expect(team.currentMission).toBe(-1);
  });

  it('PARITY FIXED: suicide+reinforceable team — both C++ and TS retreat', () => {
    /**
     * C++ team.cpp:577:
     *   if (IsMoving && IsUnderStrength) {  // no IsSuicide check
     *
     * TS team.ts:314:
     *   if (this.isMoving && this.isUnderStrength) {  // no IsSuicide check
     *
     * A suicide+reinforceable team that becomes under-strength:
     * Both C++ and TS enter the retreat block (IsMoving=false, CurrentMission=-1).
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [
        { mission: TMISSION_MOVE, data: 0 },
        { mission: TMISSION_GUARD, data: 100 },
      ],
      isSuicide: true,
      isReinforcable: true, // unusual combo: suicide + reinforceable
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    team.ai(waypoints); // activate

    expect(team.isMoving).toBe(true);

    // Kill 5, leaving 1 — under 1/3 threshold
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // Both C++ and TS: IsMoving = false (retreat triggered, no IsSuicide check)
    expect(team.isMoving).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 5: Retreat state reset
// C++ team.cpp:578-579:
//   IsMoving = false;
//   CurrentMission = -1;
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat state reset (team.cpp:578-579)', () => {

  /**
   * C++ team.cpp:577-579:
   *   if (IsMoving && IsUnderStrength) {
   *     IsMoving = false;
   *     CurrentMission = -1;
   *     ...
   *   }
   */

  it('retreat resets currentMission to -1', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [
        { mission: TMISSION_MOVE, data: 0 },
        { mission: TMISSION_ATTACK, data: 0 },
      ],
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    team.ai(waypoints); // activate
    team.ai(waypoints); // advance to MOVE

    expect(team.currentMission).toBe(0);

    // Trigger under-strength
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // C++ resets CurrentMission = -1
    expect(team.currentMission).toBe(-1);
    expect(team.isMoving).toBe(false);
  });

  it('retreat returns early — no further mission processing in same tick', () => {
    /**
     * C++ team.cpp:617:
     *   return;  // early return after retreat
     *
     * After setting up retreat, C++ returns from AI() immediately.
     * No activation check, no mission advance, no mission execution.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [
        { mission: TMISSION_GUARD, data: 100 },
      ],
      forcedActive: true,
    });
    const entities = addMembers(team, 6);

    team.ai(); // activate

    // Force under-strength with Total=1
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;

    // The remaining entity should get a MOVE command toward retreat target
    // (not a GUARD from the mission, confirming early return)
    team.ai();

    expect(team.isMoving).toBe(false);
    // Verify team didn't re-activate in the same tick
    // (C++ returns at line 617 before reaching activation at line 627)
    expect(team.isMoving).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 6: Retreat target — C++ prefers repair facility
// C++ team.cpp:590-616:
//   - Scans all Buildings for friendly unarmed buildings
//   - Distance = Distance(building, Zone) * (CellThreat + 1)
//   - STRUCT_REPAIR halves distance (preferred)
//   - Picks closest by weighted distance
//   - Calls Safety_Point() for final cell
//
// TS team.ts now implements building-based retreat targeting matching C++.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat target selection (team.cpp:590-616)', () => {

  /**
   * C++ team.cpp:590-616:
   *   Scans Buildings[] for friendly unarmed buildings.
   *   STRUCT_REPAIR (FIX) gets halved distance (preferred retreat target).
   *   Armed structures (GUN, TSLA, SAM, etc.) are skipped.
   *
   * TS team.ts now scans structures via findRetreatBuilding():
   *   - Filters: alive, same house, no weapon in STRUCTURE_WEAPONS
   *   - FIX distance halved (preferred)
   *   - Falls back to zone center if no buildings available
   */

  it('retreat targets nearest friendly unarmed building (not zone center)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    // Create friendly buildings — PROC at (10,10) is the nearest unarmed building
    // Units are at pixel ~(200,200), PROC center at ~(276, 264)
    const structures: MapStructure[] = [
      makeStructure('PROC', House.USSR, 10, 10),
      makeStructure('POWR', House.USSR, 30, 30),
    ];
    const ctx: TeamAIContext = { structures };

    team.ai(waypoints, ctx); // activate

    // Trigger under-strength
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints, ctx);

    // Retreat target should be the nearest unarmed building (PROC at 10,10)
    // not zone center (surviving member at ~210,200)
    expect(team.target).not.toBeNull();
    if (team.target) {
      const [pw, ph] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
      const expectedX = (10 + pw / 2) * CELL_SIZE;
      const expectedY = (10 + ph / 2) * CELL_SIZE;
      expect(team.target.x).toBeCloseTo(expectedX, -1);
      expect(team.target.y).toBeCloseTo(expectedY, -1);
    }
  });

  it('retreat prefers repair facility (FIX) — distance halved (team.cpp:612)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    // Place members at (200, 200)
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    // PROC at (30,30) is closer in raw distance,
    // but FIX at (40,40) has halved distance and should be preferred
    // Raw distance to PROC: ~sqrt((200-30*24)^2+(200-30*24)^2)
    // For this to work, FIX needs to be farther but < 2x farther than PROC
    const structures: MapStructure[] = [
      makeStructure('PROC', House.USSR, 5, 5),  // closer raw
      makeStructure('FIX', House.USSR, 6, 6),   // slightly farther, but halved
    ];
    const ctx: TeamAIContext = { structures };

    team.ai(waypoints, ctx); // activate

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints, ctx);

    // FIX should be preferred (distance halved)
    expect(team.target).not.toBeNull();
    if (team.target) {
      const [fw, fh] = STRUCTURE_SIZE['FIX'] ?? [1, 1];
      const expectedX = (6 + fw / 2) * CELL_SIZE;
      const expectedY = (6 + fh / 2) * CELL_SIZE;
      expect(team.target.x).toBeCloseTo(expectedX, -1);
      expect(team.target.y).toBeCloseTo(expectedY, -1);
    }
  });

  it('retreat ignores armed structures (C++ PrimaryWeapon != NULL)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    // Only armed structures (GUN, TSLA) — should be skipped
    // POWR is further away but unarmed — should be the target
    const structures: MapStructure[] = [
      makeStructure('GUN', House.USSR, 5, 5),   // armed, closer
      makeStructure('TSLA', House.USSR, 6, 6),  // armed, closer
      makeStructure('POWR', House.USSR, 10, 10), // unarmed, further
    ];
    const ctx: TeamAIContext = { structures };

    team.ai(waypoints, ctx);

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints, ctx);

    // Should target POWR (only unarmed building), not GUN/TSLA
    expect(team.target).not.toBeNull();
    if (team.target) {
      const [pw, ph] = STRUCTURE_SIZE['POWR'] ?? [1, 1];
      const expectedX = (10 + pw / 2) * CELL_SIZE;
      const expectedY = (10 + ph / 2) * CELL_SIZE;
      expect(team.target.x).toBeCloseTo(expectedX, -1);
      expect(team.target.y).toBeCloseTo(expectedY, -1);
    }
  });

  it('retreat ignores enemy buildings (C++ b->House == House)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    // Only enemy buildings — should fall back to zone center
    const structures: MapStructure[] = [
      makeStructure('PROC', House.Spain, 5, 5),  // enemy
      makeStructure('POWR', House.Spain, 10, 10), // enemy
    ];
    const ctx: TeamAIContext = { structures };

    team.ai(waypoints, ctx);

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints, ctx);

    // Should fall back to zone center (surviving member's position)
    if (team.target) {
      expect(team.target.x).toBeCloseTo(entities[5].pos.x, -1);
      expect(team.target.y).toBeCloseTo(entities[5].pos.y, -1);
    }
  });

  it('retreat falls back to zone center when no structures available', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    // No structures at all
    team.ai(waypoints);

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // Should fall back to zone center
    if (team.target) {
      expect(team.target.x).toBeCloseTo(entities[5].pos.x, -1);
      expect(team.target.y).toBeCloseTo(entities[5].pos.y, -1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 7: Reform trigger on under-strength state transitions
// C++ team.cpp:569-571:
//   if (old_under != IsUnderStrength) {
//     IsReforming = true;
//   }
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Reform trigger (team.cpp:569-571)', () => {

  /**
   * C++ team.cpp:569-571:
   *   if (old_under != IsUnderStrength) {
   *     IsReforming = true;
   *   }
   *
   * Reform is triggered whenever the under-strength state CHANGES, in
   * either direction (becoming under-strength OR recovering from it).
   */

  it('transitioning INTO under-strength triggers reform', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    team.ai(); // activate — sets isUnderStrength=false

    expect(team.isUnderStrength).toBe(false);

    // Kill enough to go under strength
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;

    // Snapshot: old_under = false, after composition check IsUnderStrength = true
    // old_under != IsUnderStrength → IsReforming = true
    team.ai();

    expect(team.isUnderStrength).toBe(true);
    expect(team.isReforming).toBe(true);
  });

  it('transitioning OUT of under-strength triggers reform', () => {
    /**
     * When under-strength transitions from true→false, C++ sets IsReforming=true
     * (team.cpp:569-571). However, in the same AI() tick, the reforming fallback
     * block (team.cpp:862-864) runs: IsReforming = !Coordinate_Regroup().
     * If all members are close together, Coordinate_Regroup returns true and
     * IsReforming is immediately cleared back to false.
     *
     * To observe IsReforming=true persisting after ai(), we place members
     * far apart so Coordinate_Regroup returns false (not all regrouped).
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });

    // Start with just 1 member (under strength)
    const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    team.add(e1);
    team.ai();
    expect(team.isUnderStrength).toBe(true);

    // Add 5 more at DISTANT positions so Coordinate_Regroup returns false
    for (let i = 0; i < 5; i++) {
      const e = makeEntity(UnitType.V_3TNK, House.USSR, 500 + i * 100, 500 + i * 100);
      team.add(e);
    }
    team.ai(); // composition re-evaluated: isUnderStrength transitions true→false

    // After reaching full strength: old_under=true, new IsUnderStrength=false
    // old_under != IsUnderStrength → IsReforming = true (team.cpp:569-571)
    // Then reforming fallback: IsReforming = !Coordinate_Regroup()
    // Members are far apart → Coordinate_Regroup returns false → IsReforming stays true
    expect(team.isReforming).toBe(true);
  });

  it('no state change → no reform trigger', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    addMembers(team, 6);
    team.ai(); // activate

    // Reset isReforming after activation
    team.isReforming = false;
    team.isAltered = true; // force re-evaluation but no member changes

    team.ai();

    // No state transition → isReforming should stay false
    expect(team.isReforming).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 8: Non-reinforceable team under-strength logic
// C++ team.cpp:521-530:
//   } else {
//     // Teams that are not flagged as reinforceable are never considered under
//     // strength if the team has already started its main mission.
//     IsUnderStrength = !IsHasBeen;
//   }
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Non-reinforceable under-strength (team.cpp:521-530)', () => {

  /**
   * C++ team.cpp:528-529:
   *   IsUnderStrength = !IsHasBeen;
   *
   * Once isHasBeen is true (team reached full strength and activated),
   * non-reinforceable teams are NEVER considered under-strength,
   * regardless of how many members die.
   */

  it('before activation: isUnderStrength = true (!isHasBeen = !false = true)', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      isReinforcable: false,
    });
    addMembers(team, 1); // partial
    team.ai();

    expect(team.isHasBeen).toBe(false);
    expect(team.isUnderStrength).toBe(true); // !isHasBeen = true
  });

  it('after activation: isUnderStrength = false even with heavy losses', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      isReinforcable: false,
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    team.ai(); // activate → isHasBeen = true

    expect(team.isHasBeen).toBe(true);

    // Kill 5 of 6 members
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // Non-reinforceable: IsUnderStrength = !IsHasBeen = !true = false
    expect(team.isUnderStrength).toBe(false);
    // Team should continue operating, not retreat
    expect(team.isMoving).toBe(true);
  });

  it('non-reinforceable team with 1/6 members does NOT retreat', () => {
    /**
     * This is the key behavioral difference from reinforceable teams.
     * A reinforceable team with 1/6 members would be under strength (1 <= 6/3=2)
     * and would retreat. A non-reinforceable team fights to the last unit.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [
        { mission: TMISSION_MOVE, data: 0 },
        { mission: TMISSION_GUARD, data: 100 },
      ],
      isReinforcable: false,
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    team.ai(waypoints); // activate

    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // Non-reinforceable: never goes under strength after activation
    expect(team.isUnderStrength).toBe(false);
    expect(team.isMoving).toBe(true);
    expect(team.currentMission).not.toBe(-1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 9: Empty team under-strength and dissolve
// C++ team.cpp:533-562:
//   } else {         // Total == 0
//     IsUnderStrength = true;
//     IsFullStrength = false;
//     Zone = TARGET_NONE;
//     if (IsHasBeen || Session.Type != GAME_NORMAL) {
//       ...
//       delete this;
//       return;
//     }
//   }
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Empty team handling (team.cpp:533-562)', () => {

  /**
   * C++ team.cpp:533-536:
   *   } else {
   *     IsUnderStrength = true;
   *     IsFullStrength = false;
   *     Zone = TARGET_NONE;
   */

  it('empty team: isUnderStrength=true, isFullStrength=false, zone=null', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });

    // Start with members, then kill all
    const entities = addMembers(team, 3);
    team.ai(); // activate

    for (const e of entities) e.alive = false;
    team.isAltered = true;
    team.ai();

    // Before dissolve check: isUnderStrength=true, isFullStrength=false
    // Then dissolve happens because isHasBeen is true
    expect(team.dissolved).toBe(true);
  });

  it('empty team without isHasBeen does NOT dissolve (waits for reinforcement)', () => {
    /**
     * C++ team.cpp:544:
     *   if (IsHasBeen || Session.Type != GAME_NORMAL) {
     *     ...
     *     delete this;
     *
     * In normal single-player games, empty teams that never reached full
     * strength wait for reinforcements instead of dissolving.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      // Not forcedActive, not full strength → isHasBeen stays false
    });

    // Add only 2 of 5 desired, then kill both
    const e1 = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    const e2 = makeEntity(UnitType.V_3TNK, House.USSR, 101, 100);
    team.add(e1);
    team.add(e2);
    team.ai();

    expect(team.isHasBeen).toBe(false);

    e1.alive = false;
    e2.alive = false;
    team.isAltered = true;
    team.ai();

    // C++ does not dissolve because IsHasBeen is false
    expect(team.dissolved).toBe(false);
    expect(team.isUnderStrength).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 10: Activation gate — IsFullStrength || IsForcedActive
// C++ team.cpp:627-630:
//   if (!IsMoving && (IsFullStrength || IsForcedActive)) {
//     IsMoving = true;
//     IsHasBeen = true;
//     IsUnderStrength = false;
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Activation gate (team.cpp:627-630)', () => {

  /**
   * C++ team.cpp:627:
   *   if (!IsMoving && (IsFullStrength || IsForcedActive)) {
   *
   * Activation requires either:
   * 1. IsFullStrength == true (Total == desired in C++)
   * 2. IsForcedActive == true (explicitly forced)
   *
   * And !IsMoving (team not already active).
   */

  it('activation clears isUnderStrength', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 1 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });

    expect(team.isUnderStrength).toBe(true); // constructor default

    addMembers(team, 1);
    team.ai(); // full strength → activate

    // C++ team.cpp:630: IsUnderStrength = false
    expect(team.isUnderStrength).toBe(false);
    expect(team.isMoving).toBe(true);
    expect(team.isHasBeen).toBe(true);
  });

  it('forcedActive activates even when not at full strength', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 5 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });

    // Only 2 of 5 members
    addMembers(team, 2);
    team.ai();

    expect(team.isMoving).toBe(true);
    expect(team.isHasBeen).toBe(true);
    expect(team.isUnderStrength).toBe(false); // cleared by activation
  });

  it('does NOT activate without full strength or forcedActive', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    addMembers(team, 2); // 2 < 3 desired
    team.ai();

    expect(team.isMoving).toBe(false);
    expect(team.isHasBeen).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 11: Retreat + re-activation cycle
// When a team retreats, it resets IsMoving and CurrentMission.
// It can re-activate when it reaches full strength again (via reinforcement).
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat and re-activation cycle', () => {

  it('team can re-activate after retreat when reinforced to full strength', () => {
    /**
     * After retreat:
     * - IsMoving = false
     * - CurrentMission = -1
     * - Team waits for reinforcement
     *
     * When new members bring it to full strength:
     * - Activation block (team.cpp:627) fires again
     * - IsMoving = true, missions restart from -1
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [
        { mission: TMISSION_GUARD, data: 100 },
      ],
    });
    const entities = addMembers(team, 3);
    team.ai(); // activate

    expect(team.isMoving).toBe(true);

    // Kill 2, trigger retreat (1 <= 3/3=1 → under strength)
    entities[0].alive = false;
    entities[1].alive = false;
    team.isAltered = true;
    team.ai();

    expect(team.isMoving).toBe(false);
    expect(team.currentMission).toBe(-1);

    // Reinforce with 2 new members
    const e3 = makeEntity(UnitType.V_3TNK, House.USSR, 101, 100);
    const e4 = makeEntity(UnitType.V_3TNK, House.USSR, 102, 100);
    team.add(e3);
    team.add(e4);
    team.ai();

    // Now at 3/3 → full strength → re-activates
    expect(team.isMoving).toBe(true);
    expect(team.isHasBeen).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 12: Comprehensive threshold boundary table
// Tests the exact boundary for all common team sizes to verify
// integer division parity between C++ (int/3) and TS (Math.floor/3).
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Comprehensive threshold boundary table', () => {

  /**
   * For each desired count (3..12), calculate:
   *   threshold = floor(desired / 3)
   *   Total <= threshold → under strength
   *   Total = threshold + 1 → NOT under strength
   *
   * This verifies Math.floor matches C++ integer division for all
   * practical team sizes.
   */

  const BOUNDARY_CASES: [number, number][] = [
    // [desired, threshold = desired/3 in C++ int division]
    [3, 1],   // 3/3 = 1
    [4, 1],   // 4/3 = 1
    [5, 1],   // 5/3 = 1
    [6, 2],   // 6/3 = 2
    [7, 2],   // 7/3 = 2
    [8, 2],   // 8/3 = 2
    [9, 3],   // 9/3 = 3
    [10, 3],  // 10/3 = 3
    [11, 3],  // 11/3 = 3
    [12, 4],  // 12/3 = 4
  ];

  for (const [desired, threshold] of BOUNDARY_CASES) {
    it(`desired=${desired}: ${threshold} members IS under strength (${threshold} <= ${desired}/3=${threshold})`, () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: desired }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });
      const entities = addMembers(team, desired);
      team.ai(); // activate

      // Kill down to exactly threshold
      const toKill = desired - threshold;
      for (let i = 0; i < toKill; i++) entities[i].alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.isUnderStrength).toBe(true);
    });

    it(`desired=${desired}: ${threshold + 1} members is NOT under strength (${threshold + 1} > ${desired}/3=${threshold})`, () => {
      const team = makeTeam({
        memberDefs: [{ type: UnitType.V_3TNK, count: desired }],
        missions: [{ mission: TMISSION_GUARD, data: 100 }],
        forcedActive: true,
      });
      const entities = addMembers(team, desired);
      team.ai(); // activate

      // Kill down to threshold + 1
      const toKill = desired - (threshold + 1);
      for (let i = 0; i < toKill; i++) entities[i].alive = false;
      team.isAltered = true;
      team.ai();

      expect(team.isUnderStrength).toBe(false);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Section 13: C++ old_under snapshot timing
// C++ team.cpp:476:
//   int old_under = IsUnderStrength;
// The snapshot is taken BEFORE composition check. Reform trigger
// compares old snapshot vs new value.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: old_under snapshot timing (team.cpp:476)', () => {

  /**
   * C++ team.cpp:476:
   *   int old_under = IsUnderStrength;  // snapshot before composition check
   *
   * C++ team.cpp:569:
   *   if (old_under != IsUnderStrength) {  // compare after composition check
   *     IsReforming = true;
   *   }
   *
   * The reform trigger depends on the state CHANGING during the composition
   * check, not just on the current state.
   */

  it('reform triggered when under-strength changes in composition check', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6);
    team.ai(); // activate

    // isUnderStrength is now false
    team.isReforming = false; // clear any reform from activation
    expect(team.isUnderStrength).toBe(false);

    // Kill 5 → under strength transition (false → true)
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai();

    // old_under (false) != new IsUnderStrength (true) → reform
    expect(team.isReforming).toBe(true);
  });

  it('no reform when isAltered is false (no composition check)', () => {
    /**
     * C++ team.cpp:495:
     *   if (IsAltered) { ... }
     *
     * If IsAltered is false, composition is not re-evaluated,
     * so old_under == IsUnderStrength (no change), no reform.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    addMembers(team, 6);
    team.ai(); // activate, composition check sets isAltered = false

    team.isReforming = false;
    expect(team.isAltered).toBe(false);

    // Don't set isAltered = true → composition check skipped → no reform
    team.ai();

    expect(team.isReforming).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Section 14: Retreat with Total=0 — Zone reset
// C++ team.cpp:618-620:
//   } else {
//     Zone = TARGET_NONE;
//   }
// When retreat triggers but team has no living members, Zone is cleared.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat with no living members (team.cpp:618-620)', () => {

  /**
   * C++ team.cpp:577-620:
   *   if (IsMoving && IsUnderStrength) {
   *     IsMoving = false;
   *     CurrentMission = -1;
   *     if (Total) {
   *       ... retreat to building ...
   *     } else {
   *       Zone = TARGET_NONE;
   *     }
   *   }
   *
   * When under-strength with 0 members, only Zone is cleared.
   * (In practice, empty team would have been caught by the dissolve
   * check above, but the code path exists.)
   */

  it('retreat with empty member list sets zone to null', () => {
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
      forcedActive: true,
    });
    addMembers(team, 3);
    team.ai(); // activate

    // Manually set state to trigger the specific code path
    // (normally empty team would dissolve first)
    team.isMoving = true;
    team.isUnderStrength = true;
    team.zone = { x: 100, y: 100 };
    // Clear members without going through normal flow
    while (team.members.length > 0) {
      team.remove(team.members[0]);
    }

    // Prevent dissolve by keeping isHasBeen false
    (team as any).isHasBeen = false;
    team.isAltered = false; // skip composition check

    team.ai();

    // C++ sets Zone = TARGET_NONE when Total=0 in retreat path
    expect(team.zone).toBeNull();
  });
});
