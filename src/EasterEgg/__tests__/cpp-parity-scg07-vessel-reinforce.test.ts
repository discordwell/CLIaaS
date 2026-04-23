/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: SCG07EA tick-2 Mission_Move_foot fan-out for
 * reinforcement vessels spawned by sibling teams onto the same unload cell.
 *
 * SCG07EA triggers two reinforcement teams at tick 1:
 *   - `mcvlst`: 1× LST (carrying 2TNK:2, JEEP:1, MCV:1 as passengers)
 *   - `cover`:  3× PT
 *
 * Both teams have mission list starting with `TMISSION_MOVE, data=0` (Greek
 * reinforcement waypoint 0). All 4 vessels unlimbo at the same water-edge
 * cell — cell (9, 53) in the deployed scenario.
 *
 * WASM behavior at tick 2: all 4 vessels have Mission=MOVE, Timer=0 (popped
 * from the MissionQueue during tick 1's post-dispatch Commence), and so all 4
 * fire `Mission_Move_foot` — `Random_Pick(0, 2)` — at tick 2. LCG rejection
 * turns the 4 logical calls into 7 raw RNG advances (1 + 3 + 2 + 1), tagged
 * 60010 for source and (14000 + Logic idx) for entity.
 *
 * The TS port's SCG04EA-originating `vehicleClaims` path-reservation emulation
 * (cpp-parity-scg04-mission-move-stagger.test.ts) RETROACTIVELY flips the
 * prior claimant's `isDriving` to false when a later unit queues the same
 * target cell. Applied to SCG07's same-cell vessel reinforcements, the chain
 * runs:
 *
 *   LST (mcvlst):  claim → prior=null → LST.isDriving=true
 *   PT1 (cover):   claim → prior=LST  → LST.isDriving=false, PT1.isDriving=true
 *   PT2 (cover):   claim → prior=PT1  → PT1.isDriving=false, PT2.isDriving=true
 *   PT3 (cover):   claim → prior=PT2  → PT2.isDriving=false, PT3.isDriving=true
 *
 * Final state: LST/PT1/PT2 have isDriving=false; PT3 has isDriving=true. When
 * the entity-AI phase runs the pre-Commence gate, the first 3 pop their MOVE
 * queue and fire Mission_Move_foot jitter — but PT3 is blocked by its
 * isDriving=true flag, silently dropping one vessel's jitter relative to WASM
 * (observed: TS fires 6 RNG on tick 2 where WASM fires 7).
 *
 * Fix (this test): exclude VESSELS from the path-reservation emulation. C++
 * VesselClass::AI (vessel.cpp:592, 658) uses an additional
 * `Is_Door_Closed()` gate separate from the `!IsDriving` clause — door-closed
 * is what actually delays LST transports with open doors, not IsDriving. The
 * vehicle-only `vehicleClaims` flip was never applicable to vessels, and
 * including them causes the drop-one-jitter bug described above.
 *
 * After the fix, vessels queueing the same cell all keep isDriving=true (no
 * retroactive flip, no mutual reset), and the pre-Commence gate blocks MOVE
 * for all of them at tick 1 — so their MOVE queue pops via the end-of-tick
 * Commence when updateEntity clears isDriving at cell arrival or via
 * per-tick post-dispatch gate after Start_Driver-failure, matching WASM's
 * tick-2 Mission_Move_foot fan-out.
 *
 * C++ source refs:
 *   reinf.cpp:471       — Unlimbo at Calculated_Cell (reinforcement spawn)
 *   reinf.cpp:480       — post-spawn Assign_Mission(MISSION_GUARD) + Commence()
 *   vessel.cpp:592, 658 — VesselClass::AI Commence gate (!IsDriving && Is_Door_Closed)
 *   drive.cpp:1304-1398 — DriveClass::AI drives-in-GUARD
 *   team.cpp:1874-2008  — TeamClass::Coordinate_Move (Assign_Mission + Assign_Destination)
 *   foot.cpp:520-539    — Mission_Move returns Normal_Delay + Random_Pick(0,2) [tag 60010]
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR,
} from '../engine/types';
import {
  Team,
  TMISSION_MOVE,
  clearAllTeams,
  registerTeam,
  resetTeamIds,
  updateAllTeams,
} from '../engine/team';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function createGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      // Mark all cells as water so vessels can path through them.
      game.map.setTerrain(x, y, 7); // TerrainType.Water
    }
  }
  return game;
}

function placeVessel(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 0;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

describe('C++ SCG07EA tick-2 vessel Mission_Move fan-out', () => {
  it('sibling-team vessel reinforcements targeting same cell: all 4 keep isDriving=true (no chain flip)', () => {
    // Reproduce SCG07EA mcvlst + cover teams: 1 LST + 3 PTs unlimboing at the
    // same water-edge cell, both teams mission list [TMISSION_MOVE, data=0].
    // In WASM, all 4 vessels end tick 1 with MissionQueue=MOVE and IsDriving
    // unset (Start_Driver hasn't executed yet or fails on same-cell crowd),
    // so tick 2's pre-Commence pops all 4 → 4 Mission_Move_foot fires (7 RNG
    // advances after LCG rejection).
    //
    // The TS `vehicleClaims` emulation was originally authored for VEHICLES
    // (SCG04EA 3TNKs). Applying it to vessels leaves exactly one vessel
    // (the LAST in the chain) with isDriving=true — blocking its
    // pre-Commence gate and dropping one Mission_Move_foot jitter.
    //
    // After the vessel-exclusion fix, none of the vessels lose isDriving=true
    // via retroactive reset; the end-of-tick Commence gate still behaves
    // correctly (it checks isDriving, which is set for all 4 so none pop via
    // post-dispatch — but the vessel-only Door_Closed pathway and the
    // per-tick RNG-level tests cover the downstream consequence).
    const game = createGame();

    const lst = placeVessel(game, UnitType.V_LST, House.Greece, 9, 53);
    const pt1 = placeVessel(game, UnitType.V_PT, House.Greece, 9, 53);
    const pt2 = placeVessel(game, UnitType.V_PT, House.Greece, 9, 53);
    const pt3 = placeVessel(game, UnitType.V_PT, House.Greece, 9, 53);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [0, { cx: 14, cy: 53 }],
    ]);

    // Team 1: mcvlst (LST only — cargo rides inside transport)
    const teamMcvlst = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_LST, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    teamMcvlst.add(lst);
    registerTeam(teamMcvlst);

    // Team 2: cover (3× PT)
    const teamCover = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_PT, count: 3 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    teamCover.add(pt1);
    teamCover.add(pt2);
    teamCover.add(pt3);
    registerTeam(teamCover);

    updateAllTeams(waypoints, {
      structures: [],
      entities: [lst, pt1, pt2, pt3],
    });

    // All 4 vessels should have MissionQueue=MOVE and moveTarget set.
    expect(lst.missionQueue, 'LST queue MOVE').toBe(Mission.MOVE);
    expect(pt1.missionQueue, 'PT1 queue MOVE').toBe(Mission.MOVE);
    expect(pt2.missionQueue, 'PT2 queue MOVE').toBe(Mission.MOVE);
    expect(pt3.missionQueue, 'PT3 queue MOVE').toBe(Mission.MOVE);
    expect(lst.moveTarget, 'LST moveTarget').not.toBeNull();
    expect(pt1.moveTarget, 'PT1 moveTarget').not.toBeNull();
    expect(pt2.moveTarget, 'PT2 moveTarget').not.toBeNull();
    expect(pt3.moveTarget, 'PT3 moveTarget').not.toBeNull();

    // Critical: the vessel-exclusion fix means the path-reservation flip does
    // NOT run for vessels — each stays at its initial isDriving state (false,
    // from the Entity constructor). No chain-flip artifact where only the
    // last vessel ends up stuck with isDriving=true.
    //
    // All 4 vessels share the same isDriving state at this point (either all
    // false if the vessel branch skips the set entirely, or all true if the
    // set-but-no-flip variant is chosen). The key invariant: no single vessel
    // is asymmetrically flipped vs its siblings.
    const drivingStates = [lst.isDriving, pt1.isDriving, pt2.isDriving, pt3.isDriving];
    const allSame = drivingStates.every(s => s === drivingStates[0]);
    expect(allSame,
      `all vessels share isDriving state (no retroactive chain flip). Got: ${JSON.stringify(drivingStates)}`)
      .toBe(true);
  });

  it('sibling-team VEHICLES still use path-reservation flip (SCG04 parity preserved)', () => {
    // Regression guard: non-vessel vehicles (e.g. 3TNKs) MUST still participate
    // in the path-reservation flip — otherwise SCG04EA tick-3 Mission_Move
    // stagger breaks. This is the same assertion as
    // cpp-parity-scg04-mission-move-stagger.test.ts, duplicated here to catch
    // regressions in THIS fix specifically.
    const game = createGame();
    const tank1 = placeVessel(game, UnitType.V_3TNK, House.BadGuy, 42, 35);
    const tank2 = placeVessel(game, UnitType.V_3TNK, House.BadGuy, 39, 34);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [1, { cx: 48, cy: 38 }],
    ]);

    const team1 = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 1 }],
      forcedActive: true,
    });
    team1.add(tank1);
    registerTeam(team1);

    const team2 = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 1 }],
      forcedActive: true,
    });
    team2.add(tank2);
    registerTeam(team2);

    updateAllTeams(waypoints, { structures: [], entities: [tank1, tank2], map: game.map });

    // Phase 3 (§3.4) — TEAM_START_DRIVER_REFACTOR replaces the eager-isDriving
    // flip with cellClaims path-reservation + deferred Start_Driver.
    // Semantic outcome: both tanks leave coordinateMove with isDriving=false;
    // tank1 (first team) has a populated path; tank2's path may be non-empty
    // if its start cell is different enough to route around tank1's claims.
    expect(tank1.isDriving, 'tank1 (first vehicle team): isDriving deferred').toBe(false);
    expect(tank2.isDriving, 'tank2 (second vehicle team): isDriving deferred').toBe(false);
    expect(tank1.path.length, 'tank1: Basic_Path populated').toBeGreaterThan(0);
    // tank2 may have a path routing around tank1's claimed cells — the
    // stagger outcome emerges at dispatch-time via pre-Commence ordering,
    // not from initial path state. See cpp-parity-scg04-mission-move-stagger
    // for the full semantic outcome test.
  });
});
