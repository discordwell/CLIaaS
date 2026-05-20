/**
 * Dual-runtime check for fixed-wing Mission_Hunt REGROUP delay.
 *
 * In SCG08EA, a loaner BADR exhausts its ammo in Mission_Hunt REGROUP. C++
 * removes it from the team, assigns RETREAT, commences that mission, then
 * returns MissionControl[Mission].Normal_Delay() + Random_Pick(0,2). Because
 * Mission has already changed to RETREAT, the returned frame timer is the long
 * retreat delay, not the short attack delay. A short TS timer sends the BADR
 * down a different retreat path and later changes AGUN target retention.
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
const WASM_MISSION_RETREAT = 4;
const WASM_MISSION_ENTER = 7;
const FIXED_WING_REGROUP = 4;
const LOOK_FOR_TARGET = 0;
const BADR_LOGIC_INDEX = 185;
const YAK_LOGIC_INDEX = 182;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmAircraft(adapter: unknown, logicIndex: number, type: string) {
  return adapterPage(adapter).evaluate(({ logicIndex: targetLogic, type: targetType }) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((entry: any[]) =>
      entry[0] === targetLogic &&
      entry[5] === 'A' &&
      entry[1] === targetType &&
      entry[2] === 'USSR');
    if (!row) throw new Error(`C++ SCG08EA ${targetType} logic ${targetLogic} not found`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: row[1],
      mission: row[7],
      missionTimer: row[8],
      status: row[27],
      cx: row[3],
      cy: row[4],
      lx: row[12],
      ly: row[13],
      ammoArm: row[23],
    };
  }, { logicIndex, type });
}

async function tsAircraft(adapter: unknown, logicIndex: number, type: string) {
  return adapterPage(adapter).evaluate(({ logicIndex: targetLogic, type: targetType }) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const aircraft = ((game?.entities ?? []) as any[]).find(entity =>
      entity.logicIndexHint === targetLogic &&
      entity.type === targetType &&
      entity.house === 'USSR' &&
      entity.alive !== false);
    if (!aircraft) throw new Error(`TS SCG08EA ${targetType} logic ${targetLogic} not found`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: aircraft.type,
      mission: aircraft.mission,
      missionTimer: aircraft.missionTimer,
      status: aircraft.aircraftAttackStatus,
      phase: aircraft.attackRunPhase,
      aircraftState: aircraft.aircraftState,
      cx: aircraft.cell.cx,
      cy: aircraft.cell.cy,
      lx: aircraft.leptonX,
      ly: aircraft.leptonY,
      ammo: aircraft.ammo,
      attackCooldown: aircraft.attackCooldown,
      isALoaner: aircraft.isALoaner === true,
    };
  }, { logicIndex, type });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08EA fixed-wing regroup retreat delay', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses the RETREAT normal delay after loaner REGROUP assigns retreat', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 676);
      expect(await wasmAircraft(handle.wasm, BADR_LOGIC_INDEX, 'BADR')).toMatchObject({
        tick: 676,
        mission: WASM_MISSION_ATTACK,
        missionTimer: 0,
        status: FIXED_WING_REGROUP,
      });
      expect(await tsAircraft(handle.ts, BADR_LOGIC_INDEX, 'BADR')).toMatchObject({
        tick: 676,
        mission: 'ATTACK',
        missionTimer: 0,
        status: FIXED_WING_REGROUP,
        phase: 'regroup',
        ammo: 0,
      });

      await stepBoth(handle, 1);
      const cpp = await wasmAircraft(handle.wasm, BADR_LOGIC_INDEX, 'BADR');
      const ts = await tsAircraft(handle.ts, BADR_LOGIC_INDEX, 'BADR');

      expect(cpp).toMatchObject({
        tick: 677,
        mission: WASM_MISSION_RETREAT,
        status: LOOK_FOR_TARGET,
      });
      expect(cpp.missionTimer).toBeGreaterThanOrEqual(87);
      expect(ts).toMatchObject({
        tick: 677,
        mission: 'RETREAT',
        missionTimer: cpp.missionTimer,
        status: cpp.status,
        aircraftState: 'flying',
      });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('does not mark AI YAK reinforcements as loaners when C++ takes them for airstrips', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 785);
      expect(await wasmAircraft(handle.wasm, YAK_LOGIC_INDEX, 'YAK')).toMatchObject({
        tick: 785,
        mission: WASM_MISSION_ATTACK,
        missionTimer: 0,
        status: FIXED_WING_REGROUP,
      });
      expect(await tsAircraft(handle.ts, YAK_LOGIC_INDEX, 'YAK')).toMatchObject({
        tick: 785,
        mission: 'ATTACK',
        missionTimer: 0,
        status: FIXED_WING_REGROUP,
        phase: 'regroup',
        ammo: 0,
      });

      await stepBoth(handle, 1);
      const cpp = await wasmAircraft(handle.wasm, YAK_LOGIC_INDEX, 'YAK');
      const ts = await tsAircraft(handle.ts, YAK_LOGIC_INDEX, 'YAK');

      expect(cpp).toMatchObject({
        tick: 786,
        mission: WASM_MISSION_ENTER,
        status: LOOK_FOR_TARGET,
      });
      expect(ts).toMatchObject({
        tick: 786,
        mission: 'ENTER',
        missionTimer: cpp.missionTimer,
        status: cpp.status,
        aircraftState: 'returning',
        isALoaner: false,
      });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
