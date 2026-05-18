/**
 * Dual-runtime check for vehicle crew Scatter(0, true).
 *
 * In SCG27EA, a Greek ARTY at (30,46) dies at tick 790 and ejects an E1.
 * C++ runs the real UnitClass death path:
 *   Unlimbo -> random survivor Strength -> InfantryClass::Scatter(0,true)
 *
 * InfantryClass::Scatter probes candidate cells with InfantryClass::Can_Enter_Cell.
 * The first random-facing candidate, (31,45), is occupied by a Greek tank, so C++
 * skips it and chooses (31,46). A map-terrain-only scatter check picks the blocked
 * cell instead, then Basic_Path fails close enough and the survivor never walks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmCrewState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const crew = (state.units ?? []).find((unit: any) =>
      unit.id === 852006 &&
      unit.t === 'E1' &&
      unit.house === 'Greece');
    if (!crew) throw new Error('C++ SCG27EA vehicle crew E1 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      crew: {
        id: crew.id,
        type: crew.t,
        hp: crew.hp,
        mission: crew.m,
        missionTimer: crew.mt,
        missionQueue: crew.mq,
        isDriving: crew.drv,
        lx: crew.lx,
        ly: crew.ly,
        navLX: crew.nlx,
        navLY: crew.nly,
        headLX: crew.hlx,
        headLY: crew.hly,
        path0: crew.p0,
      },
    };
  });
}

async function tsCrewState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const crew = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'Greece' &&
      entity.hp === 14 &&
      entity.cell.cx === 30 &&
      entity.cell.cy === 46);
    if (!crew) throw new Error('TS SCG27EA vehicle crew E1 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      crew: {
        id: crew.id,
        type: crew.type,
        hp: crew.hp,
        mission: crew.mission,
        missionTimer: crew.missionTimer,
        missionQueue: crew.missionQueue,
        isDriving: crew.isDriving,
        lx: crew.leptonX,
        ly: crew.leptonY,
        navLX: crew.moveTarget?.lx ?? 0,
        navLY: crew.moveTarget?.ly ?? 0,
        headLX: crew.headToLX,
        headLY: crew.headToLY,
        path0: crew.path.length > 0 && crew.pathIndex < crew.path.length
          ? crew.path[crew.pathIndex].cx - crew.cell.cx
          : null,
        doing: crew.doing,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27EA vehicle crew scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('skips blocked scatter cells and starts the survivor driver on the death tick', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 790);
      const [cppDeathTick, tsDeathTick] = await Promise.all([
        wasmCrewState(handle.wasm),
        tsCrewState(handle.ts),
      ]);

      expect(tsDeathTick.tick).toBe(cppDeathTick.tick);
      expect(tsDeathTick.rngState >>> 0).toBe(cppDeathTick.rngState >>> 0);
      expect(tsDeathTick.crew).toMatchObject({
        type: 'E1',
        hp: cppDeathTick.crew.hp,
        mission: 'MOVE',
        missionTimer: cppDeathTick.crew.missionTimer,
        missionQueue: null,
        isDriving: true,
        lx: cppDeathTick.crew.lx,
        ly: cppDeathTick.crew.ly,
        navLX: cppDeathTick.crew.navLX,
        navLY: cppDeathTick.crew.navLY,
        headLX: cppDeathTick.crew.headLX,
        headLY: cppDeathTick.crew.headLY,
        doing: 'walk',
      });
      expect(cppDeathTick.crew).toMatchObject({
        mission: 2,
        missionQueue: -1,
        isDriving: true,
        navLX: 8072,
        navLY: 11912,
        headLX: 8000,
        headLY: 11968,
      });

      await stepBothOneTickAtATime(handle, 1);
      const [cppNext, tsNext] = await Promise.all([
        wasmCrewState(handle.wasm),
        tsCrewState(handle.ts),
      ]);

      expect(tsNext.tick).toBe(cppNext.tick);
      expect(tsNext.rngState >>> 0).toBe(cppNext.rngState >>> 0);
      expect(tsNext.crew).toMatchObject({
        isDriving: cppNext.crew.isDriving,
        lx: cppNext.crew.lx,
        ly: cppNext.crew.ly,
        headLX: cppNext.crew.headLX,
        headLY: cppNext.crew.headLY,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
