/**
 * Dual-runtime check for scenario `Tracked=` unit overrides.
 *
 * SCA04EA marks ANT1/ANT2/ANT3 as Tracked in the scenario INI. C++
 * `UnitTypeClass::Read_INI` applies that before DriveClass computes the
 * terrain throttle, so the moving ANT1 at (65,58) uses Clear/Track speed
 * (204 raw) rather than Clear/Wheel speed (153 raw).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SpeedClass } from '../engine/types.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmTrackedAnt(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
    ];
    const ant = all.find((u: any) =>
      u.t === 'ANT1' &&
      u.house === 'USSR' &&
      u.cx === 65 &&
      u.cy === 58);
    if (!ant) throw new Error('C++ SCA04EA tracked ANT1 probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.m,
      missionQueue: ant.mq,
      missionTimer: ant.mt,
      speedThrottle: ant.spd,
      speedAdd: ant.add,
      trackControlIndex: ant.tn,
      trackIndex: ant.ti,
      ly: ant.ly,
    };
  });
}

async function tsTrackedAnt(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const ant = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'ANT1' &&
      e.house === 'USSR' &&
      e.cell?.cx === 65 &&
      e.cell?.cy === 58);
    if (!ant) throw new Error('TS SCA04EA tracked ANT1 probe not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: ant.mission,
      missionQueue: ant.missionQueue,
      missionTimer: ant.missionTimer,
      speedClass: ant.stats.speedClass,
      speedThrottle: ant.driveSpeed,
      trackControlIndex: ant.trackControlIndex,
      trackIndex: ant.trackIndex,
      ly: ant.leptonY,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA04 tracked ant movement', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses the C++ Tracked=yes terrain throttle for SCA04 ants', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 24);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmTrackedAnt(handle.wasm);
      const ts = await tsTrackedAnt(handle.ts);

      expect(cpp.tick).toBe(24);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.speedClass).toBe(SpeedClass.TRACK);
      expect(ts.speedThrottle).toBe(cpp.speedThrottle);
      expect(ts.trackControlIndex).toBe(cpp.trackControlIndex);
      expect(ts.trackIndex).toBe(cpp.trackIndex);
      expect(ts.ly).toBe(cpp.ly);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('reaches the track boundary soon enough to pop GUARD before tick 28', async () => {
    await withDualScenario('SCA04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 27);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmTrackedAnt(handle.wasm);
      const ts = await tsTrackedAnt(handle.ts);

      expect(cpp.tick).toBe(27);
      expect(cpp.mission).toBe(5);
      expect(cpp.missionQueue).toBe(-1);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.mission).toBe('GUARD');
      expect(ts.missionQueue).toBeNull();
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
