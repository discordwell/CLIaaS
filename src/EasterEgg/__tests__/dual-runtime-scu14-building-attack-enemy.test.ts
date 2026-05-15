/**
 * Dual-runtime check for BuildingClass::Take_Damage house enemy recording.
 *
 * In SCU14EA, Soviet fire has damaged Greece-owned buildings before the Greek
 * 2TNK at C++ logic id 1835022 performs its tick-235 HUNT scan. C++ records the
 * source house as House->LAEnemy and, because it is not allied, House->Enemy.
 * TechnoClass::Evaluate_Object then applies the designated-enemy bonus while
 * choosing the nearby Soviet E1. TS used to leave the persistent house enemy
 * unset, so the same 2TNK preferred a farther 4TNK and began driving, which
 * later caused the tick-251 projectile scatter RNG divergence.
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

async function wasmScu14Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const house = state.houses.find((h: any) => h.house === 'Greece');
    const row = state.logicLayer.find((r: any[]) => r[6] === 1835022);
    if (!house) throw new Error('C++ SCU14EA Greece house state missing');
    if (!row) throw new Error('C++ SCU14EA Greek 2TNK logic row missing');

    const targetRtti = row[32];
    const targetIndex = row[33];
    const targetRow = targetRtti >= 0 && targetIndex >= 0
      ? state.logicLayer.find((r: any[]) => r[6] === ((targetRtti << 16) + targetIndex))
      : null;

    return {
      tick: state.tick,
      greece: {
        lastAttackerEnemy: house.laenemy,
      },
      tank: {
        mission: row[7],
        isDriving: row[10] === true,
        lx: row[12],
        ly: row[13],
        targetLX: row[21],
        targetLY: row[22],
        targetType: targetRow?.[1] ?? null,
        targetHouse: targetRow?.[2] ?? null,
        targetCell: targetRow ? { cx: targetRow[3], cy: targetRow[4] } : null,
      },
    };
  });
}

async function tsScu14Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const tank = game.entities.find((e: any) => e.id === 104)
      ?? game.entities.find((e: any) =>
        e.type === '2TNK' && e.house === 'Greece' && e.cell.cx === 92 && e.cell.cy === 76);
    if (!tank) throw new Error('TS SCU14EA Greek 2TNK missing');
    const greece = game.aiStates.get('Greece');
    if (!greece) throw new Error('TS SCU14EA Greece AI state missing');

    return {
      tick: game.tick,
      greece: {
        lastAttackerEnemy: greece.lastAttackerEnemy ?? null,
        designatedEnemy: greece.designatedEnemy ?? null,
      },
      tank: {
        mission: tank.mission,
        isDriving: tank.isDriving === true,
        lx: tank.leptonX,
        ly: tank.leptonY,
        targetLX: tank.target?.leptonX ?? 0,
        targetLY: tank.target?.leptonY ?? 0,
        targetType: tank.target?.type ?? null,
        targetHouse: tank.target?.house ?? null,
        targetCell: tank.target ? { cx: tank.target.cell.cx, cy: tank.target.cell.cy } : null,
        moveTarget: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 building attack sets house enemy', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses the building attacker as the designated enemy for the tick-235 HUNT target scan', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 235);
      const cpp = await wasmScu14Snapshot(handle.wasm);
      const ts = await tsScu14Snapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.greece.lastAttackerEnemy).toBe('USSR');
      expect(ts.greece.lastAttackerEnemy).toBe(cpp.greece.lastAttackerEnemy);
      expect(ts.greece.designatedEnemy).toBe(cpp.greece.lastAttackerEnemy);

      expect(cpp.tank.mission).toBe(14);
      expect(ts.tank.mission).toBe('HUNT');
      expect(cpp.tank.targetType).toBe('E1');
      expect(cpp.tank.targetHouse).toBe('USSR');
      expect(ts.tank.targetType).toBe(cpp.tank.targetType);
      expect(ts.tank.targetHouse).toBe(cpp.tank.targetHouse);
      expect(ts.tank.targetCell).toEqual(cpp.tank.targetCell);
      expect(ts.tank.targetLX).toBe(cpp.tank.targetLX);
      expect(ts.tank.targetLY).toBe(cpp.tank.targetLY);
      expect(ts.tank.isDriving).toBe(cpp.tank.isDriving);
      expect(ts.tank.moveTarget).toBeNull();
    }, { wasmSeed: 0 });
  }, 300_000);
});
