/**
 * Dual-runtime check for BulletClass launch inaccuracy on fixed-wing guns.
 *
 * In SCG04EA, a moving YAK fires ChainGun at a coordinate target around tick
 * 1440. C++ still has FootClass::IsDriving=false for fixed-wing attack flight,
 * so BulletClass::Unlimbo does not apply moving-platform scatter; only the two
 * invisible bullets scatter when they detonate. Treating physical aircraft
 * movement as IsDriving adds a third RNG call and desynchronizes the mission.
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

async function wasmYakSnapshot(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const yaks = state.logicLayer
      .filter((r: any[]) => r[5] === 'A' && r[1] === 'YAK' && r[2] === 'BadGuy')
      .map((r: any[]) => ({
        logicIndex: r[0],
        cx: r[3],
        cy: r[4],
        mission: r[7],
        missionTimer: r[8],
        isDriving: r[10],
        lx: r[12],
        ly: r[13],
        arm: r[23],
        status: r[27],
        firex: r[34],
        firey: r[35],
      }));
    const shooter = yaks.find((y: any) => y.logicIndex === 112);
    if (!shooter) throw new Error('C++ SCG04EA YAK shooter not found');
    return { tick: state.tick, rngState: state.rngState, shooter, yaks };
  });
}

async function tsYakSnapshot(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const game = (window as any).__agentGame;
    const yaks = game.entities
      .filter((e: any) => e.type === 'YAK' && e.house === 'BadGuy' && e.alive)
      .map((e: any) => ({
        id: e.id,
        hint: e.logicIndexHint,
        cx: e.cell.cx,
        cy: e.cell.cy,
        mission: e.mission,
        missionTimer: e.missionTimer,
        isDriving: e.isDriving,
        lx: e.leptonX,
        ly: e.leptonY,
        arm: e.attackCooldown,
        status: e.aircraftAttackStatus,
      }));
    const shooter = yaks.find((y: any) => y.hint === 55);
    if (!shooter) throw new Error('TS SCG04EA YAK shooter not found');
    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      shooter,
      projectileCount: game.inflightProjectiles.length,
      yaks,
    };
  });
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04EA YAK ChainGun scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not treat fixed-wing attack movement as IsDriving launch scatter', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 1439);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBoth(handle, 1);

      const cpp = await wasmYakSnapshot(handle.wasm);
      const ts = await tsYakSnapshot(handle.ts);
      expect(cpp.shooter).toMatchObject({
        cx: 68,
        cy: 58,
        isDriving: false,
        status: 3,
      });
      expect(ts.shooter).toMatchObject({
        cx: 68,
        cy: 58,
        isDriving: false,
        status: 3,
      });
      expect(ts.projectileCount).toBe(0);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
