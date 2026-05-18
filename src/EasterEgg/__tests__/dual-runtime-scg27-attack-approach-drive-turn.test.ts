/**
 * Dual-runtime check for DriveClass::Assign_Destination during attack approach.
 *
 * C++ FootClass::Mission_Attack calls Approach_Target(), whose virtual
 * DriveClass::Assign_Destination immediately runs Start_Of_Move when the
 * vehicle is stationary. That computes Path[0]/Do_Turn before DriveClass::AI's
 * rotation branch, so the same object AI pass advances the newly requested turn.
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

async function wasmTank89(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 89);
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((unit: any) => unit.id === row?.[6]);
    if (!row || !tank) throw new Error('C++ SCG27EA logic[89] tank missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        type: row[1],
        house: row[2],
        mission: row[7],
        missionTimer: row[8],
        missionQueue: row[9],
        isDriving: row[10],
        lx: row[12],
        ly: row[13],
        target: row[30] >= 0 ? { lx: row[21], ly: row[22] } : null,
        nav: typeof tank.nlx === 'number' ? { lx: tank.nlx, ly: tank.nly } : null,
        path0: tank.p0,
        path1: tank.p1,
        trackNumber: tank.tn,
        trackIndex: tank.ti,
        headLX: tank.hlx,
        headLY: tank.hly,
        primaryFacing: row[28],
        desiredFacing: row[29],
      },
    };
  });
}

async function tsTank89(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) => entity.logicIndexHint === 89);
    if (!tank) throw new Error('TS SCG27EA logic[89] tank missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        type: tank.type,
        house: tank.house,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        missionQueue: tank.missionQueue,
        isDriving: tank.isDriving,
        lx: tank.leptonX,
        ly: tank.leptonY,
        target: tank.target ? { lx: tank.target.leptonX, ly: tank.target.leptonY } : null,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path0: tank.drivePathFacings[0] ?? null,
        path1: tank.drivePathFacings[1] ?? null,
        trackNumber: tank.trackNumber,
        trackIndex: tank.trackIndex,
        headLX: tank.headToLX,
        headLY: tank.headToLY,
        primaryFacing: tank.bodyFacing256,
        desiredFacing: tank.desiredFacing256,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27 attack approach drive turn', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('advances the Start_Of_Move turn in the same Mission_Attack AI pass', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 1413);
      const [cppTurn, tsTurn] = await Promise.all([
        wasmTank89(handle.wasm),
        tsTank89(handle.ts),
      ]);

      expect(tsTurn.tick).toBe(cppTurn.tick);
      expect(tsTurn.rngState >>> 0).toBe(cppTurn.rngState >>> 0);
      expect(cppTurn.tank).toMatchObject({
        type: '3TNK',
        mission: 1,
        isDriving: false,
        desiredFacing: 0,
      });
      expect(tsTurn.tank).toMatchObject({
        type: cppTurn.tank.type,
        mission: 'ATTACK',
        missionTimer: cppTurn.tank.missionTimer,
        isDriving: cppTurn.tank.isDriving,
        target: cppTurn.tank.target,
        nav: cppTurn.tank.nav,
        path0: cppTurn.tank.path0,
        path1: cppTurn.tank.path1,
        desiredFacing: cppTurn.tank.desiredFacing,
        primaryFacing: cppTurn.tank.primaryFacing,
      });

      await stepBothOneTickAtATime(handle, 13);
      const [cppDriver, tsDriver] = await Promise.all([
        wasmTank89(handle.wasm),
        tsTank89(handle.ts),
      ]);

      expect(tsDriver.tick).toBe(cppDriver.tick);
      expect(tsDriver.rngState >>> 0).toBe(cppDriver.rngState >>> 0);
      expect(tsDriver.tank).toMatchObject({
        isDriving: cppDriver.tank.isDriving,
        lx: cppDriver.tank.lx,
        ly: cppDriver.tank.ly,
        headLX: cppDriver.tank.headLX,
        headLY: cppDriver.tank.headLY,
        trackIndex: cppDriver.tank.trackIndex,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
