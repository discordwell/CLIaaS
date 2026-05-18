/**
 * Dual-runtime check for C++ Do_Action(DO_GET_UP) prone-state semantics.
 *
 * In SCG28EA, the Greek E3 at logic index 203 has recovered from prone fear by
 * tick 705. C++ has IsProne=false and Doing=DO_STAND_READY, so tick 706 runs
 * InfantryClass::Random_Animate before Mission_Guard. TS must not clear
 * isProne while leaving Doing stuck in the prone animation state, or it skips
 * the same idle RNG calls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
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

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmScg28E3Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic203 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 203);
    if (!logic203 || logic203[1] !== 'E3' || logic203[2] !== 'Greece') {
      throw new Error('C++ SCG28EA Greek E3 logic index 203 not found');
    }
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const e3 = allUnits.find((u: any) =>
      u.t === 'E3' &&
      u.house === 'Greece' &&
      u.cx === logic203[3] &&
      u.cy === logic203[4] &&
      u.lx === logic203[12] &&
      u.ly === logic203[13]);
    if (!e3) throw new Error('C++ SCG28EA Greek E3 state not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e3: {
        mission: logic203[7],
        missionTimer: logic203[8],
        hp: logic203[14],
        doing: e3.doing,
        isProne: e3.prone === true,
        idleTimer: e3.idle,
      },
    };
  });
}

async function tsScg28E3Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e3 = game.entities.find((e: any) => e.logicIndexHint === 203);
    if (!e3 || e3.type !== 'E3' || e3.house !== 'Greece') {
      throw new Error('TS SCG28EA Greek E3 logic index 203 not found');
    }
    return {
      tick: game.tick,
      rngState: state.rngState,
      e3: {
        mission: e3.mission,
        missionTimer: e3.missionTimer,
        hp: e3.hp,
        doing: e3.doing,
        isProne: e3.isProne === true,
        idleTimer: e3.idleAnimTimer,
        randomAnimateReady: e3.isReadyToRandomAnimate(),
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG28 infantry get-up random animate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reaches stand-ready after get-up before the guard timer fires', async () => {
    await withDualScenario('SCG28EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 705);
      const [cpp705, ts705] = await Promise.all([
        wasmScg28E3Snapshot(handle.wasm),
        tsScg28E3Snapshot(handle.ts),
      ]);

      expect(ts705.tick).toBe(cpp705.tick);
      expect(ts705.rngState >>> 0).toBe(cpp705.rngState >>> 0);
      expect(cpp705.e3).toMatchObject({
        mission: 5,
        missionTimer: 0,
        hp: 37,
        doing: 0,
        isProne: false,
        idleTimer: 0,
      });
      expect(ts705.e3).toMatchObject({
        mission: 'GUARD',
        missionTimer: 0,
        hp: cpp705.e3.hp,
        doing: 'stand_ready',
        isProne: false,
        idleTimer: 0,
        randomAnimateReady: true,
      });

      const step706 = await stepBoth(handle, 1);
      expect(step706.ts.rngState >>> 0).toBe(step706.wasm.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
