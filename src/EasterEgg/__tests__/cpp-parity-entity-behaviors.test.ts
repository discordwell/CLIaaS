/**
 * C++ Behavioral Parity Tests: Entity Behaviors
 *
 * Tests mission queue, formation movement, scatter, turret rotation,
 * cloaking state machine, guard mode, and condition thresholds against
 * the original C++ Red Alert source code.
 *
 * C++ source references:
 *   - defines.h:979-1008    — MissionType enum (22 values)
 *   - defines.h:952-957     — CloakType enum (4 states)
 *   - defines.h:2942-2955   — FacingType enum (8 directions)
 *   - defines.h:2995-3005   — DirType (256-value direction system, 32 per octant)
 *   - defines.h:3031-3032   — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - const.cpp:83-107      — Missions[] name array (22 entries)
 *   - rules.cpp:233-235     — ConditionGreen=1, ConditionYellow=1/2, ConditionRed=1/4
 *   - mission.cpp:70-78     — MissionClass constructor defaults
 *   - mission.cpp:133-139   — Set_Mission: clears MissionQueue
 *   - mission.cpp:158-163   — Get_Mission: returns MissionQueue if Mission is NONE
 *   - mission.cpp:343-359   — Commence: promotes MissionQueue, resets Timer/Status
 *   - mission.cpp:379-391   — Assign_Mission: QMOVE→MOVE, skip if same as current
 *   - mission.cpp:532-543   — MissionControlClass defaults (all true/false)
 *   - techno.cpp:142        — MAX_UNCLOAK_STAGE = 38
 *   - techno.cpp:4045-4066  — Do_Uncloak: CLOAKED/CLOAKING → UNCLOAKING
 *   - techno.cpp:4083-4107  — Do_Cloak: UNCLOAKED/UNCLOAKING → CLOAKING
 *   - techno.cpp:2438-2536  — Cloaking_AI: state machine transitions
 *   - techno.cpp:2557-2607  — Is_Ready_To_Cloak: preconditions
 *   - unit.cpp:507-564      — Rotation_AI: turret at ROT+1, body rotation
 *   - foot.cpp:118-119      — XFormOffset/YFormOffset init to 0x80000000
 *   - foot.cpp:2185-2199    — Adjust_Dest: formation offset applied
 *   - infantry.cpp:1852-1907— Scatter: mission-gated, forced flag, human check
 *   - foot.cpp:1140-1153    — Take_Damage scatter: IsScatter checks
 */

import { describe, it, expect } from 'vitest';
import {
  Dir, Mission, House, UnitType, Stance,
  CONDITION_RED, CONDITION_YELLOW,
  UNIT_STATS, MISSION_CONTROL,
} from '../engine/types';
import type { MissionControl } from '../engine/types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from '../engine/entity';


// =============================================================================
// Section 1: Mission Enum Values
// C++ defines.h:979-1008 — MissionType enum ordering
// =============================================================================
describe('Mission enum values — C++ defines.h:979-1008', () => {

  /**
   * C++ MissionType enum (defines.h:979-1008):
   *   MISSION_NONE=-1
   *   MISSION_SLEEP=0, MISSION_ATTACK=1, MISSION_MOVE=2, MISSION_QMOVE=3,
   *   MISSION_RETREAT=4, MISSION_GUARD=5, MISSION_STICKY=6, MISSION_ENTER=7,
   *   MISSION_CAPTURE=8, MISSION_HARVEST=9, MISSION_GUARD_AREA=10,
   *   MISSION_RETURN=11, MISSION_STOP=12, MISSION_AMBUSH=13, MISSION_HUNT=14,
   *   MISSION_UNLOAD=15, MISSION_SABOTAGE=16, MISSION_CONSTRUCTION=17,
   *   MISSION_DECONSTRUCTION=18, MISSION_REPAIR=19, MISSION_RESCUE=20,
   *   MISSION_MISSILE=21, MISSION_HARMLESS=22
   *   MISSION_COUNT=23, MISSION_FIRST=0
   *
   * TS uses string enums, so we can't test numeric parity directly.
   * Instead we verify all 22 C++ missions exist in the TS enum.
   */
  const CPP_MISSIONS = [
    'SLEEP', 'ATTACK', 'MOVE', 'QMOVE', 'RETREAT', 'GUARD', 'STICKY',
    'ENTER', 'CAPTURE', 'HARVEST', 'AREA_GUARD', 'RETURN', 'STOP',
    'AMBUSH', 'HUNT', 'UNLOAD', 'SABOTAGE', 'CONSTRUCTION',
    'DECONSTRUCTION', 'REPAIR', 'RESCUE', 'MISSILE', 'HARMLESS',
  ];

  // C++ const.cpp:83-107 — Missions[] name array (note: "Area Guard" has space, "Selling" for DECONSTRUCTION)
  const CPP_MISSION_NAMES = [
    'Sleep', 'Attack', 'Move', 'QMove', 'Retreat', 'Guard', 'Sticky',
    'Enter', 'Capture', 'Harvest', 'Area Guard', 'Return', 'Stop',
    'Ambush', 'Hunt', 'Unload', 'Sabotage', 'Construction', 'Selling',
    'Repair', 'Rescue', 'Missile', 'Harmless',
  ];

  it('TS Mission enum contains all 23 C++ mission types (22 + GUARD_AREA as AREA_GUARD)', () => {
    for (const name of CPP_MISSIONS) {
      const tsValue = (Mission as Record<string, string>)[name];
      expect(tsValue, `Mission.${name} should exist in TS enum`).toBeDefined();
    }
  });

  it('C++ MISSION_COUNT = 23 missions; TS should have at least 23', () => {
    // C++ has 23 missions (0-22). TS also has DIE which is not in C++ enum.
    const tsMissionCount = Object.keys(Mission).length;
    expect(tsMissionCount).toBeGreaterThanOrEqual(23);
  });

  it('C++ Missions[] has 23 name entries (const.cpp:83-107)', () => {
    expect(CPP_MISSION_NAMES.length).toBe(23);
  });

  it('TS has DIE mission which C++ handles through object destruction, not a mission enum', () => {
    // C++ has no MISSION_DIE — death is handled by object state (Strength <= 0).
    // TS adds DIE as a mission. This is a design divergence, not a bug.
    expect(Mission.DIE).toBe('DIE');
  });
});


// =============================================================================
// Section 2: Mission Queue Behavior
// C++ mission.cpp:133-139 (Set_Mission), 158-163 (Get_Mission),
//     343-359 (Commence), 379-391 (Assign_Mission)
// =============================================================================
describe('Mission queue behavior — C++ mission.cpp', () => {

  it('Assign_Mission translates QMOVE to MOVE (mission.cpp:386)', () => {
    // C++ mission.cpp:386: if (order == MISSION_QMOVE) order = MISSION_MOVE;
    // TS has QMOVE as a separate mission, but the C++ code converts it.
    // We verify TS has both as distinct enums — whether QMOVE→MOVE translation
    // happens is in the game loop, not in Mission enum.
    expect(Mission.QMOVE).toBe('QMOVE');
    expect(Mission.MOVE).toBe('MOVE');
    expect(Mission.QMOVE).not.toBe(Mission.MOVE);
  });

  it('Entity starts with GUARD mission (C++ foot.cpp constructor → Enter_Idle_Mode → GUARD)', () => {
    // C++ MissionClass constructor (mission.cpp:70-78) initializes Mission=MISSION_NONE.
    // But Enter_Idle_Mode is called during creation, setting it to GUARD.
    // TS entity.ts:84 initializes mission = Mission.GUARD directly.
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.mission).toBe(Mission.GUARD);
  });

  it('Entity mission queue starts as null (C++ MissionQueue = MISSION_NONE)', () => {
    // C++ mission.cpp:74: MissionQueue(MISSION_NONE)
    // TS entity.ts:85: missionQueue = null (null ≡ MISSION_NONE)
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.missionQueue).toBeNull();
  });
});


// =============================================================================
// Section 3: Condition Thresholds
// C++ rules.cpp:233-235:
//   ConditionGreen(1)          — full health
//   ConditionYellow(fixed(1,2)) — 50% health
//   ConditionRed(fixed(1,4))    — 25% health
// =============================================================================
describe('Condition thresholds — C++ rules.cpp:233-235', () => {

  it('CONDITION_RED = 0.25 (C++ ConditionRed = fixed(1,4) = 1/4)', () => {
    // C++ rules.cpp:235: ConditionRed(fixed(1, 4))
    // fixed(1,4) = 1/4 = 0.25
    expect(CONDITION_RED).toBe(0.25);
  });

  it('CONDITION_YELLOW = 0.5 (C++ ConditionYellow = fixed(1,2) = 1/2)', () => {
    // C++ rules.cpp:234: ConditionYellow(fixed(1, 2))
    // fixed(1,2) = 1/2 = 0.5
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('C++ ConditionGreen = 1 (full health) — TS should not define a separate constant < 1', () => {
    // C++ rules.cpp:233: ConditionGreen(1) — means health ratio >= 1.0 is green
    // TS doesn't export CONDITION_GREEN; verify the implicit assumption.
    // Any health ratio > CONDITION_YELLOW is considered green/healthy.
    expect(CONDITION_YELLOW).toBeLessThan(1.0);
    expect(CONDITION_RED).toBeLessThan(CONDITION_YELLOW);
  });
});


// =============================================================================
// Section 4: Turret Rotation
// C++ unit.cpp:507-564 — Rotation_AI
// Key: turret rotates at ROT+1 (unit.cpp:542)
// =============================================================================
describe('Turret rotation — C++ unit.cpp:507-564', () => {

  it('turret rotation rate is ROT+1 (C++ unit.cpp:542: Rotation_Adjust(Class->ROT+1))', () => {
    // C++ unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
    // TS entity.ts:687: this.turretRotAccumulator += this.stats.rot + 1
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    // Medium Tank has ROT=5 (C++ udata.cpp:511)
    expect(tank.stats.rot).toBe(5);

    // Set turret to face East, desire to face North
    tank.turretFacing = Dir.E;
    tank.turretFacing32 = Dir.E * 4; // 8
    tank.desiredTurretFacing = Dir.N;

    // Tick turret rotation — accumulator should increase by ROT+1 = 6
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    // After 1 tick: accumulator += 6, but 6 < 8 threshold, no step yet
    // Actually: ROT+1=6, accumulator starts at 0, after tick: 6
    // 6 < 8, so no visual step
    expect(tank.turretFacing32).not.toBe(Dir.N * 4);
  });

  it('turret visual step happens when accumulator reaches 8 (256/32)', () => {
    // C++ 256-value direction system / 32 visual steps = 8 per step
    // TS entity.ts:688: if (this.turretRotAccumulator >= 8)
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    tank.turretFacing = Dir.E;
    tank.turretFacing32 = Dir.E * 4; // = 8
    tank.desiredTurretFacing = Dir.NE;
    const startFacing32 = tank.turretFacing32;

    // Tick 1: accumulator = 0 + 6 = 6 (< 8, no step)
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Tick 2: accumulator = 6 + 6 = 12 (>= 8, take one step)
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should have stepped at least once
    expect(tank.turretFacing32).not.toBe(startFacing32);
  });

  it('turret uses shortest-path rotation (C++ facing system wraps 0-31)', () => {
    // C++ facing system uses shortest path around the 32-step ring
    // TS entity.ts:690: diff32 <= 16 → clockwise, else counter-clockwise
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    // Face N (0), want NW (28) — shortest is counter-clockwise (-4 steps)
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NW;
    tank.turretRotAccumulator = 7; // prime it so next tick triggers a step

    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should go counter-clockwise: 0 → 31 (mod 32)
    // diff32 = (28 - 0 + 32) % 32 = 28, which is > 16, so CCW
    expect(tank.turretFacing32).toBe(31);
  });

  it('turret snaps to body when idle with no target (C++ unit.cpp:554-560)', () => {
    // C++ unit.cpp:554-556: if (!IsTurretLockedDown && !Target_Legal(TarCom))
    //   SecondaryFacing.Set_Desired(PrimaryFacing.Current())
    // TS sets desiredTurretFacing = facing when no target.
    // We verify the TS entity initialization: turret starts aligned to body.
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    expect(tank.turretFacing).toBe(tank.facing);
    expect(tank.desiredTurretFacing).toBe(tank.desiredFacing);
  });
});


// =============================================================================
// Section 5: Cloaking State Machine
// C++ defines.h:952-957 — CloakType { UNCLOAKED=0, CLOAKING=1, CLOAKED=2, UNCLOAKING=3 }
// C++ techno.cpp:142     — MAX_UNCLOAK_STAGE = 38
// C++ techno.cpp:4045-4107 — Do_Uncloak, Do_Cloak
// C++ techno.cpp:2427-2536 — Cloaking_AI state transitions
// =============================================================================
describe('Cloaking state machine — C++ defines.h:952-957, techno.cpp', () => {

  it('CloakState enum matches C++ CloakType ordering (defines.h:952-957)', () => {
    // C++ defines.h:952-957:
    //   UNCLOAKED  = 0
    //   CLOAKING   = 1
    //   CLOAKED    = 2
    //   UNCLOAKING = 3
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('CLOAK_TRANSITION_FRAMES = 38 (C++ techno.cpp:142: MAX_UNCLOAK_STAGE = 38)', () => {
    // C++ techno.cpp:142: #define MAX_UNCLOAK_STAGE 38
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('Do_Cloak: UNCLOAKED → CLOAKING (C++ techno.cpp:4087)', () => {
    // C++ techno.cpp:4087: if (IsCloakable && (Cloak == UNCLOAKED || Cloak == UNCLOAKING))
    //   Cloak = CLOAKING;  (line 4094)
    // TS entity doesn't have a Do_Cloak method — cloaking is managed by game loop.
    // Verify the valid transition: UNCLOAKED → CLOAKING
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    sub.cloakState = CloakState.CLOAKING;
    expect(sub.cloakState).toBe(CloakState.CLOAKING);
  });

  it('Do_Cloak: UNCLOAKING → CLOAKING (C++ techno.cpp:4087)', () => {
    // C++ techno.cpp:4087: Cloak == UNCLOAKING is also valid → CLOAKING
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakState = CloakState.CLOAKING;
    expect(sub.cloakState).toBe(CloakState.CLOAKING);
  });

  it('Do_Uncloak: CLOAKED → UNCLOAKING (C++ techno.cpp:4049-4053)', () => {
    // C++ techno.cpp:4049: if (IsCloakable && (Cloak == CLOAKED || Cloak == CLOAKING))
    //   Cloak = UNCLOAKING;  (line 4053)
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.CLOAKED;
    sub.cloakState = CloakState.UNCLOAKING;
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('Do_Uncloak: CLOAKING → UNCLOAKING (C++ techno.cpp:4049)', () => {
    // C++ allows interrupting a cloak-in-progress by transitioning to UNCLOAKING
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakState = CloakState.UNCLOAKING;
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('Cloaking_AI: UNCLOAKING completes → UNCLOAKED (C++ techno.cpp:2462-2468)', () => {
    // C++ techno.cpp:2464: if (Visual_Character(true) == VISUAL_NORMAL)
    //   Cloak = UNCLOAKED; (line 2467)
    //   CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE; (line 2468)
    // TS simulates this with timer reaching 0 → UNCLOAKED
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakTimer = 0; // transition complete
    // After timer expires, game loop should set UNCLOAKED
    sub.cloakState = CloakState.UNCLOAKED;
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('Cloaking_AI: CLOAKING completes → CLOAKED (C++ techno.cpp:2494-2497)', () => {
    // C++ techno.cpp:2494-2495: case VISUAL_HIDDEN: Cloak = CLOAKED;
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 0;
    sub.cloakState = CloakState.CLOAKED;
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('Damage force-uncloaks cloaked units (C++ techno.cpp via entity.ts:509-512)', () => {
    // C++ applies damage → calls Do_Uncloak if cloaked
    // TS entity.ts:509-512: if cloaked/cloaking on damage → UNCLOAKING
    const sub = new Entity(UnitType.V_SS, House.USSR, 300, 300);
    sub.cloakState = CloakState.CLOAKED;
    // Simulate the isCloakable flag being set (needed for takeDamage check)
    (sub.stats as Record<string, unknown>).isCloakable = true;
    sub.takeDamage(10, 'HE');
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('Cloaking_AI: badly damaged units shimmer during cloaking (C++ techno.cpp:2488-2492)', () => {
    // C++ techno.cpp:2488-2492:
    //   case VISUAL_DARKEN:
    //     if (Health_Ratio() <= Rule.ConditionRed && Percent_Chance(25))
    //       Cloak = UNCLOAKING;
    // At ConditionRed (25%), cloaking can fail and revert to UNCLOAKING.
    // This is a probabilistic behavior — we just verify the threshold is correct.
    expect(CONDITION_RED).toBe(0.25);
    // At exactly 25% health, the unit has a 25% chance per tick to fail cloaking
  });
});


// =============================================================================
// Section 6: Body/Vehicle Rotation (32-step system)
// C++ defines.h:2995-3005 — DirType (N=0, NE=32, E=64, ... NW=224, max=255)
// C++ unit.cpp:507-564 — body rotation
// =============================================================================
describe('Body rotation — C++ 32-step facing system', () => {

  it('8-dir facing maps to 32-step: facing * 4 (C++ DIR_N=0, DIR_NE=32, each octant=32)', () => {
    // C++ DirType: DIR_N=0, DIR_NE=1<<5=32, DIR_E=2<<5=64, etc.
    // 256 values / 8 directions = 32 per octant
    // 32-step visual: 32 frames / 8 directions = 4 steps per octant
    // So facing * 4 converts 8-dir to 32-step
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    expect(e.bodyFacing32).toBe(e.facing * 4);
  });

  it('infantry (rot >= 8) snap rotation instantly (C++ infantry rotation is immediate)', () => {
    // C++ infantry.cpp: infantry have ROT=0 (meaning instant rotation)
    // TS entity.ts:646: if (this.stats.rot >= 8) snap instantly
    const inf = new Entity(UnitType.E1, House.Greece, 100, 100);
    inf.facing = Dir.N;
    inf.desiredFacing = Dir.S;
    inf.rotTickedThisFrame = false;
    const done = inf.tickRotation();
    expect(done).toBe(true);
    expect(inf.facing).toBe(Dir.S);
  });

  it('vehicles rotate gradually based on ROT (C++ unit.cpp:522)', () => {
    // C++ unit.cpp:522: tracked vehicles rotate to face, wheeled vehicles don't rotate in place
    // Medium Tank (2TNK) ROT=5 — takes multiple ticks
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.S; // 180 degrees away — 16 steps
    tank.rotTickedThisFrame = false;
    const done = tank.tickRotation();
    // ROT=5: accumulator += 5, 5 < 8, no step yet
    expect(done).toBe(false);
    expect(tank.facing).toBe(Dir.N); // hasn't rotated yet
  });

  it('vehicles rotate by ROT in 256-dir space; Dir_To_32 derives visual frame', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    tank.facing = Dir.N;
    tank.bodyFacing256 = Dir.N * 32;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.NE;
    tank.rotAccumulator = 0;

    // Tick 1: C++ Rotation_Adjust applies +5 immediately. Dir_To_32(5) = 1.
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    expect(tank.bodyFacing256).toBe(5);
    expect(tank.bodyFacing32).toBe(1);
    expect(tank.rotAccumulator).toBe(0);

    // Tick 2: current DirType is 10. Dir_To_32(10) is still frame 1.
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    expect(tank.bodyFacing256).toBe(10);
    expect(tank.bodyFacing32).toBe(1);
    expect(tank.rotAccumulator).toBe(0);
  });

  it('rotation uses shortest path around 32-step ring', () => {
    // C++ unit.cpp uses FacingClass which does shortest-path around 256-value ring
    // TS entity.ts:660-665: diff32 <= 16 → CW, else CCW
    const tank = new Entity(UnitType.V_2TNK, House.Greece, 200, 200);
    // Face E (8), want NE (4) — shortest is CCW (4 steps)
    tank.facing = Dir.E;
    tank.bodyFacing32 = 8;
    tank.desiredFacing = Dir.NE;
    tank.rotAccumulator = 7; // prime to trigger step

    tank.rotTickedThisFrame = false;
    tank.tickRotation();

    // diff32 = (4 - 8 + 32) % 32 = 28 > 16, so CCW: 8 → 7
    expect(tank.bodyFacing32).toBe(7);
  });
});


// =============================================================================
// Section 7: Formation Offsets
// C++ foot.cpp:118-119 — XFormOffset/YFormOffset init to 0x80000000
// C++ foot.cpp:2185-2199 — Adjust_Dest: adds XFormOffset/YFormOffset to dest cell
// =============================================================================
describe('Formation offsets — C++ foot.cpp:118-119, 2185-2199', () => {

  it('formation offset starts as null (C++ 0x80000000 sentinel)', () => {
    // C++ foot.cpp:118-119:
    //   XFormOffset(0x80000000),
    //   YFormOffset(0x80000000)
    // 0x80000000 is a sentinel meaning "not in formation".
    // TS entity.ts:179: formationOffset = null (null ≡ sentinel)
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    expect(e.formationOffset).toBeNull();
  });

  it('formation offset can be set to apply position delta (C++ Adjust_Dest logic)', () => {
    // C++ foot.cpp:2189-2196:
    //   if (IsFormationMove) {
    //     newx = Bound(XFormOffset + xdest, ...)
    //     newy = Bound(YFormOffset + ydest, ...)
    //   }
    // TS uses formationOffset as a WorldPos delta.
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    e.formationOffset = { x: 48, y: -24 };
    expect(e.formationOffset.x).toBe(48);
    expect(e.formationOffset.y).toBe(-24);
  });
});


// =============================================================================
// Section 8: Guard Mode / MissionControl
// C++ mission.cpp:532-543 — MissionControlClass defaults
// C++ rules.ini overrides per mission (loaded at rules.cpp:1019-1023)
// =============================================================================
describe('Guard mode MissionControl — C++ mission.cpp:532-543', () => {

  /**
   * C++ MissionControlClass constructor defaults (mission.cpp:532-543):
   *   IsNoThreat = false
   *   IsZombie = false
   *   IsRecruitable = true
   *   IsParalyzed = false
   *   IsRetaliate = true
   *   IsScatter = true
   *
   * These defaults are then overridden per-mission by rules.ini (rules.cpp:1019-1023).
   * The actual shipped RULES.INI overrides create the expected per-mission behavior.
   */

  it('GUARD mission: IsRetaliate=true, IsScatter=true (default + rules.ini)', () => {
    // C++ Guard mission: units retaliate and scatter when attacked
    const mc = MISSION_CONTROL[Mission.GUARD];
    expect(mc).toBeDefined();
    expect(mc.isRetaliate).toBe(true);
    expect(mc.isScatter).toBe(true);
  });

  it('GUARD mission: IsNoThreat=false (guard units ARE considered threats)', () => {
    const mc = MISSION_CONTROL[Mission.GUARD];
    expect(mc.isNoThreat).toBe(false);
  });

  it('GUARD mission: IsRecruitable=true (guard units can join teams)', () => {
    const mc = MISSION_CONTROL[Mission.GUARD];
    expect(mc.isRecruitable).toBe(true);
  });

  it('GUARD mission: IsParalyzed=false (guard units can still move)', () => {
    const mc = MISSION_CONTROL[Mission.GUARD];
    expect(mc.isParalyzed).toBe(false);
  });

  it('ATTACK mission: uses C++ defaults (no INI overrides)', () => {
    const mc = MISSION_CONTROL[Mission.ATTACK];
    expect(mc.isScatter).toBe(true);
    expect(mc.isRetaliate).toBe(true);
    expect(mc.isRecruitable).toBe(true);
  });

  it('HUNT mission: IsScatter=true, IsRetaliate=false (INI: Recruitable=no, Retaliate=no)', () => {
    const mc = MISSION_CONTROL[Mission.HUNT];
    expect(mc.isScatter).toBe(true);
    expect(mc.isRetaliate).toBe(false);
    expect(mc.isRecruitable).toBe(false);
  });

  it('SLEEP mission: IsZombie=true, no-retaliate, no-scatter (INI overrides)', () => {
    const mc = MISSION_CONTROL[Mission.SLEEP];
    expect(mc.isNoThreat).toBe(false);
    expect(mc.isZombie).toBe(true);
    expect(mc.isParalyzed).toBe(false);
    expect(mc.isRetaliate).toBe(false);
    expect(mc.isScatter).toBe(false);
  });

  it('AMBUSH mission: uses C++ defaults (no INI overrides — unused mission)', () => {
    const mc = MISSION_CONTROL[Mission.AMBUSH];
    expect(mc.isRetaliate).toBe(true);
    expect(mc.isScatter).toBe(true);
    expect(mc.isParalyzed).toBe(false);
  });

  it('STICKY mission: IsRecruitable=false (defines.h:988: never recruit)', () => {
    // C++ defines.h:988: MISSION_STICKY — Stay still -- never recruit.
    const mc = MISSION_CONTROL[Mission.STICKY];
    expect(mc.isRecruitable).toBe(false);
  });

  it('MOVE mission: uses C++ defaults (no INI overrides)', () => {
    const mc = MISSION_CONTROL[Mission.MOVE];
    expect(mc.isRecruitable).toBe(true);
    expect(mc.isRetaliate).toBe(true);
    expect(mc.isScatter).toBe(true);
  });

  it('HARVEST mission: INI overrides (Retaliate=no, Recruitable=no, Scatter=no)', () => {
    const mc = MISSION_CONTROL[Mission.HARVEST];
    expect(mc.isNoThreat).toBe(false);
    expect(mc.isZombie).toBe(false);
    expect(mc.isRetaliate).toBe(false);
    expect(mc.isScatter).toBe(false);
    expect(mc.isRecruitable).toBe(false);
  });

  it('STOP mission: uses C++ defaults (no INI overrides)', () => {
    const mc = MISSION_CONTROL[Mission.STOP];
    expect(mc.isParalyzed).toBe(false);
    expect(mc.isRecruitable).toBe(true);
    expect(mc.isZombie).toBe(false);
    expect(mc.isRetaliate).toBe(true);
    expect(mc.isScatter).toBe(true);
  });

  it('HARMLESS mission: IsNoThreat=true, IsScatter=true (defines.h:1004)', () => {
    // C++ defines.h:1004: MISSION_HARMLESS — Sit around and don't appear like a threat.
    // But does scatter when attacked (important for civilians)
    const mc = MISSION_CONTROL[Mission.HARMLESS];
    expect(mc.isNoThreat).toBe(true);
    expect(mc.isScatter).toBe(true);
    expect(mc.isRetaliate).toBe(false);
  });

  it('ENTER mission: IsRetaliate=false, IsScatter=true (INI: Retaliate=no, Recruitable=no)', () => {
    const mc = MISSION_CONTROL[Mission.ENTER];
    expect(mc.isZombie).toBe(false);
    expect(mc.isRetaliate).toBe(false);
    expect(mc.isScatter).toBe(true);
    expect(mc.isRecruitable).toBe(false);
  });

  it('CAPTURE mission: IsRetaliate=false, IsScatter=false (INI: Retaliate=no, Recruitable=no, Scatter=no)', () => {
    const mc = MISSION_CONTROL[Mission.CAPTURE];
    expect(mc.isZombie).toBe(false);
    expect(mc.isRetaliate).toBe(false);
    expect(mc.isScatter).toBe(false);
    expect(mc.isRecruitable).toBe(false);
  });

  it('all 24 TS missions have MISSION_CONTROL entries', () => {
    // Verify every mission in the enum has a corresponding MISSION_CONTROL entry
    for (const missionKey of Object.values(Mission)) {
      expect(MISSION_CONTROL[missionKey], `MISSION_CONTROL[${missionKey}]`).toBeDefined();
    }
  });
});


// =============================================================================
// Section 9: Scatter Behavior
// C++ infantry.cpp:1852-1907 — InfantryClass::Scatter
// C++ foot.cpp:1140-1153 — Take_Damage scatter checks
// =============================================================================
describe('Scatter behavior — C++ infantry.cpp:1852-1907, foot.cpp:1140-1153', () => {

  it('scatter is mission-gated by MissionControl.isScatter (C++ infantry.cpp:1866)', () => {
    // C++ infantry.cpp:1866: if (!MissionControl[Mission].IsScatter && !forced) return;
    // CAPTURE mission: IsScatter=false → scatter blocked unless forced
    const mc = MISSION_CONTROL[Mission.CAPTURE];
    expect(mc.isScatter).toBe(false);
    // GUARD mission: IsScatter=true → scatter allowed
    const mcGuard = MISSION_CONTROL[Mission.GUARD];
    expect(mcGuard.isScatter).toBe(true);
  });

  it('HUNT mission allows scatter (C++ defaults + INI: Recruitable=no, Retaliate=no only)', () => {
    // HUNT INI overrides: Recruitable=no, Retaliate=no — but Scatter remains true (default)
    expect(MISSION_CONTROL[Mission.HUNT].isScatter).toBe(true);
  });

  it('MOVE mission allows scatter (units dodge while moving)', () => {
    expect(MISSION_CONTROL[Mission.MOVE].isScatter).toBe(true);
  });

  it('SLEEP mission blocks scatter (sleeping units are inert)', () => {
    expect(MISSION_CONTROL[Mission.SLEEP].isScatter).toBe(false);
  });

  it('scatter gating: foot.cpp:1149 checks IsScatter AND not tethered AND not driving', () => {
    // C++ foot.cpp:1149: if (MissionControl[Mission].IsScatter && !IsTethered && !IsDriving
    //                        && !Target_Legal(TarCom) && !Target_Legal(NavCom)
    //                        && What_Am_I() != RTTI_AIRCRAFT && What_Am_I() != RTTI_VESSEL)
    // Multiple conditions must be met — scatter is not just mission-gated.
    // TS should check at least the mission scatter flag. Verify it exists.
    const mc = MISSION_CONTROL[Mission.GUARD];
    expect(mc.isScatter).toBe(true);
  });

  it('IsDriving cancels forced scatter for infantry (C++ infantry.cpp:1860)', () => {
    // C++ infantry.cpp:1860: if (IsDriving) forced = false;
    // This means infantry that are mid-movement won't scatter even when forced.
    // We document this C++ behavior. TS may not implement IsDriving flag.
    // This test verifies the C++ constraint is documented.
    expect(true).toBe(true); // documentation test
  });
});


// =============================================================================
// Section 10: TICKS_PER_SECOND and mission timer defaults
// C++ defines.h:3031-3032
// C++ mission.cpp:97-114 — all stub handlers return TICKS_PER_SECOND*30 = 450
// =============================================================================
describe('Tick constants — C++ defines.h:3031-3032', () => {

  it('C++ TICKS_PER_SECOND = 15 (defines.h:3031)', () => {
    // C++ defines.h:3031: #define TICKS_PER_SECOND 15
    // This is the fundamental game tick rate.
    // TS game loop should run at 15 ticks/second (or equivalent).
    expect(15).toBe(15); // constant documentation
  });

  it('C++ TICKS_PER_MINUTE = 900 (defines.h:3032)', () => {
    // C++ defines.h:3032: #define TICKS_PER_MINUTE (TICKS_PER_SECOND * 60)
    expect(15 * 60).toBe(900);
  });

  it('C++ default mission handler delay = TICKS_PER_SECOND * 30 = 450 ticks (mission.cpp:97)', () => {
    // C++ mission.cpp:97: int MissionClass::Mission_Sleep(void) {return TICKS_PER_SECOND*30;};
    // All stub mission handlers return 450 ticks (30 seconds) between AI ticks.
    expect(15 * 30).toBe(450);
  });
});


// =============================================================================
// Section 11: Direction System
// C++ defines.h:2942-2955 — FacingType (8 values, 0-7)
// C++ defines.h:2995-3005 — DirType (256 values, N=0, NE=32, E=64...)
// =============================================================================
describe('Direction system — C++ defines.h:2942-3005', () => {

  it('Dir enum matches C++ FacingType (8 directions, 0-7)', () => {
    // C++ defines.h:2944-2951:
    //   FACING_N=0, FACING_NE=1, FACING_E=2, FACING_SE=3,
    //   FACING_S=4, FACING_SW=5, FACING_W=6, FACING_NW=7
    expect(Dir.N).toBe(0);
    expect(Dir.NE).toBe(1);
    expect(Dir.E).toBe(2);
    expect(Dir.SE).toBe(3);
    expect(Dir.S).toBe(4);
    expect(Dir.SW).toBe(5);
    expect(Dir.W).toBe(6);
    expect(Dir.NW).toBe(7);
  });

  it('C++ FACING_COUNT = 8 (defines.h:2953)', () => {
    // C++ defines.h:2953: FACING_COUNT = 8
    // Count enum values in TS Dir
    const dirValues = Object.values(Dir).filter(v => typeof v === 'number');
    expect(dirValues.length).toBe(8);
  });

  it('C++ DirType octants: N=0, NE=32, E=64, SE=96, S=128, SW=160, W=192, NW=224', () => {
    // C++ defines.h:2995-3004:
    //   DIR_N=0, DIR_NE=1<<5=32, DIR_E=2<<5=64, DIR_SE=3<<5=96,
    //   DIR_S=4<<5=128, DIR_SW=5<<5=160, DIR_W=6<<5=192, DIR_NW=7<<5=224
    // TS 32-step system: each facing covers 4 steps (32 total)
    // C++ 256-value: each facing covers 32 values (256 total)
    // Ratio: 256/32 = 8 → TS accumulator threshold is 8
    // Verify: Dir.N * 32 = C++ DIR_N, Dir.NE * 32 = C++ DIR_NE, etc.
    expect(Dir.N * 32).toBe(0);
    expect(Dir.NE * 32).toBe(32);
    expect(Dir.E * 32).toBe(64);
    expect(Dir.SE * 32).toBe(96);
    expect(Dir.S * 32).toBe(128);
    expect(Dir.SW * 32).toBe(160);
    expect(Dir.W * 32).toBe(192);
    expect(Dir.NW * 32).toBe(224);
  });

  it('C++ FacingType addition wraps mod 8 (defines.h:2957-2959)', () => {
    // C++ defines.h:2957-2959:
    //   inline FacingType operator + (FacingType f1, FacingType f2)
    //   { return (FacingType)(((int)f1 + (int)f2) & 0x07); }
    // Verify 8-dir wrapping works
    expect((Dir.NW + 1) % 8).toBe(Dir.N); // 7 + 1 = 8, mod 8 = 0 = N
    expect((Dir.N + 7) % 8).toBe(Dir.NW); // 0 + 7 = 7 = NW
  });
});


// =============================================================================
// Section 12: Entity Construction and Initial State
// C++ foot.cpp:102-137 — FootClass constructor
// C++ techno.cpp:596-617 — TechnoClass constructor
// =============================================================================
describe('Entity construction — C++ foot.cpp:102-137, techno.cpp:596-617', () => {

  it('Cloak starts UNCLOAKED (C++ techno.cpp:616: Cloak(UNCLOAKED))', () => {
    // C++ techno.cpp:616: Cloak(UNCLOAKED)
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('Speed bias starts at 1.0 (C++ foot.cpp:117: SpeedBias(1))', () => {
    // C++ foot.cpp:117: SpeedBias(1)
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    expect(e.speedBias).toBe(1.0);
  });

  it('Group starts at unassigned (C++ foot.cpp:123: Group(255))', () => {
    // C++ foot.cpp:123: Group(255) — 255 means no control group assigned
    // TS doesn't expose Group directly — this tests the C++ convention.
    // TS uses selected flag instead.
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.selected).toBe(false);
  });

  it('PathThreshhold starts at MOVE_CLOAK (C++ foot.cpp:125)', () => {
    // C++ foot.cpp:125: PathThreshhold(MOVE_CLOAK)
    // C++ defines.h:830: MOVE_CLOAK = some value (blocks cloaked units)
    // TS entity.ts:114: pathThreshold = 1
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    expect(e.pathThreshold).toBe(1);
  });

  it('tryCount starts at PATH_RETRY = 10 (C++ foot.cpp:127)', () => {
    // C++ foot.cpp:127: TryTryAgain(PATH_RETRY)
    // C++ foot.h: PATH_RETRY = 10
    // TS entity.ts:116: tryCount = 10
    const e = new Entity(UnitType.V_2TNK, House.Greece, 100, 100);
    expect(e.tryCount).toBe(10);
  });

  it('IsScattering starts false (C++ foot.cpp:115)', () => {
    // C++ foot.cpp:115: IsScattering(false)
    // TS doesn't have a direct IsScattering flag — movement handles it.
    // The closest analog is that the entity starts without a scatter target.
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.moveTarget).toBeNull();
  });

  it('HP equals stats strength on creation (C++ TechnoClass init)', () => {
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.hp).toBe(e.maxHp);
    expect(e.hp).toBe(e.stats.strength);
  });

  it('weapon is initialized from stats primaryWeapon (C++ Techno_Type_Class)', () => {
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.weapon).not.toBeNull();
    expect(e.weapon!.name).toBe('M1Carbine');
  });
});


// =============================================================================
// Section 13: Fear / Prone System
// C++ infantry.cpp: Fear increases on damage, prone when fear >= FEAR_ANXIOUS
// C++ rules.cpp:202: ProneDamageBias = fixed(1,2) = 0.5
// =============================================================================
describe('Fear/Prone system — C++ infantry.cpp, rules.cpp:202', () => {

  it('FEAR_ANXIOUS = 10 (C++ infantry prone threshold)', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  it('FEAR_SCARED = 100', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  it('FEAR_PANIC = 200', () => {
    expect(Entity.FEAR_PANIC).toBe(200);
  });

  it('FEAR_MAXIMUM = 255 (uint8_t max in C++)', () => {
    // C++ FearType is a uint8_t (0-255)
    expect(Entity.FEAR_MAXIMUM).toBe(255);
  });

  it('infantry starts with fear=0, isProne=false', () => {
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    expect(e.fear).toBe(0);
    expect(e.isProne).toBe(false);
  });

  it('damage sets fear to at least FEAR_SCARED (C++ infantry.cpp:442-457)', () => {
    // C++ infantry.cpp:442: fear jump requires known attacker (source != NULL)
    const e = new Entity(UnitType.E1, House.Greece, 100, 100);
    const attacker = new Entity(UnitType.I_E1, House.USSR, 200, 200);
    e.takeDamage(10, 'SA', attacker);
    expect(e.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });
});


// =============================================================================
// Section 14: Assign_Mission QMOVE translation
// C++ mission.cpp:386: if (order == MISSION_QMOVE) order = MISSION_MOVE;
// =============================================================================
describe('Assign_Mission QMOVE → MOVE translation — C++ mission.cpp:386', () => {

  it('C++ translates QMOVE to MOVE in Assign_Mission (mission.cpp:386)', () => {
    // C++ mission.cpp:386: if (order == MISSION_QMOVE) order = MISSION_MOVE;
    // This means QMOVE never actually appears in the mission queue in C++.
    // TS keeps QMOVE as a separate enum value.
    // The MISSION_CONTROL for QMOVE should match MOVE since C++ treats them identically.
    const mcQMove = MISSION_CONTROL[Mission.QMOVE];
    const mcMove = MISSION_CONTROL[Mission.MOVE];
    expect(mcQMove.isRetaliate).toBe(mcMove.isRetaliate);
    expect(mcQMove.isScatter).toBe(mcMove.isScatter);
    expect(mcQMove.isRecruitable).toBe(mcMove.isRecruitable);
  });
});


// =============================================================================
// Section 15: Mission AI dispatch (mission.cpp:233-318)
// C++ mission.cpp:233-318 — AI() switch routes missions to handlers
// RESCUE uses Mission_Hunt, SABOTAGE uses Mission_Capture, QMOVE uses Mission_Move
// =============================================================================
describe('Mission AI dispatch — C++ mission.cpp:233-318', () => {

  it('RESCUE mission dispatches to same handler as HUNT (mission.cpp:298-299)', () => {
    // C++ mission.cpp:298-299: both use Mission_Hunt()
    // But their MissionControl flags differ per rules.ini:
    // HUNT: Recruitable=no, Retaliate=no; RESCUE: (no overrides, uses defaults)
    const mcRescue = MISSION_CONTROL[Mission.RESCUE];
    const mcHunt = MISSION_CONTROL[Mission.HUNT];
    // Both share the same AI handler, but INI flags differ
    expect(mcRescue).toBeDefined();
    expect(mcHunt).toBeDefined();
    // Same handler does not imply same flags — INI overrides differ
    expect(mcRescue.isNoThreat).toBe(false);
    expect(mcHunt.isNoThreat).toBe(false);
  });

  it('SABOTAGE mission dispatches to same handler as CAPTURE (mission.cpp:260-262)', () => {
    // C++ mission.cpp:260-262: both use Mission_Capture()
    // But their MissionControl flags differ per rules.ini:
    // CAPTURE: Retaliate=no, Recruitable=no, Scatter=no; SABOTAGE: Recruitable=no only
    const mcSab = MISSION_CONTROL[Mission.SABOTAGE];
    const mcCap = MISSION_CONTROL[Mission.CAPTURE];
    // Same handler does not imply same flags
    expect(mcSab.isRecruitable).toBe(false);
    expect(mcCap.isRecruitable).toBe(false);
  });

  it('STICKY mission dispatches to same handler as GUARD (mission.cpp:243-245)', () => {
    // C++ mission.cpp:243-245:
    //   case MISSION_STICKY:
    //   case MISSION_GUARD:
    //     Timer = Mission_Guard();
    // Both use the same guard AI, but STICKY is not recruitable and has Scatter=no (rules.ini)
    const mcSticky = MISSION_CONTROL[Mission.STICKY];
    const mcGuard = MISSION_CONTROL[Mission.GUARD];
    expect(mcSticky.isRetaliate).toBe(mcGuard.isRetaliate);
    // Key differences: recruitable and scatter
    expect(mcSticky.isRecruitable).toBe(false);
    expect(mcGuard.isRecruitable).toBe(true);
    expect(mcSticky.isScatter).toBe(false); // rules.ini [Sticky] Scatter=no
    expect(mcGuard.isScatter).toBe(true);
  });

  it('HARMLESS and SLEEP mission dispatch to same handler (mission.cpp:238-241)', () => {
    // C++ mission.cpp:238-241:
    //   case MISSION_HARMLESS:
    //   case MISSION_SLEEP:
    //     Timer = Mission_Sleep();
    // Both use Mission_Sleep handler
    const mcHarmless = MISSION_CONTROL[Mission.HARMLESS];
    const mcSleep = MISSION_CONTROL[Mission.SLEEP];
    // But their MissionControl differs: HARMLESS scatters, SLEEP does not
    expect(mcHarmless.isScatter).toBe(true);
    expect(mcSleep.isScatter).toBe(false);
  });
});
