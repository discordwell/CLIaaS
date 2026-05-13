/**
 * Dual-runtime check for TeamClass::TMission_Follow / HOUND_DOG.
 *
 * SCU10EA's Turkey convoy runs MOVE -> HOUND_DOG -> LOOP. Once the first
 * MOVE is complete, C++ finds the nearest friendly foot object outside the
 * convoy and reissues convoy movement toward that object target. TS used to
 * fall through the Team mission default for HOUND_DOG, so the trucks stayed
 * on GUARD and missed the next movement/RNG path.
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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmTurkeyConvoy(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const trucks = [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((u: any) => u.t === 'TRUK' && u.house === 'Turkey')
      .sort((a: any, b: any) => a.id - b.id);
    const team = (state.teams ?? []).find((t: any) => t.cls === 'conv2');
    if (!team || trucks.length !== 3) throw new Error('C++ SCU10EA Turkey convoy not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      currentMission: team.cur,
      isNextMission: team.next,
      trucks: trucks.map((truck: any) => ({
        id: truck.id,
        cx: truck.cx,
        cy: truck.cy,
        lx: truck.lx,
        ly: truck.ly,
        mission: truck.m,
        missionQueue: truck.mq,
        missionTimer: truck.mt,
        isDriving: truck.drv === true,
        headToLX: truck.hlx ?? 0,
        headToLY: truck.hly ?? 0,
        hasNavCom: truck.nlx !== undefined,
      })),
    };
  }, undefined);
}

async function tsTurkeyConvoy(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState?.();
    const trucks = game.entities
      .filter((e: any) => e.alive !== false && e.type === 'TRUK' && e.house === 'Turkey')
      .sort((a: any, b: any) => b.id - a.id);
    const team = (window as any).__agentTeams?.().find((t: any) => t.typeName === 'conv2');
    if (!team || trucks.length !== 3) throw new Error('TS SCU10EA Turkey convoy not found');
    return {
      tick: game.tick,
      rngState: state?.rngState,
      currentMission: team.currentMission,
      isNextMission: team.isNextMission,
      trucks: trucks.map((truck: any) => ({
        id: truck.id,
        cx: truck.cell.cx,
        cy: truck.cell.cy,
        lx: truck.leptonX,
        ly: truck.leptonY,
        mission: truck.mission,
        missionQueue: truck.missionQueue ?? null,
        missionTimer: truck.missionTimer,
        isDriving: truck.isDriving === true,
        headToLX: truck.headToLX,
        headToLY: truck.headToLY,
        hasNavCom: !!truck.moveTarget,
      })),
    };
  }, undefined);
}

async function wasmHoundDogTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((t: any) => t.cls === 'conv2');
    if (!team) throw new Error('C++ SCU10EA conv2 team not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      target: { lx: team.tgtX, ly: team.tgtY },
      anchor: { lx: team.closeX, ly: team.closeY },
    };
  }, undefined);
}

async function tsHoundDogTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState?.();
    const team = (window as any).__teamsList?.().find((t: any) => t.typeName === 'conv2');
    if (!team) throw new Error('TS SCU10EA conv2 team not found');
    const target = team.targetEntityRef
      ? { lx: team.targetEntityRef.leptonX, ly: team.targetEntityRef.leptonY }
      : { lx: team.zoneLeptonX, ly: team.zoneLeptonY };
    const anchor = team._members?.[team._members.length - 1];
    return {
      tick: game.tick,
      rngState: state?.rngState,
      target,
      anchor: anchor ? { lx: anchor.leptonX, ly: anchor.leptonY } : null,
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 HOUND_DOG follow', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reissues convoy movement toward the nearest friendly object target', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 300);
      await stepBoth(handle, 68);

      const cpp368 = await wasmTurkeyConvoy(handle.wasm);
      const ts368 = await tsTurkeyConvoy(handle.ts);

      expect(ts368.tick).toBe(cpp368.tick);
      expect(ts368.rngState).toBe(cpp368.rngState);
      expect(ts368.currentMission).toBe(cpp368.currentMission);
      expect(ts368.isNextMission).toBe(cpp368.isNextMission);
      expect(cpp368.currentMission).toBe(1);

      expect(ts368.trucks.map(t => ({
        cx: t.cx,
        cy: t.cy,
        lx: t.lx,
        ly: t.ly,
        mission: t.mission,
        missionQueue: t.missionQueue,
        missionTimer: t.missionTimer,
        isDriving: t.isDriving,
        headToLX: t.headToLX,
        headToLY: t.headToLY,
        hasNavCom: t.hasNavCom,
      }))).toEqual(cpp368.trucks.map(t => ({
        cx: t.cx,
        cy: t.cy,
        lx: t.lx,
        ly: t.ly,
        mission: t.mission === 2 ? 'MOVE' : 'GUARD',
        missionQueue: t.missionQueue === -1 ? null : 'MOVE',
        missionTimer: t.missionTimer,
        isDriving: t.isDriving,
        headToLX: t.headToLX,
        headToLY: t.headToLY,
        hasNavCom: t.hasNavCom,
      })));
    }, { wasmSeed: 0 });
  }, 180_000);

  it('breaks equal-distance target ties in C++ Units.Count order', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 477);
      const cpp477 = await wasmHoundDogTarget(handle.wasm);
      const ts477 = await tsHoundDogTarget(handle.ts);

      expect(ts477.tick).toBe(cpp477.tick);
      expect(ts477.rngState >>> 0).toBe(cpp477.rngState >>> 0);
      expect(ts477.anchor).toEqual(cpp477.anchor);
      expect(ts477.target).toEqual(cpp477.target);
    }, { wasmSeed: 0 });
  }, 180_000);
});
