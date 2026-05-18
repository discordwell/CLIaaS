/**
 * Dual-runtime check for CellClass::Overlap_Down discovery timing.
 *
 * In SCG23EA, a trigger reveal maps cells near the USSR E1 at (82,88), but
 * not the E1's center cell. C++ discovers that E1 during its own tick-1 guard
 * processing when the infantry overlap footprint is marked down into an
 * already-mapped cell. The later Spain C7 HUNT scanner then acquires it and
 * starts moving in the same tick.
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

async function wasmScg23Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const units = [...(state.units ?? []), ...(state.enemies ?? [])];
    const scanner = units.find((u: any) =>
      u.t === 'C7' && u.house === 'Spain' && u.cx === 97 && u.cy === 88);
    const target = units.find((u: any) =>
      u.t === 'E1' && u.house === 'USSR' && u.cx === 82 && u.cy === 88);
    if (!scanner) throw new Error('C++ SCG23EA Spain C7 scanner not found');
    if (!target) throw new Error('C++ SCG23EA USSR E1 target not found');
    return {
      tick: state.tick,
      scanner: {
        mission: scanner.m,
        missionTimer: scanner.mt,
        isDriving: scanner.drv === true,
        targetLX: scanner.tlx ?? null,
        targetLY: scanner.tly ?? null,
        navLX: scanner.nlx ?? null,
        navLY: scanner.nly ?? null,
      },
      target: {
        lx: target.lx,
        ly: target.ly,
        discoveredByPlayer: target.dp === true,
      },
    };
  }, undefined);
}

async function tsScg23Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const scanner = game.entities.find((e: any) =>
      e.type === 'C7' && e.house === 'Spain' && e.cell.cx === 97 && e.cell.cy === 88);
    const target = game.entities.find((e: any) =>
      e.type === 'E1' && e.house === 'USSR' && e.cell.cx === 82 && e.cell.cy === 88);
    if (!scanner) throw new Error('TS SCG23EA Spain C7 scanner not found');
    if (!target) throw new Error('TS SCG23EA USSR E1 target not found');
    return {
      tick: game.tick,
      scanner: {
        mission: scanner.mission,
        missionTimer: scanner.missionTimer,
        isDriving: scanner.isDriving === true,
        targetLX: scanner.target?.leptonX ?? null,
        targetLY: scanner.target?.leptonY ?? null,
        navLX: scanner.moveTarget?.lx ?? null,
        navLY: scanner.moveTarget?.ly ?? null,
      },
      target: {
        lx: target.leptonX,
        ly: target.leptonY,
        discoveredByPlayer: game.discoveredEntityIds.has(target.id),
      },
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 overlap discovery before HUNT', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('discovers the overlap-only E1 before the Spain C7 HUNT scan runs', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 1);
      const cpp = await wasmScg23Snapshot(handle.wasm);
      const ts = await tsScg23Snapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.target.discoveredByPlayer).toBe(true);
      expect(ts.target.discoveredByPlayer).toBe(cpp.target.discoveredByPlayer);
      expect(ts.scanner.mission).toBe('HUNT');
      expect(cpp.scanner.mission).toBe(14);
      expect(ts.scanner.missionTimer).toBe(cpp.scanner.missionTimer);
      expect(ts.scanner.isDriving).toBe(cpp.scanner.isDriving);
      expect(ts.scanner.targetLX).toBe(cpp.scanner.targetLX);
      expect(ts.scanner.targetLY).toBe(cpp.scanner.targetLY);
      expect(ts.scanner.navLX).toBe(cpp.scanner.navLX);
      expect(ts.scanner.navLY).toBe(cpp.scanner.navLY);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
