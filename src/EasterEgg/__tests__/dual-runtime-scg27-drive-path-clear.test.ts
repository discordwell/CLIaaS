/**
 * Dual-runtime check for DriveClass Assign_Destination path invalidation.
 *
 * In SCG27EA, Greek 2TNK unit[201] has an active two-cell E track whose C++
 * Path[0] is cleared to FACING_NONE while the vehicle keeps following its
 * current Head_To_Coord. If TS clears only the absolute path and leaves its
 * mirrored drivePathFacings buffer alive, While_Moving fabricates a NE track
 * jump on tick 901. That prematurely runs PCP_END/Commence, pops the queued
 * GUARD mission, and adds a GUARD scan RNG call on tick 902.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmTank201(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 201);
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])].find((unit: any) => unit.id === row?.[6]);
    if (!row || !tank) throw new Error('C++ SCG27EA tank logic[201] missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        type: tank.t,
        mission: tank.m,
        missionQueue: tank.mq,
        missionTimer: tank.mt,
        isDriving: tank.drv,
        lx: tank.lx,
        ly: tank.ly,
        headLX: tank.hlx,
        headLY: tank.hly,
        path0: tank.p0,
        trackNumber: tank.tn,
        trackIndex: tank.ti,
      },
    };
  });
}

async function tsTank201(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) => entity.logicIndexHint === 201);
    if (!tank) throw new Error('TS SCG27EA tank logic[201] missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        type: tank.type,
        mission: tank.mission,
        missionQueue: tank.missionQueue,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving,
        lx: tank.leptonX,
        ly: tank.leptonY,
        headLX: tank.headToLX,
        headLY: tank.headToLY,
        drivePathFacings: tank.drivePathFacings.slice(0, 3),
        trackNumber: tank.trackNumber,
        trackControlIndex: tank.trackControlIndex,
        trackIndex: tank.trackIndex,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27EA DriveClass path clear', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears the mirrored Path[] facing before While_Moving track-jump checks', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 900);
      const [cppPathCleared, tsPathCleared] = await Promise.all([
        wasmTank201(handle.wasm),
        tsTank201(handle.ts),
      ]);

      expect(tsPathCleared.tick).toBe(cppPathCleared.tick);
      expect(cppPathCleared.tank).toMatchObject({
        mission: 2,
        missionQueue: -1,
        isDriving: true,
        headLX: 8320,
        headLY: 11392,
        path0: -1,
      });
      expect(tsPathCleared.tank).toMatchObject({
        mission: 'MOVE',
        missionQueue: null,
        isDriving: true,
        headLX: cppPathCleared.tank.headLX,
        headLY: cppPathCleared.tank.headLY,
        drivePathFacings: [],
      });

      await stepBothOneTickAtATime(handle, 1);
      const [cppNoJump, tsNoJump] = await Promise.all([
        wasmTank201(handle.wasm),
        tsTank201(handle.ts),
      ]);

      expect(tsNoJump.tick).toBe(cppNoJump.tick);
      expect(tsNoJump.rngState >>> 0).toBe(cppNoJump.rngState >>> 0);
      expect(tsNoJump.tank).toMatchObject({
        mission: 'MOVE',
        missionQueue: 'GUARD',
        missionTimer: cppNoJump.tank.missionTimer,
        isDriving: cppNoJump.tank.isDriving,
        lx: cppNoJump.tank.lx,
        ly: cppNoJump.tank.ly,
        headLX: cppNoJump.tank.headLX,
        headLY: cppNoJump.tank.headLY,
      });
      expect(cppNoJump.tank).toMatchObject({
        mission: 2,
        missionQueue: 5,
        headLX: 8320,
        headLY: 11392,
      });

      await stepBothOneTickAtATime(handle, 1);
      const [cppNext, tsNext] = await Promise.all([
        wasmTank201(handle.wasm),
        tsTank201(handle.ts),
      ]);

      expect(tsNext.tick).toBe(cppNext.tick);
      expect(tsNext.rngState >>> 0).toBe(cppNext.rngState >>> 0);
      expect(tsNext.tank.mission).toBe('MOVE');
      expect(tsNext.tank.missionQueue).toBe('GUARD');
    }, { wasmSeed: 0 });
  }, 300_000);
});
