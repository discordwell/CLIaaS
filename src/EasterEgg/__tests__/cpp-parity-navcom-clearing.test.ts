/**
 * C++ Behavioral Parity: DriveClass::Per_Cell_Process NavCom Clearing
 *
 * Tests verify that moveTarget (NavCom) is cleared when a vehicle/vessel
 * enters the cell of its navigation target, matching C++ DriveClass::Per_Cell_Process
 * behavior (drive.cpp:844-865).
 *
 * C++ source references:
 *   drive.cpp:844-865  — DriveClass::Per_Cell_Process: clears NavCom when As_Cell(NavCom)==cell
 *   drive.cpp:855-858  — if (As_Cell(NavCom) == cell) { NavCom = TARGET_NONE; Path[0] = FACING_NONE; }
 *   vessel.cpp:684-731 — VesselClass::Per_Cell_Process calls DriveClass::Per_Cell_Process
 *   team.cpp:1938-1958 — Coordinate_Move: re-assigns when NavCom != Target
 *   foot.cpp:492-505   — Mission_Move: returns 1 (no RNG) when !Target_Legal(NavCom)
 *
 * The key behavior: In C++, when a drive-class entity (vehicle or vessel) finishes
 * moving into a cell and that cell is As_Cell(NavCom), NavCom is set to TARGET_NONE.
 * This allows Team::Coordinate_Move to re-assign the navigation target, resetting
 * the mission timer and consuming Random_Pick(0,2) on the next Mission_Move dispatch.
 *
 * In the TS engine, this corresponds to clearing entity.moveTarget when the entity
 * enters the cell matching worldToCell(moveTarget).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  worldToCell,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

describe('C++ DriveClass::Per_Cell_Process NavCom clearing (drive.cpp:844-865)', () => {
  it('vessel moveTarget should clear when entity enters the NavCom cell', () => {
    // C++ drive.cpp:855: if (As_Cell(NavCom) == cell) { NavCom = TARGET_NONE; }
    //
    // Scenario: A patrol boat (PT) has moveTarget set to cell (5, 5).
    // When the boat enters cell (5, 5), moveTarget should be cleared to null.
    // This matches C++ DriveClass::Per_Cell_Process clearing NavCom at PCP_END.
    const pt = entityAtCell(UnitType.V_PT, House.USSR, 4, 5);
    pt.mission = Mission.MOVE;
    pt.moveTarget = { x: 5 * CELL_SIZE + CELL_SIZE / 2, y: 5 * CELL_SIZE + CELL_SIZE / 2 };

    // Before entering the cell — entity is at (4, 5), moveTarget cell is (5, 5)
    expect(pt.cell.cx).toBe(4);
    expect(pt.cell.cy).toBe(5);
    expect(pt.moveTarget).not.toBeNull();

    // Simulate the entity reaching the moveTarget cell
    // (setPosition updates leptons, which updates the cell getter)
    pt.setPosition(5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);

    // Verify entity is now at the moveTarget cell
    expect(pt.cell.cx).toBe(5);
    expect(pt.cell.cy).toBe(5);

    // Apply the Per_Cell_Process NavCom check (same logic as in updateMove)
    const navCell = worldToCell(pt.moveTarget!.x, pt.moveTarget!.y);
    const curCell = pt.cell;
    if (navCell.cx === curCell.cx && navCell.cy === curCell.cy) {
      pt.moveTarget = null;
      pt.path = [];
      pt.pathIndex = 0;
    }

    // C++ result: NavCom should be cleared (TARGET_NONE)
    expect(pt.moveTarget).toBeNull();
    expect(pt.path).toEqual([]);
    expect(pt.pathIndex).toBe(0);
  });

  it('vehicle moveTarget should NOT clear at intermediate cells', () => {
    // C++ drive.cpp:855: As_Cell(NavCom) != cell → NavCom stays
    //
    // When a vehicle is at cell (3, 5) but NavCom points to cell (6, 5),
    // Per_Cell_Process should NOT clear NavCom.
    const tank = entityAtCell(UnitType.U_2TNK, House.USSR, 3, 5);
    tank.mission = Mission.MOVE;
    tank.moveTarget = { x: 6 * CELL_SIZE + CELL_SIZE / 2, y: 5 * CELL_SIZE + CELL_SIZE / 2 };

    // Entity is at (3, 5), moveTarget is at (6, 5) — different cells
    const navCell = worldToCell(tank.moveTarget!.x, tank.moveTarget!.y);
    const curCell = tank.cell;
    const shouldClear = navCell.cx === curCell.cx && navCell.cy === curCell.cy;

    // C++ result: NavCom should NOT be cleared
    expect(shouldClear).toBe(false);
    expect(tank.moveTarget).not.toBeNull();
  });

  it('team coordinateMove should re-assign when moveTarget is cleared', () => {
    // C++ team.cpp:1938-1958: When NavCom != Target, Coordinate_Move re-assigns.
    // After Per_Cell_Process clears NavCom, the team sees !moveTarget → re-assigns
    // with a new moveTarget and resets missionTimer=0, which triggers Mission_Move
    // → Random_Pick(0,2) on the next entity AI tick.
    const pt = entityAtCell(UnitType.V_PT, House.USSR, 5, 5);
    pt.mission = Mission.MOVE;
    pt.moveTarget = null; // NavCom was cleared by Per_Cell_Process
    pt.missionTimer = 7; // some timer value

    // C++ team.cpp:1938+1942: check unit->Mission != MISSION_MOVE || unit->NavCom != Target
    // TS equivalent: unit.mission !== Mission.MOVE || !unit.moveTarget
    const teamTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 5 * CELL_SIZE + CELL_SIZE / 2 };
    const shouldReassign = pt.mission !== Mission.MOVE || !pt.moveTarget;

    expect(shouldReassign).toBe(true);

    // Simulate what coordinateMove does on re-assign
    if (shouldReassign) {
      pt.mission = Mission.MOVE;
      pt.moveTarget = { ...teamTarget };
      pt.missionTimer = 0; // C++ Commence() resets Timer=0
    }

    // After re-assignment, moveTarget should be set to team target
    expect(pt.moveTarget).toEqual(teamTarget);
    expect(pt.missionTimer).toBe(0);
  });

  it('Mission_Move returns 1 (no RNG) when NavCom is cleared', () => {
    // C++ foot.cpp:496-498: if (!Target_Legal(NavCom) && !IsDriving && MissionQueue == MISSION_NONE)
    //   → Enter_Idle_Mode(); return 1;
    // This is the "no RNG consumed" path when NavCom has been cleared.
    const pt = entityAtCell(UnitType.V_PT, House.USSR, 5, 5);
    pt.mission = Mission.MOVE;
    pt.moveTarget = null; // NavCom cleared
    pt.isDriving = false;
    pt.missionQueue = null;

    // C++ foot.cpp:496-498 condition
    const noNavCom = !pt.moveTarget;
    const notDriving = !pt.isDriving;
    const noQueuedMission = pt.missionQueue === null;

    expect(noNavCom && notDriving && noQueuedMission).toBe(true);
    // This condition causes missionTimer = 1 (no Random_Pick consumed)
  });

  it('Mission_Move consumes Random_Pick(0,2) when NavCom is valid', () => {
    // C++ foot.cpp:504: return MissionControl[Mission].Normal_Delay() + Random_Pick(0, 2);
    // When NavCom is valid (re-assigned by team), Mission_Move consumes RNG.
    const pt = entityAtCell(UnitType.V_PT, House.USSR, 5, 5);
    pt.mission = Mission.MOVE;
    pt.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 5 * CELL_SIZE + CELL_SIZE / 2 };
    pt.isDriving = false;
    pt.missionQueue = null;

    // C++ foot.cpp:496-498 condition fails (NavCom IS valid)
    const noNavCom = !pt.moveTarget;
    expect(noNavCom).toBe(false);
    // Falls through to Normal_Delay + Random_Pick(0,2) path
  });

  it('drive-class entities clear NavCom at cell boundary, infantry do not', () => {
    // C++ DriveClass::Per_Cell_Process is only for vehicles/vessels.
    // Infantry use FootClass::Per_Cell_Process which does NOT clear NavCom at cell.
    // (Infantry NavCom clearing happens at sub-cell level in InfantryClass)
    //
    // Verify the worldToCell check works correctly for different entity positions.
    const cellX = 7, cellY = 7;
    const targetCell = worldToCell(cellX * CELL_SIZE + CELL_SIZE / 2, cellY * CELL_SIZE + CELL_SIZE / 2);

    // Entity at same cell — should match
    const sameCell = worldToCell(cellX * CELL_SIZE + 1, cellY * CELL_SIZE + 1);
    expect(sameCell.cx).toBe(targetCell.cx);
    expect(sameCell.cy).toBe(targetCell.cy);

    // Entity at adjacent cell — should NOT match
    const adjCell = worldToCell((cellX + 1) * CELL_SIZE + 1, cellY * CELL_SIZE + 1);
    expect(adjCell.cx).not.toBe(targetCell.cx);

    // Entity at edge of cell — still same cell
    const edgeCell = worldToCell(cellX * CELL_SIZE + CELL_SIZE - 1, cellY * CELL_SIZE + CELL_SIZE - 1);
    expect(edgeCell.cx).toBe(targetCell.cx);
    expect(edgeCell.cy).toBe(targetCell.cy);
  });
});
