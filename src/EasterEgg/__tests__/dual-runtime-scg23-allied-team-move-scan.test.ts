/**
 * Dual-runtime check for FootClass::Mission_Move's opportunistic target scan.
 *
 * In SCG23EA the England `flar` E1 is a player-allied but computer-controlled
 * team member. C++ still lets FootClass::Mission_Move call
 * Target_Something_Nearby(THREAT_RANGE) for that house because HouseClass::
 * IsPlayerControl/IsHuman are false. Treating all player allies as human in TS
 * skips this TarCom assignment, so the E1 misses its tick-325 rifle shot.
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

async function wasmFlarMoveScanSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicLayer = (state.logicLayer ?? []) as any[][];
    const englandE1 = logicLayer.find((row) => row[0] === 92);
    const targetE1 = logicLayer.find((row) => row[0] === 94);
    if (!englandE1 || !targetE1) throw new Error('C++ SCG23EA E1 pair missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      englandE1: {
        type: englandE1[1],
        house: englandE1[2],
        mission: englandE1[7],
        missionTimer: englandE1[8],
        isDriving: englandE1[10],
        targetKind: englandE1[30],
        targetObjectIndex: englandE1[33],
        targetRtti: englandE1[32],
        inRange0: englandE1[36],
      },
      targetE1: {
        type: targetE1[1],
        house: targetE1[2],
        cx: targetE1[3],
        cy: targetE1[4],
      },
    };
  });
}

async function tsFlarMoveScanSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const englandE1 = game.entities.find((entity: any) => entity.logicIndexHint === 92);
    const targetE1 = game.entities.find((entity: any) => entity.logicIndexHint === 94);
    if (!englandE1 || !targetE1) throw new Error('TS SCG23EA E1 pair missing');
    return {
      tick: game.tick,
      rngState: state.rngState,
      englandE1: {
        type: englandE1.type,
        house: englandE1.house,
        mission: englandE1.mission,
        missionTimer: englandE1.missionTimer,
        isDriving: englandE1.isDriving,
        targetLogicIndex: englandE1.target?.logicIndexHint ?? null,
        targetType: englandE1.target?.type ?? null,
        targetHouse: englandE1.target?.house ?? null,
        targetCell: englandE1.target?.cell ? { ...englandE1.target.cell } : null,
      },
      targetE1: {
        type: targetE1.type,
        house: targetE1.house,
        cx: targetE1.cell.cx,
        cy: targetE1.cell.cy,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 allied team Mission_Move scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('lets a player-allied computer team member acquire TarCom during Mission_Move and fire on schedule', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 300);
      const cpp300 = await wasmFlarMoveScanSnapshot(handle.wasm);
      const ts300 = await tsFlarMoveScanSnapshot(handle.ts);

      expect(ts300.tick).toBe(cpp300.tick);
      expect(cpp300.englandE1).toMatchObject({
        type: 'E1',
        house: 'England',
        mission: 2,
        targetRtti: 13,
        targetObjectIndex: 2,
        inRange0: 1,
      });
      expect(ts300.englandE1).toMatchObject({
        type: 'E1',
        house: 'England',
        mission: 'MOVE',
        targetLogicIndex: 94,
        targetType: 'E1',
        targetHouse: 'USSR',
      });
      expect(ts300.englandE1.targetCell).toEqual({
        cx: cpp300.targetE1.cx,
        cy: cpp300.targetE1.cy,
      });

      await stepBoth(handle, 25);
      const cpp325 = await wasmFlarMoveScanSnapshot(handle.wasm);
      const ts325 = await tsFlarMoveScanSnapshot(handle.ts);

      expect(ts325.tick).toBe(cpp325.tick);
      expect(ts325.rngState >>> 0).toBe(cpp325.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
