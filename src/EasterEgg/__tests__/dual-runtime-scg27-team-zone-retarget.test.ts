/**
 * Dual-runtime check for TeamClass::Calc_Center feeding Took_Damage retargets.
 *
 * SCG27EA BadGuy team "atk2" is a single moving 3TNK at this point. C++
 * Calc_Center keeps the averaged coordinate when the average lands on the
 * tank's own occupied cell, because Can_Enter_Cell sees the vehicle occupy bit
 * and returns a non-MOVE_OK value. That Zone keeps the existing 2TNK target in
 * range, so Took_Damage does not retarget the team to the attacking infantry.
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

type LeptonTarget = { lx: number; ly: number } | null;

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

async function wasmAtk2State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((candidate: any) =>
      candidate.cls === 'atk2' && candidate.house === 'BadGuy');
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 89);
    if (!team || !row) throw new Error('C++ SCG27EA atk2/team tank missing');

    const target = (team.tgtX || team.tgtY)
      ? { lx: team.tgtX, ly: team.tgtY }
      : null;
    const missionTarget = (team.mtgtX || team.mtgtY)
      ? { lx: team.mtgtX, ly: team.mtgtY }
      : null;
    const tankTarget = row[30] >= 0
      ? { lx: row[21], ly: row[22] }
      : null;

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        typeName: team.cls,
        target,
        missionTarget,
        zone: { lx: team.zoneX, ly: team.zoneY },
        closestMember: { lx: team.closeX, ly: team.closeY },
      },
      tank: {
        logicIndex: row[0],
        type: row[1],
        target: tankTarget,
        arm: row[23],
      },
    };
  });
}

async function tsAtk2State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) => entity.logicIndexHint === 89);
    const team = tank?.teamRef;
    if (!tank || !team) throw new Error('TS SCG27EA atk2/team tank missing');

    const entityTarget = (entity: any | null): LeptonTarget => entity
      ? { lx: entity.leptonX, ly: entity.leptonY }
      : null;

    return {
      tick: state.tick,
      rngState: state.rngState,
      team: {
        typeName: team.typeName,
        target: entityTarget(team.targetEntityRef),
        missionTarget: entityTarget(team.missionTargetEntityRef),
        zone: { lx: team.zoneLeptonX, ly: team.zoneLeptonY },
      },
      tank: {
        logicIndex: tank.logicIndexHint,
        type: tank.type,
        target: entityTarget(tank.target),
        arm: tank.attackCooldown,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27 atk2 team zone retarget', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps an armed existing target when Calc_Center zone is in range', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 1995);
      const [cppBefore, tsBefore] = await Promise.all([
        wasmAtk2State(handle.wasm),
        tsAtk2State(handle.ts),
      ]);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(cppBefore.team).toMatchObject({
        typeName: 'atk2',
        target: { lx: 8320, ly: 11392 },
        missionTarget: { lx: 8320, ly: 11392 },
      });
      expect(tsBefore.team).toMatchObject({
        typeName: cppBefore.team.typeName,
        target: cppBefore.team.target,
        missionTarget: cppBefore.team.missionTarget,
        zone: cppBefore.team.zone,
      });
      expect(tsBefore.tank.target).toEqual(cppBefore.tank.target);

      await stepBothOneTickAtATime(handle, 1);
      const [cppAfter, tsAfter] = await Promise.all([
        wasmAtk2State(handle.wasm),
        tsAtk2State(handle.ts),
      ]);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
      expect(tsAfter.team.target).toEqual(cppAfter.team.target);
      expect(tsAfter.tank.target).toEqual(cppAfter.tank.target);
    }, { wasmSeed: 0 });
  }, 300_000);
});
