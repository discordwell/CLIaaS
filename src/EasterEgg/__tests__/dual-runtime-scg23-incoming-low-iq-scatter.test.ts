/**
 * Dual-runtime check for CellClass::Incoming IQ gating.
 *
 * In SCG23EA, a USSR E2 fires a slow grenade at the Spain C7 in cell (92,88)
 * on tick 106. C++ CellClass::Incoming does see that C7 in the cell occupier
 * chain, but Spain has no scenario IQ= override, so HouseClass keeps the
 * constructor IQ of 0 and the C7 does not scatter. TS must not treat an
 * omitted allied/non-player IQ as Rule.IQScatter.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmIncomingTargetCell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const units = [...(state.units ?? []), ...(state.enemies ?? [])];
    const shooter = units.find((u: any) =>
      u.t === 'E2' &&
      u.house === 'USSR' &&
      u.cx === 90 &&
      u.cy === 89 &&
      u.tlx !== undefined &&
      u.tly !== undefined);
    if (!shooter) throw new Error('C++ SCG23EA grenade shooter not found');

    const targetCell = {
      cx: Math.floor(shooter.tlx / 256),
      cy: Math.floor(shooter.tly / 256),
    };
    const occupiers = JSON.parse(module.ccall(
      'agent_get_cell_occupiers',
      'string',
      ['number', 'number'],
      [targetCell.cx, targetCell.cy],
    ));
    const c7 = occupiers.occ.find((entry: any) => entry.t === 'C7' && entry.house === 'Spain');
    return {
      tick: state.tick,
      targetCell,
      c7: c7
        ? {
            type: c7.t,
            house: c7.house,
            mission: c7.m,
            isDriving: c7.drv,
            hp: c7.hp,
          }
        : null,
    };
  });
}

async function tsIncomingTargetSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const shooter = game.entities.find((entity: any) => entity.logicIndexHint === 100);
    const c7 = game.entities.find((entity: any) => entity.logicIndexHint === 107);
    if (!shooter || !c7) throw new Error('TS SCG23EA shooter/C7 not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      shooter: {
        type: shooter.type,
        house: shooter.house,
        targetLogicIndex: shooter.target?.logicIndexHint ?? null,
        targetCell: shooter.target?.cell ? { ...shooter.target.cell } : null,
      },
      c7: {
        type: c7.type,
        house: c7.house,
        cell: { ...c7.cell },
        mission: c7.mission,
        isDriving: c7.isDriving,
        hp: c7.hp,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 incoming low-IQ scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not scatter a cell occupier whose house IQ is below Rule.IQScatter', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 105);
      const cppBefore = await wasmIncomingTargetCell(handle.wasm);
      const tsBefore = await tsIncomingTargetSnapshot(handle.ts);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.targetCell).toEqual({ cx: 92, cy: 88 });
      expect(cppBefore.c7).toMatchObject({
        type: 'C7',
        house: 'Spain',
        isDriving: true,
      });
      expect(tsBefore.shooter).toMatchObject({
        type: 'E2',
        house: 'USSR',
        targetLogicIndex: 107,
        targetCell: cppBefore.targetCell,
      });
      expect(tsBefore.c7).toMatchObject({
        type: 'C7',
        house: 'Spain',
        cell: cppBefore.targetCell,
        isDriving: true,
      });

      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });
      const result = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() => (window as any).__rngTagControl?.('read'));

      const cppIncomingSeeds = (result.wasm.state.rngLog ?? [])
        .filter(entry => entry[1] === 53002)
        .map(entry => entry[0] >>> 0);
      const tsIncomingSeeds = ((tsRng?.seedLog ?? []) as Array<[number, number, number]>)
        .filter(entry => entry[1] === 53002)
        .map(entry => entry[0] >>> 0);

      expect(result.wasm.state.tick).toBe(106);
      expect(result.ts.state.tick).toBe(106);
      expect(cppIncomingSeeds).toEqual([]);
      expect(tsIncomingSeeds).toEqual(cppIncomingSeeds);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
