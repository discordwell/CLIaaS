/**
 * Dual-runtime check for C++ InfantryClass::Stop_Driver animation semantics.
 *
 * SCU02EA tick 1929 exercises a team Coordinate_Move retarget while a Greek E1
 * is still in DO_GESTURE2. C++ Stop_Driver calls Do_Action(DO_STAND_READY), but
 * Do_Action refuses to interrupt non-interruptible gesture frames. The queued
 * GUARD mission must therefore remain queued until the gesture finishes.
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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
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
    const chunk = Math.min(remaining, 15);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmInfantrySnapshot(adapter: unknown, aid: number) {
  return adapterPage(adapter).evaluate((targetAid) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer.find((r: any[]) => r[6] === targetAid);
    if (!logic) throw new Error(`C++ SCU02EA infantry aid ${targetAid} missing from Logic`);
    const unit = [...state.units, ...state.enemies].find((u: any) => u.id === targetAid);
    if (!unit) throw new Error(`C++ SCU02EA infantry aid ${targetAid} missing from unit state`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        logicIndex: logic[0],
        mission: logic[7],
        missionTimer: logic[8],
        missionQueue: logic[9],
        isDriving: logic[10],
        doing: logic[11],
        leptonX: logic[12],
        leptonY: logic[13],
        navLeptonX: unit.nlx ?? null,
        navLeptonY: unit.nly ?? null,
      },
    };
  }, aid);
}

async function tsInfantrySnapshot(adapter: unknown, entityId: number) {
  return adapterPage(adapter).evaluate((targetId) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entity = game.entities.find((e: any) => e.id === targetId);
    if (!entity) throw new Error(`TS SCU02EA infantry id ${targetId} missing`);
    return {
      tick: game.tick,
      rngState: state.rngState,
      infantry: {
        logicIndexHint: entity.logicIndexHint,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        missionQueue: entity.missionQueue,
        isDriving: entity.isDriving,
        doing: entity.doing,
        leptonX: entity.leptonX,
        leptonY: entity.leptonY,
        moveTarget: entity.moveTarget
          ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
          : null,
      },
    };
  }, entityId);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: Stop_Driver gesture gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not interrupt a team-move gesture before the queued GUARD mission can pop', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 1929);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmInfantrySnapshot(handle.wasm, 851993);
      const ts = await tsInfantrySnapshot(handle.ts, 75);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.infantry.logicIndex).toBe(109);
      expect(ts.infantry.logicIndexHint).toBe(152);
      expect(cpp.infantry.mission).toBe(2);
      expect(ts.infantry.mission).toBe('MOVE');
      expect(ts.infantry.missionTimer).toBe(cpp.infantry.missionTimer);
      expect(cpp.infantry.missionTimer).toBe(13);
      expect(cpp.infantry.missionQueue).toBe(5);
      expect(ts.infantry.missionQueue).toBe('GUARD');
      expect(cpp.infantry.isDriving).toBe(false);
      expect(ts.infantry.isDriving).toBe(false);
      expect(cpp.infantry.doing).toBe(18);
      expect(ts.infantry.doing).toBe('gesture');
      expect(ts.infantry.leptonX).toBe(cpp.infantry.leptonX);
      expect(ts.infantry.leptonY).toBe(cpp.infantry.leptonY);
      expect(ts.infantry.moveTarget).toEqual({
        lx: cpp.infantry.navLeptonX,
        ly: cpp.infantry.navLeptonY,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
