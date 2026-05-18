/**
 * Dual-runtime check for FootClass::Approach_Target movement-zone passability.
 *
 * SCU35EA starts several Greek E3 infantry on HUNT against a USSR BADR. The E3
 * primary warhead has Wall=yes, so C++ gives it MZONE_DESTROYER and
 * Approach_Target accepts wall overlay cells through CellClass::Is_Clear_To_Move.
 * If TS filters the sweep with ordinary terrain passability, it skips the wall
 * cell C++ chooses and diverges before the later firing RNG.
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
  evaluate<T>(fn: (...args: any[]) => T, arg?: unknown): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmGreekE3Snapshot(adapter: unknown, logicIndex = 99) {
  return adapterPage(adapter).evaluate((hint: number) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === hint);
    if (!row) throw new Error(`C++ SCU35EA Greek E3 logic ${hint} missing`);

    const infantry = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!infantry) throw new Error('C++ SCU35EA Greek E3 detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10],
      doing: row[11],
      lx: row[12],
      ly: row[13],
      arm: row[23],
      target: row[32] >= 0 && row[33] >= 0
        ? { rtti: row[32], index: row[33], lx: row[21], ly: row[22] }
        : null,
      primaryFacing: row[28],
      primaryDesiredFacing: row[29],
      nav: infantry.nlx !== undefined && infantry.nly !== undefined
        ? { lx: infantry.nlx, ly: infantry.nly }
        : null,
      headTo: infantry.hlx !== undefined && infantry.hly !== undefined
        ? { lx: infantry.hlx, ly: infantry.hly }
        : null,
      path: [infantry.p0, infantry.p1, infantry.p2, infantry.p3, infantry.p4, infantry.p5]
        .filter((facing: unknown): facing is number => typeof facing === 'number'),
    };
  }, logicIndex) as Promise<{
    tick: number;
    rngState: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    doing: number;
    lx: number;
    ly: number;
    arm: number;
    target: { rtti: number; index: number; lx: number; ly: number } | null;
    primaryFacing: number;
    primaryDesiredFacing: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

async function tsGreekE3Snapshot(adapter: unknown, logicIndex = 99) {
  return adapterPage(adapter).evaluate((hint: number) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.logicIndexHint === hint);
    if (!entity) throw new Error(`TS SCU35EA Greek E3 logic ${hint} missing`);

    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      doing: entity.doing,
      lx: entity.leptonX,
      ly: entity.leptonY,
      arm: entity.attackCooldown,
      target: entity.target
        ? {
            id: entity.target.id,
            type: entity.target.type,
            lx: entity.target.targetCoordLeptons().lx,
            ly: entity.target.targetCoordLeptons().ly,
            height: entity.target.objectHeightLeptons(),
          }
        : null,
      bodyFacing: entity.bodyFacing256,
      desiredFacing: entity.desiredFacing256,
      firePrepActive: entity.firePrepActive,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      headTo: entity.headToLX || entity.headToLY
        ? { lx: entity.headToLX, ly: entity.headToLY }
        : null,
      facings: entity.drivePathFacings.slice(0, 6),
    };
  }, logicIndex) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    doing: string;
    lx: number;
    ly: number;
    arm: number;
    target: { id: number; type: string; lx: number; ly: number; height: number } | null;
    bodyFacing: number;
    desiredFacing: number;
    firePrepActive: boolean;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    facings: number[];
  }>;
}

async function wasmBadrSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const badr = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.t === 'BADR');
    return badr
      ? { tick: state.tick, id: badr.id, hp: badr.hp, lx: badr.lx, ly: badr.ly, height: badr.hgt }
      : { tick: state.tick, id: null, hp: 0, lx: null, ly: null, height: null };
  }) as Promise<{
    tick: number;
    id: number | null;
    hp: number;
    lx: number | null;
    ly: number | null;
    height: number | null;
  }>;
}

async function tsBadrSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const badr = game.entities.find((e: any) => e.type === 'BADR');
    return badr
      ? {
          tick: game.tick,
          id: badr.id,
          alive: badr.alive,
          hp: badr.hp,
          lx: badr.leptonX,
          ly: badr.leptonY,
          height: badr.objectHeightLeptons(),
        }
      : { tick: game.tick, id: null, alive: false, hp: 0, lx: null, ly: null, height: null };
  }) as Promise<{
    tick: number;
    id: number | null;
    alive: boolean;
    hp: number;
    lx: number | null;
    ly: number | null;
    height: number | null;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU35 HUNT approach wall destroyer', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('allows a wall-destroying infantry HUNT approach to choose the C++ wall cell', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 1);
      const cpp = await wasmGreekE3Snapshot(handle.wasm);
      const ts = await tsGreekE3Snapshot(handle.ts);

      expect(cpp.tick).toBe(1);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.nav).toEqual({ lx: 6024, ly: 22152 });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts).toMatchObject({
        mission: 'HUNT',
        missionTimer: cpp.missionTimer,
        isDriving: cpp.isDriving,
        lx: cpp.lx,
        ly: cpp.ly,
        nav: cpp.nav,
        headTo: cpp.headTo,
      });
      expect(ts.facings.slice(0, cpp.path.length)).toEqual(cpp.path);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps the retreating BADR alive until the C++ homing missile impact frame', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 105);
      const cppBeforeImpact = await wasmBadrSnapshot(handle.wasm);
      const tsBeforeImpact = await tsBadrSnapshot(handle.ts);

      expect(cppBeforeImpact).toMatchObject({
        tick: 105,
        hp: 3,
        lx: 5825,
        ly: 19904,
        height: 256,
      });
      expect(tsBeforeImpact).toMatchObject({
        tick: cppBeforeImpact.tick,
        alive: true,
        hp: cppBeforeImpact.hp,
        lx: cppBeforeImpact.lx,
        ly: cppBeforeImpact.ly,
        height: cppBeforeImpact.height,
      });

      await stepBoth(handle, 1);
      const cppAfterImpact = await wasmBadrSnapshot(handle.wasm);
      const tsAfterImpact = await tsBadrSnapshot(handle.ts);
      const cppShooter = await wasmGreekE3Snapshot(handle.wasm, 105);
      const tsShooter = await tsGreekE3Snapshot(handle.ts, 105);

      expect(cppAfterImpact).toMatchObject({ tick: 106, id: null, hp: 0 });
      expect(tsAfterImpact).toMatchObject({
        tick: cppAfterImpact.tick,
        alive: false,
        hp: 0,
      });
      expect(cppShooter.arm).toBe(49);
      expect(tsShooter.arm).toBe(cppShooter.arm);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('starts the RedEye firing animation at the C++ tick against falling Volkov', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 130);
      const cpp = await wasmGreekE3Snapshot(handle.wasm);
      const ts = await tsGreekE3Snapshot(handle.ts);

      expect(cpp.target).toMatchObject({ rtti: 13, index: 57 });
      expect(cpp.doing).toBe(4); // DO_FIRE_WEAPON
      expect(cpp.primaryFacing).toBe(160);

      expect(ts.target).toMatchObject({
        type: 'GNRL',
        lx: cpp.target!.lx,
      });
      expect(ts.target!.height).toBeGreaterThan(0);
      expect(ts.doing).toBe('fire');
      expect(ts.firePrepActive).toBe(true);
      expect(ts.bodyFacing).toBe(cpp.primaryFacing);
      expect(ts.desiredFacing).toBe(cpp.primaryDesiredFacing);
      expect(ts.arm).toBe(cpp.arm);
    }, { wasmSeed: 0 });
  }, 300_000);
});
