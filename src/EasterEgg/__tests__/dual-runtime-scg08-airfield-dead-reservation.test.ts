/**
 * Dual-runtime check for aircraft pad radio-contact teardown.
 *
 * In SCG08EA, one returning YAK dies after reserving the first USSR AFLD. C++
 * tears down the radio contact during object death, leaving that AFLD free for
 * the surviving damaged YAK. If TS keeps the stale dockedAircraft id, the live
 * YAK chooses the second AFLD, the first AFLD stays in GUARD, and its guard
 * timer consumes one extra Random_Pick at tick 1400.
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

const WASM_MISSION_ATTACK = 0;
const WASM_MISSION_GUARD = 5;
const WASM_MISSION_REPAIR = 19;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmAirfieldRepairSnapshot(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const firstAfld = state.logicLayer.find((r: any[]) =>
      r[5] === 'B' &&
      r[1] === 'AFLD' &&
      r[2] === 'USSR' &&
      r[3] === 102 &&
      r[4] === 58);
    const secondAfld = state.logicLayer.find((r: any[]) =>
      r[5] === 'B' &&
      r[1] === 'AFLD' &&
      r[2] === 'USSR' &&
      r[3] === 106 &&
      r[4] === 57);
    const yak = state.logicLayer.find((r: any[]) =>
      r[5] === 'A' &&
      r[1] === 'YAK' &&
      r[2] === 'USSR');
    if (!firstAfld || !secondAfld || !yak) throw new Error('C++ SCG08EA airfield/YAK state not found');
    return {
      tick: state.tick,
      firstMission: firstAfld[7],
      firstMissionTimer: firstAfld[8],
      firstStatus: firstAfld[27],
      secondMission: secondAfld[7],
      secondMissionTimer: secondAfld[8],
      yakMission: yak[7],
      yakCell: `${yak[3]},${yak[4]}`,
      yakHp: yak[14],
      yakHeight: yak[38],
    };
  });
}

async function tsAirfieldRepairSnapshot(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const game = (window as any).__agentGame;
    const firstIndex = game.structures.findIndex((s: any) =>
      s.type === 'AFLD' &&
      s.house === 'USSR' &&
      s.cx === 102 &&
      s.cy === 58);
    const secondIndex = game.structures.findIndex((s: any) =>
      s.type === 'AFLD' &&
      s.house === 'USSR' &&
      s.cx === 106 &&
      s.cy === 57);
    if (firstIndex < 0 || secondIndex < 0) throw new Error('TS SCG08EA airfields not found');
    const first = game.structures[firstIndex];
    const second = game.structures[secondIndex];
    const docked = first.dockedAircraft !== undefined
      ? game.entityById.get(first.dockedAircraft)
      : undefined;
    return {
      tick: game.tick,
      firstMission: first.mission,
      firstMissionTimer: first.missionTimer,
      firstRepairStatus: first.repairMissionStatus ?? null,
      firstDockedAircraft: first.dockedAircraft ?? null,
      secondMission: second.mission,
      secondMissionTimer: second.missionTimer,
      secondDockedAircraft: second.dockedAircraft ?? null,
      dockedType: docked?.type ?? null,
      dockedAlive: docked?.alive ?? null,
      dockedCell: docked ? `${docked.cell.cx},${docked.cell.cy}` : null,
      dockedHp: docked?.hp ?? null,
      dockedMission: docked?.mission ?? null,
      dockedState: docked?.aircraftState ?? null,
      dockedAltitude: docked?.flightAltitude ?? null,
      dockedLandedAtStructure: docked?.landedAtStructure ?? null,
      firstIndex,
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08EA dead AFLD reservation cleanup', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('frees a dead YAK reservation so the surviving YAK rearms on the C++ airfield', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 1390);

      expect(await wasmAirfieldRepairSnapshot(handle.wasm)).toMatchObject({
        tick: 1390,
        firstMission: WASM_MISSION_REPAIR,
        firstMissionTimer: 32,
        firstStatus: 1,
        secondMission: WASM_MISSION_GUARD,
        secondMissionTimer: 8,
        yakMission: WASM_MISSION_ATTACK,
        yakCell: '103,58',
        yakHp: 15,
        yakHeight: 0,
      });

      const tsSnapshot = await tsAirfieldRepairSnapshot(handle.ts);
      expect(tsSnapshot).toMatchObject({
        tick: 1390,
        firstMission: 'REPAIR',
        firstMissionTimer: 32,
        firstRepairStatus: 1,
        secondMission: 'GUARD',
        secondMissionTimer: 8,
        secondDockedAircraft: null,
        dockedType: 'YAK',
        dockedAlive: true,
        dockedCell: '103,58',
        dockedHp: 15,
        dockedMission: 'GUARD',
        dockedState: 'rearming',
        dockedAltitude: 0,
      });
      expect(tsSnapshot.dockedLandedAtStructure).toBe(tsSnapshot.firstIndex);

      for (let tick = 1391; tick <= 1400; tick++) {
        result = await stepBoth(handle, 1);
      }
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 360_000);
});
