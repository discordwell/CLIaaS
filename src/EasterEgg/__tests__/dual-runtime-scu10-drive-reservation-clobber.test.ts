/**
 * Dual-runtime check for DriveClass reservation bit lifetime.
 *
 * C++ UnitClass::Start_Driver reserves track cells by setting the same
 * CellClass::Flag.Occupy.Vehicle bit used by normal Place_Down/Pick_Up.
 * While_Moving does not re-run Mark_Track every tick, so another vehicle's
 * physical Pick_Up can clear a stale reservation bit. SCU10EA's BadGuy tank
 * column exposes this before the Turkey HOUND_DOG convoy diverges: the followed
 * 3TNK starts moving west on tick 469 in C++ once the reservation bit has been
 * clobbered, but a stricter owner-tracked TS reservation keeps it blocked.
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

async function wasmFollowedTankSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((t: any) => t.cls === 'conv2');
    const tanks = [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((u: any) => u.t === '3TNK' && u.house === 'BadGuy');
    if (!team) throw new Error('C++ SCU10EA conv2 team not found');
    const tank = tanks.find((u: any) => u.lx === team.tgtX && u.ly === team.tgtY);
    if (!tank) throw new Error('C++ SCU10EA followed 3TNK not found');
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
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
        head: tank.hlx === undefined ? null : { lx: tank.hlx, ly: tank.hly },
      },
    };
  }, undefined);
}

async function tsFollowedTankSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const team = (window as any).__agentTeams?.().find((t: any) => t.typeName === 'conv2');
    if (!team) throw new Error('TS SCU10EA conv2 team not found');
    const tanks = game.entities
      .filter((e: any) => e.alive !== false && e.type === '3TNK' && e.house === 'BadGuy');
    const tank = tanks
      .map((e: any) => ({
        entity: e,
        dist: Math.abs(e.leptonX - team.zoneLeptonX) + Math.abs(e.leptonY - team.zoneLeptonY),
      }))
      .sort((a: any, b: any) => a.dist - b.dist)[0]?.entity;
    if (!tank) throw new Error('TS SCU10EA followed 3TNK not found');
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
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        head: tank.headToLX > 0 ? { lx: tank.headToLX, ly: tank.headToLY } : null,
      },
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 DriveClass reservation bits', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not keep stale owner-tracked reservations blocking a moving tank', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 469);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmFollowedTankSnapshot(handle.wasm);
      const ts = await tsFollowedTankSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toEqual({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'MOVE',
        missionTimer: cpp.tank.missionTimer,
        isDriving: cpp.tank.isDriving,
        nav: cpp.tank.nav,
        head: cpp.tank.head,
      });
    }, { wasmSeed: 0 });
  }, 240_000);
});
