/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: DriveClass::AI → Start_Of_Move → Basic_Path failure
 * (drive.cpp:961-1029 + foot.cpp:313-500)
 *
 * SCG11EA tick 19 divergence root cause: TS's direct-move fallback in
 * `updateMove` (index.ts) sub-cell crawls toward a moveTarget even when the
 * target is blocked by a friendly unit in the adjacent cell and would fail
 * Basic_Path in C++. As a result, TS's Mission_Move timer eventually reaches
 * zero and fires Random_Pick(0,2) jitter (foot.cpp:535, tag 60010) — WASM
 * already cleared NavCom via drive.cpp:970 and transitioned to GUARD, so no
 * RNG fire occurs.
 *
 * The specific SCG11EA setup:
 *   USSR 4TNK at cell (60,58) patrol-assigned MOVE to (62,59).
 *   Friendly USSR 4TNK at (61,59) blocks the direct adjacent cell (61,58→59).
 *   Distance to target: ~640 leptons < CloseEnoughDistance=704 leptons.
 *
 * C++ flow (drive.cpp:961-972):
 *   1. DriveClass::AI sees Path[0]==FACING_NONE → Start_Of_Move.
 *   2. Start_Of_Move calls Basic_Path → fails (adjacent blocked).
 *   3. `Distance(NavCom) < CloseEnoughDistance && Mission==MISSION_MOVE` →
 *      Assign_Destination(TARGET_NONE); NavCom cleared immediately.
 *   4. Next tick's Mission_Move (foot.cpp:524): !NavCom && !IsDriving →
 *      Enter_Idle_Mode; return(1); NO RNG consumed.
 *
 * TS fix (index.ts updateMove, team.ts coordinatePatrol):
 *   - updateMove: when path empty + moveTarget set + missionTimer>0 (or
 *     previously blocked on same target) + adjacent cell occupied by friendly
 *     unit + target within CloseEnoughDistance → clear moveTarget, flag
 *     `patrolBlockedTargetLX/LY`, setMissionIdle (GUARD).
 *   - coordinatePatrol: when re-assigning MOVE, check the flag — if the team's
 *     target matches the blocked target, skip the `missionTimer=0` reset so
 *     Mission_Move doesn't re-fire Random_Pick jitter on every tick.
 *
 * Mission_Move is expected to fire jitter ONCE on initial activation (matching
 * WASM tick 3 for this scenario). On subsequent ticks when Basic_Path would
 * fail in C++, our fix transitions the unit to GUARD without further RNG
 * consumption, matching WASM's stationary behavior from tick 3-14.
 *
 * C++ source refs:
 *   drive.cpp:961-1029 — DriveClass::Start_Of_Move (Basic_Path failure cases)
 *   drive.cpp:970      — "close enough" → Assign_Destination(TARGET_NONE)
 *   foot.cpp:313-500   — FootClass::Basic_Path (pathfinding with threshold)
 *   foot.cpp:524       — Mission_Move: !NavCom && !IsDriving → Enter_Idle_Mode
 *   foot.cpp:536       — Mission_Move: Random_Pick(0,2) jitter (tag 60010)
 *   rules.ini [General] CloseEnough=2.75 → 704 leptons (2.75 * 256)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR, pixelToLepton,
} from '../engine/types';

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
      game.map.setTerrain(x, y, 0);
    }
  }
  return game;
}

function placeVehicle(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 42;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  game.map.setOccupancy(cx, cy, e.id);
  return e;
}

function tickEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(e: Entity): void }).updateEntity(entity);
}

function callUpdateMove(game: Game, entity: Entity): void {
  (game as unknown as { updateMove(e: Entity, fromGuardDrive?: boolean): void }).updateMove(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => { resetEntityIds(); });

describe('C++ DriveClass::Start_Of_Move Basic_Path failure (SCG11EA tick 19)', () => {
  it('clears moveTarget when adjacent cell is friendly-blocked + close enough', () => {
    // Replicates SCG11EA tick 3-19: USSR 4TNK at (60,58) moving to (62,59).
    // Friendly USSR 4TNK at (61,59) blocks the direct adjacent cell toward target.
    // Distance: dx=512, dy=256 → oct dist = 512 + 128 = 640 leptons < 704 (CloseEnough).
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    const blocker = placeVehicle(game, UnitType.V_4TNK, House.USSR, 61, 59);

    // Set up post-Mission.MOVE-assignment state (after initial Mission_Move jitter fired).
    // missionTimer > 0 signals we're past the initial RNG-fire tick.
    moving.mission = Mission.MOVE;
    moving.missionTimer = 15;
    moving.moveTarget = {
      lx: pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2),
    };
    moving.path = [];
    moving.isDriving = false;

    expect(blocker.alive).toBe(true);

    callUpdateMove(game, moving);

    // C++ drive.cpp:970 parity — NavCom cleared because Basic_Path fails.
    expect(moving.moveTarget, 'moveTarget should be cleared (NavCom=NONE)').toBeNull();
    // setMissionIdle → GUARD (no guardOrigin, so idleMission returns GUARD)
    expect(moving.mission, 'mission transitions to GUARD').toBe(Mission.GUARD);
    // Flag is stored so coordinatePatrol won't re-fire Mission_Move jitter
    expect(moving.patrolBlockedTargetLX, 'patrolBlockedTargetLX flag').toBe(
      pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2),
    );
    expect(moving.patrolBlockedTargetLY, 'patrolBlockedTargetLY flag').toBe(
      pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2),
    );
  });

  it('does NOT clear moveTarget on Mission.MOVE entry tick (missionTimer=0)', () => {
    // C++ Mission_Move's Random_Pick(0,2) jitter (foot.cpp:535 tag 60010) fires
    // ONCE when Commence sets timer=0 on the MOVE transition. We must let that
    // initial RNG fire to match WASM's tick 3. Fix is gated by `missionTimer > 0`
    // (AND no prior block flag) to preserve the first-tick fire.
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    placeVehicle(game, UnitType.V_4TNK, House.USSR, 61, 59);

    moving.mission = Mission.MOVE;
    moving.missionTimer = 0; // entry tick — first Mission_Move handler call
    moving.moveTarget = {
      lx: pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2),
    };
    moving.path = [];
    moving.isDriving = false;
    // Clean flags (entry tick, no prior block)
    moving.patrolBlockedTargetLX = -1;
    moving.patrolBlockedTargetLY = -1;

    callUpdateMove(game, moving);

    // On entry tick (timer=0, no prior block), the clear gate is not taken —
    // updateMove falls through so Mission_Move's switch handler can fire the
    // Random_Pick(0,2) jitter (done by the caller switch case, not updateMove).
    expect(moving.moveTarget, 'moveTarget preserved on entry tick').not.toBeNull();
    expect(moving.mission, 'mission stays MOVE on entry tick').toBe(Mission.MOVE);
  });

  it('re-fires clear on subsequent ticks when previously blocked (timer=0 re-fire)', () => {
    // After the initial jitter consumed RNG, if Mission_Move's timer counts
    // down to 0 again (team re-assign cycle), we must NOT fire jitter again.
    // The `alreadyBlockedThisTarget` check lifts the `missionTimer > 0` gate
    // when the block flag matches the current moveTarget, clearing moveTarget
    // before the switch-case timer-fire handler runs.
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    placeVehicle(game, UnitType.V_4TNK, House.USSR, 61, 59);

    const targetLX = pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2);
    const targetLY = pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2);

    moving.mission = Mission.MOVE;
    moving.missionTimer = 0; // timer reached 0 — would fire jitter without fix
    moving.moveTarget = { lx: targetLX, ly: targetLY };
    moving.path = [];
    moving.isDriving = false;
    // Pre-existing block flag from prior fix trigger
    moving.patrolBlockedTargetLX = targetLX;
    moving.patrolBlockedTargetLY = targetLY;

    callUpdateMove(game, moving);

    expect(moving.moveTarget, 'moveTarget cleared even at timer=0').toBeNull();
    expect(moving.mission, 'mission transitions to GUARD').toBe(Mission.GUARD);
  });

  it('does NOT clear moveTarget when adjacent cell is empty (path exists)', () => {
    // Sanity: without a friendly blocker, the fix must not fire. Vehicle
    // should continue through the normal updateMove path.
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    // No blocker placed at (61, 59)

    moving.mission = Mission.MOVE;
    moving.missionTimer = 15;
    moving.moveTarget = {
      lx: pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2),
    };
    moving.path = [];
    moving.isDriving = false;

    callUpdateMove(game, moving);

    expect(moving.moveTarget, 'moveTarget preserved without blocker').not.toBeNull();
    expect(moving.mission, 'mission stays MOVE without blocker').toBe(Mission.MOVE);
    expect(moving.patrolBlockedTargetLX).toBe(-1);
  });

  it('does NOT clear moveTarget when adjacent blocker is an enemy unit', () => {
    // C++ drive.cpp:970 specifically handles FRIENDLY (MOVE_TEMP) blockers.
    // Enemy units give MOVE_DESTROYABLE and are handled by different logic
    // (Greatest_Threat target acquisition). Our fix uses entitiesAllied to
    // restrict to friendlies only.
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    // Place ENEMY (Greece — not allied to USSR) at the adjacent cell
    placeVehicle(game, UnitType.V_2TNK, House.Greece, 61, 59);

    moving.mission = Mission.MOVE;
    moving.missionTimer = 15;
    moving.moveTarget = {
      lx: pixelToLepton(62 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(59 * CELL_SIZE + CELL_SIZE / 2),
    };
    moving.path = [];
    moving.isDriving = false;

    callUpdateMove(game, moving);

    expect(moving.moveTarget, 'moveTarget preserved when blocker is enemy').not.toBeNull();
    expect(moving.patrolBlockedTargetLX).toBe(-1);
  });

  it('does NOT clear moveTarget when target is beyond CloseEnoughDistance', () => {
    // C++ drive.cpp:970 guard: only clears NavCom if Distance < CloseEnoughDistance
    // (704 leptons = 2.75 cells). Far targets keep trying Basic_Path at higher
    // thresholds, matching C++ TryTryAgain logic.
    const game = createGame();
    const moving = placeVehicle(game, UnitType.V_4TNK, House.USSR, 60, 58);
    placeVehicle(game, UnitType.V_4TNK, House.USSR, 61, 59);

    moving.mission = Mission.MOVE;
    moving.missionTimer = 15;
    // Far target: cell (70, 58) — dx = 10 cells = 2560 leptons >> 704
    moving.moveTarget = {
      lx: pixelToLepton(70 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(58 * CELL_SIZE + CELL_SIZE / 2),
    };
    moving.path = [];
    moving.isDriving = false;

    callUpdateMove(game, moving);

    expect(moving.moveTarget, 'far target not cleared by the close-enough gate').not.toBeNull();
    expect(moving.patrolBlockedTargetLX).toBe(-1);
  });

  it('infantry are not affected (FootClass::Basic_Path has different semantics)', () => {
    // Fix targets vehicles only: infantry use sub-cell movement and the
    // coordinatePatrol code queues MissionQueue instead of direct-setting
    // Mission, so the Timer-reset race doesn't apply. Skip my fix for infantry.
    const game = createGame();
    const moving = new Entity(UnitType.I_E1, House.USSR, 60 * CELL_SIZE + 12, 58 * CELL_SIZE + 12);
    moving.mission = Mission.MOVE;
    moving.missionTimer = 15;
    moving.moveTarget = {
      lx: pixelToLepton(62 * CELL_SIZE + 12),
      ly: pixelToLepton(59 * CELL_SIZE + 12),
    };
    moving.path = [];
    moving.isDriving = false;
    game.entities.push(moving);
    game.entityById.set(moving.id, moving);

    placeVehicle(game, UnitType.V_4TNK, House.USSR, 61, 59);

    callUpdateMove(game, moving);

    // Infantry path: our fix doesn't fire. Usual infantry handling applies.
    expect(moving.patrolBlockedTargetLX, 'infantry flag untouched').toBe(-1);
  });
});
