/**
 * Dual-runtime check for FootClass::Mission_Attack approaching without a weapon.
 *
 * C++ foot.cpp:604-619 calls Approach_Target whenever TarCom is legal. It does
 * not require PrimaryWeapon to exist. SCU13EA's Greek `hunt1` team includes a
 * weaponless MGG; when the team attack starts, C++ gives it a NavCom approach
 * cell toward the Soviet target. TS must do the same or the team formation
 * drifts long before the first RNG divergence.
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
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmMggState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const mgg = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.t === 'MGG' && u.house === 'Greece' && u.cx === 78 && u.cy === 60);
    if (!mgg) throw new Error('C++ SCU13EA hunt1 MGG missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: mgg.m,
      missionTimer: mgg.mt,
      target: { lx: mgg.tlx, ly: mgg.tly },
      nav: { lx: mgg.nlx, ly: mgg.nly },
    };
  });
}

async function tsMggState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mgg = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'MGG' &&
      e.house === 'Greece' &&
      e.cell?.cx === 78 &&
      e.cell?.cy === 60);
    if (!mgg) throw new Error('TS SCU13EA hunt1 MGG missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      mission: mgg.mission,
      missionTimer: mgg.missionTimer,
      target: mgg.target ? { lx: mgg.target.leptonX, ly: mgg.target.leptonY } : null,
      nav: mgg.moveTarget ? { lx: mgg.moveTarget.lx, ly: mgg.moveTarget.ly } : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 weaponless attack approach', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('assigns NavCom to a weaponless MGG under Mission_Attack', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 6);
      const cpp = await wasmMggState(handle.wasm);
      const ts = await tsMggState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.target).toEqual(cpp.target);
      expect(cpp.nav).toEqual({ lx: 27016, ly: 10632 });
      expect(ts.nav).toEqual(cpp.nav);
    }, { wasmSeed: 0 });
  }, 300_000);
});
