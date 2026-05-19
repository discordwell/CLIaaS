/**
 * Dual-runtime check for UnitClass::Per_Cell_Process crush cadence.
 *
 * SCU06EB has a USSR C1 at C++ logic[98] / TS logicIndexHint 98 standing in
 * the same cell a GoodGuy tank is crossing. On tick 582 the tank is close
 * enough to crush by distance, but C++ has not reached a PCP_DURING/PCP_END
 * overrun point for that tank, so the C1 remains alive and spends the
 * Mission_Attack jitter RNG on tick 583. A generic per-WALK crush tail removes
 * the C1 one tick early and hides that call.
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

async function wasmScu06C1(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[]).find(entry => entry[0] === 98);
    if (!row) throw new Error('C++ SCU06EB C1 logic row 98 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: row[1],
      house: row[2],
      cx: row[3],
      cy: row[4],
      mission: row[7],
      missionTimer: row[8],
      driving: row[10],
      doing: row[11],
      leptonX: row[12],
      leptonY: row[13],
      hp: row[14],
    };
  });
}

async function tsScu06C1(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const c1 = game.entities.find((entity: any) => entity.logicIndexHint === 98);
    if (!c1) return null;
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: c1.type,
      house: c1.house,
      cx: c1.cell?.cx,
      cy: c1.cell?.cy,
      alive: c1.alive,
      mission: c1.mission,
      missionTimer: c1.missionTimer,
      driving: c1.isDriving,
      doing: c1.doing,
      leptonX: c1.leptonX,
      leptonY: c1.leptonY,
      hp: c1.hp,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU06 vehicle crush cadence', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not crush infantry between raw track per-cell-process points', async () => {
    await withDualScenario('SCU06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 582);
      const cppBefore = await wasmScu06C1(handle.wasm);
      const tsBefore = await tsScu06C1(handle.ts);

      expect(cppBefore).toMatchObject({
        tick: 582,
        type: 'C1',
        house: 'USSR',
        cx: 46,
        cy: 60,
        mission: 1,
        missionTimer: 0,
        driving: true,
        hp: 8,
      });
      expect(tsBefore).toMatchObject({
        tick: 582,
        type: 'C1',
        house: 'USSR',
        cx: 46,
        cy: 60,
        alive: true,
        mission: 'ATTACK',
        missionTimer: 0,
        driving: true,
        hp: 8,
      });

      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });

      const step = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() => (window as any).__rngTagControl?.('read'));

      expect(step.wasm.state.tick).toBe(583);
      expect(step.ts.state.tick).toBe(583);
      expect(step.wasm.state.rngLog).toContainEqual([934115621, 60030, 10098]);
      expect(tsRng.seedLog).toContainEqual([934115621, 60030, 10098]);
      expect(step.ts.state.rngState >>> 0).toBe(step.wasm.state.rngState! >>> 0);
    }, { preserveSourceFog: true });
  }, 180_000);
});
