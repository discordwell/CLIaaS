/**
 * Dual-runtime check for SCU10EA airfield Mission_Repair -> Guard handoff.
 *
 * C++ building.cpp:4041-4089 keeps an AFLD/HPAD on Mission_Repair when a
 * docked aircraft is already RADIO_PREPARED, queues Guard, and only then lets
 * the normal non-weapon Guard jitter run. Writing Guard directly skips the
 * airfield's tick-191 Random_Pick and shifts every later structure RNG call.
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

const CPP_MISSION_GUARD = 5;
const CPP_MISSION_REPAIR = 19;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmScu10Airfield(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const afld = ((state.logicLayer ?? []) as any[]).find(row => row[0] === 174);
    if (!afld) throw new Error('C++ SCU10EA AFLD logic row 174 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: afld[1],
      house: afld[2],
      cx: afld[3],
      cy: afld[4],
      mission: afld[7],
      missionTimer: afld[8],
      missionQueue: afld[9],
      status: afld[27],
    };
  });
}

async function tsScu10Airfield(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const afld = game.structures.find((structure: any) =>
      structure.type === 'AFLD' &&
      structure.house === 'USSR' &&
      structure.cx === 103 &&
      structure.cy === 53);
    if (!afld) throw new Error('TS SCU10EA USSR AFLD at (103,53) missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: afld.type,
      house: afld.house,
      cx: afld.cx,
      cy: afld.cy,
      mission: afld.mission,
      missionTimer: afld.missionTimer,
      missionQueue: afld.missionQueue ?? null,
      repairMissionStatus: afld.repairMissionStatus ?? null,
      isReadyToCommence: afld.isReadyToCommence ?? null,
      dockedAircraft: afld.dockedAircraft ?? null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 airfield repair guard handoff', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('queues Guard from pad Mission_Repair so the tick-191 non-weapon jitter is not skipped', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 190);
      const preCpp = await wasmScu10Airfield(handle.wasm);
      const preTs = await tsScu10Airfield(handle.ts);

      expect(preCpp).toMatchObject({
        tick: 190,
        type: 'AFLD',
        house: 'USSR',
        cx: 103,
        cy: 53,
        mission: CPP_MISSION_REPAIR,
        missionTimer: 2,
        status: 0,
      });
      expect(preTs).toMatchObject({
        tick: 190,
        type: 'AFLD',
        house: 'USSR',
        cx: 103,
        cy: 53,
        mission: 'REPAIR',
        missionTimer: 2,
        missionQueue: 'GUARD',
        repairMissionStatus: 0,
        isReadyToCommence: true,
      });

      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
        (window as any).__rngTagControl?.('reset');
      });

      const step = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() => (window as any).__rngTagControl?.('read'));
      const postCpp = await wasmScu10Airfield(handle.wasm);
      const postTs = await tsScu10Airfield(handle.ts);

      expect(step.wasm.state.tick).toBe(191);
      expect(step.ts.state.tick).toBe(191);
      expect(step.wasm.state.rngState >>> 0).toBe(tsRng.seed >>> 0);
      expect(step.wasm.state.rngLog).toContainEqual([2590852455, 70002, 12174]);
      expect(tsRng.seedLog).toContainEqual([2590852455, 12174, 12174]);

      expect(postCpp).toMatchObject({
        tick: 191,
        mission: CPP_MISSION_GUARD,
        missionTimer: 126,
        status: 1,
      });
      expect(postTs).toMatchObject({
        tick: 191,
        mission: 'GUARD',
        missionTimer: 126,
        missionQueue: null,
        repairMissionStatus: 0,
        isReadyToCommence: false,
      });
    });
  }, 80_000);
});
