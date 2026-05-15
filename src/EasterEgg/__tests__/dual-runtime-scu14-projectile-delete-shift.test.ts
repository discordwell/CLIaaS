/**
 * Dual-runtime check for C++ Logic cursor shifts caused by projectile deletes.
 *
 * In SCU14EA a SCUD detonates during the runtime object pass. Its blast deletes
 * an earlier logic object, which shifts the following 2TNK behind the active C++
 * Logic cursor. C++ skips that tank until the next frame; TS must not keep
 * processing it just because it still appears later in the JS entity array.
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

async function wasmDeleteShiftState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer ?? [];
    const tank = logic.find((row: any[]) =>
      row[1] === '2TNK' && row[2] === 'Greece' && row[3] === 99 && row[4] === 98);
    const rifle = logic.find((row: any[]) =>
      row[1] === 'E1' && row[2] === 'Greece' && row[3] === 92 && row[4] === 77);
    if (!tank) throw new Error('C++ SCU14EA shifted 2TNK missing');
    if (!rifle) throw new Error('C++ SCU14EA SCUD survivor E1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        mission: tank[7],
        missionTimer: tank[8],
        isDriving: !!tank[10],
        lx: tank[12],
        ly: tank[13],
      },
      rifle: {
        mission: rifle[7],
        missionTimer: rifle[8],
        isDriving: !!rifle[10],
        lx: rifle[12],
        ly: rifle[13],
      },
    };
  });
}

async function tsDeleteShiftState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) =>
      entity.type === '2TNK' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 99 &&
      entity.cell?.cy === 98);
    const rifle = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 92 &&
      entity.cell?.cy === 77);
    if (!tank) throw new Error('TS SCU14EA shifted 2TNK missing');
    if (!rifle) throw new Error('TS SCU14EA SCUD survivor E1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving,
        lx: tank.leptonX,
        ly: tank.leptonY,
      },
      rifle: {
        mission: rifle.mission,
        missionTimer: rifle.missionTimer,
        isDriving: rifle.isDriving,
        lx: rifle.leptonX,
        ly: rifle.leptonY,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 projectile delete shifts', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('skips a 2TNK shifted behind the Logic cursor by a SCUD detonation', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 763);
      const cpp = await wasmDeleteShiftState(handle.wasm);
      const ts = await tsDeleteShiftState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.tank.mission).toBe(2);
      expect(ts.tank.mission).toBe('MOVE');
      expect(ts.tank.missionTimer).toBe(cpp.tank.missionTimer);
      expect(ts.tank.isDriving).toBe(cpp.tank.isDriving);
      expect(ts.tank.lx).toBe(cpp.tank.lx);
      expect(ts.tank.ly).toBe(cpp.tank.ly);

      expect(cpp.rifle.mission).toBe(14);
      expect(ts.rifle.mission).toBe('HUNT');
      expect(ts.rifle.missionTimer).toBe(cpp.rifle.missionTimer);
      expect(ts.rifle.isDriving).toBe(cpp.rifle.isDriving);
      expect(ts.rifle.lx).toBe(cpp.rifle.lx);
      expect(ts.rifle.ly).toBe(cpp.rifle.ly);
    }, { wasmSeed: 0 });
  }, 300_000);
});
