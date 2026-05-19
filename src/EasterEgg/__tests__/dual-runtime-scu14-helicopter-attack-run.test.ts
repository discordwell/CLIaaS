/**
 * Dual-runtime check for SCU14 helicopter attack-run timing.
 *
 * The `air1` Longbow reaches its selected attack location near tick 1036.
 * C++ decides the FLY_TO_POSITION -> FIRE_AT_TARGET transition from the
 * pre-move Process_Fly_To distance and only turns SecondaryFacing while
 * approaching. TS must not advance the status from a post-move distance or
 * overwrite PrimaryFacing.Desired in that state.
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

async function wasmAir1AttackRunState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const heli = (state.logicLayer ?? []).find((row: any[]) => row[6] === 65542);
    if (!heli) throw new Error('C++ SCU14EA air1 HELI aid 65542 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        logicIndex: heli[0],
        type: heli[1],
        house: heli[2],
        mission: heli[7],
        missionTimer: heli[8],
        status: heli[27],
        lx: heli[12],
        ly: heli[13],
        primaryCurrent: heli[28],
        primaryDesired: heli[29],
        targetKind: heli[30],
        targetIndex: heli[33],
        height: heli[38],
      },
    };
  });
}

async function tsAir1AttackRunState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const heli = game.entities.find((entity: any) =>
      entity.id === 205 &&
      entity.type === 'HELI' &&
      entity.house === 'Greece');
    if (!heli) throw new Error('TS SCU14EA air1 HELI id 205 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        logicIndex: heli.logicIndexHint,
        type: heli.type,
        house: heli.house,
        mission: heli.mission,
        missionTimer: heli.missionTimer,
        status: heli.aircraftAttackStatus,
        lx: heli.leptonX,
        ly: heli.leptonY,
        primaryCurrent: heli.facing256,
        primaryDesired: heli.desiredFacing256,
        secondaryCurrent: heli.turretFacing256,
        secondaryDesired: heli.desiredTurretFacing256,
        targetId: heli.target?.id ?? null,
        height: heli.aircraftHeightLeptons,
      },
    };
  });
}

async function wasmHeliStateByAid(adapter: unknown, aid: number) {
  return adapterPage(adapter).evaluate((targetAid: number) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const heli = (state.logicLayer ?? []).find((row: any[]) => row[6] === targetAid);
    const detail = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((unit: any) => unit.id === targetAid);
    if (!heli) throw new Error(`C++ SCU14EA HELI aid ${targetAid} missing`);
    if (!detail) throw new Error(`C++ SCU14EA HELI aid ${targetAid} detail missing`);

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        logicIndex: heli[0],
        type: heli[1],
        house: heli[2],
        mission: heli[7],
        missionTimer: heli[8],
        arm: heli[23],
        ammo: detail.ammo,
        status: heli[27],
        lx: heli[12],
        ly: heli[13],
        primaryCurrent: heli[28],
        primaryDesired: heli[29],
        targetKind: heli[30],
        targetIndex: heli[33],
        height: heli[38],
      },
    };
  }, aid);
}

async function tsHeliStateById(adapter: unknown, id: number) {
  return adapterPage(adapter).evaluate((targetId: number) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const heli = game.entities.find((entity: any) =>
      entity.id === targetId &&
      entity.type === 'HELI' &&
      entity.house === 'Greece');
    if (!heli) throw new Error(`TS SCU14EA HELI id ${targetId} missing`);

    return {
      tick: state.tick,
      rngState: state.rngState,
      heli: {
        id: heli.id,
        logicIndex: heli.logicIndexHint,
        type: heli.type,
        house: heli.house,
        mission: heli.mission,
        missionTimer: heli.missionTimer,
        attackCooldown: heli.attackCooldown,
        ammo: heli.ammo,
        isSecondShot: heli.isSecondShot,
        status: heli.aircraftAttackStatus,
        lx: heli.leptonX,
        ly: heli.leptonY,
        primaryCurrent: heli.facing256,
        primaryDesired: heli.desiredFacing256,
        secondaryCurrent: heli.turretFacing256,
        secondaryDesired: heli.desiredTurretFacing256,
        targetId: heli.target?.id ?? null,
        height: heli.aircraftHeightLeptons,
      },
    };
  }, id);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 helicopter attack run', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the air1 Longbow attack status and Mission_Attack RNG aligned at tick 1036', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1036);
      const cpp = await wasmAir1AttackRunState(handle.wasm);
      const ts = await tsAir1AttackRunState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 1,
        missionTimer: 13,
      });
      expect(ts.heli).toMatchObject({
        type: cpp.heli.type,
        house: cpp.heli.house,
        mission: 'ATTACK',
        missionTimer: cpp.heli.missionTimer,
        status: cpp.heli.status,
        lx: cpp.heli.lx,
        ly: cpp.heli.ly,
        primaryCurrent: cpp.heli.primaryCurrent,
        primaryDesired: cpp.heli.primaryDesired,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('restarts the air1 Longbow at full flight speed for the next attack run', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1123);
      const cpp = await wasmAir1AttackRunState(handle.wasm);
      const ts = await tsAir1AttackRunState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 1,
        missionTimer: 13,
      });
      expect(ts.heli).toMatchObject({
        type: cpp.heli.type,
        house: cpp.heli.house,
        mission: 'ATTACK',
        missionTimer: cpp.heli.missionTimer,
        status: cpp.heli.status,
        lx: cpp.heli.lx,
        ly: cpp.heli.ly,
        primaryCurrent: cpp.heli.primaryCurrent,
        primaryDesired: cpp.heli.primaryDesired,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps Longbow two-shooter rearm cadence aligned through the Hellfire pair', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1139);
      const firstCpp = await wasmHeliStateByAid(handle.wasm, 65544);
      const firstTs = await tsHeliStateById(handle.ts, 207);

      expect(firstTs.tick).toBe(firstCpp.tick);
      expect(firstTs.rngState >>> 0).toBe(firstCpp.rngState >>> 0);
      expect(firstCpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 5,
        arm: 2,
      });
      expect(firstTs.heli).toMatchObject({
        type: firstCpp.heli.type,
        house: firstCpp.heli.house,
        mission: 'ATTACK',
        missionTimer: firstCpp.heli.missionTimer,
        status: firstCpp.heli.status,
        attackCooldown: firstCpp.heli.arm,
        isSecondShot: true,
      });

      await stepBothInChunks(handle, 17);
      const secondCpp = await wasmHeliStateByAid(handle.wasm, 65544);
      const secondTs = await tsHeliStateById(handle.ts, 207);

      expect(secondTs.tick).toBe(secondCpp.tick);
      expect(secondTs.rngState >>> 0).toBe(secondCpp.rngState >>> 0);
      expect(secondCpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 4,
        missionTimer: 14,
        arm: 59,
      });
      expect(secondTs.heli).toMatchObject({
        type: secondCpp.heli.type,
        house: secondCpp.heli.house,
        mission: 'ATTACK',
        missionTimer: secondCpp.heli.missionTimer,
        status: secondCpp.heli.status,
        attackCooldown: secondCpp.heli.arm,
        isSecondShot: false,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('does not fire on the tick C++ exposes a post-dispatch Arm value of zero', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1205);
      const readyCpp = await wasmHeliStateByAid(handle.wasm, 65543);
      const readyTs = await tsHeliStateById(handle.ts, 206);

      expect(readyTs.tick).toBe(readyCpp.tick);
      expect(readyTs.rngState >>> 0).toBe(readyCpp.rngState >>> 0);
      expect(readyCpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 4,
        arm: 0,
        ammo: 4,
      });
      expect(readyTs.heli).toMatchObject({
        type: readyCpp.heli.type,
        house: readyCpp.heli.house,
        mission: 'ATTACK',
        missionTimer: readyCpp.heli.missionTimer,
        status: readyCpp.heli.status,
        attackCooldown: readyCpp.heli.arm,
        ammo: readyCpp.heli.ammo,
      });

      await stepBoth(handle, 1);
      const firedCpp = await wasmHeliStateByAid(handle.wasm, 65543);
      const firedTs = await tsHeliStateById(handle.ts, 206);

      expect(firedTs.tick).toBe(firedCpp.tick);
      expect(firedTs.rngState >>> 0).toBe(firedCpp.rngState >>> 0);
      expect(firedCpp.heli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        mission: 1,
        status: 5,
        arm: 2,
        ammo: 3,
      });
      expect(firedTs.heli).toMatchObject({
        type: firedCpp.heli.type,
        house: firedCpp.heli.house,
        mission: 'ATTACK',
        missionTimer: firedCpp.heli.missionTimer,
        status: firedCpp.heli.status,
        attackCooldown: firedCpp.heli.arm,
        ammo: firedCpp.heli.ammo,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
