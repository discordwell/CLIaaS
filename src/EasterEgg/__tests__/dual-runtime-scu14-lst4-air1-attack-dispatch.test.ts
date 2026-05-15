/**
 * Dual-runtime check for SCU14 team cargo and helicopter attack dispatch.
 *
 * `lst4` unloads ARTYs from an LST and later advances through SET_GLOBAL into
 * ATTACK. C++ consumes the LST cargo scatter flag without issuing a fresh team
 * member scatter order, so the parked ARTY remains in GUARD until the team attack
 * queues ATTACK. The dependent `air1` helicopter team also runs the first
 * AircraftClass::Mission_Attack status dispatch on the same object tick.
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

async function wasmScu14AttackDispatchState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer ?? [];
    const arty = logic.find((row: any[]) => row[6] === 1835032);
    if (!arty) throw new Error('C++ SCU14EA lst4 ARTY 1835032 missing');

    const helis = logic
      .filter((row: any[]) => row[1] === 'HELI' && row[2] === 'Greece' && row[3] === 45 && row[4] === 14)
      .map((row: any[]) => ({
        mission: row[7],
        missionTimer: row[8],
        status: row[27],
        height: row[38],
        targetKind: row[30],
        targetIndex: row[33],
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      arty: {
        mission: arty[7],
        missionQueue: arty[9],
        missionTimer: arty[8],
        isDriving: !!arty[10],
        lx: arty[12],
        ly: arty[13],
        targetKind: arty[30],
        targetIndex: arty[33],
      },
      helis,
    };
  });
}

async function tsScu14AttackDispatchState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const arty = game.entities.find((entity: any) =>
      entity.id === 180 && entity.type === 'ARTY' && entity.house === 'Greece');
    if (!arty) throw new Error('TS SCU14EA lst4 ARTY id 180 missing');

    const helis = game.entities
      .filter((entity: any) =>
        entity.type === 'HELI' &&
        entity.house === 'Greece' &&
        entity.cell?.cx === 45 &&
        entity.cell?.cy === 14)
      .map((entity: any) => ({
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        status: entity.aircraftAttackStatus,
        height: entity.aircraftHeightLeptons,
        targetId: entity.target?.id ?? null,
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      arty: {
        mission: arty.mission,
        missionQueue: arty.missionQueue,
        missionTimer: arty.missionTimer,
        isDriving: arty.isDriving,
        lx: arty.leptonX,
        ly: arty.leptonY,
        targetId: arty.target?.id ?? null,
      },
      helis,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 lst4/air1 attack dispatch', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not turn LST cargo scatter into an extra team move before attack dispatch', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 482);
      const beforeCpp = await wasmScu14AttackDispatchState(handle.wasm);
      const beforeTs = await tsScu14AttackDispatchState(handle.ts);

      expect(beforeTs.tick).toBe(beforeCpp.tick);
      expect(beforeTs.rngState >>> 0).toBe(beforeCpp.rngState >>> 0);
      expect(beforeTs.arty.lx).toBe(beforeCpp.arty.lx);
      expect(beforeTs.arty.ly).toBe(beforeCpp.arty.ly);
      expect(beforeTs.arty.isDriving).toBe(beforeCpp.arty.isDriving);

      await stepBoth(handle, 1);
      const guardCpp = await wasmScu14AttackDispatchState(handle.wasm);
      const guardTs = await tsScu14AttackDispatchState(handle.ts);

      expect(guardTs.tick).toBe(guardCpp.tick);
      expect(guardTs.rngState >>> 0).toBe(guardCpp.rngState >>> 0);
      expect(guardCpp.arty.mission).toBe(5);
      expect(guardTs.arty.mission).toBe('GUARD');
      expect(guardTs.arty.isDriving).toBe(false);
      expect(guardTs.arty.lx).toBe(guardCpp.arty.lx);
      expect(guardTs.arty.ly).toBe(guardCpp.arty.ly);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('runs lst4 ARTY and air1 HELI attack mission dispatch on tick 485', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 485);
      const cpp = await wasmScu14AttackDispatchState(handle.wasm);
      const ts = await tsScu14AttackDispatchState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.arty.mission).toBe(1);
      expect(ts.arty.mission).toBe('ATTACK');
      expect(ts.arty.missionTimer).toBe(cpp.arty.missionTimer);
      expect(ts.arty.isDriving).toBe(cpp.arty.isDriving);

      expect(cpp.helis).toHaveLength(4);
      expect(ts.helis).toHaveLength(4);
      const cppHeliTimers = cpp.helis.map((heli) => heli.missionTimer).sort((a, b) => a - b);
      const tsHeliTimers = ts.helis.map((heli) => heli.missionTimer).sort((a, b) => a - b);
      for (const heli of cpp.helis) {
        expect(heli.mission).toBe(1);
        expect(heli.status).toBe(1);
      }
      for (const heli of ts.helis) {
        expect(heli.mission).toBe('ATTACK');
        expect(heli.status).toBe(1);
        expect(heli.targetId).not.toBeNull();
      }
      expect(tsHeliTimers).toEqual(cppHeliTimers);
    }, { wasmSeed: 0 });
  }, 300_000);
});
