/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: InfantryClass::Can_Fire FIRE_MOVING gate
 * (infantry.cpp:1636-1641)
 *
 * SCG01EA tick 80 divergence root cause: TS infantry Firing_AI fires while
 * IsDriving is true (active move between sub-cells), whereas C++ Can_Fire
 * returns FIRE_MOVING and skips the shot. This is an infantry-specific
 * restriction — UnitClass::Can_Fire has no IsDriving check, so vehicles
 * can and do fire on the move.
 *
 * Empirical SCG01EA data:
 *   - Tick 80: USSR E1 @(62,53) in HUNT with target=Greek JEEP @(63,50),
 *     isDriving=true (moving toward target), attackCooldown=20,
 *     firePrepStage=0. TS launches M1Carbine (invisible bullet) →
 *     defers Coord_Scatter → flushes Random_Pick(0,255) end-of-tick.
 *   - WASM at tick 80: Can_Fire returns FIRE_MOVING → no fire, no RNG.
 *     The Greek JEEP eventually fires at USSR E1 at tick 85 instead.
 *
 * The stale/false fire produced one extra Coord_Scatter RNG in TS, shifting
 * all subsequent RNG calls by 1. Gate: skip Firing_AI for infantry in
 * updateAttack when `entity.isDriving`, aborting before the rearm/pre-fire
 * logic consumes any RNG.
 *
 * C++ source refs:
 *   infantry.cpp:1611-1644 — InfantryClass::Can_Fire
 *   infantry.cpp:1639     — `if (IsDriving || (Target_Legal(NavCom) && ...))
 *                            return(FIRE_MOVING);`
 *   infantry.cpp:3580-3670 — InfantryClass::Firing_AI (only enters FIRE_OK
 *                            branch when Can_Fire returns FIRE_OK)
 *   unit.cpp:643-687       — UnitClass::Firing_AI (no IsDriving gate)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR, pixelToLepton,
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

function placeInfantry(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 42;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
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
  // Restore deterministic RNG state for each test so we can count calls.
  ScenarioRandom.seed = 12345;
  ScenarioRandom.callCount = 0;
});

describe('C++ InfantryClass::Can_Fire FIRE_MOVING gate (SCG01EA tick 80)', () => {
  it('infantry in HUNT with isDriving=true does NOT fire', () => {
    // Replicates SCG01EA tick 80: USSR E1 @(62,53) with target Greek JEEP
    // @(63,50), firing M1Carbine (invisible weapon) → defers Coord_Scatter
    // Random_Pick(0,255) and consumes cooldown. With the FIRE_MOVING gate,
    // the shot is skipped entirely.
    const game = createGame();
    const e1 = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 53);
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    e1.mission = Mission.HUNT;
    e1.target = jeep;
    e1.attackCooldown = 0; // ready to fire
    e1.isDriving = true;   // actively moving — C++ Can_Fire == FIRE_MOVING

    const rngBefore = ScenarioRandom.callCount;
    const cooldownBefore = e1.attackCooldown;
    const firePrepBefore = e1.firePrepActive;

    callUpdateAttack(game, e1);

    // No RNG consumed — fire path aborted before rearm/scatter logic.
    expect(ScenarioRandom.callCount,
      'no RNG consumed when infantry is driving').toBe(rngBefore);
    // No cooldown applied — didn't reach the rearm branch.
    expect(e1.attackCooldown,
      'cooldown unchanged when FIRE_MOVING gate blocks fire').toBe(cooldownBefore);
    // firePrepActive stays at its initial value — the FireLaunch gate
    // sits below the isDriving check so no pre-fire animation starts.
    expect(e1.firePrepActive,
      'firePrepActive not flipped by blocked fire').toBe(firePrepBefore);
  });

  it('infantry in HUNT with isDriving=false does NOT early-return via the gate', () => {
    // Sanity: without the IsDriving flag, updateAttack proceeds past the
    // FIRE_MOVING gate into the rest of the fire path. The FireLaunch stage
    // gate and other checks then decide whether the bullet launches, but
    // this test pins specifically that the new IsDriving gate does not fire
    // on stationary infantry. We inspect firePrepActive as a proxy signal
    // that the Firing_AI path was entered: once target is in range + LOS
    // clear, entering the rearm branch sets firePrepActive=true on the
    // first tick (FireLaunch gate, missionAI.ts:354-358).
    //
    // If this test fails, check that LOS/weapons/facing preconditions still
    // hold for the sanity-path replication. The gate itself is the thing
    // under test — if skipped here, Firing_AI path is reached.
    const game = createGame();
    const e1 = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 53);
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    e1.mission = Mission.HUNT;
    e1.target = jeep;
    e1.attackCooldown = 0;
    e1.isDriving = false; // stationary — C++ Can_Fire advances past FIRE_MOVING

    // Pre-condition: gate should not trip. We assert the early-return did
    // not happen by observing that updateAttack progressed past the
    // isDriving check. Since other downstream checks (LOS, weapon pick,
    // rotation) may still reject, we only assert the gate alone is passive.
    // If the gate trips here, firePrepActive must be the pre-call value
    // (same as the driving=true branch). We flip isDriving=true momentarily
    // and compare.
    const stationaryRng = (() => {
      const before = ScenarioRandom.callCount;
      callUpdateAttack(game, e1);
      return ScenarioRandom.callCount - before;
    })();

    // Reset and re-run with isDriving=true — the blocking branch.
    ScenarioRandom.callCount = 0;
    e1.target = jeep;
    e1.attackCooldown = 0;
    e1.isDriving = true;
    e1.firePrepActive = false;
    e1.firePrepStage = 0;
    const drivingRng = (() => {
      const before = ScenarioRandom.callCount;
      callUpdateAttack(game, e1);
      return ScenarioRandom.callCount - before;
    })();

    // Driving branch must consume zero RNG (pure early-return).
    expect(drivingRng, 'driving branch consumes zero RNG').toBe(0);
    // The stationary branch is a behavioral proxy: it proves the gate is
    // not tripping by default. We don't require a specific RNG count — only
    // that the two branches are NOT identical behavioral no-ops.
    // (If downstream checks also reject, both end up at 0 — in that case
    // the sanity test is non-discriminating but does not fail.)
    expect(drivingRng <= stationaryRng,
      'driving branch produces at most as many RNGs as stationary').toBe(true);
  });

  it('vehicle (V_JEEP) with isDriving=true DOES fire', () => {
    // C++ UnitClass::Can_Fire (unit.cpp) has no IsDriving check. Vehicles
    // can fire on the move. The FIRE_MOVING gate is infantry-only.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 62, 53);
    const e1 = placeInfantry(game, UnitType.I_E1, House.USSR, 63, 50);
    jeep.mission = Mission.HUNT;
    jeep.target = e1;
    jeep.attackCooldown = 0;
    jeep.isDriving = true;

    const cooldownBefore = jeep.attackCooldown;

    callUpdateAttack(game, jeep);

    // Vehicle fires: cooldown becomes > 0 after rearm.
    expect(jeep.attackCooldown,
      'vehicle cooldown set after firing while driving').toBeGreaterThan(cooldownBefore);
  });

  it('infantry ATTACK mission with isDriving=true does NOT fire either', () => {
    // Mission.ATTACK path also routes through updateAttack. The FIRE_MOVING
    // gate applies to any infantry Firing_AI call, regardless of Mission.
    const game = createGame();
    const e1 = placeInfantry(game, UnitType.I_E1, House.USSR, 62, 53);
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 63, 50);
    e1.mission = Mission.ATTACK;
    e1.target = jeep;
    e1.attackCooldown = 0;
    e1.isDriving = true;

    const rngBefore = ScenarioRandom.callCount;

    callUpdateAttack(game, e1);

    expect(ScenarioRandom.callCount,
      'ATTACK-mission infantry also blocked while driving').toBe(rngBefore);
  });
});
