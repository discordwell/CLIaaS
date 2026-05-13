/**
 * Dual-runtime check for BuildingClass::Greatest_Threat aircraft scan order.
 *
 * SCG08EA exposes two airborne YAKs with equal C++ Evaluate_Object scores for
 * the eastern AGUN at tick 683. C++ breaks the tie by Aircraft.Count() pool
 * order, not Logic/entity iteration order. If TS scans the Logic-ordered
 * entity array, both AGUNs acquire the same weakened YAK and the extra ZSU-23
 * projectile diverges RNG at tick 693.
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

const WASM_MISSION_ATTACK = 1;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

interface AgunTargetSnapshot {
  mission: string | number;
  missionTimer: number | undefined;
  targetLX: number;
  targetLY: number;
  targetHp: number | undefined;
  targetPoolIndex: number | undefined;
}

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmEastAgunTarget(adapter: unknown): Promise<AgunTargetSnapshot> {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) =>
      r[5] === 'B' &&
      r[1] === 'AGUN' &&
      r[3] === 62 &&
      r[4] === 100);
    if (!row) throw new Error('C++ eastern AGUN not found');
    return {
      mission: row[7],
      missionTimer: row[8],
      targetLX: row[21],
      targetLY: row[22],
      targetHp: undefined,
      targetPoolIndex: row[33],
    };
  });
}

async function tsEastAgunTarget(adapter: unknown): Promise<AgunTargetSnapshot> {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const game = (window as any).__agentGame;
    const agun = game.structures.find((s: any) =>
      s.type === 'AGUN' &&
      s.cx === 62 &&
      s.cy === 100);
    if (!agun) throw new Error('TS eastern AGUN not found');
    const target = agun.targetEntityId !== undefined
      ? game.entityById.get(agun.targetEntityId)
      : undefined;
    return {
      mission: agun.mission,
      missionTimer: agun.missionTimer,
      targetLX: target?.leptonX ?? 0,
      targetLY: target ? target.leptonY - (target.isAirUnit ? 256 : 0) : 0,
      targetHp: target?.hp,
      targetPoolIndex: undefined,
    };
  });
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08EA AGUN aircraft pool-order target tie', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses Aircraft.Count pool order, not Logic order, when AGUN air targets tie', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 683);
      const wasmAgun = await wasmEastAgunTarget(handle.wasm);
      expect(wasmAgun).toMatchObject({
        mission: WASM_MISSION_ATTACK,
        missionTimer: 0,
        targetLX: 14860,
        targetLY: 26315,
        targetPoolIndex: 0,
      });

      expect(await tsEastAgunTarget(handle.ts), 'SCG08EA eastern AGUN target at tick 683').toMatchObject({
        mission: 'ATTACK',
        missionTimer: 0,
        targetLX: wasmAgun.targetLX,
        targetLY: wasmAgun.targetLY,
        targetHp: 60,
      });

      for (let tick = 684; tick <= 693; tick++) {
        result = await stepBoth(handle, 1);
      }
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
