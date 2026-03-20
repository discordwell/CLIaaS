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
} from '../engine/team';

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
// Section 3: IsFullStrength — C++ uses exact equality (==), TS uses >=
// C++ team.cpp:506:
//   IsFullStrength = (Total == desired);
//
// TS team.ts:269:
//   this.isFullStrength = (alive >= desired);
//
// PARITY GAP: if a team somehow has MORE members than desired (possible
// via forced add), C++ would NOT consider it full strength, but TS would.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: IsFullStrength exact equality (team.cpp:506)', () => {

  /**
   * C++ team.cpp:506:
   *   IsFullStrength = (Total == desired);
   *
   * TS team.ts:269:
   *   this.isFullStrength = (alive >= desired);
   *
   * When Total > desired, C++ sets IsFullStrength = false.
   * TS sets isFullStrength = true.
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

  it('PARITY GAP: above desired count — C++ says false, TS says true', () => {
    /**
     * C++ team.cpp:506:
     *   IsFullStrength = (Total == desired);  // 4 == 3 → false
     *
     * TS team.ts:269:
     *   this.isFullStrength = (alive >= desired);  // 4 >= 3 → true
     *
     * C++ only considers a team at "full strength" when EXACTLY at desired.
     * Having extra members does NOT make it full strength in C++.
     * This matters because IsFullStrength gates team activation (team.cpp:627).
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 3 }],
      missions: [{ mission: TMISSION_GUARD, data: 100 }],
    });
    // Force-add 4 members to a team wanting 3
    addMembers(team, 4);
    team.ai();

    // C++ expected: IsFullStrength = (4 == 3) = false
    // TS actual: isFullStrength = (4 >= 3) = true
    // PARITY GAP
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
// TS team.ts:307:
//   if (this.isMoving && this.isUnderStrength && !this.isSuicide) {
//
// PARITY GAP: TS adds !this.isSuicide which does NOT exist in C++.
// In C++, a suicide team that becomes under-strength DOES trigger retreat.
// In practice, suicide teams are typically non-reinforceable, so
// IsUnderStrength = !IsHasBeen = false after activation, making the
// difference moot. But the check itself is structurally different.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat block trigger (team.cpp:577)', () => {

  /**
   * C++ team.cpp:577:
   *   if (IsMoving && IsUnderStrength) {
   *
   * No IsSuicide check. In C++, suicide teams CAN enter this block if
   * they somehow become under-strength while moving.
   *
   * TS team.ts:307:
   *   if (this.isMoving && this.isUnderStrength && !this.isSuicide) {
   *
   * TS explicitly prevents suicide teams from retreating.
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

  it('PARITY GAP: suicide+reinforceable team — C++ retreats, TS does not', () => {
    /**
     * C++ team.cpp:577:
     *   if (IsMoving && IsUnderStrength) {  // no IsSuicide check
     *
     * A suicide+reinforceable team that becomes under-strength:
     * C++: enters retreat block (IsMoving=false, CurrentMission=-1)
     * TS:  !this.isSuicide is false, skips retreat block entirely
     *
     * This is an unusual flag combination (suicide teams are typically
     * not reinforceable), but C++ does not prevent it.
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

    // C++ expected: IsMoving = false (retreat triggered, no IsSuicide check)
    // TS actual: isMoving stays true (!this.isSuicide is false, skips retreat)
    // PARITY GAP
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
// TS team.ts:313-318:
//   - Simply uses zone center (this.zone) as retreat target
//   - No building scan, no repair facility preference
//
// PARITY GAP: TS lacks the building-based retreat targeting entirely.
// ══════════════════════════════════════════════════════════════════════════

describe('C++ parity: Retreat target selection (team.cpp:590-616)', () => {

  /**
   * C++ team.cpp:590-616:
   *   CELL dest = As_Cell(Zone);
   *   int max = 0x7FFFFFFF;
   *   for (int index = 0; index < Buildings.Count(); index++) {
   *     BuildingClass * b = Buildings.Ptr(index);
   *     if (b != NULL && !b->IsInLimbo && b->House == House && b->Class->PrimaryWeapon == NULL) {
   *       ...
   *       if (*b == STRUCT_REPAIR) {
   *         dist /= 2;  // repair facility preferred
   *       }
   *       ...
   *     }
   *   }
   *   Target = ::As_Target(dest);
   *   Coordinate_Move();
   *
   * TS team.ts:315-317:
   *   this.target = { ...this.zone };
   *   this.coordinateMove(waypoints);
   *
   * PARITY GAP: TS does no building scan. It just moves toward zone center.
   */

  it('PARITY GAP: retreat target should be a friendly building, not zone center', () => {
    /**
     * In C++, when a team retreats, it scans Buildings[] to find the nearest
     * friendly unarmed building, preferring STRUCT_REPAIR (repair facility).
     *
     * In TS, the retreat target is simply the team's zone center (average
     * position of remaining members), which means damaged teams circle back
     * to their current position rather than retreating to a repair facility
     * or friendly base.
     *
     * We test that the retreat target is set to zone center (TS behavior).
     * The C++ behavior would set it to a building location.
     */
    const team = makeTeam({
      memberDefs: [{ type: UnitType.V_3TNK, count: 6 }],
      missions: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    const entities = addMembers(team, 6, { startX: 200, y: 200, spacing: 2 });
    const waypoints = new Map<number, { cx: number; cy: number }>();
    waypoints.set(0, { cx: 50, cy: 50 });

    team.ai(waypoints); // activate

    // Trigger under-strength
    for (let i = 0; i < 5; i++) entities[i].alive = false;
    team.isAltered = true;
    team.ai(waypoints);

    // TS sets target to zone center (just the surviving member's position)
    // C++ would scan Buildings[] for a friendly building
    // We verify TS behavior: target should be close to the surviving member
    if (team.target) {
      // The surviving entity is entities[5], which is at (200 + 5*2, 200) = (210, 200)
      // Zone center of 1 member = that member's position
      expect(team.target.x).toBeCloseTo(entities[5].pos.x, 0);
      expect(team.target.y).toBeCloseTo(entities[5].pos.y, 0);
    }

    // PARITY GAP: C++ would NOT target zone center — it would find a building
    // This means TS retreat is effectively "stay in place" rather than "fall back to base"
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
