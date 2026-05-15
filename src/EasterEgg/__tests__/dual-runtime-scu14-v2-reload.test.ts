/**
 * Dual-runtime check for UnitClass::Reload_AI on V2 launchers.
 *
 * SCU14EA has a stationary USSR V2RL that fires once at scenario start, waits
 * for UnitClass::Reload to expire, reloads one rocket, and fires again at a
 * visible Allied tank. TS must model the reload timer so the second FROG/SCUD
 * exists in logic before its splash damage RNG at tick 473.
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

type CellFilter = { cx: number; cy: number };

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmV2State(adapter: unknown, cell?: CellFilter) {
  return adapterPage(adapter).evaluate((cell) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const v2 = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) =>
        u.t === 'V2RL' &&
        u.house === 'USSR' &&
        (!cell || (u.cx === cell.cx && u.cy === cell.cy)));
    if (!v2) throw new Error('C++ SCU14EA USSR V2RL missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      v2: {
        id: v2.id,
        cell: { cx: v2.cx, cy: v2.cy },
        mission: v2.m,
        missionTimer: v2.mt,
        attackCooldown: v2.arm,
        ammo: v2.ammo,
        target: { lx: v2.tlx, ly: v2.tly },
      },
      frogs: (state.bullets ?? [])
        .filter((b: any) => b.type === 'FROG' && b.pb === v2.id)
        .map((b: any) => ({
          fuseTarget: { lx: b.fx, ly: b.fy },
          timer: b.timer,
          strength: b.str,
        })),
    };
  }, cell);
}

async function tsV2State(adapter: unknown, cell?: CellFilter) {
  return adapterPage(adapter).evaluate((cell) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const v2 = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'V2RL' &&
      e.house === 'USSR' &&
      (!cell || (e.cell?.cx === cell.cx && e.cell?.cy === cell.cy)));
    if (!v2) throw new Error('TS SCU14EA USSR V2RL missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      v2: {
        id: v2.id,
        cell: { cx: v2.cell?.cx, cy: v2.cell?.cy },
        mission: v2.mission,
        missionTimer: v2.missionTimer,
        attackCooldown: v2.attackCooldown,
        ammo: v2.ammo,
        target: v2.target ? { lx: v2.target.leptonX, ly: v2.target.leptonY } : null,
      },
      scuds: (game.inflightProjectiles ?? [])
        .filter((p: any) => p.weapon.name === 'SCUD' && p.attackerId === v2.id)
        .map((p: any) => ({
          fuseTarget: { lx: p.headToLX, ly: p.headToLY },
          timer: p.fuseTimer,
          strength: p.strength,
        })),
    };
  }, cell);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 V2 reload', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reloads the stationary V2 and launches the second SCUD on the C++ tick', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 451);
      const reloadedCpp = await wasmV2State(handle.wasm);
      const reloadedTs = await tsV2State(handle.ts);

      expect(reloadedTs.tick).toBe(reloadedCpp.tick);
      expect(reloadedTs.rngState >>> 0).toBe(reloadedCpp.rngState >>> 0);
      expect(reloadedCpp.v2.ammo).toBe(1);
      expect(reloadedTs.v2.ammo).toBe(1);
      expect(reloadedTs.v2.attackCooldown).toBe(reloadedCpp.v2.attackCooldown);
      expect(reloadedCpp.frogs).toHaveLength(0);
      expect(reloadedTs.scuds).toHaveLength(0);

      await stepBoth(handle, 1);
      const firedCpp = await wasmV2State(handle.wasm);
      const firedTs = await tsV2State(handle.ts);

      expect(firedTs.tick).toBe(firedCpp.tick);
      expect(firedTs.rngState >>> 0).toBe(firedCpp.rngState >>> 0);
      expect(firedCpp.v2.ammo).toBe(0);
      expect(firedTs.v2.ammo).toBe(0);
      expect(firedTs.v2.attackCooldown).toBe(firedCpp.v2.attackCooldown);
      expect(firedCpp.frogs).toHaveLength(1);
      expect(firedTs.scuds).toHaveLength(1);
      expect(firedTs.scuds[0].fuseTarget).toEqual(firedCpp.frogs[0].fuseTarget);
      expect(firedTs.scuds[0].strength).toBe(firedCpp.frogs[0].strength);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('stationary guard V2 fires immediately after guard scan instead of taking stale setup delay', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const targetCell = { cx: 89, cy: 84 };
      await stepBoth(handle, 657);
      const readyCpp = await wasmV2State(handle.wasm, targetCell);
      const readyTs = await tsV2State(handle.ts, targetCell);

      expect(readyTs.tick).toBe(readyCpp.tick);
      expect(readyTs.rngState >>> 0).toBe(readyCpp.rngState >>> 0);
      expect(readyCpp.v2.attackCooldown).toBe(0);
      expect(readyTs.v2.attackCooldown).toBe(0);
      expect(readyCpp.v2.ammo).toBe(1);
      expect(readyTs.v2.ammo).toBe(1);
      expect(readyCpp.frogs).toHaveLength(0);
      expect(readyTs.scuds).toHaveLength(0);

      await stepBoth(handle, 1);
      const firedCpp = await wasmV2State(handle.wasm, targetCell);
      const firedTs = await tsV2State(handle.ts, targetCell);

      expect(firedTs.tick).toBe(firedCpp.tick);
      expect(firedTs.rngState >>> 0).toBe(firedCpp.rngState >>> 0);
      expect(firedCpp.v2.ammo).toBe(0);
      expect(firedTs.v2.ammo).toBe(0);
      expect(firedTs.v2.attackCooldown).toBe(firedCpp.v2.attackCooldown);
      expect(firedTs.v2.target).toEqual(firedCpp.v2.target);
      expect(firedCpp.frogs).toHaveLength(1);
      expect(firedTs.scuds).toHaveLength(1);
      expect(firedTs.scuds[0].fuseTarget).toEqual(firedCpp.frogs[0].fuseTarget);
      expect(firedTs.scuds[0].strength).toBe(firedCpp.frogs[0].strength);
    }, { wasmSeed: 0 });
  }, 300_000);
});
