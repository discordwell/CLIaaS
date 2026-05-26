/**
 * Dual-runtime regression for SCU33EA reinforcement team startup.
 *
 * The Greek `atk2` team reaches waypoint 1 and queues HUNT while the new E1
 * members are still in their non-interruptible team-start gesture. C++ leaves
 * them on MISSION_GUARD with MISSION_HUNT queued and no TarCom through this
 * startup window; they must not run a Guard target scan just because the
 * visible mission timer has been initialized.
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
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmReinforcementSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const rows = (state.logicLayer ?? [])
      .filter((row: any[]) => [60, 61, 62].includes(row[0]))
      .sort((a: any[], b: any[]) => a[0] - b[0]);
    const dog = (state.units ?? []).find((unit: any) => unit.t === 'DOG' && unit.cx === 43 && unit.cy === 81);
    if (rows.length !== 3) throw new Error(`C++ SCU33EA reinforcement rows missing: ${rows.length}`);
    if (!dog) throw new Error('C++ SCU33EA USSR dog at (43,81) missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: { hp: dog.hp, cx: dog.cx, cy: dog.cy },
      infantry: rows.map((row: any[]) => ({
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        cx: row[3],
        cy: row[4],
        mission: row[7],
        missionTimer: row[8],
        missionQueue: row[9],
        isDriving: row[10] === true,
        doing: row[11],
        target: row[30] >= 0
          ? { kind: row[30], value: row[31], rtti: row[32], index: row[33] }
          : null,
      })),
    };
  });
}

async function tsReinforcementSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const infantry = game.entities
      .filter((entity: any) => [60, 61, 62].includes(entity.logicIndexHint))
      .sort((a: any, b: any) => a.logicIndexHint - b.logicIndexHint);
    const dog = game.entities.find((entity: any) =>
      entity.type === 'DOG' && entity.house === 'USSR' && entity.cell.cx === 43 && entity.cell.cy === 81);
    if (infantry.length !== 3) throw new Error(`TS SCU33EA reinforcement rows missing: ${infantry.length}`);
    if (!dog) throw new Error('TS SCU33EA USSR dog at (43,81) missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: { hp: dog.hp, cx: dog.cell.cx, cy: dog.cell.cy },
      infantry: infantry.map((entity: any) => ({
        logicIndex: entity.logicIndexHint,
        type: entity.type,
        house: entity.house,
        cx: entity.cell.cx,
        cy: entity.cell.cy,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        missionQueue: entity.missionQueue,
        isDriving: entity.isDriving === true,
        doing: entity.doing,
        animState: entity.animState,
        target: entity.target
          ? { type: entity.target.type, house: entity.target.house, hint: entity.target.logicIndexHint }
          : null,
        targetStructure: entity.targetStructure
          ? { type: entity.targetStructure.type, house: entity.targetStructure.house }
          : null,
      })),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU33 reinforcement gesture guard target gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps newly arrived gesture-locked team infantry targetless while HUNT is queued', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 305);
      const [cpp, ts] = await Promise.all([
        wasmReinforcementSnapshot(handle.wasm),
        tsReinforcementSnapshot(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.infantry.map(row => row.logicIndex)).toEqual([60, 61, 62]);
      for (const row of cpp.infantry) {
        expect(row).toMatchObject({
          type: 'E1',
          house: 'Greece',
          cx: 43,
          cy: 84,
          mission: 5,
          missionQueue: 14,
          isDriving: false,
          doing: 16,
          target: null,
        });
        expect(row.missionTimer === 13 || row.missionTimer === 14).toBe(true);
      }

      expect(ts.infantry).toHaveLength(cpp.infantry.length);
      for (let i = 0; i < cpp.infantry.length; i++) {
        expect(ts.infantry[i]).toMatchObject({
          logicIndex: cpp.infantry[i].logicIndex,
          type: cpp.infantry[i].type,
          house: cpp.infantry[i].house,
          cx: cpp.infantry[i].cx,
          cy: cpp.infantry[i].cy,
          mission: 'GUARD',
          missionTimer: cpp.infantry[i].missionTimer,
          missionQueue: 'HUNT',
          isDriving: false,
          doing: 'gesture',
          target: null,
          targetStructure: null,
        });
      }
      expect(ts.dog.hp).toBe(cpp.dog.hp);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
