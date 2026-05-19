/**
 * Dual-runtime check for SCG01EA loaner Chinook retreat takeoff status.
 *
 * C++ AircraftClass::Mission_Retreat owns helicopter takeoff. While Status is
 * TAKE_OFF, each MissionClass dispatch calls Process_Take_Off(); the dispatch
 * that reaches FLIGHT_LEVEL changes Status to FACE_MAP_EDGE and returns 1.
 * The next dispatch then sets full speed/facing and consumes the retreat delay
 * jitter. TS must advance the retreat status when its takeoff state reaches
 * flight level, not wait for an extra flying-state dispatch.
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

const WASM_MISSION_RETREAT = 4;
const RETREAT_FACE_MAP_EDGE = 1;
const RETREAT_KEEP_FLYING = 2;
const FLIGHT_LEVEL_LEPTONS = 256;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmTransport(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? [])];
    const tran = all.find((entry: any) => entry.t === 'TRAN' && entry.house === 'Greece');
    if (!tran) throw new Error('C++ Greece TRAN missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tran: {
        mission: tran.m,
        missionTimer: tran.mt,
        status: tran.status,
        height: tran.hgt,
        cx: tran.cx,
        cy: tran.cy,
      },
    };
  });
}

async function tsTransport(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tran = ((game?.entities ?? []) as any[]).find(entity =>
      entity.type === 'TRAN' &&
      entity.house === 'Greece' &&
      entity.alive !== false);
    if (!tran) throw new Error('TS Greece TRAN missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tran: {
        mission: tran.mission,
        missionTimer: tran.missionTimer,
        status: tran.aircraftAttackStatus,
        aircraftState: tran.aircraftState,
        height: tran.aircraftHeightLeptons,
        cx: tran.cell.cx,
        cy: tran.cell.cy,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG01EA Chinook retreat takeoff status', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('promotes TAKE_OFF to FACE_MAP_EDGE as takeoff reaches flight level', async () => {
    await withDualScenario('SCG01EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 252);
      const cpp252 = await wasmTransport(handle.wasm);
      const ts252 = await tsTransport(handle.ts);

      expect(cpp252.tran).toMatchObject({
        mission: WASM_MISSION_RETREAT,
        missionTimer: 0,
        status: RETREAT_FACE_MAP_EDGE,
        height: FLIGHT_LEVEL_LEPTONS,
      });
      expect(ts252.tran).toMatchObject({
        mission: 'RETREAT',
        missionTimer: cpp252.tran.missionTimer,
        status: cpp252.tran.status,
        aircraftState: 'flying',
        height: cpp252.tran.height,
        cx: cpp252.tran.cx,
        cy: cpp252.tran.cy,
      });
      expect(ts252.rngState >>> 0).toBe(cpp252.rngState >>> 0);

      await stepBoth(handle, 1);
      const cpp253 = await wasmTransport(handle.wasm);
      const ts253 = await tsTransport(handle.ts);

      expect(cpp253.tran).toMatchObject({
        mission: WASM_MISSION_RETREAT,
        status: RETREAT_KEEP_FLYING,
        height: FLIGHT_LEVEL_LEPTONS,
      });
      expect(ts253.tran).toMatchObject({
        mission: 'RETREAT',
        missionTimer: cpp253.tran.missionTimer,
        status: cpp253.tran.status,
        aircraftState: 'flying',
        height: cpp253.tran.height,
        cx: cpp253.tran.cx,
        cy: cpp253.tran.cy,
      });
      expect(ts253.rngState >>> 0).toBe(cpp253.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
