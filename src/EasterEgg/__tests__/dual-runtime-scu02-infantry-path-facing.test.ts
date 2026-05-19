/**
 * Dual-runtime check for InfantryClass Path[] facing consumption.
 *
 * SCU02EB reaches a synced state at tick 928 where a GoodGuy E1 has just
 * completed a sub-cell hop and C++ still has a WEST FacingType at Path[0].
 * TS also stores materialized absolute path cells for diagnostics; normalizing
 * that absolute cursor must not consume the C++ facing queue early.
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
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmE1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) => r[6] === 851977);
    const all = [
      ...(state.units ?? []),
      ...(state.infantry ?? []),
      ...(state.enemies ?? []),
      ...(state.neutrals ?? []),
    ];
    const foot = all.find((e: any) => e.id === 851977);
    if (!row || !foot) throw new Error('C++ SCU02EB E1 id 851977 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      e1: {
        mission: row[7],
        isDriving: row[10] === true,
        cx: row[3],
        cy: row[4],
        leptonX: row[12],
        leptonY: row[13],
        headToLX: foot.hlx ?? 0,
        headToLY: foot.hly ?? 0,
        primaryFacing: row[28],
        desiredFacing: row[29],
      },
    };
  });
}

async function tsE1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e1 = game.entities.find((e: any) => e.id === 45);
    if (!e1) throw new Error('TS SCU02EB E1 id 45 missing');
    return {
      tick: game.tick,
      rngState: state.rngState,
      e1: {
        mission: e1.mission,
        isDriving: e1.isDriving === true,
        cx: e1.cell.cx,
        cy: e1.cell.cy,
        leptonX: e1.leptonX,
        leptonY: e1.leptonY,
        headToLX: e1.headToLX,
        headToLY: e1.headToLY,
        primaryFacing: e1.bodyFacing256,
        desiredFacing: e1.desiredFacing256,
        drivePathFacings: e1.drivePathFacings.slice(0, 4),
        pathCells: e1.path.slice(e1.pathIndex, e1.pathIndex + 4)
          .map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      },
    };
  });
}

async function wasmAnonymousCellCanEnter(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const cell = JSON.parse(
      (window as any).Module.ccall(
        'agent_get_cell_info',
        'string',
        ['number', 'number', 'number'],
        [54, 77, 851977],
      ),
    );
    return {
      tick: state.tick,
      rngState: state.rngState,
      canEnter: cell.canEnter,
      flag: cell.flag,
      infType: cell.infType,
    };
  });
}

async function tsAnonymousCellCanEnter(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e1 = game.entities.find((e: any) => e.id === 45);
    if (!e1) throw new Error('TS SCU02EB E1 id 45 missing');
    const cellIdx = 77 * 128 + 54;
    return {
      tick: game.tick,
      rngState: state.rngState,
      canEnter: game.infantryCanEnterCell(e1, 54, 77),
      slots: game.map.subCellOccupancy.get(cellIdx) ?? null,
      anonymousHouse: game.map.getAnonymousSubCellHouse(cellIdx, 1),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EB infantry path facings', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not consume Path[0] while normalizing a stale absolute current-cell entry', async () => {
    await withDualScenario('SCU02EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBothInCppSizedChunks(handle, 717);

      const cppCanEnter = await wasmAnonymousCellCanEnter(handle.wasm);
      const tsCanEnter = await tsAnonymousCellCanEnter(handle.ts);
      expect(tsCanEnter.tick).toBe(cppCanEnter.tick);
      expect(tsCanEnter.rngState >>> 0).toBe(cppCanEnter.rngState >>> 0);
      expect(cppCanEnter.flag & 0x02).toBe(0x02);
      expect(tsCanEnter.slots?.[1]).toBe(-1);
      expect(tsCanEnter.canEnter).toBe(cppCanEnter.canEnter);
      expect(cppCanEnter.canEnter).toBe(3);

      await stepBothInCppSizedChunks(handle, 211);

      const cppBefore = await wasmE1State(handle.wasm);
      const tsBefore = await tsE1State(handle.ts);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(tsBefore.e1.leptonX).toBe(cppBefore.e1.leptonX);
      expect(tsBefore.e1.leptonY).toBe(cppBefore.e1.leptonY);
      expect(tsBefore.e1.isDriving).toBe(false);
      expect(cppBefore.e1.isDriving).toBe(false);

      await stepBoth(handle, 1);

      const cpp = await wasmE1State(handle.wasm);
      const ts = await tsE1State(handle.ts);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.e1.isDriving).toBe(true);
      expect(ts.e1.isDriving).toBe(true);
      expect(cpp.e1.headToLX).toBe(14272);
      expect(cpp.e1.headToLY).toBe(19264);
      expect(ts.e1.headToLX).toBe(cpp.e1.headToLX);
      expect(ts.e1.headToLY).toBe(cpp.e1.headToLY);
      expect(ts.e1.primaryFacing).toBe(cpp.e1.primaryFacing);
      expect(ts.e1.desiredFacing).toBe(cpp.e1.desiredFacing);
      expect(ts.e1.leptonX).toBe(cpp.e1.leptonX);
      expect(ts.e1.leptonY).toBe(cpp.e1.leptonY);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
