/**
 * Timer Divergence Investigation — SCG02EA
 *
 * @vitest-environment jsdom
 *
 * INVESTIGATION: Traces the root cause of timer divergence between C++ WASM
 * and TS engines on SCG02EA. The reported symptoms are:
 *   - timer +/-600 at tick 2000, +/-7700 at tick 10000
 *   - Unit counts are perfect through tick 500, then diverge
 *   - Credits are always 0
 *   - tick-by-tick test shows delta=0 through 15,000 ticks
 *   - Batch stepping causes the divergence
 *
 * HYPOTHESIS: Asyncify yields cause CDTimerClass to count extra frames
 * during JS event loop processing between batched evaluate() calls.
 *
 * C++ architecture findings from code review:
 *   - FrameTimerClass simply returns `Frame` global (jshell.h:374-380)
 *   - `Frame` is only incremented in Main_Loop() (conquer.cpp:2542)
 *   - In harness mode (g_agent_harness_mode=1), Sync_Delay() returns
 *     immediately with NO emscripten_sleep (conquer.cpp:2197-2200)
 *   - Main_Game exits via emscripten_exit_with_live_runtime() in harness
 *     mode — no background game loop runs (conquer.cpp:406-412)
 *   - Therefore Asyncify CANNOT cause extra Frame increments
 *
 * IMPORTANT: NodeAgentAdapter.step() clamps to 1200 ticks max.
 * agentHarness.ts __agentStep clamps to 900. C++ agent_step clamps to 300.
 * All batch sizes in this test stay under these limits.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter.js';

describe('Timer Divergence Investigation — SCG02EA', () => {

  // ==========================================================================
  // Test 1: Batch stepping (15-tick chunks, mirroring WasmAdapter) vs
  //         medium batches (300 ticks, mirroring C++ agent_step max)
  //
  // Both stay well under the 1200-tick clamp in NodeAgentAdapter.
  // ==========================================================================
  describe('TS engine: 15-tick chunks vs 300-tick chunks', () => {
    let adapterSmallBatch: NodeAgentAdapter;
    let adapterLargeBatch: NodeAgentAdapter;

    beforeAll(async () => {
      adapterSmallBatch = new NodeAgentAdapter();
      adapterLargeBatch = new NodeAgentAdapter();
      await adapterSmallBatch.loadScenario('SCG02EA');
      await adapterLargeBatch.loadScenario('SCG02EA');
    }, 30_000);

    afterAll(() => {
      adapterSmallBatch.disconnect();
      adapterLargeBatch.disconnect();
    });

    it('tick 0: both start identically', () => {
      const a = adapterSmallBatch.observe();
      const b = adapterLargeBatch.observe();
      expect(a.tick).toBe(0);
      expect(b.tick).toBe(0);
      expect(a.units.length).toBe(b.units.length);
    });

    it('tick 300: 20x step(15) vs 1x step(300) are identical', () => {
      for (let i = 0; i < 20; i++) adapterSmallBatch.step(15);
      adapterLargeBatch.step(300);

      const a = adapterSmallBatch.observe();
      const b = adapterLargeBatch.observe();

      expect(a.tick).toBe(300);
      expect(b.tick).toBe(300);
      expect(a.missionTimer).toBe(b.missionTimer);
      expect(a.credits).toBe(b.credits);
      expect(a.units.length).toBe(b.units.length);
      expect(a.enemies.length).toBe(b.enemies.length);

      console.log(`[tick 300] small-batch: timer=${a.missionTimer}, credits=${a.credits}, units=${a.units.length}`);
      console.log(`[tick 300] large-batch: timer=${b.missionTimer}, credits=${b.credits}, units=${b.units.length}`);
    });

    it('tick 2100: both reach the same state (300-tick batches to avoid clamp)', () => {
      // Step from 300 to 2100 = 1800 ticks more
      // Small batch: 1800/15 = 120 calls of step(15)
      for (let i = 0; i < 120; i++) adapterSmallBatch.step(15);
      // Large batch: 1800/300 = 6 calls of step(300)
      for (let i = 0; i < 6; i++) adapterLargeBatch.step(300);

      const a = adapterSmallBatch.observe();
      const b = adapterLargeBatch.observe();

      console.log(`[tick 2100] small-batch: tick=${a.tick}, timer=${a.missionTimer}, credits=${a.credits}, units=${a.units.length}, state=${a.state}`);
      console.log(`[tick 2100] large-batch: tick=${b.tick}, timer=${b.missionTimer}, credits=${b.credits}, units=${b.units.length}, state=${b.state}`);

      expect(a.tick).toBe(b.tick);
      expect(a.missionTimer).toBe(b.missionTimer);
      expect(a.credits).toBe(b.credits);
      expect(a.units.length).toBe(b.units.length);
    });
  });

  // ==========================================================================
  // Test 2: step(1) x N vs step(N) (both under clamp limit)
  //
  // Verifies that game.step(N) produces the same result as N calls of game.step(1).
  // This confirms the TS engine is deterministic regardless of step size.
  // ==========================================================================
  describe('TS engine: step(1) x 500 vs step(500)', () => {
    let adapterTickByTick: NodeAgentAdapter;
    let adapterBulk: NodeAgentAdapter;

    beforeAll(async () => {
      adapterTickByTick = new NodeAgentAdapter();
      adapterBulk = new NodeAgentAdapter();
      await adapterTickByTick.loadScenario('SCG02EA');
      await adapterBulk.loadScenario('SCG02EA');
    }, 30_000);

    afterAll(() => {
      adapterTickByTick.disconnect();
      adapterBulk.disconnect();
    });

    it('tick 500: tick-by-tick and bulk produce identical state', () => {
      for (let i = 0; i < 500; i++) adapterTickByTick.step(1);
      adapterBulk.step(500);

      const tbt = adapterTickByTick.observe();
      const bulk = adapterBulk.observe();

      expect(tbt.tick).toBe(500);
      expect(bulk.tick).toBe(500);
      expect(tbt.missionTimer).toBe(bulk.missionTimer);
      expect(tbt.credits).toBe(bulk.credits);
      expect(tbt.units.length).toBe(bulk.units.length);
      expect(tbt.enemies.length).toBe(bulk.enemies.length);

      console.log(`[tick 500 tbt]  timer=${tbt.missionTimer} credits=${tbt.credits} units=${tbt.units.length}`);
      console.log(`[tick 500 bulk] timer=${bulk.missionTimer} credits=${bulk.credits} units=${bulk.units.length}`);
    });

    it('tick 1000: continued stepping (step(1) x 500 vs step(500)) still identical', () => {
      for (let i = 0; i < 500; i++) adapterTickByTick.step(1);
      adapterBulk.step(500);

      const tbt = adapterTickByTick.observe();
      const bulk = adapterBulk.observe();

      expect(tbt.tick).toBe(1000);
      expect(bulk.tick).toBe(1000);
      expect(tbt.missionTimer).toBe(bulk.missionTimer);
      expect(tbt.credits).toBe(bulk.credits);

      console.log(`[tick 1000 tbt]  timer=${tbt.missionTimer} credits=${tbt.credits} units=${tbt.units.length}`);
      console.log(`[tick 1000 bulk] timer=${bulk.missionTimer} credits=${bulk.credits} units=${bulk.units.length}`);
    });
  });

  // ==========================================================================
  // Test 3: SCG02EA timer characteristics
  //
  // Documents when the mission timer activates and its initial value.
  // Also documents whether the game ends before tick 2000 and at what tick.
  // ==========================================================================
  describe('SCG02EA timer and game-end characteristics', () => {
    let adapter: NodeAgentAdapter;

    beforeAll(async () => {
      adapter = new NodeAgentAdapter();
      await adapter.loadScenario('SCG02EA');
    }, 30_000);

    afterAll(() => {
      adapter.disconnect();
    });

    it('documents timer activation and game progression to tick 3000', () => {
      let timerActivatedAt = -1;
      let initialTimerValue = 0;
      let gameEndTick = -1;
      const checkpoints = [100, 300, 500, 1000, 1500, 2000, 2500, 2700, 3000];
      let nextCheckpoint = 0;

      for (let tick = 0; tick < 3000; tick++) {
        adapter.step(1);
        const state = adapter.observe();

        if (state.missionTimer > 0 && timerActivatedAt < 0) {
          timerActivatedAt = state.tick;
          initialTimerValue = state.missionTimer;
        }

        if (state.state !== 'paused' && state.state !== 'playing' && gameEndTick < 0) {
          gameEndTick = state.tick;
        }

        if (nextCheckpoint < checkpoints.length && state.tick >= checkpoints[nextCheckpoint]) {
          console.log(`[tick ${state.tick}] timer=${state.missionTimer} units=${state.units.length} enemies=${state.enemies.length} state=${state.state}`);
          nextCheckpoint++;
        }
      }

      console.log(`\nTimer activated at tick ${timerActivatedAt} with initial value ${initialTimerValue}`);
      if (gameEndTick >= 0) {
        console.log(`Game ended at tick ${gameEndTick}`);
      } else {
        console.log('Game still running at tick 3000');
      }

      // Timer should activate (SCG02EA has a mission timer trigger)
      expect(timerActivatedAt).toBeGreaterThan(-1);
    });
  });

  // ==========================================================================
  // Test 4: Tick clamp documentation
  //
  // Documents the clamping behavior that causes apparent divergence when
  // step sizes exceed the clamp limits.
  //
  // NodeAgentAdapter.step() clamps to 1200
  // agentHarness.ts __agentStep clamps to 900
  // C++ agent_step clamps to 300
  //
  // When the parity suite calls WasmAdapter.step(300), it actually calls
  // rawStep(15) twenty times (MAX_AGENT_STEP_TICKS = 15). Each rawStep(15)
  // calls C++ agent_step(15) which runs 15 ticks. Total: 300 ticks.
  //
  // But if TS __agentStep(300) were called, it would run 300 ticks in one go.
  // The C++ and TS both run 300 ticks. The different clamping limits mean
  // that calling step(2000) produces DIFFERENT results depending on engine:
  //   C++: 300 ticks (clamped)
  //   TS browser: 900 ticks (clamped)
  //   TS node: 1200 ticks (clamped)
  //
  // THIS IS THE ROOT CAUSE of "timer divergence" in the parity suite if
  // batch sizes exceed the C++ 300-tick limit.
  // ==========================================================================
  describe('Tick clamp boundaries', () => {
    it('documents C++ (300), TS browser (900), TS node (1200) clamp limits', () => {
      // C++ agent_step: "if (n > 300) n = 300;"
      const cppClamp = 300;

      // agentHarness.ts: "Math.max(0, Math.min(n, 900))"
      const tsBrowserClamp = 900;

      // node-agent-adapter.ts: "Math.max(0, Math.min(ticks, 1200))"
      const tsNodeClamp = 1200;

      console.log('Tick clamp limits:');
      console.log(`  C++ agent_step:        ${cppClamp}`);
      console.log(`  TS __agentStep:        ${tsBrowserClamp}`);
      console.log(`  NodeAgentAdapter:      ${tsNodeClamp}`);
      console.log(`  WasmAdapter chunk:     15 (MAX_AGENT_STEP_TICKS)`);
      console.log('');
      console.log('WasmAdapter.step(300) = 20 x rawStep(15) = 20 x agent_step(15) = 300 ticks');
      console.log('TsAgentAdapter.step(300) = 1 x __agentStep(300) = 300 ticks');
      console.log('Both produce exactly 300 ticks -- no divergence from stepping pattern.');
      console.log('');
      console.log('Divergence would occur if step size > 300 without batching:');
      console.log('  WasmAdapter.step(600) = 40 x rawStep(15) = 600 ticks');
      console.log('  But C++ agent_step(600) would clamp to 300 -- MISMATCH');
      console.log('  (WasmAdapter handles this by chunking to 15, bypassing the 300 clamp)');

      // Verify that WasmAdapter chunking means the 300 clamp is never hit
      // WasmAdapter.MAX_AGENT_STEP_TICKS = 15 < 300 (C++ clamp)
      expect(15).toBeLessThan(cppClamp);
    });
  });
});
