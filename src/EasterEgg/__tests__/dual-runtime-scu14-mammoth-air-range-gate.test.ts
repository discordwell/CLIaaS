/**
 * Dual-runtime check for SCU14 Mammoth secondary-weapon range timing.
 *
 * C++ UnitClass::AI runs Firing_AI before Rotation_AI for land units, and
 * `Direction(TarCom)` aims at the target object's Target_Coord. A Mammoth that
 * is tracking a helicopter must therefore aim at the height-adjusted aircraft
 * target coordinate, not the helicopter body center.
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

async function wasmForwardMammothState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const mammoth = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === '4TNK' &&
      row[2] === 'USSR' &&
      row[3] === 86 &&
      row[4] === 84);
    if (!mammoth) throw new Error('C++ SCU14EA forward Mammoth missing at cell (86,84)');
    const allEntities = [...(state.units ?? []), ...(state.enemies ?? [])];
    const mammothEntity = allEntities.find((entity: any) =>
      entity.t === '4TNK' &&
      entity.house === 'USSR' &&
      entity.cx === 86 &&
      entity.cy === 84);

    return {
      tick: state.tick,
      rngState: state.rngState,
      mammoth: {
        logicIndex: mammoth[0],
        type: mammoth[1],
        house: mammoth[2],
        mission: mammoth[7],
        missionTimer: mammoth[8],
        arm: mammoth[23],
        targetKind: mammoth[30],
        targetRtti: mammoth[32],
        targetIndex: mammoth[33],
        secondaryFacing: mammothEntity?.sf,
        desiredSecondaryFacing: mammothEntity?.sfd,
      },
    };
  });
}

async function tsForwardMammothState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mammoth = game.entities.find((entity: any) =>
      entity.id === 193 &&
      entity.type === '4TNK' &&
      entity.house === 'USSR');
    if (!mammoth) throw new Error('TS SCU14EA forward Mammoth id 193 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mammoth: {
        id: mammoth.id,
        logicIndex: mammoth.logicIndexHint,
        type: mammoth.type,
        house: mammoth.house,
        mission: mammoth.mission,
        missionTimer: mammoth.missionTimer,
        attackCooldown: mammoth.attackCooldown,
        isSecondShot: mammoth.isSecondShot,
        turretFacing256: mammoth.turretFacing256,
        desiredTurretFacing256: mammoth.desiredTurretFacing256,
        targetId: mammoth.target?.id ?? null,
        targetType: mammoth.target?.type ?? null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 Mammoth AA range gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not use same-tick turret rotation to fire MammothTusk early', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1092);
      const preFireCpp = await wasmForwardMammothState(handle.wasm);
      const preFireTs = await tsForwardMammothState(handle.ts);

      expect(preFireTs.tick).toBe(preFireCpp.tick);
      expect(preFireTs.rngState >>> 0).toBe(preFireCpp.rngState >>> 0);
      expect(preFireCpp.mammoth).toMatchObject({
        type: '4TNK',
        house: 'USSR',
        mission: 5,
        missionTimer: 19,
        arm: 0,
        targetKind: 1,
        secondaryFacing: 19,
        desiredSecondaryFacing: 19,
      });
      expect(preFireTs.mammoth).toMatchObject({
        type: preFireCpp.mammoth.type,
        house: preFireCpp.mammoth.house,
        mission: 'GUARD',
        missionTimer: preFireCpp.mammoth.missionTimer,
        attackCooldown: preFireCpp.mammoth.arm,
        isSecondShot: false,
        turretFacing256: preFireCpp.mammoth.secondaryFacing,
        desiredTurretFacing256: preFireCpp.mammoth.desiredSecondaryFacing,
        targetType: 'HELI',
      });

      await stepBoth(handle, 1);
      const fireCpp = await wasmForwardMammothState(handle.wasm);
      const fireTs = await tsForwardMammothState(handle.ts);

      expect(fireTs.tick).toBe(fireCpp.tick);
      expect(fireTs.rngState >>> 0).toBe(fireCpp.rngState >>> 0);
      expect(fireCpp.mammoth).toMatchObject({
        missionTimer: 18,
        arm: 2,
      });
      expect(fireTs.mammoth).toMatchObject({
        missionTimer: fireCpp.mammoth.missionTimer,
        attackCooldown: fireCpp.mammoth.arm,
        isSecondShot: true,
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
