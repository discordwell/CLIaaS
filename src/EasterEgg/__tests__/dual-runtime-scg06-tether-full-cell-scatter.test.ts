/**
 * Dual-runtime check for InfantryClass::Per_Cell_Process tether full-cell scatter.
 *
 * SCG06EB tick 1214 has a USSR E1 finish a transport/factory radio tether hop
 * into an infantry cell whose five sub-cell bits are full. C++ runs
 * CellClass::Incoming(0,true,true) from the tether branch before Stop_Driver,
 * making one already-present cell occupier scatter and consume the 53003
 * InfantryClass::Scatter no-threat RNG sequence. TS must do the same generally;
 * hardcoding SCG06EB's post-tick seed would miss the actual C++ call site.
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

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmTetherArrivalState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === 852004);
    if (!unit) throw new Error('C++ SCG06EB tether-arrival infantry missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        id: unit.id,
        type: unit.t,
        house: unit.house,
        cell: { cx: unit.cx, cy: unit.cy },
        mission: unit.m,
        missionTimer: unit.mt,
        missionQueue: unit.mq,
        isDriving: unit.drv,
        doing: unit.doing,
        lx: unit.lx,
        ly: unit.ly,
        navLX: unit.nlx,
        navLY: unit.nly,
        headLX: unit.hlx,
        headLY: unit.hly,
      },
    };
  });
}

async function tsTetherArrivalState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entity = game.entities.find((candidate: any) => candidate.logicIndexHint === 144);
    if (!entity) throw new Error('TS SCG06EB logic infantry 144 missing');
    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        id: entity.id,
        logicIndexHint: entity.logicIndexHint,
        type: entity.type,
        house: entity.house,
        cell: { ...entity.cell },
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        missionQueue: entity.missionQueue,
        isDriving: entity.isDriving,
        isTethered: entity.isTethered,
        lx: entity.leptonX,
        ly: entity.leptonY,
        moveTarget: entity.moveTarget ? { ...entity.moveTarget } : null,
        headToLX: entity.headToLX,
        headToLY: entity.headToLY,
        subCellCount: game.map.getSubCellCount(74, 85),
        onlyInfantryOccupied: game.map.isOnlyInfantryOccupied(74, 85),
      },
    };
  });
}

async function wasmPostScatterUnits(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((entry: any) => entry.id >= 852000 && entry.id <= 852004)
      .map((entry: any) => ({
        id: entry.id,
        mission: entry.m,
        missionTimer: entry.mt,
        missionQueue: entry.mq,
        isDriving: entry.drv,
        navLX: entry.nlx ?? null,
        navLY: entry.nly ?? null,
      }))
      .sort((a: any, b: any) => a.id - b.id);
  });
}

async function tsPostScatterUnits(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return game.entities
      .filter((entry: any) => entry.logicIndexHint >= 140 && entry.logicIndexHint <= 144)
      .map((entry: any) => ({
        logicIndexHint: entry.logicIndexHint,
        mission: entry.mission,
        missionTimer: entry.missionTimer,
        missionQueue: entry.missionQueue,
        isDriving: entry.isDriving,
        navLX: entry.moveTarget?.lx ?? null,
        navLY: entry.moveTarget?.ly ?? null,
      }))
      .sort((a: any, b: any) => a.logicIndexHint - b.logicIndexHint);
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG06 tether full-cell scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('runs Incoming(0,true,true) when a tethered infantry arrival fills all five sub-cells', async () => {
    await withDualScenario('SCG06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 1213);
      const cppBefore = await wasmTetherArrivalState(handle.wasm);
      const tsBefore = await tsTetherArrivalState(handle.ts);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.tick).toBe(1213);
      expect(cppBefore.unit).toMatchObject({
        id: 852004,
        type: 'E1',
        house: 'USSR',
        cell: { cx: 74, cy: 85 },
        mission: 2,
        missionTimer: 9,
        missionQueue: -1,
        isDriving: true,
        lx: 19132,
        ly: 21948,
        navLX: 19080,
        navLY: 21896,
        headLX: 19136,
        headLY: 21952,
      });
      expect(tsBefore.unit).toMatchObject({
        logicIndexHint: 144,
        type: 'E1',
        house: 'USSR',
        cell: { cx: 74, cy: 85 },
        mission: 'MOVE',
        missionTimer: 9,
        missionQueue: null,
        isDriving: true,
        isTethered: true,
        moveTarget: { lx: 19080, ly: 21896 },
        headToLX: 19136,
        headToLY: 21952,
        subCellCount: 5,
        onlyInfantryOccupied: true,
      });

      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });
      const result = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() => (window as any).__rngTagControl?.('read'));
      const cppPostScatter = await wasmPostScatterUnits(handle.wasm);
      const tsPostScatter = await tsPostScatterUnits(handle.ts);

      const cppNoThreatScatterSeeds = (result.wasm.state.rngLog ?? [])
        .filter(entry => entry[1] === 53003)
        .map(entry => entry[0] >>> 0);
      const tsNoThreatScatterSeeds = ((tsRng?.seedLog ?? []) as Array<[number, number, number]>)
        .filter(entry => entry[1] === 53003)
        .map(entry => entry[0] >>> 0);

      expect(result.wasm.state.tick).toBe(1214);
      expect(result.ts.state.tick).toBe(1214);
      expect(cppNoThreatScatterSeeds).toEqual([
        650446294,
        1664016471,
        496645956,
        2585292845,
        1046718818,
      ]);
      expect(tsNoThreatScatterSeeds).toEqual(cppNoThreatScatterSeeds);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      expect(cppPostScatter).toEqual([
        { id: 852000, mission: 5, missionTimer: 10, missionQueue: 2, isDriving: false, navLX: 19336, navLY: 21640 },
        { id: 852001, mission: 5, missionTimer: 12, missionQueue: 2, isDriving: false, navLX: 19336, navLY: 21640 },
        { id: 852002, mission: 5, missionTimer: 11, missionQueue: 2, isDriving: false, navLX: 19336, navLY: 21640 },
        { id: 852003, mission: 5, missionTimer: 5, missionQueue: 2, isDriving: false, navLX: 19080, navLY: 22152 },
        { id: 852004, mission: 2, missionTimer: 8, missionQueue: 5, isDriving: false, navLX: null, navLY: null },
      ]);
      expect(tsPostScatter).toEqual([
        { logicIndexHint: 140, mission: 'GUARD', missionTimer: 10, missionQueue: 'MOVE', isDriving: false, navLX: 19336, navLY: 21640 },
        { logicIndexHint: 141, mission: 'GUARD', missionTimer: 12, missionQueue: 'MOVE', isDriving: false, navLX: 19336, navLY: 21640 },
        { logicIndexHint: 142, mission: 'GUARD', missionTimer: 11, missionQueue: 'MOVE', isDriving: false, navLX: 19336, navLY: 21640 },
        { logicIndexHint: 143, mission: 'GUARD', missionTimer: 5, missionQueue: 'MOVE', isDriving: false, navLX: 19080, navLY: 22152 },
        { logicIndexHint: 144, mission: 'MOVE', missionTimer: 8, missionQueue: 'GUARD', isDriving: false, navLX: null, navLY: null },
      ]);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
