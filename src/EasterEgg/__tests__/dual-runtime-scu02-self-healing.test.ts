/**
 * Dual-runtime check for C++ self-healing unit timing and fixed Health_Ratio.
 *
 * SCU02EA starts a Greece harvester at 300/600 HP. C++ TechnoClass self-heal
 * fires on the first AI tick and compares fixed-point Health_Ratio() to
 * ConditionYellow, so 301/600 and 302/600 still count as yellow and heal.
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

function allUnits(state: any): any[] {
  return [...(state.units ?? []), ...(state.enemies ?? [])];
}

function wasmHarvester(state: any): any {
  const unit = allUnits(state).find((u: any) => u.id === 1835008);
  if (!unit) throw new Error('C++ SCU02EA harvester id 1835008 not found');
  return unit;
}

function tsHarvester(state: any): any {
  const unit = allUnits(state).find((u: any) => u.id === 37);
  if (!unit) throw new Error('TS SCU02EA harvester id 37 not found');
  return unit;
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

async function wasmHarvesterDriveSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((targetAid) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const unit = [...(state.units ?? []), ...(state.enemies ?? [])].find((u: any) => u.id === targetAid);
    if (!unit) throw new Error(`C++ SCU02EA harvester id ${targetAid} missing`);
    return {
      tick: state.tick,
      hp: unit.hp,
      missionTimer: unit.mt,
      isDriving: unit.drv,
      speedRaw: unit.spd,
      speedAdd: unit.add,
      leptonX: unit.lx,
      leptonY: unit.ly,
    };
  }, 1835008);
}

async function tsHarvesterDriveSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((targetId) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.id === targetId);
    if (!entity) throw new Error(`TS SCU02EA harvester id ${targetId} missing`);
    return {
      tick: game.tick,
      hp: entity.hp,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      speedRaw: entity.driveSpeed,
      speedAccum: entity.speedAccum,
      leptonX: entity.leptonX,
      leptonY: entity.leptonY,
    };
  }, 37);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: self-healing units', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses C++ RepairRate phase and fixed-point yellow-health threshold', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 1);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
      expect(tsHarvester(result.ts.state).hp).toBe(wasmHarvester(result.wasm.state).hp);
      expect(wasmHarvester(result.wasm.state).hp).toBe(301);

      result = await stepBothInCppSizedChunks(handle, 14);
      expect(tsHarvester(result.ts.state).hp).toBe(wasmHarvester(result.wasm.state).hp);
      expect(wasmHarvester(result.wasm.state).hp).toBe(302);

      result = await stepBothInCppSizedChunks(handle, 14);
      expect(tsHarvester(result.ts.state).hp).toBe(wasmHarvester(result.wasm.state).hp);
      expect(wasmHarvester(result.wasm.state).hp).toBe(303);

      result = await stepBothInCppSizedChunks(handle, 14);
      expect(tsHarvester(result.ts.state).hp).toBe(wasmHarvester(result.wasm.state).hp);
      expect(wasmHarvester(result.wasm.state).hp).toBe(303);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('keeps fixed-point yellow-health classification for drive speed after healing to 301 HP', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 8);
      const cpp = await wasmHarvesterDriveSnapshot(handle.wasm);
      const ts = await tsHarvesterDriveSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.hp).toBe(cpp.hp);
      expect(cpp.hp).toBe(301);
      expect(cpp.isDriving).toBe(true);
      expect(ts.isDriving).toBe(true);
      expect(ts.speedRaw).toBe(cpp.speedRaw);
      expect(cpp.speedRaw).toBe(153);
      expect(cpp.speedAdd).toBe(9);
      expect(ts.leptonX).toBe(cpp.leptonX);
      expect(ts.leptonY).toBe(cpp.leptonY);
    }, { wasmSeed: 0 });
  }, 180_000);
});
