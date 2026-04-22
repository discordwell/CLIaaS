/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: UnitClass::Can_Fire FIRE_FACING gate — 256-step precision
 * (unit.cpp:4163-4181)
 *
 * SCG01EA tick 87 residual divergence (after 6079da63 + 7fac4188):
 *   After the coarse 8-dir FIRE_ROTATING gate was added, one JEEP still fired
 *   at tick 87 producing a stray Coord_Scatter RNG call. Root cause:
 *     TS's `tickTurretRotation()` returns "aligned" when 8-dir turretFacing
 *     matches 8-dir desiredTurretFacing. But `turretFacing32` (0-31) may be
 *     off by up to 3 within the same 45° 8-dir zone — equivalent to 24/256,
 *     well above C++'s 8/256 FIRE_FACING tolerance.
 *
 *     Example: turret rotating N→NE@CCW. 3 ticks in, turretFacing32=5 (within
 *     NE zone 4-7 → turretFacing=NE). 8-dir check passes (NE === NE). C++:
 *     diff256 = |NE256(32) - turret256(40)| = 8, not < 8 → FIRE_FACING.
 *
 * Fix: add 256-step diff check using `directionToLeptons256`. Homing weapons
 *      (Bullet->ROT != 0) get 4× tolerance via `diff >>= 2`.
 *
 * C++ source refs:
 *   unit.cpp:4163-4181 — dir = Direction(target); diff = ABS(SecondaryFacing.Difference(dir));
 *                        if (weapon->Bullet->ROT != 0) diff >>= 2;
 *                        if (diff < 8) Can_Fire OK; else return FIRE_FACING.
 *   facing.h:70        — Difference: (int)(signed char)(desired - current).
 *   coord.cpp:390-408  — Coord_Scatter source_tag=50002.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR, Dir,
  directionToLeptons256,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';

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

function placeInfantry(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 42;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

function callUpdateAttack(game: Game, entity: Entity): void {
  (game as unknown as { updateAttack(e: Entity): void }).updateAttack(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 12345;
  ScenarioRandom.callCount = 0;
});

/** C++ FacingClass::Difference: (int)(signed char)(desired - current). */
function cppDiff256(desired: number, current: number): number {
  let d = (desired - current) & 0xFF;
  if (d > 127) d -= 256;
  return d;
}

describe('C++ UnitClass::Can_Fire 256-step FIRE_FACING gate (SCG01EA tick 87 residual)', () => {
  it('JEEP turretFacing32 off by 3 within matching 8-dir zone does NOT fire', () => {
    // Reproduce the residual SCG01EA tick-87 case: 8-dir alignment passes but
    // 32-step (and therefore 256-step) misses the C++ FIRE_FACING tolerance.
    // Target direction in 256-step = 32 (NE). Turret parked at turretFacing32=5
    // (still in NE 8-dir zone 4-7) → turret256 = 40. diff = |32-40| = 8, NOT < 8
    // → C++ returns FIRE_FACING.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 60, 50);
    // Target placed such that 256-step direction is exactly NE (32).
    // NE = (+X, -Y). Pixel direction from (60,50) to (62,48) gives dx=dy → exact NE.
    // Within M60mg range (4 cells); sqrt(8) ≈ 2.83.
    const target = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 48);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;
    // Seed turret into a "mid-zone" 32-step position that still 8-dir-matches NE.
    // turretFacing32 = 5 → turretFacing = floor(5/4) = 1 = Dir.NE.
    jeep.turretFacing = Dir.NE;
    jeep.turretFacing32 = 5;
    jeep.desiredTurretFacing = Dir.NE;

    // Sanity: 8-dir already aligned (coarse tickTurretRotation returns true).
    expect(jeep.turretFacing).toBe(Dir.NE);
    expect(jeep.desiredTurretFacing).toBe(Dir.NE);

    // Sanity on the 256-step diff: should be >= 8 for this setup.
    const dir256 = directionToLeptons256(
      jeep.leptonX, jeep.leptonY, target.leptonX, target.leptonY,
    );
    const turret256 = (jeep.turretFacing32 * 8) & 0xFF;
    const diff = Math.abs(cppDiff256(dir256, turret256));
    expect(diff, '256-step diff should be ≥ 8 in this setup').toBeGreaterThanOrEqual(8);

    const rngBefore = ScenarioRandom.callCount;
    const pendingBefore = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    // The fine 256-step FIRE_FACING gate MUST block this fire.
    const pendingAfter = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    expect(pendingAfter,
      '256-step FIRE_FACING gate blocks fire when diff >= 8').toBe(pendingBefore);
    expect(ScenarioRandom.callCount,
      'no Coord_Scatter RNG consumed when 256-step gate blocks').toBe(rngBefore);
  });

  it('JEEP turretFacing32 landed on exact 256-step target DOES fire', () => {
    // When turretFacing32 matches the 8-dir target zone exactly (mid-zone),
    // 256-step diff is the offset between turret256 and dir256. If we land
    // turretFacing32 on the closest 32-step boundary to the target direction,
    // diff < 8 → fire OK.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 60, 50);
    // Target at exact NE within M60mg range (sqrt(8) ≈ 2.83 cells).
    const target = placeInfantry(game, UnitType.I_DOG, House.USSR, 62, 48);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;

    // Align turret on exact NE boundary. turretFacing32 = 4 → turret256 = 32.
    jeep.turretFacing = Dir.NE;
    jeep.turretFacing32 = 4;
    jeep.desiredTurretFacing = Dir.NE;

    // Sanity: 256-step diff should be 0 for a perfectly-aligned NE target.
    const dir256 = directionToLeptons256(
      jeep.leptonX, jeep.leptonY, target.leptonX, target.leptonY,
    );
    const turret256 = (jeep.turretFacing32 * 8) & 0xFF;
    expect(Math.abs(cppDiff256(dir256, turret256)),
      'perfectly aligned NE → diff = 0').toBeLessThan(8);

    const pendingBefore = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    const pendingAfter = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    expect(pendingAfter,
      'perfectly aligned turret fires → invisible Coord_Scatter deferred').toBeGreaterThan(pendingBefore);
  });

  it('homing projectile (Bullet->ROT != 0) gets 4× tolerance via diff >>= 2', () => {
    // SAM missile (projectileROT != 0). Even with a 24/256 off-aim, diff >>= 2
    // → 6/256, which is < 8 → fire OK. Verify the homing-bypass branch.
    // Use a surrogate: override weapon.projectileROT on a unit with an invisible
    // primary. The SAM site is a structure, so we test the logic path via a
    // manual weapon.projectileROT assignment on a turreted vehicle.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 60, 50);
    // Exact-NE target within range.
    const target = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 48);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;

    // Same misalignment as test 1 (diff256 ≥ 8).
    jeep.turretFacing = Dir.NE;
    jeep.turretFacing32 = 5;
    jeep.desiredTurretFacing = Dir.NE;

    // Sanity: still misaligned at 256-step.
    const dir256 = directionToLeptons256(
      jeep.leptonX, jeep.leptonY, target.leptonX, target.leptonY,
    );
    const turret256 = (jeep.turretFacing32 * 8) & 0xFF;
    const diff = Math.abs(cppDiff256(dir256, turret256));
    expect(diff).toBeGreaterThanOrEqual(8);

    // Inject a homing projectileROT into the JEEP's M60mg. After diff >>= 2,
    // tolerance becomes ~32/256, so an 8-24 diff passes.
    // Note: WEAPONS is a shared module-level table; we restore projectileROT
    // after the call so later tests see the original unmodified weapon.
    const origROT = jeep.weapon ? (jeep.weapon as unknown as { projectileROT?: number }).projectileROT : undefined;
    if (jeep.weapon) {
      (jeep.weapon as unknown as { projectileROT: number }).projectileROT = 1;
    }

    const pendingBefore = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    // Homing path passes the gate. M60mg is invisible → deferred scatter.
    const pendingAfter = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    expect(pendingAfter,
      'homing projectile bypasses 256-step FIRE_FACING via diff>>=2').toBeGreaterThan(pendingBefore);

    // Restore the shared weapon stats so subsequent tests see M60mg as non-homing.
    if (jeep.weapon) {
      if (origROT === undefined) {
        delete (jeep.weapon as unknown as { projectileROT?: number }).projectileROT;
      } else {
        (jeep.weapon as unknown as { projectileROT: number }).projectileROT = origROT;
      }
    }
  });

  it('exact south target with turret exactly south fires (diff = 0)', () => {
    // Sanity regression: the "already facing target" case from the original
    // tick-87 fix (JEEP #27) still fires. Pre-align turret on exact S.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    const target = placeInfantry(game, UnitType.I_DOG, House.USSR, 63, 53);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;
    // Exact S: turretFacing32 = 16 → turret256 = 128 = Dir.S in 256-step.
    jeep.turretFacing = Dir.S;
    jeep.turretFacing32 = 16;
    jeep.desiredTurretFacing = Dir.S;

    // Confirm 256-step diff < 8 for a directly-south target from same column.
    const dir256 = directionToLeptons256(
      jeep.leptonX, jeep.leptonY, target.leptonX, target.leptonY,
    );
    const turret256 = (jeep.turretFacing32 * 8) & 0xFF;
    const alignDiff = Math.abs(cppDiff256(dir256, turret256));
    expect(alignDiff, 'directly-south alignment: diff < 8').toBeLessThan(8);

    const pendingBefore = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    const pendingAfter = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    expect(pendingAfter,
      'exactly-aligned turret fires → scatter deferred').toBeGreaterThan(pendingBefore);
  });

  it('256-step gate does not regress the 8-dir misalignment gate', () => {
    // The coarse 8-dir gate from 7fac4188 must still block fires when the
    // turret has not yet rotated to the new target's 8-dir zone.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    const target = placeInfantry(game, UnitType.I_E1, House.USSR, 63, 53);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;
    // Turret N, target S: still rotating in 8-dir.
    jeep.turretFacing = Dir.N;
    jeep.turretFacing32 = 0;
    jeep.desiredTurretFacing = Dir.N; // will be updated to S by updateAttack.

    const pendingBefore = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    const rngBefore = ScenarioRandom.callCount;

    callUpdateAttack(game, jeep);

    const pendingAfter = (game as unknown as {
      _pendingInvisibleScatters: number;
    })._pendingInvisibleScatters;
    expect(pendingAfter,
      '8-dir mismatch still blocks fire').toBe(pendingBefore);
    expect(ScenarioRandom.callCount,
      'no RNG consumed when 8-dir gate blocks').toBe(rngBefore);
  });
});
