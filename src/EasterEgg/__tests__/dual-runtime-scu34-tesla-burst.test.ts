/**
 * Dual-runtime check for Tesla Coil Ammo=3 burst behavior.
 *
 * C++ initializes TSLA with rules.ini Ammo=3. TechnoClass::Rearm_Delay gives
 * buildings with Ammo>1 a 1-frame rearm, and the electric IsCharged flag is
 * cleared only on the last burst shot. The TS runtime must therefore detonate
 * an invisible TeslaZap bullet on consecutive logic frames while ammo remains.
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

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function resetWasmRngLog(adapter: unknown): Promise<void> {
  await adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    JSON.parse(module.ccall('agent_get_state', 'string', [], []));
  });
}

async function enableTsRngLog(adapter: unknown): Promise<void> {
  await adapterPage(adapter).evaluate(() => {
    (window as any).__rngTagControl?.('enable');
    (window as any).__rngTagControl?.('reset');
  });
}

async function readTsTeslaState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const rng = (window as any).__rngTagControl?.('read');
    const tank = [...(game?.entities ?? [])].find((entity: any) =>
      entity.type === '1TNK' && entity.cell?.cx === 87 && entity.cell?.cy === 41);
    const tesla = [...(game?.structures ?? [])].find((structure: any) =>
      structure.type === 'TSLA' && structure.cx === 87 && structure.cy === 35);

    return {
      tick: state.tick,
      rngState: state.rngState,
      coordScatterCount: ((rng?.seedLog ?? []) as Array<[number, number, number]>)
        .filter(([, sourceTag]) => sourceTag === 50002).length,
      tankHp: tank?.hp,
      teslaAmmo: tesla?.ammo,
      teslaCharged: tesla?.isCharged,
    };
  });
}

function cppTankHp(state: any): number | undefined {
  const tank = ([...(state.units ?? []), ...(state.enemies ?? [])] as any[]).find(entity =>
    entity.t === '1TNK' && entity.cx === 87 && entity.cy === 41);
  return tank?.hp;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 Tesla burst ammo', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps TSLA charged across the first two Ammo=3 burst shots', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 245);
      await resetWasmRngLog(handle.wasm);
      await enableTsRngLog(handle.ts);

      const stepped = await stepBoth(handle, 2);
      const cpp = stepped.wasm.state as any;
      const ts = await readTsTeslaState(handle.ts);
      const cppScatterCount = ((cpp.rngLog ?? []) as Array<[number, number, number]>)
        .filter(([, sourceTag]) => sourceTag === 50002).length;

      expect(ts.tick).toBe(cpp.tick);
      expect(cppScatterCount).toBe(2);
      expect(ts.coordScatterCount).toBe(cppScatterCount);
      expect(ts.rngState >>> 0).toBe((cpp.rngState as number) >>> 0);
      expect(ts.tankHp).toBe(cppTankHp(cpp));
      expect(ts.teslaAmmo).toBe(1);
      expect(ts.teslaCharged).toBe(true);
    });
  }, 60_000);
});
