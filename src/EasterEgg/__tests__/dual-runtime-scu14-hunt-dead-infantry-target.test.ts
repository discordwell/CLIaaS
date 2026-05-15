/**
 * Dual-runtime check for full-map HUNT scans seeing active dead infantry.
 *
 * C++ TechnoClass::Greatest_Threat scans Map.Layer[LAYER_GROUND] and does not
 * reject zero-strength objects during Evaluate_Object. If an active infantry
 * death animation wins the score, TechnoClass::Assign_Target then clears TarCom
 * and Target_Something_Nearby returns false without retrying lower-value live
 * targets. SCU14EA exposes this when a Greek 2TNK's HUNT timer fires while a
 * nearby Soviet E1 corpse is still active; TS must not skip that object and
 * acquire the farther live 4TNK instead.
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

async function wasmHuntTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835019);
    const live4Tnk = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835009);
    if (!tank) throw new Error('C++ SCU14EA Greek 2TNK 1835019 missing');
    if (!live4Tnk) throw new Error('C++ SCU14EA Soviet 4TNK 1835009 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cx,
        cy: tank.cy,
        lx: tank.lx,
        ly: tank.ly,
        mission: tank.m,
        missionTimer: tank.mt,
        isDriving: tank.drv === true,
        target: tank.tlx === undefined ? null : { lx: tank.tlx, ly: tank.tly },
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
      },
      live4Tnk: {
        cx: live4Tnk.cx,
        cy: live4Tnk.cy,
        sameZone: live4Tnk.sameZone,
        targetOwnedPlayer: live4Tnk.op,
        targetDiscovered: live4Tnk.dp,
      },
    };
  });
}

async function tsHuntTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 101);
    if (!tank) throw new Error('TS SCU14EA Greek 2TNK 101 missing');
    const deadInfantry = game.entities.find((e: any) =>
      e.type === 'E1' &&
      e.house === 'USSR' &&
      e.alive === false &&
      e.inLimbo !== true &&
      e.cell.cx >= 88 &&
      e.cell.cx <= 96 &&
      e.cell.cy >= 76 &&
      e.cell.cy <= 84);
    const live4Tnk = game.entities.find((e: any) => e.id === 91);

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        isDriving: tank.isDriving === true,
        target: tank.target ? {
          id: tank.target.id,
          type: tank.target.type,
          cx: tank.target.cell.cx,
          cy: tank.target.cell.cy,
        } : null,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
      },
      deadInfantry: deadInfantry ? {
        id: deadInfantry.id,
        hp: deadInfantry.hp,
        cx: deadInfantry.cell.cx,
        cy: deadInfantry.cell.cy,
        mission: deadInfantry.mission,
        inLimbo: deadInfantry.inLimbo === true,
      } : null,
      live4Tnk: live4Tnk ? {
        id: live4Tnk.id,
        alive: live4Tnk.alive,
        hp: live4Tnk.hp,
        cx: live4Tnk.cell.cx,
        cy: live4Tnk.cell.cy,
      } : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 HUNT scan zero-strength infantry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not look past an active dead infantry target to acquire the live 4TNK', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 260);
      const cpp = await wasmHuntTank(handle.wasm);
      const ts = await tsHuntTank(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toMatchObject({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        mission: 'HUNT',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        nav: cpp.tank.nav,
      });

      expect(cpp.live4Tnk).toMatchObject({
        cx: 91,
        cy: 81,
        sameZone: 1,
        targetOwnedPlayer: true,
        targetDiscovered: true,
      });
      expect(ts.live4Tnk).toMatchObject({
        id: 91,
        alive: true,
        cx: 91,
        cy: 81,
      });
      expect(ts.deadInfantry).toMatchObject({
        hp: 0,
        mission: 'DIE',
        inLimbo: false,
      });

      expect(cpp.tank.target).toBeNull();
      expect(ts.tank.target).toBeNull();
    }, { wasmSeed: 0 });
  }, 300_000);
});
