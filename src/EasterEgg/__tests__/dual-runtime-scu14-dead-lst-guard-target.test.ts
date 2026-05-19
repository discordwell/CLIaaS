/**
 * Dual-runtime check for a zero-strength vessel remaining in the C++ threat
 * layer. SCU14EA leaves a destroyed Greek LST at (86,86). At tick 2365 the
 * USSR Mammoth at (83,85) scans on GUARD; C++ Greatest_Threat returns that dead
 * LST, Assign_Target clears TarCom, and the unit does not fall through to the
 * live Greek 2TNK at (85,85).
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
    const chunk = Math.min(remaining, 300);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmDeadLstGuardSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? []), ...(state.vessels ?? [])];
    const mammoth = all.find((unit: any) =>
      unit.t === '4TNK' &&
      unit.house === 'USSR' &&
      unit.cx === 83 &&
      unit.cy === 85);
    if (!mammoth) throw new Error('C++ SCU14EA Mammoth at (83,85) missing');

    const evalDeadLst = JSON.parse(module.ccall(
      'agent_debug_eval_target',
      'string',
      ['number', 'number'],
      [mammoth.id, 1966088],
    ));

    return {
      tick: state.tick,
      rngState: state.rngState,
      mammoth: {
        id: mammoth.id,
        targetLX: mammoth.tlx ?? null,
        targetLY: mammoth.tly ?? null,
        missionTimer: mammoth.mt,
      },
      evalDeadLst: {
        bestId: evalDeadLst.bestId,
        targetStrength: evalDeadLst.targetStrength,
        targetType: evalDeadLst.targetType,
        targetCell: [evalDeadLst.targetCx, evalDeadLst.targetCy],
      },
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mammoth: {
      id: number;
      targetLX: number | null;
      targetLY: number | null;
      missionTimer: number;
    };
    evalDeadLst: {
      bestId: number;
      targetStrength: number;
      targetType: string;
      targetCell: [number, number];
    };
  }>;
}

async function tsDeadLstGuardSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mammoth = (game.entities ?? []).find((entity: any) =>
      entity.type === '4TNK' &&
      entity.house === 'USSR' &&
      entity.cell?.cx === 83 &&
      entity.cell?.cy === 85);
    if (!mammoth) throw new Error('TS SCU14EA Mammoth at (83,85) missing');

    const deadLst = (game.entities ?? []).find((entity: any) =>
      entity.type === 'LST' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 86 &&
      entity.cell?.cy === 86 &&
      entity.hp <= 0);

    return {
      tick: state.tick,
      rngState: state.rngState,
      mammoth: {
        id: mammoth.id,
        targetId: mammoth.target?.id ?? null,
        targetType: mammoth.target?.type ?? null,
        missionTimer: mammoth.missionTimer,
      },
      deadLst: deadLst ? {
        id: deadLst.id,
        alive: deadLst.alive,
        inLimbo: deadLst.inLimbo,
        occupiesCppLogic: deadLst.occupiesCppLogic(),
      } : null,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mammoth: {
      id: number;
      targetId: number | null;
      targetType: string | null;
      missionTimer: number;
    };
    deadLst: {
      id: number;
      alive: boolean;
      inLimbo: boolean;
      occupiesCppLogic: boolean;
    } | null;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 dead LST guard scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('lets the zero-strength LST poison the Mammoth guard scan instead of falling through to the 2TNK', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 2365);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmDeadLstGuardSnapshot(handle.wasm);
      const ts = await tsDeadLstGuardSnapshot(handle.ts);

      expect(cpp.evalDeadLst).toEqual({
        bestId: 1966088,
        targetStrength: 0,
        targetType: 'LST',
        targetCell: [86, 86],
      });
      expect(cpp.mammoth.targetLX).toBeNull();
      expect(cpp.mammoth.targetLY).toBeNull();

      expect(ts).toEqual({
        tick: cpp.tick,
        rngState: cpp.rngState >>> 0,
        mammoth: {
          id: 192,
          targetId: null,
          targetType: null,
          missionTimer: cpp.mammoth.missionTimer,
        },
        deadLst: {
          id: 231,
          alive: false,
          inLimbo: false,
          occupiesCppLogic: true,
        },
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 360_000);
});
