/**
 * @vitest-environment jsdom
 *
 * C++ Parity: CDTimerClass<FrameTimerClass> end-of-tick lazy decrement.
 *
 * Pins the TS refactor that moved per-entity CDTimer-semantic decrements from
 * the START of updateEntity to the END, mirroring C++'s `Frame++` at end of
 * `Main_Loop` (conquer.cpp:2542). In C++ the timer Value is computed lazily
 * via `DelayTime - (currentFrame - startedFrame)` (ftimer.h:549-561), so:
 *
 *   - Logic.AI reads the PRE-Frame++ value.
 *   - After Frame++ the next tick's Logic.AI sees Value = prior_Value - 1.
 *
 * Before the refactor TS decremented at the start of updateEntity — mission
 * and firing handlers read the POST-decrement value, which is one tick ahead
 * of C++. In simple jitter cycles this self-heals (cycle length is identical),
 * but the Mission_Guard Arm-return short-circuit (foot.cpp:683-685) assigns
 * `Timer = Arm` directly, collapsing the 1-tick display offset and exposing
 * the off-by-one on the NEXT Mission_Guard fire.
 *
 * ## C++ references
 *   - ftimer.h:449-625           CDTimerClass<FrameTimerClass>
 *   - ftimer.h:549-561           Value = DelayTime - (current - Started)
 *   - conquer.cpp:2542           Frame++ at end of Main_Loop
 *   - mission.cpp:232            `if (Timer == 0 && Strength > 0)` mission fire condition
 *   - foot.cpp:683-685           FootClass::Mission_Guard Arm-return short-circuit
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR,
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
  game.map.setBounds(0, 0, 64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      game.map.setTerrain(x, y, 0);
    }
  }
  return game;
}

function placeInfantry(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 0; // fires immediately on first tickEntity
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

function tickEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(e: Entity): void }).updateEntity(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
});

describe('C++ CDTimerClass end-of-tick decrement parity', () => {
  it('missionTimer==0 before tick → handler fires THIS tick (mission.cpp:232)', () => {
    // C++ MissionClass::AI: `if (Timer == 0 && Strength > 0) { ... Timer = Mission_X() }`.
    // With end-of-tick decrement, "Timer == 0" is tested BEFORE decrement, matching
    // C++ pre-Frame++ semantics exactly.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    expect(inf.missionTimer).toBe(0);

    tickEntity(game, inf);

    // Handler fired, assigned new missionTimer = AA_Delay (14) + Random_Pick(0,2).
    // End-of-tick decrement has run, so we observe value - 1 = 13..15.
    expect(inf.missionTimer).toBeGreaterThanOrEqual(13);
    expect(inf.missionTimer).toBeLessThanOrEqual(15);
  });

  it('missionTimer > 0 → handler does NOT fire; end-of-tick decrement applies', () => {
    // C++ MissionClass::AI: Timer != 0 → no dispatch. Timer decrements via
    // Frame++ at end of Main_Loop.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;

    tickEntity(game, inf);

    // Handler did NOT fire (Timer was 10, not 0). End-of-tick decrement → 9.
    expect(inf.missionTimer).toBe(9);
  });

  it('attackCooldown decrements at END of tick, not start (matches C++ Arm.Value lazy read)', () => {
    // C++ TechnoClass::Arm is a CDTimer. Value reads in Firing_AI use the
    // pre-Frame++ value; decrement happens lazily at end of Main_Loop.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;       // non-zero: mission handler skipped
    inf.attackCooldown = 5;

    tickEntity(game, inf);

    // After one tick: Arm decrements once (5 → 4).
    expect(inf.attackCooldown).toBe(4);
  });

  it('attackCooldown=0 → unit can fire THIS tick (Firing_AI pre-Frame++ read)', () => {
    // C++ Firing_AI gates weapon fire on `Arm.Value() == 0`. With the refactor
    // we test Arm==0 pre-end-of-tick-decrement — matching C++ Logic.AI read order.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;       // skip mission handler
    inf.attackCooldown = 0;      // ready to fire

    tickEntity(game, inf);

    // attackCooldown was 0 before decrement; end-of-tick guard `if > 0` keeps it 0.
    expect(inf.attackCooldown).toBe(0);
  });

  it('missionTimer = 0 assigned by handler → stays 0 at end of tick', () => {
    // Scenario: Mission.MOVE handler transitions to GUARD via Enter_Idle_Mode
    // (index.ts Mission.MOVE case) setting missionTimer = 0. End-of-tick
    // decrement guards against going negative (if > 0). Next tick observes
    // missionTimer == 0 → GUARD handler fires.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 1;        // will decrement to 0 at end of tick

    tickEntity(game, inf);

    // Handler did NOT fire (was 1). End-of-tick decrement → 0.
    expect(inf.missionTimer).toBe(0);

    tickEntity(game, inf);

    // Next tick: missionTimer is 0 at start → handler fires → new value assigned.
    // End-of-tick decrement → 13..15 (for E1 AA_Delay=14 + jitter).
    expect(inf.missionTimer).toBeGreaterThanOrEqual(13);
    expect(inf.missionTimer).toBeLessThanOrEqual(15);
  });

  it('idleAnimTimer and nonInterruptAnimTicks follow CDTimer semantics', () => {
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;       // skip mission handler
    inf.idleAnimTimer = 3;
    inf.nonInterruptAnimTicks = 5;

    tickEntity(game, inf);

    expect(inf.idleAnimTimer).toBe(2);
    expect(inf.nonInterruptAnimTicks).toBe(4);
  });

  it('Arm-return short-circuit preserves Timer value correctly (SCG03EA tick 238 fix)', () => {
    // C++ foot.cpp:683-685: if (Arm != 0) return (int)Arm. Reads Arm pre-
    // Frame++ decrement. TS equivalent: armBeforeScan = entity.attackCooldown
    // at Mission.GUARD dispatch (index.ts), which is pre-end-of-tick-decrement
    // — matching C++ Arm.Value at Logic.AI.
    //
    // Setup: entity in GUARD, missionTimer about to fire (=0), attackCooldown > 0.
    // Expected: Mission_Guard returns Arm (=attackCooldown), Timer = Arm (no jitter).
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 0;        // Mission_Guard will fire
    inf.attackCooldown = 23;     // Arm > 0 → short-circuit

    // Pre-tick: capture expected "Arm.Value at Logic.AI" value.
    const expectedArmAtDispatch = inf.attackCooldown;

    tickEntity(game, inf);

    // Post-tick state dump (matches WASM post-Frame++ view):
    //   Timer was assigned = Arm (23); end-of-tick decrement → 22.
    //   attackCooldown end-of-tick decrement → 22.
    // Both track in lockstep, matching WASM's lazy CDTimer.
    expect(inf.missionTimer).toBe(expectedArmAtDispatch - 1);
    expect(inf.attackCooldown).toBe(expectedArmAtDispatch - 1);
  });
});
