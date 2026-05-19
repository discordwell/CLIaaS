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

interface WestAgunSnapshot {
  mission: string | number;
  missionTimer: number | undefined;
  targetPresent: boolean;
  targetLX: number;
  targetLY: number;
  turretFacing256: number | undefined;
  desiredTurretFacing256: number | undefined;
  canFire: number | undefined;
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

async function wasmWestAgunSnapshot(adapter: unknown): Promise<WestAgunSnapshot> {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) =>
      r[5] === 'B' &&
      r[1] === 'AGUN' &&
      r[3] === 55 &&
      r[4] === 100);
    if (!row) throw new Error('C++ western AGUN not found');
    return {
      mission: row[7],
      missionTimer: row[8],
      targetPresent: row[30] >= 0,
      targetLX: row[21],
      targetLY: row[22],
      turretFacing256: row[28],
      desiredTurretFacing256: row[29],
      canFire: row[37],
    };
  });
}

async function tsWestAgunSnapshot(adapter: unknown): Promise<WestAgunSnapshot> {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const game = (window as any).__agentGame;
    const agun = game.structures.find((s: any) =>
      s.type === 'AGUN' &&
      s.cx === 55 &&
      s.cy === 100);
    if (!agun) throw new Error('TS western AGUN not found');
    const target = agun.targetEntityId !== undefined
      ? game.entityById.get(agun.targetEntityId)
      : undefined;
    return {
      mission: agun.mission,
      missionTimer: agun.missionTimer,
      targetPresent: !!target,
      targetLX: target?.leptonX ?? 0,
      targetLY: target ? target.leptonY - (target.isAirUnit ? 256 : 0) : 0,
      turretFacing256: agun.turretFacing256,
      desiredTurretFacing256: agun.desiredTurretFacing256,
      canFire: undefined,
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

  it('turns the AGUN turret toward TARGET_NONE after an out-of-range aircraft clear', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 633);
      const beforeClear = await wasmWestAgunSnapshot(handle.wasm);
      expect(beforeClear, 'C++ west AGUN reaches the FIRE_RANGE mission tick').toMatchObject({
        targetPresent: true,
        turretFacing256: 57,
        desiredTurretFacing256: 57,
        canFire: 8,
      });
      expect(await tsWestAgunSnapshot(handle.ts), 'TS west AGUN pre-clear state').toMatchObject({
        targetPresent: true,
        targetLX: beforeClear.targetLX,
        targetLY: beforeClear.targetLY,
        turretFacing256: beforeClear.turretFacing256,
        desiredTurretFacing256: beforeClear.desiredTurretFacing256,
      });

      await stepBoth(handle, 1);
      const cppAfterClear = await wasmWestAgunSnapshot(handle.wasm);
      const tsAfterClear = await tsWestAgunSnapshot(handle.ts);
      expect(cppAfterClear.targetPresent).toBe(false);
      expect(tsAfterClear, 'TS should preserve C++ turret retarget after FIRE_RANGE clears TarCom').toMatchObject({
        targetPresent: false,
        turretFacing256: cppAfterClear.turretFacing256,
        desiredTurretFacing256: cppAfterClear.desiredTurretFacing256,
      });

      let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
      for (let tick = 635; tick <= 640; tick++) {
        result = await stepBoth(handle, 1);
      }
      expect(result?.ts.state.rngState >>> 0).toBe(result?.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
