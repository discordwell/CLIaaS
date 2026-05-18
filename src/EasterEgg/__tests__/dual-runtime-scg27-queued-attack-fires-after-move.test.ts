/**
 * Dual-runtime check for InfantryClass::AI firing after a queued attack Commence.
 *
 * In SCG27EA, a Greek C1 is on MISSION_MOVE with MISSION_ATTACK queued while
 * already in Pistol range of the BadGuy 3TNK. C++ runs:
 *   MissionClass::AI(MOVE) -> Commence(ATTACK) -> Firing_AI -> Movement_AI
 * so the civilian fires before starting the next movement hop. TS must not skip
 * Firing_AI just because MissionClass::AI dispatched from MOVE this tick.
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

async function wasmC1QueuedAttackState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) =>
      entry[1] === 'C1' && entry[2] === 'Greece' && entry[3] === 35 && entry[4] === 41);
    const detail = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((unit: any) => unit.id === row?.[6]);
    if (!row || !detail) throw new Error('C++ SCG27EA Greek C1 queued attack state missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      c1: {
        logicIndex: row[0],
        mission: row[7],
        missionTimer: row[8],
        missionQueue: row[9],
        isDriving: row[10],
        doing: row[11],
        lx: row[12],
        ly: row[13],
        arm: row[23],
        primaryCurrent: row[28],
        primaryDesired: row[29],
        targetIndex: row[33],
        fireX: row[34],
        fireY: row[35],
        inRange0: row[36],
        canFire0: row[37],
        stage: detail.stage,
        rate: detail.rate,
        ammo: detail.ammo,
        firing: detail.firing,
      },
    };
  });
}

async function tsC1QueuedAttackState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const c1 = game.entities.find((entity: any) =>
      entity.type === 'C1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 35 &&
      entity.cell?.cy === 41);
    if (!c1) throw new Error('TS SCG27EA Greek C1 queued attack state missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      c1: {
        logicIndex: c1.logicIndexHint,
        mission: c1.mission,
        missionTimer: c1.missionTimer,
        missionQueue: c1.missionQueue,
        isDriving: c1.isDriving,
        doing: c1.doing,
        lx: c1.leptonX,
        ly: c1.leptonY,
        arm: c1.attackCooldown,
        primaryCurrent: c1.bodyFacing256,
        primaryDesired: c1.desiredFacing256,
        targetType: c1.target?.type ?? null,
        targetHint: c1.target?.logicIndexHint ?? null,
        stage: c1.doingStage,
        rate: c1.doingRate,
        ammo: c1.ammo,
        firing: c1.firePrepActive,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27 queued ATTACK fires after MOVE dispatch', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('runs Firing_AI after MOVE dispatch Commences into ATTACK', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 2060);
      const [cppBefore, tsBefore] = await Promise.all([
        wasmC1QueuedAttackState(handle.wasm),
        tsC1QueuedAttackState(handle.ts),
      ]);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(cppBefore.c1).toMatchObject({
        mission: 2,
        missionQueue: 1,
        arm: 0,
        ammo: 8,
        inRange0: 1,
        canFire0: 0,
      });
      expect(tsBefore.c1).toMatchObject({
        mission: 'MOVE',
        missionQueue: 'ATTACK',
        arm: cppBefore.c1.arm,
        ammo: cppBefore.c1.ammo,
      });

      await stepBothOneTickAtATime(handle, 1);
      const [cppAfter, tsAfter] = await Promise.all([
        wasmC1QueuedAttackState(handle.wasm),
        tsC1QueuedAttackState(handle.ts),
      ]);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(cppAfter.c1).toMatchObject({
        mission: 1,
        missionQueue: 2,
        arm: 6,
        ammo: 7,
        primaryCurrent: 0,
        primaryDesired: 0,
      });
      expect(tsAfter.c1).toMatchObject({
        mission: 'ATTACK',
        missionQueue: 'MOVE',
        arm: cppAfter.c1.arm,
        ammo: cppAfter.c1.ammo,
        primaryCurrent: cppAfter.c1.primaryCurrent,
        primaryDesired: cppAfter.c1.primaryDesired,
      });
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
