/**
 * Dual-runtime check for SCU34EA fixed-wing Mission_Move -> Mission_Enter.
 *
 * The Greece MIG at C++ logic slot 274 flies a scripted MOVE and then should
 * enter the airstrip landing pattern. A previous TS path used generic return
 * landing after MOVE, which let the AFLD start repair/guard handoff early and
 * consumed RNG from the airstrip guard timer at tick 160.
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
const CPP_MISSION_ENTER = 7;
const CPP_NO_MISSION = -1;

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

async function wasmScu34State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const mig = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 274);
    const afld = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 164);
    if (!mig) throw new Error('C++ SCU34EA MIG logic index 274 missing');
    if (!afld) throw new Error('C++ SCU34EA AFLD logic index 164 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mig: {
        logicIndex: mig[0],
        type: mig[1],
        house: mig[2],
        mission: mig[7],
        missionTimer: mig[8],
        missionQueue: mig[9],
        lx: mig[12],
        ly: mig[13],
        status: mig[27],
      },
      afld: {
        logicIndex: afld[0],
        type: afld[1],
        house: afld[2],
        mission: afld[7],
        missionTimer: afld[8],
        missionQueue: afld[9],
      },
    };
  });
}

async function tsScu34State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mig = game.entities.find((entity: any) =>
      entity.type === 'MIG' &&
      entity.house === 'Greece' &&
      entity.logicIndexHint === 274);
    const afld = game.structures.find((structure: any) =>
      structure.type === 'AFLD' &&
      structure.house === 'Greece' &&
      (structure.logicIndexHint === 164 || (structure.cx === 29 && structure.cy === 98)));
    if (!mig) throw new Error('TS SCU34EA MIG logic index 274 missing');
    if (!afld) throw new Error('TS SCU34EA AFLD logic index 164 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mig: {
        logicIndex: mig.logicIndexHint,
        type: mig.type,
        house: mig.house,
        mission: mig.mission,
        missionTimer: mig.missionTimer,
        missionQueue: mig.missionQueue,
        lx: mig.leptonX,
        ly: mig.leptonY,
        aircraftState: mig.aircraftState,
        aircraftEnterStatus: mig.aircraftEnterStatus,
        aircraftDockingStructure: mig.aircraftDockingStructure,
      },
      afld: {
        logicIndex: afld.logicIndexHint,
        type: afld.type,
        house: afld.house,
        mission: afld.mission,
        missionTimer: afld.missionTimer,
        missionQueue: afld.missionQueue,
        dockedAircraft: afld.dockedAircraft,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 fixed-wing enter landing pattern', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('moves the scripted Greece MIG into Mission_Enter before the airstrip guard timer fires', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 120);
      const enterCpp = await wasmScu34State(handle.wasm);
      const enterTs = await tsScu34State(handle.ts);

      expect(enterTs.tick).toBe(enterCpp.tick);
      expect(enterCpp.mig).toMatchObject({
        type: 'MIG',
        house: 'Greece',
        mission: CPP_MISSION_ENTER,
      });
      expect(enterTs.mig).toMatchObject({
        type: enterCpp.mig.type,
        house: enterCpp.mig.house,
        mission: 'ENTER',
        aircraftState: 'returning',
        aircraftEnterStatus: enterCpp.mig.status,
      });

      await stepBothInChunks(handle, 40);
      const rngCpp = await wasmScu34State(handle.wasm);
      const rngTs = await tsScu34State(handle.ts);

      expect(rngTs.tick).toBe(rngCpp.tick);
      expect(rngTs.rngState >>> 0).toBe(rngCpp.rngState >>> 0);
      expect(rngCpp.afld).toMatchObject({
        type: 'AFLD',
        house: 'Greece',
        mission: CPP_MISSION_GUARD,
        missionQueue: CPP_NO_MISSION,
      });
      expect(rngTs.afld).toMatchObject({
        type: rngCpp.afld.type,
        house: rngCpp.afld.house,
        mission: 'GUARD',
        missionTimer: rngCpp.afld.missionTimer,
      });
      expect(rngTs.afld.missionQueue ?? null).toBeNull();
    });
  }, 60_000);
});
