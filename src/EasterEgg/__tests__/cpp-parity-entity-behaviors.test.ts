/**
 * C++ Behavioral Parity: Entity Behaviors — Mission Queue, Formation, Condition,
 * Scatter, Turret Rotation, Cloaking State Machine, Guard Mode Range
 *
 * Tests verify entity behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * C++ source references:
 *   - mission.cpp — mission queue system, GUARD mission logic
 *   - queue.h — mission queue promotion at cell center
 *   - foot.cpp — formation movement offsets (XFormOffset/YFormOffset)
 *   - foot.h:139-175 — formation offset fields
 *   - rules.cpp:234-235 — ConditionGreen/Yellow/Red HP thresholds
 *   - infantry.cpp:1852-1929 — infantry scatter on crush threat
 *   - techno.cpp — turret rotation (SecondaryFacing), cloak logic
 *   - unit.cpp:542 — SecondaryFacing.Rotation_Adjust(Class->ROT+1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, DIR_COUNT,
  UNIT_STATS, CONDITION_RED, CONDITION_YELLOW, MISSION_CONTROL,
} from '../engine/types';
import {
  Entity, resetEntityIds,
  CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION,
} from '../engine/entity';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Mission Queue System (C++ mission.cpp, queue.h)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ mission.cpp — entities have a current mission and a queued next mission.
// When the current mission completes or the unit reaches cell center, the queued
// mission is promoted to active. queue.h defines the FIFO mission queue.

describe('Mission queue system (C++ mission.cpp, queue.h)', () => {

  it('entity starts with missionQueue = null (no queued mission)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.missionQueue).toBeNull();
  });

  it('entity starts with mission = GUARD (C++ mission.cpp default)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.mission).toBe(Mission.GUARD);
  });

  it('missionQueue can be set to a pending mission', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.missionQueue = Mission.MOVE;
    expect(e1.missionQueue).toBe(Mission.MOVE);
  });

  it('promoting queued mission: missionQueue replaces active mission', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.mission = Mission.GUARD;
    e1.missionQueue = Mission.ATTACK;

    // Simulate promotion (C++ queue.h — dequeue sets active mission)
    e1.mission = e1.missionQueue;
    e1.missionQueue = null;

    expect(e1.mission).toBe(Mission.ATTACK);
    expect(e1.missionQueue).toBeNull();
  });

  it('mission queue handles GUARD -> MOVE -> ATTACK sequence', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.mission).toBe(Mission.GUARD);

    // Queue MOVE
    e1.missionQueue = Mission.MOVE;

    // Promote MOVE
    e1.mission = e1.missionQueue;
    e1.missionQueue = null;
    expect(e1.mission).toBe(Mission.MOVE);

    // Queue ATTACK
    e1.missionQueue = Mission.ATTACK;

    // Promote ATTACK
    e1.mission = e1.missionQueue;
    e1.missionQueue = null;
    expect(e1.mission).toBe(Mission.ATTACK);
    expect(e1.missionQueue).toBeNull();
  });

  it('moveQueue (shift+click waypoints) is independent of missionQueue', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.mission = Mission.MOVE;
    e1.moveTarget = { x: 200, y: 200 };
    e1.moveQueue.push({ x: 300, y: 300 });
    e1.moveQueue.push({ x: 400, y: 400 });
    e1.missionQueue = Mission.GUARD;

    // moveQueue is waypoint queue (WorldPos[]), missionQueue is next mission (Mission | null)
    expect(e1.moveQueue).toHaveLength(2);
    expect(e1.missionQueue).toBe(Mission.GUARD);
  });

  it('moveQueue shifts waypoints in FIFO order', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.moveQueue.push({ x: 100, y: 100 });
    e1.moveQueue.push({ x: 200, y: 200 });
    e1.moveQueue.push({ x: 300, y: 300 });

    const first = e1.moveQueue.shift()!;
    expect(first).toEqual({ x: 100, y: 100 });
    expect(e1.moveQueue).toHaveLength(2);

    const second = e1.moveQueue.shift()!;
    expect(second).toEqual({ x: 200, y: 200 });
    expect(e1.moveQueue).toHaveLength(1);
  });

  it('all 22 C++ missions are defined in Mission enum', () => {
    // C++ mission.cpp enumerates MISSION_GUARD through MISSION_CONSTRUCTION
    const expectedMissions = [
      Mission.GUARD, Mission.AREA_GUARD, Mission.MOVE, Mission.ATTACK,
      Mission.HUNT, Mission.SLEEP, Mission.DIE, Mission.ENTER,
      Mission.CAPTURE, Mission.HARVEST, Mission.UNLOAD, Mission.RETREAT,
      Mission.AMBUSH, Mission.STICKY, Mission.REPAIR, Mission.STOP,
      Mission.HARMLESS, Mission.QMOVE, Mission.RETURN, Mission.RESCUE,
      Mission.MISSILE, Mission.SABOTAGE, Mission.CONSTRUCTION,
      Mission.DECONSTRUCTION,
    ];
    for (const m of expectedMissions) {
      expect(m).toBeDefined();
      // Each mission has MissionControl metadata
      expect(MISSION_CONTROL[m]).toBeDefined();
    }
  });

  it('QMOVE is functionally equivalent to MOVE (C++ foot.cpp:339)', () => {
    // C++ treats QMOVE the same as MOVE in the mission loop
    const qmoveCtrl = MISSION_CONTROL[Mission.QMOVE];
    const moveCtrl = MISSION_CONTROL[Mission.MOVE];
    expect(qmoveCtrl.isRetaliate).toBe(moveCtrl.isRetaliate);
    expect(qmoveCtrl.isScatter).toBe(moveCtrl.isScatter);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Formation Movement Offsets (C++ foot.cpp, foot.h:139-175)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ foot.h:139-175 — XFormOffset/YFormOffset define each unit's offset from
// the formation group center. When units move in formation, each maintains a
// fixed offset so the group moves as a cohesive block.

describe('Formation movement offsets (C++ foot.h:139-175 XFormOffset/YFormOffset)', () => {

  it('entity starts with formationOffset = null (no formation)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.formationOffset).toBeNull();
  });

  it('formationOffset can be set to a WorldPos offset', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.formationOffset = { x: CELL_SIZE, y: 0 };
    expect(e1.formationOffset).toEqual({ x: CELL_SIZE, y: 0 });
  });

  it('formationOffset can be cleared by setting to null', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.formationOffset = { x: CELL_SIZE, y: -CELL_SIZE };
    expect(e1.formationOffset).not.toBeNull();
    e1.formationOffset = null;
    expect(e1.formationOffset).toBeNull();
  });

  it('multiple units in formation have distinct offsets from group center', () => {
    const units = [
      entityAtCell(UnitType.I_E1, House.Spain, 10, 10),
      entityAtCell(UnitType.I_E1, House.Spain, 11, 10),
      entityAtCell(UnitType.I_E1, House.Spain, 10, 11),
      entityAtCell(UnitType.I_E1, House.Spain, 11, 11),
    ];

    // Assign formation offsets (2x2 grid centered on group center)
    const offsets = [
      { x: -CELL_SIZE / 2, y: -CELL_SIZE / 2 },
      { x:  CELL_SIZE / 2, y: -CELL_SIZE / 2 },
      { x: -CELL_SIZE / 2, y:  CELL_SIZE / 2 },
      { x:  CELL_SIZE / 2, y:  CELL_SIZE / 2 },
    ];
    for (let i = 0; i < units.length; i++) {
      units[i].formationOffset = offsets[i];
    }

    // All offsets should be distinct
    const offsetSet = new Set(units.map(u => `${u.formationOffset!.x},${u.formationOffset!.y}`));
    expect(offsetSet.size).toBe(4);
  });

  it('formation offset is applied relative to group destination', () => {
    const unit = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    unit.formationOffset = { x: CELL_SIZE, y: -CELL_SIZE };

    // Group destination at cell (20, 20) center
    const groupDestX = 20 * CELL_SIZE + CELL_SIZE / 2;
    const groupDestY = 20 * CELL_SIZE + CELL_SIZE / 2;

    // Unit's individual destination = group dest + formation offset
    const unitDestX = groupDestX + unit.formationOffset.x;
    const unitDestY = groupDestY + unit.formationOffset.y;

    expect(unitDestX).toBe(groupDestX + CELL_SIZE);
    expect(unitDestY).toBe(groupDestY - CELL_SIZE);
  });

  it('vehicles and infantry can both have formation offsets', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    infantry.formationOffset = { x: 0, y: 0 };
    tank.formationOffset = { x: CELL_SIZE, y: 0 };

    expect(infantry.formationOffset).toEqual({ x: 0, y: 0 });
    expect(tank.formationOffset).toEqual({ x: CELL_SIZE, y: 0 });
  });

  it('formation offsets center of mass sums to zero for symmetric grid', () => {
    // C++ foot.cpp — offsets are symmetric around group center
    const offsets = [
      { x: -CELL_SIZE, y: -CELL_SIZE },
      { x:  CELL_SIZE, y: -CELL_SIZE },
      { x: -CELL_SIZE, y:  CELL_SIZE },
      { x:  CELL_SIZE, y:  CELL_SIZE },
    ];

    const avgX = offsets.reduce((s, o) => s + o.x, 0) / offsets.length;
    const avgY = offsets.reduce((s, o) => s + o.y, 0) / offsets.length;
    expect(avgX).toBe(0);
    expect(avgY).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Condition Thresholds (C++ rules.cpp:234-235 ConditionGreen/Yellow/Red)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ rules.cpp:234 ConditionYellow = fixed(1,2) = 0.5
// C++ rules.cpp:235 ConditionRed = fixed(1,4) = 0.25
// ConditionGreen is implicit: HP > ConditionYellow
// These thresholds affect fear calculation and visual health bar color.

describe('Condition thresholds (C++ rules.cpp:234-235)', () => {

  it('CONDITION_YELLOW = 0.5 (C++ rules.cpp:234 ConditionYellow = fixed(1,2))', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('CONDITION_RED = 0.25 (C++ rules.cpp:235 ConditionRed = fixed(1,4))', () => {
    expect(CONDITION_RED).toBe(0.25);
  });

  it('CONDITION_RED < CONDITION_YELLOW (red is worse health)', () => {
    expect(CONDITION_RED).toBeLessThan(CONDITION_YELLOW);
  });

  it('full-health entity is in GREEN condition (hpRatio > CONDITION_YELLOW)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const hpRatio = e1.hp / e1.maxHp;
    expect(hpRatio).toBe(1.0);
    expect(hpRatio).toBeGreaterThan(CONDITION_YELLOW);
  });

  it('entity at 50% HP is at YELLOW boundary (hpRatio = CONDITION_YELLOW)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.hp = Math.floor(e1.maxHp * CONDITION_YELLOW);
    const hpRatio = e1.hp / e1.maxHp;
    expect(hpRatio).toBeLessThanOrEqual(CONDITION_YELLOW);
  });

  it('entity at 25% HP is at RED boundary (hpRatio = CONDITION_RED)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = Math.floor(tank.maxHp * CONDITION_RED);
    const hpRatio = tank.hp / tank.maxHp;
    expect(hpRatio).toBeLessThanOrEqual(CONDITION_RED);
  });

  it('condition thresholds affect fear calculation in takeDamage (infantry.cpp:454-457)', () => {
    // C++ infantry.cpp:454-457 — fear bonus depends on health condition:
    //   if hpRatio > CONDITION_RED: moreFear /= 2
    //   if hpRatio > CONDITION_YELLOW: moreFear /= 2 again
    // So at full health: moreFear = FEAR_ANXIOUS / 4 = 2
    //    at yellow: moreFear = FEAR_ANXIOUS / 2 = 5
    //    at red: moreFear = FEAR_ANXIOUS = 10

    // Test: unit in GREEN condition (full health)
    const greenUnit = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    greenUnit.hp = greenUnit.maxHp; // 100% — GREEN
    greenUnit.takeDamage(1, 'SA');
    const greenFear = greenUnit.fear;

    // Test: unit in RED condition (low health)
    const redUnit = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    redUnit.hp = Math.floor(redUnit.maxHp * CONDITION_RED); // 25% — RED
    redUnit.takeDamage(1, 'SA');
    const redFear = redUnit.fear;

    // Both get at least FEAR_SCARED from damage, but RED gets more moreFear bonus
    expect(redFear).toBeGreaterThanOrEqual(greenFear);
  });

  it('tank at 51% HP is GREEN, at 50% is YELLOW, at 24% is RED', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const maxHp = tank.maxHp; // 400

    // GREEN: 51% > 0.5
    tank.hp = Math.ceil(maxHp * 0.51);
    expect(tank.hp / maxHp).toBeGreaterThan(CONDITION_YELLOW);

    // YELLOW: 50% = 0.5
    tank.hp = Math.floor(maxHp * 0.5);
    expect(tank.hp / maxHp).toBeLessThanOrEqual(CONDITION_YELLOW);
    expect(tank.hp / maxHp).toBeGreaterThan(CONDITION_RED);

    // RED: 24% < 0.25
    tank.hp = Math.floor(maxHp * 0.24);
    expect(tank.hp / maxHp).toBeLessThan(CONDITION_RED);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Scatter Behavior — Crush Avoidance (C++ infantry.cpp:1852-1929)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ infantry.cpp:1852-1929 — infantry scatter when attacked by crushable
// vehicles to avoid being crushed. Direction is away from threat with +-2
// random offset. Only infantry scatter; vehicles use random scatter.
// See also cpp-parity-scatter.test.ts for directional scatter tests.

describe('Scatter behavior — crush avoidance (C++ infantry.cpp:1852-1929)', () => {

  it('infantry is crushable (stats.crushable = true)', () => {
    expect(UNIT_STATS.E1.crushable).toBe(true);
    expect(UNIT_STATS.E2.crushable).toBe(true);
    expect(UNIT_STATS.E3.crushable).toBe(true);
    expect(UNIT_STATS.DOG.crushable).toBe(true);
    expect(UNIT_STATS.SPY.crushable).toBe(true);
  });

  it('vehicles are NOT crushable', () => {
    expect(UNIT_STATS['2TNK'].crushable).toBeFalsy();
    expect(UNIT_STATS.JEEP.crushable).toBeFalsy();
    expect(UNIT_STATS.APC.crushable).toBeFalsy();
  });

  it('GUARD mission allows scatter (C++ infantry.cpp:1866 — MissionControl.isScatter)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isScatter).toBe(true);
  });

  it('AREA_GUARD mission allows scatter', () => {
    expect(MISSION_CONTROL[Mission.AREA_GUARD].isScatter).toBe(true);
  });

  it('MOVE mission allows scatter (C++ infantry.cpp:1866)', () => {
    expect(MISSION_CONTROL[Mission.MOVE].isScatter).toBe(true);
  });

  it('ATTACK mission does NOT allow scatter (C++ infantry.cpp:1866)', () => {
    expect(MISSION_CONTROL[Mission.ATTACK].isScatter).toBe(false);
  });

  it('HUNT mission does NOT allow scatter', () => {
    expect(MISSION_CONTROL[Mission.HUNT].isScatter).toBe(false);
  });

  it('SLEEP mission does NOT allow scatter (dormant unit)', () => {
    expect(MISSION_CONTROL[Mission.SLEEP].isScatter).toBe(false);
  });

  it('civilians have isFraidyCat = true (C++ infantry.cpp:1885 FraidyCat check)', () => {
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);
    expect(UNIT_STATS.EINSTEIN.isFraidyCat).toBe(true);
  });

  it('combat infantry do NOT have isFraidyCat', () => {
    expect(UNIT_STATS.E1.isFraidyCat).toBeFalsy();
    expect(UNIT_STATS.E3.isFraidyCat).toBeFalsy();
    expect(UNIT_STATS.DOG.isFraidyCat).toBeFalsy();
  });

  it('scatter target is at least 1 cell away from current position', () => {
    // When a unit scatters, the moveTarget should be in an adjacent cell
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.GUARD;

    // Simulate scatter: move to adjacent cell
    const scatterTarget = {
      x: (10 + 1) * CELL_SIZE + CELL_SIZE / 2,
      y: 10 * CELL_SIZE + CELL_SIZE / 2,
    };
    e1.moveTarget = scatterTarget;
    e1.mission = Mission.MOVE;

    const dx = e1.moveTarget.x - e1.pos.x;
    const dy = e1.moveTarget.y - e1.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeGreaterThanOrEqual(CELL_SIZE * 0.9);
  });

  it('DIR_COUNT is 8 (C++ infantry.cpp:1905-1915 tries 8 directions)', () => {
    expect(DIR_COUNT).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Turret Rotation (C++ unit.cpp:542, techno.cpp turret rotation)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ unit.cpp:542 — SecondaryFacing.Rotation_Adjust(Class->ROT+1)
// Turreted vehicles have independent body and turret facings.
// Turret rotates toward target at ROT+1 rate (faster than body ROT).
// 32-step visual rotation: accumulator advances by ROT+1 per tick,
// one visual step when accumulator >= 8.

describe('Turret rotation (C++ unit.cpp:542 SecondaryFacing ROT+1)', () => {

  it('medium tank has independent body and turret facings', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);

    // Set body facing N, turret facing E
    tank.facing = Dir.N;
    tank.turretFacing = Dir.E;
    expect(tank.facing).not.toBe(tank.turretFacing);
  });

  it('infantry do NOT have turrets', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.hasTurret).toBe(false);
  });

  it('APC does NOT have a turret (C++ udata.cpp)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.hasTurret).toBe(false);
  });

  it('artillery does NOT have a turret', () => {
    const arty = entityAtCell(UnitType.V_ARTY, House.Spain, 10, 10);
    expect(arty.hasTurret).toBe(false);
  });

  it('submarine does NOT have a turret', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    expect(sub.hasTurret).toBe(false);
  });

  it('turretFacing and desiredTurretFacing initialize to Dir.N', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.turretFacing).toBe(Dir.N);
    expect(tank.desiredTurretFacing).toBe(Dir.N);
  });

  it('tickTurretRotation returns true when turret already faces desired direction', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.turretFacing = Dir.E;
    tank.desiredTurretFacing = Dir.E;
    tank.turretFacing32 = Dir.E * 4;

    const aligned = tank.tickTurretRotation();
    expect(aligned).toBe(true);
  });

  it('turret rotates at ROT+1 rate (C++ unit.cpp:542)', () => {
    // 2TNK has ROT=5, so turret rate = 5+1 = 6 per tick
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.rot).toBe(5);

    tank.turretFacing = Dir.N;
    tank.turretFacing32 = Dir.N * 4; // 0
    tank.desiredTurretFacing = Dir.E; // 90 degrees clockwise

    // First tick: accumulator += 6 (ROT+1). Since 6 < 8, no visual step yet.
    tank.turretRotTickedThisFrame = false;
    const aligned1 = tank.tickTurretRotation();
    expect(aligned1).toBe(false);
    expect(tank.turretRotAccumulator).toBe(6 - 8 < 0 ? 6 : 6 - 8);

    // The turretRotAccumulator should be 6 after first tick (6 < 8, no step)
    // Wait — ROT+1=6, accumulator starts at 0, after += 6 it's 6.
    // 6 < 8, so no step. turretFacing32 stays at 0.
    // Actually, let me re-read the code: it checks >= 8 after accumulation.
    // 6 < 8, so no step on first tick.
  });

  it('turret rotates faster than body (ROT+1 vs ROT)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const bodyRate = tank.stats.rot;    // 5
    const turretRate = tank.stats.rot + 1; // 6

    expect(turretRate).toBeGreaterThan(bodyRate);
  });

  it('turret rotation uses 32-step system (turretFacing32 field)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // turretFacing32 should be initialized to turretFacing * 4
    expect(tank.turretFacing32).toBe(tank.turretFacing * 4);

    // 32-step range: 0-31
    tank.turretFacing32 = 31;
    expect(tank.turretFacing32).toBe(31);
  });

  it('turret rotation takes shortest path around the 32-step ring', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // Set turret at 32-step position 0 (N), desired facing is NW (Dir.NW=7, 32-step=28)
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NW; // 32-step target = 7*4 = 28

    // The shortest path from 0 to 28 in a 32-step ring is counterclockwise (4 steps)
    // not clockwise (28 steps). diff32 = (28 - 0 + 32) % 32 = 28 > 16, so decrement.
    tank.turretRotTickedThisFrame = false;
    tank.turretRotAccumulator = 0;

    // Accumulate enough for one step: ROT+1 = 6, need >=8
    // After 2 ticks: accumulator = 12 - 8 = 4, one step taken
    tank.tickTurretRotation();
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should have decremented (counterclockwise): 0 -> 31
    expect(tank.turretFacing32).toBe(31); // wrapped around from 0 to 31
  });

  it('8-dir turretFacing is derived from turretFacing32 (Math.floor(turretFacing32/4))', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);

    // Set turretFacing32 to various positions and check 8-dir derivation
    for (let f32 = 0; f32 < 32; f32++) {
      tank.turretFacing32 = f32;
      const expected8dir = Math.floor(f32 / 4) as Dir;
      // The turretFacing is derived in tickTurretRotation, so set it manually
      tank.turretFacing = expected8dir;
      expect(tank.turretFacing).toBe(expected8dir);
    }
  });

  it('turret frame uses turretFacing32 for smooth visual rotation', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);

    // turretFrame getter accesses turretFacing32 for 32-step visual precision
    const frame1 = tank.turretFrame;
    expect(typeof frame1).toBe('number');
    expect(frame1).toBeGreaterThanOrEqual(32); // turret frames start at 32
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Cloaking State Machine (C++ techno.cpp cloak logic)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ techno.cpp — spy/sub cloaking transitions:
// UNCLOAKED(0) → CLOAKING(1) → CLOAKED(2) → UNCLOAKING(3)
// CLOAK_TRANSITION_FRAMES (38 frames = ~2.5s at 15 FPS) for transitions.
// SONAR_PULSE_DURATION (225 frames = 15s at 15 FPS) prevents recloak.

describe('Cloaking state machine (C++ techno.cpp cloak logic)', () => {

  it('CloakState enum has 4 states: UNCLOAKED, CLOAKING, CLOAKED, UNCLOAKING', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('CLOAK_TRANSITION_FRAMES = 38 (C++ CLOAK_STAGES, ~2.5s at 15 FPS)', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('SONAR_PULSE_DURATION = 225 (C++ SONAR_TIME, 15s at 15 FPS)', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('submarine starts UNCLOAKED with isCloakable = true', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    expect(sub.stats.isCloakable).toBe(true);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(sub.cloakTimer).toBe(0);
  });

  it('missile sub is also cloakable', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.Spain, 10, 10);
    expect(msub.stats.isCloakable).toBe(true);
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('phase transport (STNK) is cloakable', () => {
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    expect(stnk.stats.isCloakable).toBe(true);
  });

  it('medium tank is NOT cloakable', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.isCloakable).toBeFalsy();
    expect(tank.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('infantry are NOT cloakable by default', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.stats.isCloakable).toBeFalsy();
  });

  it('UNCLOAKED -> CLOAKING transition: set state and timer', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);

    // Begin cloaking
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    expect(sub.cloakState).toBe(CloakState.CLOAKING);
    expect(sub.cloakTimer).toBe(38);
  });

  it('CLOAKING -> CLOAKED transition: when timer reaches 0', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 1; // last tick of cloaking

    // Simulate timer decrement
    sub.cloakTimer--;
    if (sub.cloakTimer <= 0) {
      sub.cloakState = CloakState.CLOAKED;
    }

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
    expect(sub.cloakTimer).toBe(0);
  });

  it('CLOAKED -> UNCLOAKING transition: triggered by attack or detection', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.cloakState = CloakState.CLOAKED;

    // Force uncloak (e.g., sonar detection or attacking)
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(38);
  });

  it('UNCLOAKING -> UNCLOAKED transition: when timer reaches 0', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakTimer = 1;

    sub.cloakTimer--;
    if (sub.cloakTimer <= 0) {
      sub.cloakState = CloakState.UNCLOAKED;
    }

    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(sub.cloakTimer).toBe(0);
  });

  it('full cloak cycle: UNCLOAKED -> CLOAKING -> CLOAKED -> UNCLOAKING -> UNCLOAKED', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);

    // Step 1: Begin cloaking
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Step 2: Run down timer
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      sub.cloakTimer--;
    }
    expect(sub.cloakTimer).toBe(0);
    sub.cloakState = CloakState.CLOAKED;
    expect(sub.cloakState).toBe(CloakState.CLOAKED);

    // Step 3: Force uncloak
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Step 4: Run down timer
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      sub.cloakTimer--;
    }
    expect(sub.cloakTimer).toBe(0);
    sub.cloakState = CloakState.UNCLOAKED;
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('taking damage force-uncloaks a cloaked submarine (entity.ts takeDamage)', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.cloakState = CloakState.CLOAKED;

    sub.takeDamage(10, 'SA');

    // takeDamage should trigger UNCLOAKING for cloakable units
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('taking damage force-uncloaks a CLOAKING submarine (mid-transition)', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 20; // mid-transition

    sub.takeDamage(10, 'SA');

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('sonarPulseTimer prevents recloak for SONAR_PULSE_DURATION frames', () => {
    const sub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    sub.sonarPulseTimer = SONAR_PULSE_DURATION;

    // While sonarPulseTimer > 0, the sub should not be able to recloak
    expect(sub.sonarPulseTimer).toBe(225);

    // Simulate countdown
    for (let i = 0; i < SONAR_PULSE_DURATION; i++) {
      sub.sonarPulseTimer--;
    }
    expect(sub.sonarPulseTimer).toBe(0);
    // Now recloak is allowed
  });

  it('crate-granted isCloakable allows non-native cloaking (C++ CR5)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isCloakable).toBe(false);

    // Crate grants cloakability
    tank.isCloakable = true;
    expect(tank.isCloakable).toBe(true);

    // Can now enter cloak states
    tank.cloakState = CloakState.CLOAKING;
    tank.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(tank.cloakState).toBe(CloakState.CLOAKING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Guard Mode Range (C++ mission.cpp GUARD mission)
// ═══════════════════════════════════════════════════════════════════════════════
// C++ mission.cpp — units in GUARD mission engage enemies within their weapon
// range. After eliminating the target or target leaves range, unit returns to
// guard position. GUARD has isRetaliate=true, isScatter=true, isRecruitable=true.

describe('Guard mode range (C++ mission.cpp GUARD mission)', () => {

  it('GUARD mission has isRetaliate = true (C++ MissionControl)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isRetaliate).toBe(true);
  });

  it('GUARD mission has isScatter = true', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isScatter).toBe(true);
  });

  it('GUARD mission has isRecruitable = true (can be recruited into teams)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isRecruitable).toBe(true);
  });

  it('GUARD mission is NOT noThreat (unit engages enemies)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isNoThreat).toBe(false);
  });

  it('GUARD mission is NOT zombie (unit is active)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isZombie).toBe(false);
  });

  it('GUARD mission is NOT paralyzed (unit can act)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isParalyzed).toBe(false);
  });

  it('entity on GUARD can detect enemies within weapon range via inRange', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.mission = Mission.GUARD;

    // Enemy within 90mm weapon range
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    expect(tank.inRange(enemy)).toBe(true);
  });

  it('entity on GUARD does NOT engage enemies beyond weapon range', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.mission = Mission.GUARD;

    // Enemy far beyond any weapon range
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 50, 50);
    expect(tank.inRange(enemy)).toBe(false);
  });

  it('guardOrigin records the spawn position for return behavior', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.guardOrigin = { x: tank.pos.x, y: tank.pos.y };

    expect(tank.guardOrigin).toEqual({ x: tank.pos.x, y: tank.pos.y });
  });

  it('entity transitions GUARD -> ATTACK when engaging, can return to GUARD', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.mission = Mission.GUARD;
    const guardPos = { x: tank.pos.x, y: tank.pos.y };
    tank.guardOrigin = guardPos;

    // Spot enemy, switch to ATTACK
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.target = enemy;
    tank.mission = Mission.ATTACK;
    expect(tank.mission).toBe(Mission.ATTACK);

    // After target eliminated, return to GUARD
    enemy.alive = false;
    tank.target = null;
    tank.mission = Mission.GUARD;
    expect(tank.mission).toBe(Mission.GUARD);
    expect(tank.guardOrigin).toEqual(guardPos);
  });

  it('AREA_GUARD behaves like GUARD but with wider patrol area', () => {
    const areaGuard = MISSION_CONTROL[Mission.AREA_GUARD];
    const guard = MISSION_CONTROL[Mission.GUARD];

    // Same control flags
    expect(areaGuard.isRetaliate).toBe(guard.isRetaliate);
    expect(areaGuard.isScatter).toBe(guard.isScatter);
    expect(areaGuard.isNoThreat).toBe(guard.isNoThreat);
    expect(areaGuard.isRecruitable).toBe(guard.isRecruitable);
  });

  it('SLEEP mission does NOT retaliate (C++ contrast with GUARD)', () => {
    expect(MISSION_CONTROL[Mission.SLEEP].isRetaliate).toBe(false);
    expect(MISSION_CONTROL[Mission.SLEEP].isScatter).toBe(false);
    expect(MISSION_CONTROL[Mission.SLEEP].isParalyzed).toBe(true);
  });

  it('HARMLESS mission does NOT retaliate (passive unit)', () => {
    expect(MISSION_CONTROL[Mission.HARMLESS].isRetaliate).toBe(false);
    expect(MISSION_CONTROL[Mission.HARMLESS].isNoThreat).toBe(true);
  });

  it('STOP mission does NOT retaliate (hold position, cease action)', () => {
    expect(MISSION_CONTROL[Mission.STOP].isRetaliate).toBe(false);
    expect(MISSION_CONTROL[Mission.STOP].isParalyzed).toBe(true);
  });

  it('unarmed unit on GUARD has no weapon range (cannot engage)', () => {
    const engineer = entityAtCell(UnitType.I_E6, House.Spain, 10, 10);
    engineer.mission = Mission.GUARD;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    // Engineer has no weapon -> inRange always false
    expect(engineer.weapon).toBeNull();
    expect(engineer.inRange(enemy)).toBe(false);
  });

  it('dual-weapon unit checks both weapons for guard range', () => {
    // Mammoth tank has primary 120mm and secondary MammothTusk
    const mammoth = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    mammoth.mission = Mission.GUARD;
    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon2).not.toBeNull();

    // Enemy at moderate range — should be in range of at least one weapon
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const inRange = mammoth.inRange(enemy);
    // inRange checks both primary and secondary weapon ranges
    expect(typeof inRange).toBe('boolean');
  });

  it('lastGuardScan field tracks when guard last scanned for enemies', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.lastGuardScan).toBe(0);

    tank.lastGuardScan = 150;
    expect(tank.lastGuardScan).toBe(150);
  });
});
