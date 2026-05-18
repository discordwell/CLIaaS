/**
 * Dual-runtime check for InfantryClass::Can_Enter_Cell with dying enemies.
 *
 * SCG20EA exposes a non-instant BadGuy E1 death animation at `(23,57)`. C++
 * keeps that infantry in the Cell_Occupier chain until the death animation
 * deletes it. A Greek E1 that is already within CloseEnough of its NavCom must
 * see the dead enemy as MOVE_DESTROYABLE, clear NavCom, and idle instead of
 * starting a new hop into a free sub-cell in the occupied enemy cell.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
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

async function wasmGreekMoverSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[6] === 852020);
    if (!row) throw new Error('C++ SCG20EA Greek E1 852020 missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === 852020);
    if (!unit) throw new Error('C++ SCG20EA Greek E1 detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10],
      lx: row[12],
      ly: row[13],
      nav: unit.nlx !== undefined && unit.nly !== undefined
        ? { lx: unit.nlx, ly: unit.nly }
        : null,
      path: [unit.p0, unit.p1],
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    path: [number, number];
  }>;
}

async function wasmDeadEnemyCellSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const cell = JSON.parse((window as any).Module.ccall(
      'agent_get_cell_info',
      'string',
      ['number', 'number', 'number'],
      [23, 57, -1],
    ));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[6] === 852022);
    if (!row) throw new Error('C++ SCG20EA dead BadGuy E1 852022 missing');
    return {
      cell,
      enemy: {
        mission: row[7],
        hp: row[5],
        lx: row[12],
        ly: row[13],
      },
    };
  }) as Promise<{
    cell: { flag: number; infType?: number };
    enemy: { mission: number; hp: number; lx: number; ly: number };
  }>;
}

async function tsGreekMoverAtStop(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'E1' &&
      e.house === 'Greece' &&
      e.leptonX === 5760 &&
      e.leptonY === 14720);
    if (!entity) throw new Error('TS SCG20EA stopped Greek E1 missing');
    return {
      id: entity.id,
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      lx: entity.leptonX,
      ly: entity.leptonY,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      path: entity.drivePathFacings.slice(0, 2),
    };
  }) as Promise<{
    id: number;
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

async function tsGreekMoverById(adapter: unknown, id: number) {
  return adapterPage(adapter).evaluate((entityId) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.id === entityId);
    if (!entity) throw new Error(`TS SCG20EA Greek E1 ${entityId} missing`);
    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      lx: entity.leptonX,
      ly: entity.leptonY,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      headTo: entity.headToLX || entity.headToLY
        ? { lx: entity.headToLX, ly: entity.headToLY }
        : null,
      path: entity.drivePathFacings.slice(0, 2),
    };
  }, id) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

async function tsDeadEnemyCellSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const cellIdx = 57 * 128 + 23;
    const slots = game.map.subCellOccupancy.get(cellIdx) ?? [0, 0, 0, 0, 0];
    const enemy = game.entities.find((e: any) =>
      e.alive === false &&
      e.type === 'E1' &&
      e.house === 'BadGuy' &&
      e.cell.cx === 23 &&
      e.cell.cy === 57);
    if (!enemy) throw new Error('TS SCG20EA dead BadGuy E1 missing');
    return {
      slots: [...slots],
      occupancy: game.map.getOccupancy(23, 57),
      enemy: {
        id: enemy.id,
        mission: enemy.mission,
        deathVariant: enemy.deathVariant,
        deathTick: enemy.deathTick,
        occupiesCppLogic: enemy.occupiesCppLogic(),
      },
    };
  }) as Promise<{
    slots: number[];
    occupancy: number;
    enemy: {
      id: number;
      mission: string;
      deathVariant: number;
      deathTick: number;
      occupiesCppLogic: boolean;
    };
  }>;
}

async function wasmGreekSpySnapshots(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const rows = new Map((state.logicLayer ?? []).map((entry: any[]) => [entry[6], entry]));
    return [852023, 852022].map((id) => {
      const row = rows.get(id) as any[] | undefined;
      const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
        .find((entry: any) => entry.id === id);
      if (!row || !unit) throw new Error(`C++ SCG20EA Greek spy ${id} missing`);
      return {
        id,
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10],
        lx: row[12],
        ly: row[13],
        nav: unit.nlx !== undefined && unit.nly !== undefined
          ? { lx: unit.nlx, ly: unit.nly }
          : null,
        headTo: unit.hlx !== undefined && unit.hly !== undefined
          ? { lx: unit.hlx, ly: unit.hly }
          : null,
        path: [unit.p0, unit.p1],
      };
    }).sort((a, b) => a.ly - b.ly);
  }) as Promise<Array<{
    id: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: [number, number];
  }>>;
}

async function tsGreekSpySnapshots(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return game.entities
      .filter((entity: any) =>
        entity.type === 'SPY' &&
        entity.house === 'Greece' &&
        entity.cell.cx === 21 &&
        entity.cell.cy === 61)
      .map((entity: any) => ({
        id: entity.id,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        isDriving: entity.isDriving,
        lx: entity.leptonX,
        ly: entity.leptonY,
        nav: entity.moveTarget
          ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
          : null,
        headTo: entity.headToLX || entity.headToLY
          ? { lx: entity.headToLX, ly: entity.headToLY }
          : null,
        path: entity.drivePathFacings.slice(0, 2),
      }))
      .sort((a: { ly: number }, b: { ly: number }) => a.ly - b.ly);
  }) as Promise<Array<{
    id: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: number[];
  }>>;
}

async function wasmUkraineC3Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) =>
      entry[1] === 'C3' && entry[2] === 'Ukraine');
    if (!row) throw new Error('C++ SCG20EA Ukraine C3 missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCG20EA Ukraine C3 detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      logicIndex: row[0],
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10],
      lx: row[12],
      ly: row[13],
      nav: unit.nlx !== undefined && unit.nly !== undefined
        ? { lx: unit.nlx, ly: unit.nly }
        : null,
      headTo: unit.hlx !== undefined && unit.hly !== undefined
        ? { lx: unit.hlx, ly: unit.hly }
        : null,
      primaryFacing: unit.pf,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    logicIndex: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    primaryFacing: number;
  }>;
}

async function tsUkraineC3Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) =>
      e.type === 'C3' && e.house === 'Ukraine');
    if (!entity) throw new Error('TS SCG20EA Ukraine C3 missing');

    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      logicIndexHint: entity.logicIndexHint,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      lx: entity.leptonX,
      ly: entity.leptonY,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      headTo: entity.headToLX || entity.headToLY
        ? { lx: entity.headToLX, ly: entity.headToLY }
        : null,
      bodyFacing256: entity.bodyFacing256,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    logicIndexHint: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    bodyFacing256: number;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG20 dying enemy infantry blocks movement', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('treats a dying non-allied infantry occupier as a blocker for Start_Driver', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 210);
      const cppBefore = await wasmGreekMoverSnapshot(handle.wasm);
      const tsBefore = await tsGreekMoverAtStop(handle.ts);
      const cppCell = await wasmDeadEnemyCellSnapshot(handle.wasm);
      const tsCell = await tsDeadEnemyCellSnapshot(handle.ts);

      expect(cppBefore.tick).toBe(210);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.mission).toBe(2);
      expect(tsBefore.mission).toBe('MOVE');
      expect(cppBefore.isDriving).toBe(false);
      expect(tsBefore.isDriving).toBe(false);
      expect(tsBefore.nav).toEqual(cppBefore.nav);
      expect(cppBefore.nav).toEqual({ lx: 6024, ly: 14728 });

      expect((cppCell.cell.flag & 16) !== 0).toBe(true);
      expect(cppCell.cell.infType).toBe(9);
      expect(tsCell.enemy.occupiesCppLogic).toBe(true);
      expect(tsCell.slots).toContain(tsCell.enemy.id);
      expect(tsCell.occupancy).toBe(tsCell.enemy.id);

      await stepBoth(handle, 1);
      const cppBlocked = await wasmGreekMoverSnapshot(handle.wasm);
      const tsBlocked = await tsGreekMoverById(handle.ts, tsBefore.id);

      expect(cppBlocked.tick).toBe(211);
      expect(tsBlocked.tick).toBe(cppBlocked.tick);
      expect(cppBlocked.nav).toBeNull();
      expect(tsBlocked.nav).toBeNull();
      expect(cppBlocked.isDriving).toBe(false);
      expect(tsBlocked.isDriving).toBe(false);
      expect(tsBlocked.lx).toBe(cppBlocked.lx);
      expect(tsBlocked.ly).toBe(cppBlocked.ly);

      await stepBoth(handle, 1);
      const cppIdle = await wasmGreekMoverSnapshot(handle.wasm);
      const tsIdle = await tsGreekMoverById(handle.ts, tsBefore.id);

      expect(cppIdle.tick).toBe(212);
      expect(tsIdle.tick).toBe(cppIdle.tick);
      expect(cppIdle.mission).toBe(5);
      expect(tsIdle.mission).toBe('GUARD');
      expect(tsIdle.nav).toBeNull();
      expect(tsIdle.lx).toBe(cppIdle.lx);
      expect(tsIdle.ly).toBe(cppIdle.ly);

      await stepBoth(handle, 1);
      const cppGuard = await wasmGreekMoverSnapshot(handle.wasm);
      const tsGuard = await tsGreekMoverById(handle.ts, tsBefore.id);

      expect(cppGuard.tick).toBe(213);
      expect(tsGuard.tick).toBe(cppGuard.tick);
      expect(tsGuard.rngState >>> 0).toBe(cppGuard.rngState >>> 0);
      expect(tsGuard.mission).toBe('GUARD');
      expect(tsGuard.missionTimer).toBe(cppGuard.missionTimer);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('runs CellClass::Incoming no-threat scatter for infantry blockers', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 309);
      const cppBefore = await wasmGreekMoverSnapshot(handle.wasm);
      const tsBefore = await tsGreekMoverById(handle.ts, 168);
      const cppSpiesBefore = await wasmGreekSpySnapshots(handle.wasm);
      const tsSpiesBefore = await tsGreekSpySnapshots(handle.ts);

      expect(cppBefore.tick).toBe(309);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(cppSpiesBefore).toHaveLength(2);
      expect(tsSpiesBefore).toHaveLength(2);
      for (let i = 0; i < cppSpiesBefore.length; i++) {
        expect(tsSpiesBefore[i]).toMatchObject({
          mission: 'GUARD',
          isDriving: false,
          lx: cppSpiesBefore[i].lx,
          ly: cppSpiesBefore[i].ly,
          nav: null,
          headTo: null,
        });
      }

      await stepBoth(handle, 1);
      const cppBlocked = await wasmGreekMoverSnapshot(handle.wasm);
      const tsBlocked = await tsGreekMoverById(handle.ts, 168);
      const cppSpiesAfter = await wasmGreekSpySnapshots(handle.wasm);
      const tsSpiesAfter = await tsGreekSpySnapshots(handle.ts);

      expect(cppBlocked.tick).toBe(310);
      expect(tsBlocked.tick).toBe(cppBlocked.tick);
      expect(tsBlocked.rngState >>> 0).toBe(cppBlocked.rngState >>> 0);
      expect(cppBlocked.isDriving).toBe(false);
      expect(tsBlocked.isDriving).toBe(false);

      for (let i = 0; i < cppSpiesAfter.length; i++) {
        expect(cppSpiesAfter[i].mission).toBe(2);
        expect(tsSpiesAfter[i]).toMatchObject({
          mission: 'MOVE',
          isDriving: true,
          lx: cppSpiesAfter[i].lx,
          ly: cppSpiesAfter[i].ly,
          nav: cppSpiesAfter[i].nav,
          headTo: cppSpiesAfter[i].headTo,
          path: [cppSpiesAfter[i].path[0]],
        });
      }
    }, { wasmSeed: 0 });
  }, 300_000);

  it('lets civilian scatter enter V03 overlap cells that are not in the C++ Occupy_List', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 437);
      const cppC3 = await wasmUkraineC3Snapshot(handle.wasm);
      const tsC3 = await tsUkraineC3Snapshot(handle.ts);

      expect(cppC3.tick).toBe(437);
      expect(tsC3.tick).toBe(cppC3.tick);
      expect(cppC3.logicIndex).toBe(104);
      expect(tsC3.logicIndexHint).toBe(cppC3.logicIndex);
      expect(cppC3.mission).toBe(2);
      expect(tsC3.mission).toBe('MOVE');
      expect(cppC3.isDriving).toBe(true);
      expect(tsC3.isDriving).toBe(true);

      expect(tsC3.rngState >>> 0).toBe(cppC3.rngState >>> 0);
      expect(tsC3.nav).toEqual(cppC3.nav);
      expect(tsC3.headTo).toEqual(cppC3.headTo);
      expect(tsC3.lx).toBe(cppC3.lx);
      expect(tsC3.ly).toBe(cppC3.ly);
      expect(tsC3.bodyFacing256).toBe(cppC3.primaryFacing);
      expect(cppC3.ly).toBeGreaterThan(10688);
    }, { wasmSeed: 0 });
  }, 300_000);
});
