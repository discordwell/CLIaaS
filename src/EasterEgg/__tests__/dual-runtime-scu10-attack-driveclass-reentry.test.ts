/**
 * Dual-runtime check for UnitClass::AI running DriveClass::AI after ATTACK.
 *
 * C++ UnitClass::AI always calls DriveClass::AI after MissionClass::AI. In
 * SCU10EA a BadGuy 3TNK is in MISSION_ATTACK with a live NavCom/path toward
 * its target; when Mission_Attack's timer fires, DriveClass::AI still rotates
 * the hull that same tick and starts the track on schedule. Skipping the
 * post-handler drive pass leaves TS one rotation tick late and eventually
 * misses Mission_Move's RNG dispatch.
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

async function wasmBadGuyAttackTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835021);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK not found');
    return {
      tick: state.tick,
      cx: tank.cx,
      cy: tank.cy,
      lx: tank.lx,
      ly: tank.ly,
      mission: tank.m,
      missionQueue: tank.mq,
      missionTimer: tank.mt,
      isDriving: tank.drv === true,
      headToLX: tank.hlx ?? 0,
      headToLY: tank.hly ?? 0,
    };
  }, undefined);
}

async function tsBadGuyAttackTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const tank = game.entities.find((e: any) => e.id === 93);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK not found');
    return {
      tick: game.tick,
      cx: tank.cell.cx,
      cy: tank.cell.cy,
      lx: tank.leptonX,
      ly: tank.leptonY,
      mission: tank.mission,
      missionQueue: tank.missionQueue,
      missionTimer: tank.missionTimer,
      isDriving: tank.isDriving === true,
      headToLX: tank.headToLX,
      headToLY: tank.headToLY,
    };
  }, undefined);
}

async function wasmBadGuyMoveScanTanks(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tanks = ((state.logicLayer ?? []) as any[][])
      .filter((row) => row[0] === 290 || row[0] === 291)
      .map((row) => ({
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10],
        targetRtti: row[32],
        targetObjectIndex: row[33],
        canFire0: row[37],
        arm: row[23],
      }));
    if (tanks.length !== 2) throw new Error('C++ SCU10EA BadGuy 3TNK pair not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tanks,
    };
  }, undefined);
}

async function tsBadGuyMoveScanTanks(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tanks = game.entities
      .filter((entity: any) => entity.logicIndexHint === 290 || entity.logicIndexHint === 291)
      .map((entity: any) => ({
        logicIndex: entity.logicIndexHint,
        type: entity.type,
        house: entity.house,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        isDriving: entity.isDriving,
        targetLogicIndex: entity.target?.logicIndexHint ?? null,
        targetType: entity.target?.type ?? null,
        targetHouse: entity.target?.house ?? null,
        attackCooldown: entity.attackCooldown,
      }));
    if (tanks.length !== 2) throw new Error('TS SCU10EA BadGuy 3TNK pair not found');
    return {
      tick: game.tick,
      rngState: state.rngState,
      tanks,
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 attack DriveClass re-entry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('continues DriveClass rotation/movement after a vehicle Mission_Attack timer fires', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 314);
      const cpp314 = await wasmBadGuyAttackTank(handle.wasm);
      const ts314 = await tsBadGuyAttackTank(handle.ts);

      expect(ts314).toEqual({
        ...cpp314,
        mission: 'ATTACK',
        missionQueue: null,
      });
      expect(cpp314.mission).toBe(1);
      expect(cpp314.missionQueue).toBe(-1);

      await stepBoth(handle, 19);
      const cpp333 = await wasmBadGuyAttackTank(handle.wasm);
      const ts333 = await tsBadGuyAttackTank(handle.ts);

      expect(ts333).toEqual({
        ...cpp333,
        mission: 'MOVE',
        missionQueue: null,
      });
      expect(cpp333.mission).toBe(2);
      expect(cpp333.missionQueue).toBe(-1);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('skips Mission_Move target scan for PlayerControl houses', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 214);
      const cpp214 = await wasmBadGuyMoveScanTanks(handle.wasm);
      const ts214 = await tsBadGuyMoveScanTanks(handle.ts);

      expect(cpp214.tanks).toEqual([
        expect.objectContaining({ logicIndex: 290, type: '3TNK', house: 'BadGuy', targetRtti: -1, targetObjectIndex: -1 }),
        expect.objectContaining({ logicIndex: 291, type: '3TNK', house: 'BadGuy', targetRtti: -1, targetObjectIndex: -1 }),
      ]);
      expect(ts214.tanks).toEqual([
        expect.objectContaining({ logicIndex: 290, type: '3TNK', house: 'BadGuy', targetLogicIndex: null }),
        expect.objectContaining({ logicIndex: 291, type: '3TNK', house: 'BadGuy', targetLogicIndex: null }),
      ]);

      await stepBoth(handle, 1);
      const cpp215 = await wasmBadGuyMoveScanTanks(handle.wasm);
      const ts215 = await tsBadGuyMoveScanTanks(handle.ts);

      expect(ts215.tick).toBe(cpp215.tick);
      expect(ts215.rngState >>> 0).toBe(cpp215.rngState >>> 0);
      expect(ts215.tanks).toEqual([
        expect.objectContaining({ logicIndex: 290, targetLogicIndex: null, attackCooldown: 0 }),
        expect.objectContaining({ logicIndex: 291, targetLogicIndex: null, attackCooldown: 0 }),
      ]);
    }, { wasmSeed: 0 });
  }, 300_000);
});
