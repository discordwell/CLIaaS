/**
 * Dual-runtime check for DriveClass::Mark_Track head-cell reservations.
 *
 * SCU13EB's Greek hunt1 column exposes a real C++ movement rule: an active
 * track keeps its Head_To_Coord vehicle bit reserved until Stop_Driver releases
 * it. The following 2TNK at logic[33] must see logic[34]'s reserved `(78,59)`
 * cell as MOVE_MOVING_BLOCK and keep its existing Path[0] instead of clearing
 * the path or regenerating a new one.
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

async function wasmFollowerSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 33);
    if (!row) throw new Error('C++ SCU13EB logic[33] follower missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCU13EB logic[33] unit detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        type: row[1],
        cell: { cx: row[3], cy: row[4] },
        lx: row[12],
        ly: row[13],
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10],
        trackNumber: unit.tn,
        path: [unit.p0, unit.p1, unit.p2, unit.p3, unit.p4, unit.p5],
      },
    };
  });
}

async function tsFollowerSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const unit = game.entities.find((entity: any) => entity.logicIndexHint === 33);
    if (!unit) throw new Error('TS SCU13EB logic[33] follower missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        type: unit.type,
        cell: { cx: unit.cell.cx, cy: unit.cell.cy },
        lx: unit.leptonX,
        ly: unit.leptonY,
        mission: unit.mission,
        missionTimer: unit.missionTimer,
        isDriving: unit.isDriving,
        trackNumber: unit.trackNumber,
        path: unit.drivePathFacings.slice(0, 6),
        nextCells: unit.path
          .slice(unit.pathIndex, unit.pathIndex + 2)
          .map((cell: any) => ({ cx: cell.cx, cy: cell.cy })),
      },
    };
  });
}

async function wasmBlockedTankScatterSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 32);
    if (!row) throw new Error('C++ SCU13EB logic[32] blocker missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCU13EB logic[32] unit detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        cell: { cx: row[3], cy: row[4] },
        mission: row[7],
        missionTimer: row[8],
        nav: unit.nlx === undefined ? null : { lx: unit.nlx, ly: unit.nly },
        path: [unit.p0, unit.p1],
      },
    };
  });
}

async function tsBlockedTankScatterSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const unit = game.entities.find((entity: any) => entity.logicIndexHint === 32);
    if (!unit) throw new Error('TS SCU13EB logic[32] blocker missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        cell: { cx: unit.cell.cx, cy: unit.cell.cy },
        mission: unit.mission,
        missionTimer: unit.missionTimer,
        nav: unit.moveTarget ? { lx: unit.moveTarget.lx, ly: unit.moveTarget.ly } : null,
        path: unit.drivePathFacings.slice(0, 2),
      },
    };
  });
}

async function wasmGuardDriveRetrySnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 31);
    if (!row) throw new Error('C++ SCU13EB logic[31] MGG missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCU13EB logic[31] unit detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        cell: { cx: row[3], cy: row[4] },
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10],
        nav: unit.nlx === undefined ? null : { lx: unit.nlx, ly: unit.nly },
        pathThreshold: unit.pth,
        tryCount: unit.try,
        path: [unit.p0, unit.p1],
      },
    };
  });
}

async function tsGuardDriveRetrySnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const unit = game.entities.find((entity: any) => entity.logicIndexHint === 31);
    if (!unit) throw new Error('TS SCU13EB logic[31] MGG missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        cell: { cx: unit.cell.cx, cy: unit.cell.cy },
        mission: unit.mission,
        missionTimer: unit.missionTimer,
        isDriving: unit.isDriving,
        nav: unit.moveTarget ? { lx: unit.moveTarget.lx, ly: unit.moveTarget.ly } : null,
        pathThreshold: unit.pathThreshold,
        tryCount: unit.tryCount,
        path: unit.drivePathFacings.slice(0, 2),
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13EB drive track reservations', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the following tank stopped while the head cell is reserved', async () => {
    await withDualScenario('SCU13EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 60);
      const cpp = await wasmFollowerSnapshot(handle.wasm);
      const ts = await tsFollowerSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.unit).toMatchObject({
        type: cpp.unit.type,
        cell: cpp.unit.cell,
        lx: cpp.unit.lx,
        ly: cpp.unit.ly,
        mission: 'MOVE',
        missionTimer: cpp.unit.missionTimer,
        isDriving: false,
        trackNumber: -1,
        path: cpp.unit.path,
        nextCells: [
          { cx: 78, cy: 59 },
          { cx: 77, cy: 58 },
        ],
      });

      expect(cpp.unit).toMatchObject({
        mission: 2,
        isDriving: false,
        trackNumber: -1,
        path: [0, 7, 1, 0, 1, 0],
      });
    });
  }, 60_000);

  it('uses the C++ frame when a moving blocker scatters a stationary tank', async () => {
    await withDualScenario('SCU13EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 119);
      const cpp = await wasmBlockedTankScatterSnapshot(handle.wasm);
      const ts = await tsBlockedTankScatterSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.unit).toEqual({
        cell: cpp.unit.cell,
        mission: 'GUARD',
        missionTimer: cpp.unit.missionTimer,
        nav: cpp.unit.nav,
        path: [],
      });
      expect(cpp.unit).toMatchObject({
        mission: 5,
        nav: { lx: 20104, ly: 14216 },
        path: [-1, -1],
      });
    });
  }, 60_000);

  it('preserves NavCom while Basic_Path retry budget remains', async () => {
    await withDualScenario('SCU13EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 120);
      const cpp = await wasmGuardDriveRetrySnapshot(handle.wasm);
      const ts = await tsGuardDriveRetrySnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.unit).toEqual({
        cell: cpp.unit.cell,
        mission: 'GUARD',
        missionTimer: cpp.unit.missionTimer,
        isDriving: false,
        nav: cpp.unit.nav,
        pathThreshold: cpp.unit.pathThreshold,
        tryCount: cpp.unit.tryCount,
        path: [],
      });
      expect(cpp.unit).toMatchObject({
        mission: 5,
        nav: { lx: 20360, ly: 14216 },
        pathThreshold: 5,
        tryCount: 9,
        path: [-1, -1],
      });
    });
  }, 60_000);
});
