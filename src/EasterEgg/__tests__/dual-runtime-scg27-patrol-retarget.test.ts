/**
 * Dual-runtime check for TMission_Patrol re-targeting through Coordinate_Move.
 *
 * SCG27EA team "grd1" patrols between waypoints. After its attack target dies,
 * C++ TMission_Patrol treats the waypoint as a movement destination and calls
 * Coordinate_Move. That reissues Assign_Destination when NavCom differs from
 * the patrol target, which stops active infantry drivers before Commence pops
 * the queued MOVE mission.
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

async function wasmPatrolMembers(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const rows = new Map<number, any>(
      (state.logicLayer ?? [])
        .filter((row: any[]) => row[0] === 114 || row[0] === 115 || row[0] === 116)
        .map((row: any[]) => [row[0], {
          logicIndex: row[0],
          mission: row[7],
          missionTimer: row[8],
          missionQueue: row[9],
          isDriving: row[10],
          lx: row[12],
          ly: row[13],
        }]),
    );
    if (!rows.has(114) || !rows.has(115) || !rows.has(116)) {
      throw new Error('C++ SCG27EA patrol infantry rows missing');
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      units: Object.fromEntries(rows),
    };
  });
}

async function tsPatrolMembers(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const rows = [114, 115, 116].map(logicIndex => {
      const entity = game.entities.find((e: any) => e.logicIndexHint === logicIndex);
      if (!entity) throw new Error(`TS SCG27EA patrol infantry ${logicIndex} missing`);
      return [logicIndex, {
        logicIndex,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        missionQueue: entity.missionQueue,
        isDriving: entity.isDriving,
        lx: entity.leptonX,
        ly: entity.leptonY,
        moveTarget: entity.moveTarget
          ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
          : null,
      }];
    });
    return {
      tick: state.tick,
      rngState: state.rngState,
      units: Object.fromEntries(rows),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27EA patrol retarget', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reassigns patrol destinations before infantry Commence pops MOVE', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 688);
      const [cppRetarget, tsRetarget] = await Promise.all([
        wasmPatrolMembers(handle.wasm),
        tsPatrolMembers(handle.ts),
      ]);

      expect(tsRetarget.tick).toBe(cppRetarget.tick);
      for (const logicIndex of [114, 115] as const) {
        const cpp = cppRetarget.units[logicIndex];
        const ts = tsRetarget.units[logicIndex];
        expect(ts).toMatchObject({
          mission: 'MOVE',
          missionQueue: null,
          missionTimer: cpp.missionTimer,
          isDriving: cpp.isDriving,
          lx: cpp.lx,
          ly: cpp.ly,
          moveTarget: { lx: 8584, ly: 12424 },
        });
        expect(cpp).toMatchObject({
          mission: 2,
          missionQueue: -1,
        });
      }

      const cpp116 = cppRetarget.units[116];
      const ts116 = tsRetarget.units[116];
      expect(ts116).toMatchObject({
        mission: 'MOVE',
        missionQueue: null,
        missionTimer: cpp116.missionTimer,
        isDriving: cpp116.isDriving,
        lx: cpp116.lx,
        ly: cpp116.ly,
        moveTarget: { lx: 8584, ly: 12424 },
      });
      expect(cpp116).toMatchObject({
        mission: 2,
        missionQueue: -1,
        isDriving: false,
      });

      await stepBothOneTickAtATime(handle, 1);
      const [cppNext, tsNext] = await Promise.all([
        wasmPatrolMembers(handle.wasm),
        tsPatrolMembers(handle.ts),
      ]);

      expect(tsNext.tick).toBe(cppNext.tick);
      expect(tsNext.rngState >>> 0).toBe(cppNext.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
