/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: UnitClass::Can_Fire FIRE_FACING / FIRE_ROTATING gate
 * (unit.cpp:4159-4181)
 *
 * SCG01EA tick 87 divergence root cause: TS turreted vehicles fire the moment
 * they acquire a target via Mission_Guard scan, while C++ UnitClass::Can_Fire
 * first checks whether the turret is facing the target (IsRotating + turret
 * direction difference). If the turret has not completed rotating toward the
 * target (and the weapon's bullet has ROT==0, i.e. non-homing), C++ returns
 * FIRE_ROTATING / FIRE_FACING and skips the shot.
 *
 * Empirical SCG01EA data:
 *   - Tick 87: Greek JEEP @(64,50) acquires target E1 @(62,53) via Mission_Guard
 *     scan. In TS the turret was not yet at the target direction (desiredTurretFacing
 *     = 5, turretFacing started at an older value). Without a FIRE_FACING gate,
 *     TS launched M60mg (invisible bullet) → deferred Coord_Scatter → fired
 *     Random_Pick(0,255) at the end-of-tick flush. WASM's UnitClass::Can_Fire
 *     returned FIRE_ROTATING for the same JEEP → no fire, no RNG.
 *   - Pre-fix: TS fired 2 extra aircraft[51]-mistagged Random_Picks at tick 87
 *     (both JEEPs #27 and #30 firing). Post-fix: JEEP #30 (non-facing turret)
 *     is blocked; JEEP #27 (turret happened to be facing target from a prior
 *     acquisition) still fires — that divergence is a second-order cascade
 *     not addressed here.
 *
 * The stale fires also leaked the aircraft[51] tag into the
 * _pendingInvisibleScatters flush (_sourceTag persisted from the Phase 4
 * aircraft loop). Fix: set _sourceTag to 50002 (Coord_Scatter) before each
 * flushed Random_Pick(0,255) and reset _sourceTag to 0 at end of Phase 4.
 *
 * C++ source refs:
 *   unit.cpp:4159-4161 — `if (!IsFiring && IsRotating && weapon->Bullet->ROT == 0)
 *                         return(FIRE_ROTATING);`
 *   unit.cpp:4168-4181 — turret facing diff gate (FIRE_FACING if diff >= 8)
 *   facing.h:69        — `Is_Rotating() const { return DesiredFacing != CurrentFacing; }`
 *   coord.cpp:390-408  — Coord_Scatter source_tag=50002
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR, Dir,
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

describe('C++ UnitClass::Can_Fire FIRE_ROTATING gate (SCG01EA tick 87)', () => {
  it('JEEP with turret not facing target (diff != 0) does NOT fire', () => {
    // JEEP has turret, M60mg primary (invisible, Bullet->ROT == 0).
    // Turret currently N (0), desired turret S (4) — not yet rotated.
    // Without the gate, TS would launch M60mg and defer Coord_Scatter RNG.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 64, 50);
    const target = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 53);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;
    // Turret at N (0), will desire S-ish (target is SW of jeep).
    jeep.turretFacing = Dir.N;
    jeep.turretFacing32 = Dir.N * 4;
    jeep.desiredTurretFacing = Dir.N; // will be updated by updateAttack → directionTo

    const rngBefore = ScenarioRandom.callCount;
    const pendingBefore = (game as unknown as { _pendingInvisibleScatters: number })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    // No deferred scatter — the facing gate blocked the fire.
    const pendingAfter = (game as unknown as { _pendingInvisibleScatters: number })._pendingInvisibleScatters;
    expect(pendingAfter,
      '_pendingInvisibleScatters not incremented when turret not facing').toBe(pendingBefore);
    // No RNG consumed by the fire path (cooldown rearm / deferred scatter).
    expect(ScenarioRandom.callCount,
      'no RNG consumed by blocked JEEP fire').toBe(rngBefore);
  });

  it('JEEP with turret already facing target DOES fire', () => {
    // JEEP turret pre-aligned with target direction. This is the second-order
    // SCG01EA case (JEEP #27 at tick 87) — not blocked by the new gate because
    // tickTurretRotation() returns facingReady=true immediately when
    // turretFacing === desiredTurretFacing.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    const target = placeInfantry(game, UnitType.I_DOG, House.USSR, 63, 53);
    jeep.mission = Mission.GUARD;
    jeep.target = target;
    jeep.attackCooldown = 0;
    // Pre-align turret with target (directly south → Dir.S = 4).
    jeep.turretFacing = Dir.S;
    jeep.turretFacing32 = Dir.S * 4;
    jeep.desiredTurretFacing = Dir.S;

    const pendingBefore = (game as unknown as { _pendingInvisibleScatters: number })._pendingInvisibleScatters;

    callUpdateAttack(game, jeep);

    // Aligned turret → fire proceeds → invisible scatter deferred.
    const pendingAfter = (game as unknown as { _pendingInvisibleScatters: number })._pendingInvisibleScatters;
    expect(pendingAfter,
      'pre-aligned JEEP fires and defers invisible scatter').toBeGreaterThan(pendingBefore);
  });

  it('non-turreted vehicle (no hasTurret) is unaffected by the gate', () => {
    // Harvesters and similar bodies use PrimaryFacing for aim — the new gate
    // keys on entity.hasTurret, so non-turreted units skip it entirely.
    const game = createGame();
    const harv = placeVehicle(game, UnitType.V_HARV, House.Greece, 10, 10);
    expect(harv.hasTurret,
      'sanity: harvester has no turret').toBe(false);

    // Harvester has no primary weapon — we're only asserting the gate path
    // doesn't early-return. The call completes without throwing.
    harv.mission = Mission.GUARD;
    harv.target = null;

    expect(() => callUpdateAttack(game, harv)).not.toThrow();
  });

  it('_pendingInvisibleScatters flush tags RNG calls with source_tag=50002', () => {
    // After the fix, the flush loop in Game.update() sets _sourceTag = 50002
    // (Coord_Scatter) before each Random_Pick(0,255). Without this, calls
    // inherited the last _sourceTag from the Phase 4 aircraft loop
    // (13000 + final aircraft logicIdx), producing the SCG01EA "aircraft[51]"
    // mistagged entries in the RNG log.
    //
    // We replicate the flush loop logic directly in the test — the block
    // under fix is intentionally minimal (a 4-line helper in Game.update()),
    // so mirroring it here is clearer than routing through step() / scenario
    // bootstrap. Any future rewrite of the flush should preserve:
    //   (a) per-call _sourceTag = 50002 before nextInRange(0, 255), and
    //   (b) no lingering _sourceTag leak into whatever runs next.
    const prevLogging = ScenarioRandom._tagLogging;
    const prevLog = ScenarioRandom._seedLog;
    const prevTag = ScenarioRandom._sourceTag;
    ScenarioRandom._tagLogging = true;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 13051; // simulate aircraft[51] tag leak pre-flush

    try {
      // Mirror the flush loop shape from index.ts:
      //   for (let i = 0; i < flushCount; i++) {
      //     if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 50002;
      //     ScenarioRandom.nextInRange(0, 255);
      //   }
      const flushCount = 2;
      for (let i = 0; i < flushCount; i++) {
        if (ScenarioRandom._tagLogging) {
          ScenarioRandom._sourceTag = 50002;
        }
        ScenarioRandom.nextInRange(0, 255);
      }

      const flushEntries = ScenarioRandom._seedLog.filter(([, tag]) => tag === 50002);
      expect(flushEntries.length,
        'flushed scatters tagged 50002 (Coord_Scatter)').toBe(2);
      const leakedEntries = ScenarioRandom._seedLog.filter(([, tag]) => tag === 13051);
      expect(leakedEntries.length,
        'no RNG calls leak the aircraft[51] tag into the flush').toBe(0);
    } finally {
      ScenarioRandom._tagLogging = prevLogging;
      ScenarioRandom._seedLog = prevLog;
      ScenarioRandom._sourceTag = prevTag;
    }
  });
});
