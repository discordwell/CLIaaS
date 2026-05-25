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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
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
    const shooter = yaks.find((y: any) => y.cx === 68 && y.cy === 58 && y.status === 3);
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
    const shooter = yaks.find((y: any) => y.cx === 68 && y.cy === 58 && y.status === 3);
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

type DisplayCellProbe = {
  cx: number;
  cy: number;
  mapped: boolean;
  visible: boolean;
};

type YakDiscoveryProbe = {
  cx: number;
  cy: number;
  discoveredByPlayer: boolean;
  mapped: boolean;
  visible: boolean;
};

const YAK_FIRE_REVEAL_CELLS: Array<[number, number]> = [
  [74, 62],
  [74, 63],
  [73, 64],
  [74, 64],
  [74, 65],
];

async function wasmYakFireRevealSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((cells: Array<[number, number]>) => {
    const M = (window as any).Module;
    const state = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
    const yaks = [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((u: any) => u.t === 'YAK' && u.house === 'BadGuy' && u.cx === 70 && (u.cy === 60 || u.cy === 61))
      .map((u: any) => ({
        cx: u.cx,
        cy: u.cy,
        discoveredByPlayer: u.dp === true,
        mapped: u.map === true,
        visible: u.vis === true,
      }))
      .sort((a: YakDiscoveryProbe, b: YakDiscoveryProbe) => a.cy - b.cy);
    const displayCells = cells.map(([cx, cy]) => {
      const cell = JSON.parse(M.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [cx, cy, -1]));
      return { cx, cy, mapped: cell.mapped === true, visible: cell.visible === true };
    });
    return { tick: state.tick, rngState: state.rngState, yaks, displayCells };
  }, YAK_FIRE_REVEAL_CELLS);
}

async function tsYakFireRevealSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((cells: Array<[number, number]>) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const yaks = game.entities
      .filter((e: any) => e.type === 'YAK' && e.house === 'BadGuy' && e.alive && e.cell.cx === 70 && (e.cell.cy === 60 || e.cell.cy === 61))
      .map((e: any) => {
        const display = game.map.getDisplayVisibility(e.cell.cx, e.cell.cy);
        return {
          cx: e.cell.cx,
          cy: e.cell.cy,
          discoveredByPlayer: game.discoveredEntityIds.has(e.id),
          mapped: display > 0,
          visible: display === 2,
        };
      })
      .sort((a: YakDiscoveryProbe, b: YakDiscoveryProbe) => a.cy - b.cy);
    const displayCells = cells.map(([cx, cy]) => {
      const display = game.map.getDisplayVisibility(cx, cy);
      return { cx, cy, mapped: display > 0, visible: display === 2 };
    });
    return { tick: game.tick, rngState: state.rngState, yaks, displayCells };
  }, YAK_FIRE_REVEAL_CELLS);
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

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let remaining = ticks;
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
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
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('maps hidden fixed-wing shooter Fire_At cells without discovering the airborne YAKs', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1600);
      const cpp = await wasmYakFireRevealSnapshot(handle.wasm);
      const ts = await tsYakFireRevealSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.yaks).toEqual(cpp.yaks);
      expect(cpp.yaks).toHaveLength(2);
      expect(cpp.yaks.every((yak: YakDiscoveryProbe) => yak.visible && yak.mapped && !yak.discoveredByPlayer)).toBe(true);
      expect(ts.displayCells).toEqual(cpp.displayCells);
      expect(cpp.displayCells).toEqual([
        { cx: 74, cy: 62, mapped: true, visible: true },
        { cx: 74, cy: 63, mapped: true, visible: true },
        { cx: 73, cy: 64, mapped: true, visible: true },
        { cx: 74, cy: 64, mapped: true, visible: false },
        { cx: 74, cy: 65, mapped: true, visible: false },
      ] satisfies DisplayCellProbe[]);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
