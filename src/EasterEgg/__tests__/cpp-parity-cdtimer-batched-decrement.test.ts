/**
 * @vitest-environment jsdom
 *
 * C++ Parity: CDTimerClass<FrameTimerClass> batched end-of-tick decrement.
 *
 * Pins the TS refactor that moves per-entity CDTimer-semantic decrements OUT of
 * `updateEntity` and into a single batched pass at the end of `Game.update()`,
 * AFTER Phase 1-4 entity iteration has completed. This mirrors C++ `Frame++`
 * at end of `Main_Loop` (conquer.cpp:2542), which runs ONCE per tick AFTER the
 * entire Logic[] array has been processed.
 *
 * ## Why batched (not per-entity end-of-updateEntity)
 *
 * C++ CDTimerClass<FrameTimerClass>::Value() is lazy:
 *   Value() = max(0, DelayTime - (currentFrame - Started))
 *
 * During Logic.AI (logic.cpp:267-296), every entity reads `currentFrame` which
 * is the SAME frame number for all entities in the tick. Entity[K+1] observing
 * entity[K]'s Timer sees entity[K]'s pre-Frame++ Value.
 *
 * A prior TS attempt (commit d6db5f97, reverted by 4277d897) placed the
 * decrement at the END of each entity's updateEntity. That cascaded — entity[K+1]
 * saw entity[K]'s POST-decrement value (one tick ahead of WASM), producing
 * Playwright first-divergence regressions:
 *   - SCG03EA:  238 → 10   (-228 ticks)
 *   - SCG06EA:  76  → 11   (-65 ticks)
 *   - SCG07EA:  17  → 6    (-11 ticks)
 *
 * The correct fix (this refactor) batches the decrement AFTER the entity loop
 * so cross-entity reads see the consistent pre-Frame++ value.
 *
 * ## Fire conditions
 *
 * C++ MissionClass::AI (mission.cpp:213-232): `if (Timer == 0 && Strength > 0)`.
 * Checks Timer.Value() BEFORE Frame++. TS equivalent: `missionTimer === 0`
 * BEFORE the batched end-of-tick decrement.
 *
 * C++ TechnoClass::Firing_AI: `if (Arm.Value() == 0)`. TS: `attackCooldown <= 0`
 * (equivalent to `=== 0` since batched pass clamps at 0).
 *
 * ## C++ references
 *   - ftimer.h:449-625           CDTimerClass<FrameTimerClass>
 *   - ftimer.h:549-561           Value = DelayTime - (current - Started)
 *   - conquer.cpp:2542           Frame++ at end of Main_Loop
 *   - mission.cpp:213-232        MissionClass::AI fire condition
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
  e.missionTimer = 0;
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

describe('C++ CDTimerClass batched end-of-tick decrement parity', () => {
  // ── Per-entity read semantics within updateEntity ──────────────────────────
  // updateEntity is called from the Phase 1-4 loop. With the refactor, NO timer
  // field is decremented during updateEntity. The batched decrement runs AFTER
  // the full entity loop completes (Game.update after this._runCombat).
  //
  // These unit tests exercise updateEntity in isolation (NOT through Game.update).
  // They verify the INVARIANT that updateEntity reads pre-decrement values and
  // does NOT decrement CDTimer fields itself.

  it('updateEntity does NOT decrement idleAnimTimer (batched elsewhere)', () => {
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;   // skip mission handler
    inf.idleAnimTimer = 3;

    tickEntity(game, inf);

    // Batched decrement is NOT run when invoking updateEntity directly.
    // idleAnimTimer stays at 3 — decrement happens in Game.update batched pass.
    expect(inf.idleAnimTimer).toBe(3);
  });

  it('updateEntity does NOT decrement attackCooldown (batched elsewhere)', () => {
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;
    inf.attackCooldown = 5;

    tickEntity(game, inf);

    expect(inf.attackCooldown).toBe(5);
  });

  it('updateEntity does NOT decrement missionTimer when > 0', () => {
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;

    tickEntity(game, inf);

    // No decrement inside updateEntity — batched pass does it.
    expect(inf.missionTimer).toBe(10);
  });

  it('missionTimer === 0 → Mission_Guard handler fires (mission.cpp:232)', () => {
    // C++ MissionClass::AI checks Timer==0 pre-Frame++. TS: missionTimer === 0
    // pre-batched-decrement triggers dispatch.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 0;

    tickEntity(game, inf);

    // Mission_Guard fired, set new timer to AA_Delay(14) + Random_Pick(0,2) = 14..16.
    // No decrement in updateEntity — observed value is the assigned value.
    expect(inf.missionTimer).toBeGreaterThanOrEqual(14);
    expect(inf.missionTimer).toBeLessThanOrEqual(16);
  });

  // ── Full Game.update batched pass semantics ────────────────────────────────
  // When invoked via the full update() tick, the batched decrement runs AFTER
  // all entity processing. Post-tick observations are 1 less than mid-tick.

  it('full Game.update: missionTimer decrements once per tick (batched)', () => {
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;   // no handler fire
    inf.attackCooldown = 0;
    inf.idleAnimTimer = 5;
    inf.attackCooldown2 = 3;
    inf.nonInterruptAnimTicks = 7;

    // @ts-expect-error private
    game.update();

    // Each CDTimer field decremented exactly once by the batched pass.
    expect(inf.missionTimer).toBe(9);
    expect(inf.attackCooldown).toBe(0);      // clamped at 0
    expect(inf.idleAnimTimer).toBe(4);
    expect(inf.attackCooldown2).toBe(2);
    expect(inf.nonInterruptAnimTicks).toBe(6);
  });

  it('full Game.update: missionTimer=0 entering tick → handler fires, post-tick reflects new_value - 1', () => {
    // C++: Tick T enters with Timer==0 → Mission_Guard fires, assigns Timer = D + jitter.
    // Frame++ at end of tick → next tick reads Value = D + jitter - 1.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 0;

    // @ts-expect-error private
    game.update();

    // Handler fired with Timer = 14..16, then batched decrement → 13..15.
    expect(inf.missionTimer).toBeGreaterThanOrEqual(13);
    expect(inf.missionTimer).toBeLessThanOrEqual(15);
  });

  it('full Game.update: attackCooldown=0 stays 0 after batched decrement (clamp)', () => {
    // Idle Arm stays at 0 indefinitely — clamp prevents underflow.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 10;    // skip mission handler
    inf.attackCooldown = 0;

    // @ts-expect-error private
    game.update();

    expect(inf.attackCooldown).toBe(0);
  });

  it('cross-entity read consistency: entity[K+1] sees entity[K]\'s pre-decrement Timer', () => {
    // C++ semantics: every entity in the tick reads Timer values at the SAME
    // currentFrame. Mid-loop, entity[K+1] reading entity[K].missionTimer should
    // see the pre-Frame++ value.
    //
    // With the refactor, no entity decrements its own Timer during updateEntity
    // — the batched pass runs AFTER the loop. So cross-entity reads in Phase 1-4
    // all observe pre-decrement values.
    const game = createGame();
    const a = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    const b = placeInfantry(game, UnitType.I_E1, House.Greece, 11, 11);
    a.missionTimer = 7;
    b.missionTimer = 9;

    // During a full Game.update tick, while processing entity b, any read of
    // a.missionTimer should return 7 (not 6) — a has been processed but not
    // decremented. We can't directly observe mid-loop, but we can verify that
    // POST-tick both decrement exactly once: 7→6, 9→8.
    // @ts-expect-error private
    game.update();

    expect(a.missionTimer).toBe(6);
    expect(b.missionTimer).toBe(8);
  });

  it('Mission_Guard Arm-return preserves Arm value (SCG03EA tick 238)', () => {
    // C++ foot.cpp:683-685: `if (Arm != 0) return (int)Arm;` — reads Arm pre-
    // Frame++. TS: `armBeforeScan = entity.attackCooldown` at Mission.GUARD
    // dispatch (index.ts) captures the pre-batched-decrement value — matching
    // C++ Arm.Value at Logic.AI time.
    //
    // Setup: entity in GUARD, missionTimer=0 (will fire), attackCooldown=23.
    // C++: Mission_Guard returns Arm=23, Timer = 23. Frame++ → post-tick view
    //      Timer=22, Arm=22.
    const game = createGame();
    const inf = placeInfantry(game, UnitType.I_E1, House.Greece, 10, 10);
    inf.missionTimer = 0;
    inf.attackCooldown = 23;

    // @ts-expect-error private
    game.update();

    // Both Timer and Arm decremented ONCE by batched pass.
    // Pre-batched: Timer=23 (from Mission_Guard), Arm=23 (unchanged).
    // Post-batched: Timer=22, Arm=22.
    expect(inf.missionTimer).toBe(22);
    expect(inf.attackCooldown).toBe(22);
  });
});
