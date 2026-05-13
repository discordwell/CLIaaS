/**
 * Dual-runtime check for object TARGET NavCom semantics in HOUND_DOG teams.
 *
 * C++ TeamClass::TMission_Follow stores the followed friendly as an object
 * TARGET in each member's NavCom, not as a coordinate snapshot. When the
 * followed tank moves earlier in the same Logic pass, convoy trucks dereference
 * NavCom to the tank's new coordinate before their own DriveClass AI runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmConvoySnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const trucks = [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((u: any) => u.t === 'TRUK' && u.house === 'Turkey')
      .sort((a: any, b: any) => a.id - b.id);
    const team = (state.teams ?? []).find((t: any) => t.cls === 'conv2');
    if (!team || trucks.length !== 3) throw new Error('C++ SCU10EA Turkey convoy not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      trucks: trucks.map((truck: any) => ({
        cx: truck.cx,
        cy: truck.cy,
        mission: truck.m,
        missionQueue: truck.mq,
        missionTimer: truck.mt,
        isDriving: truck.drv === true,
        nav: truck.nlx === undefined ? null : { lx: truck.nlx, ly: truck.nly },
      })),
    };
  }, undefined);
}

async function tsConvoySnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const trucks = game.entities
      .filter((e: any) => e.alive !== false && e.type === 'TRUK' && e.house === 'Turkey')
      .sort((a: any, b: any) => b.id - a.id);
    const team = (window as any).__agentTeams?.().find((t: any) => t.typeName === 'conv2');
    if (!team || trucks.length !== 3) throw new Error('TS SCU10EA Turkey convoy not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      trucks: trucks.map((truck: any) => ({
        cx: truck.cell.cx,
        cy: truck.cell.cy,
        mission: truck.mission,
        missionQueue: truck.missionQueue ?? null,
        missionTimer: truck.missionTimer,
        isDriving: truck.isDriving === true,
        nav: truck.moveTarget ? { lx: truck.moveTarget.lx, ly: truck.moveTarget.ly } : null,
      })),
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 HOUND_DOG object NavCom', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps convoy NavCom bound to the followed moving object', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 405);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmConvoySnapshot(handle.wasm);
      const ts = await tsConvoySnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.trucks).toEqual(cpp.trucks.map(truck => ({
        cx: truck.cx,
        cy: truck.cy,
        mission: truck.mission === 2 ? 'MOVE' : 'GUARD',
        missionQueue: truck.missionQueue === -1 ? null : 'MOVE',
        missionTimer: truck.missionTimer,
        isDriving: truck.isDriving,
        nav: truck.nav,
      })));
    }, { wasmSeed: 0 });
  }, 240_000);
});
