/**
 * Dual-runtime check for C++ AI [Base] building production.
 *
 * SCU13EA gives GoodGuy a [Base] blueprint whose first missing node is a GUN
 * at cell 10047, i.e. (63,78). C++ HouseClass::AI_Building selects that node
 * as BuildStructure, the GoodGuy construction yard builds it through its
 * building-local FactoryClass, and BuildingClass::Exit_Object places the GUN.
 * Once its construction mission completes, the turret's first guard jitter RNG
 * call appears on tick 528.
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

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(300, remaining);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmGoodGuyBaseGun(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const gun = (state.structures ?? []).find((structure: any) =>
      structure.t === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 63 &&
      structure.cy === 78);
    if (!gun) throw new Error('C++ SCU13EA GoodGuy base GUN missing');

    const logicRow = (state.logicLayer ?? []).find((row: any[]) =>
      row[5] === 'B' &&
      row[1] === 'GUN' &&
      row[2] === 'GoodGuy' &&
      row[3] === 63 &&
      row[4] === 78);

    return {
      tick: state.tick,
      rngState: state.rngState,
      gun: {
        logicIndex: logicRow?.[0] ?? null,
        type: gun.t,
        house: gun.house,
        cx: gun.cx,
        cy: gun.cy,
        hp: gun.hp,
        maxHp: gun.mhp,
        mission: logicRow?.[7] ?? null,
        missionTimer: logicRow?.[8] ?? null,
      },
    };
  });
}

async function wasmGoodGuyRuntimeOrder(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicLayer = state.logicLayer ?? [];
    const gunRow = logicLayer.find((row: any[]) =>
      row[5] === 'B' &&
      row[1] === 'GUN' &&
      row[2] === 'GoodGuy' &&
      row[3] === 63 &&
      row[4] === 78);
    if (!gunRow) throw new Error('C++ SCU13EA GoodGuy base GUN logic row missing');

    const mcvRow = logicLayer.find((row: any[]) => row[0] === gunRow[0] - 1);
    if (!mcvRow || mcvRow[1] !== 'MCV') {
      throw new Error('C++ SCU13EA MCV does not immediately precede base GUN');
    }

    return {
      tick: state.tick,
      rngState: state.rngState,
      mcv: {
        logicIndex: mcvRow[0],
        type: mcvRow[1],
        house: mcvRow[2],
        mission: mcvRow[7],
        missionTimer: mcvRow[8],
      },
      gun: {
        logicIndex: gunRow[0],
        type: gunRow[1],
        mission: gunRow[7],
        missionTimer: gunRow[8],
      },
    };
  });
}

async function tsGoodGuyBaseGun(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gun = game.structures.find((structure: any) =>
      structure.type === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 63 &&
      structure.cy === 78);
    if (!gun) throw new Error('TS SCU13EA GoodGuy base GUN missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      gun: {
        logicIndex: gun.logicIndexHint ?? null,
        type: gun.type,
        house: gun.house,
        cx: gun.cx,
        cy: gun.cy,
        hp: gun.hp,
        maxHp: gun.maxHp,
        mission: gun.mission === 'GUARD' ? 5 : gun.mission,
        missionTimer: gun.missionTimer,
      },
    };
  });
}

async function tsGoodGuyRuntimeOrder(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gun = game.structures.find((structure: any) =>
      structure.type === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 63 &&
      structure.cy === 78);
    if (!gun) throw new Error('TS SCU13EA GoodGuy base GUN missing');

    const mcv = game.entities.find((entity: any) =>
      entity.type === 'MCV' &&
      entity.logicIndexHint === gun.logicIndexHint - 1);
    if (!mcv) throw new Error('TS SCU13EA MCV does not immediately precede base GUN');

    return {
      tick: game.tick,
      rngState: state.rngState,
      mcv: {
        logicIndex: mcv.logicIndexHint ?? null,
        type: mcv.type,
        house: mcv.house,
        mission: mcv.mission === 'GUARD' ? 5 : mcv.mission,
        missionTimer: mcv.missionTimer,
      },
      gun: {
        logicIndex: gun.logicIndexHint ?? null,
        type: gun.type,
        mission: gun.mission === 'GUARD' ? 5 : gun.mission,
        missionTimer: gun.missionTimer,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 AI base GUN construction', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('builds the first GoodGuy [Base] GUN through the AI building factory', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 527);
      const cppConstructed = await wasmGoodGuyBaseGun(handle.wasm);
      const tsConstructed = await tsGoodGuyBaseGun(handle.ts);

      expect(tsConstructed.tick).toBe(cppConstructed.tick);
      expect(tsConstructed.rngState >>> 0).toBe(cppConstructed.rngState >>> 0);
      expect(tsConstructed.gun).toMatchObject({
        type: cppConstructed.gun.type,
        house: cppConstructed.gun.house,
        cx: cppConstructed.gun.cx,
        cy: cppConstructed.gun.cy,
        hp: cppConstructed.gun.hp,
        maxHp: cppConstructed.gun.maxHp,
        mission: cppConstructed.gun.mission,
        missionTimer: cppConstructed.gun.missionTimer,
      });

      await stepBoth(handle, 1);
      const cppAfterGuardJitter = await wasmGoodGuyBaseGun(handle.wasm);
      const tsAfterGuardJitter = await tsGoodGuyBaseGun(handle.ts);

      expect(tsAfterGuardJitter.tick).toBe(cppAfterGuardJitter.tick);
      expect(tsAfterGuardJitter.rngState >>> 0).toBe(cppAfterGuardJitter.rngState >>> 0);
      expect(tsAfterGuardJitter.gun).toMatchObject({
        mission: cppAfterGuardJitter.gun.mission,
        missionTimer: cppAfterGuardJitter.gun.missionTimer,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('interleaves the runtime MCV before the runtime base GUN guard jitter', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1008);
      const cpp = await wasmGoodGuyRuntimeOrder(handle.wasm);
      const ts = await tsGoodGuyRuntimeOrder(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.mcv).toMatchObject({
        logicIndex: cpp.mcv.logicIndex,
        type: cpp.mcv.type,
        house: cpp.mcv.house,
        mission: cpp.mcv.mission,
        missionTimer: cpp.mcv.missionTimer,
      });
      expect(ts.gun).toMatchObject({
        logicIndex: cpp.gun.logicIndex,
        type: cpp.gun.type,
        mission: cpp.gun.mission,
        missionTimer: cpp.gun.missionTimer,
      });
      expect(ts.mcv.logicIndex + 1).toBe(ts.gun.logicIndex);
    }, { wasmSeed: 0 });
  }, 300_000);
});
