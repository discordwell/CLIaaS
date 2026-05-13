/**
 * Dual-runtime check for DisplayClass::Calculated_Cell edge scanning.
 *
 * SCU10EA's `conv2` Turkey TRUK reinforcement is aligned to waypoint 27 near
 * the east map edge. C++ does not blindly use the aligned y=60 edge cell:
 * Good_Reinforcement_Cell rejects it because the inside cell is occupied when
 * the trigger fires, then scans forward/wraps to the first legal edge cell
 * at y=58. TS used to skip that ground-team scan and spawned at y=60.
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

async function wasmTurkeyTrucks(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((u: any) => u.t === 'TRUK' && u.house === 'Turkey')
      .sort((a: any, b: any) => a.id - b.id)
      .map((u: any) => ({
        cx: u.cx,
        cy: u.cy,
        lx: u.lx,
        ly: u.ly,
        mission: u.m,
        missionTimer: u.mt,
        isDriving: u.drv === true,
      }));
  }, undefined);
}

async function tsTurkeyTrucks(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return game.entities
      .filter((e: any) => e.type === 'TRUK' && e.house === 'Turkey')
      .sort((a: any, b: any) => a.id - b.id)
      .map((e: any) => ({
        cx: e.cell.cx,
        cy: e.cell.cy,
        lx: e.leptonX,
        ly: e.leptonY,
        mission: e.mission,
        missionTimer: e.missionTimer,
        isDriving: e.isDriving === true,
      }));
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 reinforcement edge scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('spawns the Turkey convoy at the first C++ Good_Reinforcement_Cell edge slot', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 210);
      const cpp = await wasmTurkeyTrucks(handle.wasm);
      const ts = await tsTurkeyTrucks(handle.ts);

      expect(ts).toHaveLength(3);
      expect(cpp).toHaveLength(3);
      for (let i = 0; i < cpp.length; i++) {
        expect(ts[i]).toEqual({
          ...cpp[i],
          mission: 'MOVE',
        });
        expect(cpp[i].mission).toBe(2);
        expect(cpp[i].cx).toBe(114);
        expect(cpp[i].cy).toBe(58);
      }
    }, { wasmSeed: 0 });
  }, 180_000);
});
