/**
 * @vitest-environment jsdom
 *
 * Agent Harness __syncRngSeed regression tests.
 *
 * Verifies that the sync function used by the parity harness
 * (scripts/test-divergence-multi.ts etc.) only touches the ScenarioRandom
 * seed and does NOT mutate entity timers. Mutating entity.missionTimer /
 * attackCooldown at sync time is an overcorrection that makes E4 flamers
 * and similar units fire on tick 1 where the WASM build would not,
 * causing parity divergence (see claudepad 2026-04-10 SCG07EA ±5 note).
 *
 * C++ refs:
 *   - mission.cpp:70-78   — MissionClass::MissionClass constructor sets Timer(0)
 *   - techno.cpp:594-625  — TechnoClass constructor sets Arm(0), IdleTimer(0)
 *   - foot.cpp:950-1021   — Mission_Guard_Area honours the natural Timer value
 *
 * The natural values set by Entity/TechnoClass constructors already match
 * C++ at scenario start. __syncRngSeed must preserve them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, UnitType, CELL_SIZE } from '../engine/types';
import { installHarness } from '../engine/agentHarness';
import { ScenarioRandom } from '../engine/random';

// Minimal game stub — installHarness only reads `entities` from the sync path.
function makeStubGame(entities: Entity[]): Parameters<typeof installHarness>[0] {
  return {
    entities,
    tick: 0,
    state: 'paused',
    step: () => undefined,
    debugTriggers: false,
  } as unknown as Parameters<typeof installHarness>[0];
}

function makeEntity(type: UnitType, cx: number, cy: number, house = House.USSR): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

describe('installHarness __syncRngSeed', () => {
  beforeEach(() => {
    resetEntityIds();
    ScenarioRandom.seed = 0;
    ScenarioRandom.debugLog = [];
    // Purge any harness hooks left over from a previous test.
    const w = window as unknown as Record<string, unknown>;
    delete w.__agentReady;
    delete w.__syncRngSeed;
  });

  it('sets ScenarioRandom seed to the target value', () => {
    const e = makeEntity(UnitType.I_E4, 30, 59);
    const game = makeStubGame([e]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(12345);

    expect(ScenarioRandom.seed).toBe(12345);
  });

  it('preserves entity.missionTimer (does not force-reset to 0)', () => {
    // C++ parity: if scenario init assigned a non-zero CDTimer, sync must keep it.
    // Regression guard: previously this was overwritten to 0 by the harness.
    const e = makeEntity(UnitType.I_E4, 30, 59);
    e.missionTimer = 42;
    const game = makeStubGame([e]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(0);

    expect(e.missionTimer).toBe(42);
  });

  it('preserves entity.attackCooldown (does not force-reset to 0)', () => {
    // Regression: the previous harness reset Arm/attackCooldown to 0 during sync,
    // causing E4 flamers to fire on tick 1 in TS where WASM had a natural delay.
    // See claudepad 2026-04-10 SCG07EA note.
    const e = makeEntity(UnitType.I_E4, 30, 59);
    e.attackCooldown = 22;
    e.attackCooldown2 = 11;
    const game = makeStubGame([e]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(0);

    expect(e.attackCooldown).toBe(22);
    expect(e.attackCooldown2).toBe(11);
  });

  it('preserves entity.idleAnimTimer (does not force-reset to 0)', () => {
    // C++ techno.cpp:611 — IdleTimer is a CDTimer. Natural values must not be erased
    // by the parity sync step.
    const e = makeEntity(UnitType.I_E1, 50, 50);
    e.idleAnimTimer = 55;
    const game = makeStubGame([e]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(0);

    expect(e.idleAnimTimer).toBe(55);
  });

  it('preserves timers across multiple entities', () => {
    const a = makeEntity(UnitType.I_E4, 30, 59);
    const b = makeEntity(UnitType.V_2TNK, 40, 60);
    a.missionTimer = 70;
    a.attackCooldown = 30;
    b.missionTimer = 14;
    b.attackCooldown = 12;
    const game = makeStubGame([a, b]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(0xdeadbeef);

    expect(ScenarioRandom.seed).toBe(0xdeadbeef);
    expect(a.missionTimer).toBe(70);
    expect(a.attackCooldown).toBe(30);
    expect(b.missionTimer).toBe(14);
    expect(b.attackCooldown).toBe(12);
  });

  it('entity constructor defaults (0) also pass through unchanged', () => {
    // The normal agent-harness flow (AntGame.tsx: start → pause → step(0) →
    // installHarness) leaves every entity at tick-0 constructor defaults:
    // missionTimer = 0, attackCooldown = 0, idleAnimTimer = 0.
    // Verify the sync function does not perturb these either.
    const e = makeEntity(UnitType.I_E4, 30, 59);
    expect(e.missionTimer).toBe(0);
    expect(e.attackCooldown).toBe(0);

    const game = makeStubGame([e]);
    installHarness(game);
    const sync = (window as unknown as { __syncRngSeed: (s: number) => void }).__syncRngSeed;

    sync(42);

    expect(e.missionTimer).toBe(0);
    expect(e.attackCooldown).toBe(0);
  });
});
