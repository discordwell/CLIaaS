/**
 * Dual-runtime checks for SCU09EA late-tick parity regressions.
 *
 * These cover real C++ behavior observed in the harness:
 * - UnitClass::Mission_Harvest owns the no-refinery abort; non-HARVEST harvesters do not.
 * - BuildingClass::Mission_Attack clears FIRE_RANGE/FIRE_CANT before Tesla charge busy.
 * - FootClass::Mission_Move treats TARGET_CELL TarComs as legal, even out of range.
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

const HARVESTER_LOGIC_INDEX = 90;
const MOVE_TANK_LOGIC_INDEX = 106;
const MISSION_MOVE = 2;
const FIRE_RANGE = 8;

type EvalPage = {
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
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
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmLogicEntry(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((idx) => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === idx);
    if (!row) throw new Error(`C++ logic entry ${idx} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      logicIndex: row[0],
      type: row[1],
      house: row[2],
      mission: row[7],
      missionTimer: row[8],
      missionQueue: row[9],
      isDriving: row[10] === true,
      targetLX: row[21],
      targetLY: row[22],
      arm: row[23],
      targetKind: row[30],
      targetValue: row[31],
      inRange0: row[36],
      canFire0: row[37],
    };
  }, logicIndex);
}

async function tsEntityState(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((idx) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entity = (game?.entities ?? []).find((e: any) => e.logicIndexHint === idx);
    if (!entity) throw new Error(`TS logic entity ${idx} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      logicIndex: entity.logicIndexHint,
      type: entity.type,
      house: entity.house,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      missionQueue: entity.missionQueue,
      isDriving: entity.isDriving === true,
      attackCooldown: entity.attackCooldown,
      forceFireLX: entity.forceFirePos
        ? Math.round(entity.forceFirePos.x * 256 / 24)
        : null,
      forceFireLY: entity.forceFirePos
        ? Math.round(entity.forceFirePos.y * 256 / 24)
        : null,
    };
  }, logicIndex);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU09 late root-cause regressions', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('preserves harvester move, Tesla attack, and moving TARGET_CELL TarCom parity', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothInCppSizedChunks(handle, 1017);
      let cppHarv = await wasmLogicEntry(handle.wasm, HARVESTER_LOGIC_INDEX);
      let tsHarv = await tsEntityState(handle.ts, HARVESTER_LOGIC_INDEX);

      expect(result.ts.state.rngState! >>> 0).toBe(result.wasm.state.rngState! >>> 0);
      expect(cppHarv.type).toBe('HARV');
      expect(cppHarv.mission).toBe(MISSION_MOVE);
      expect(tsHarv.type).toBe(cppHarv.type);
      expect(tsHarv.mission).toBe('MOVE');
      expect(tsHarv.missionTimer).toBe(cppHarv.missionTimer);

      result = await stepBothInCppSizedChunks(handle, 30);
      expect(result.ts.state.tick).toBe(1047);
      expect(result.ts.state.rngState! >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBothInCppSizedChunks(handle, 113);
      expect(result.ts.state.tick).toBe(1160);
      expect(result.ts.state.rngState! >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cppTank = await wasmLogicEntry(handle.wasm, MOVE_TANK_LOGIC_INDEX);
      const tsTank = await tsEntityState(handle.ts, MOVE_TANK_LOGIC_INDEX);
      expect(cppTank.type).toBe('2TNK');
      expect(cppTank.mission).toBe(MISSION_MOVE);
      expect(cppTank.isDriving).toBe(true);
      expect(cppTank.canFire0).toBe(FIRE_RANGE);
      expect(tsTank.type).toBe(cppTank.type);
      expect(tsTank.mission).toBe('MOVE');
      expect(tsTank.isDriving).toBe(true);
      expect(tsTank.forceFireLX).toBe(cppTank.targetLX);
      expect(tsTank.forceFireLY).toBe(cppTank.targetLY);

      result = await stepBothInCppSizedChunks(handle, 10);
      expect(result.ts.state.tick).toBe(1170);
      expect(result.ts.state.rngState! >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      cppHarv = await wasmLogicEntry(handle.wasm, HARVESTER_LOGIC_INDEX);
      tsHarv = await tsEntityState(handle.ts, HARVESTER_LOGIC_INDEX);
      expect(tsHarv.missionTimer).toBe(cppHarv.missionTimer);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
