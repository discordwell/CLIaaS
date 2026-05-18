/**
 * Dual-runtime check for BulletClass::Unlimbo inaccuracy on building shells.
 *
 * In SCG26EA, the Greece GUN at (34,72) fires TurretGun/AP at a USSR E1.
 * C++ treats AP shells targeting infantry as inaccurate in bullet.cpp and
 * consumes Random_Pick(0, scatterdist) while launching the shell. TS must do
 * the same at fire time or the scenario RNG stream diverges at tick 82.
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

async function wasmGunSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) =>
      entry[0] === 105 &&
      entry[1] === 'GUN' &&
      entry[2] === 'Greece' &&
      entry[3] === 34 &&
      entry[4] === 72);
    if (!row) throw new Error('C++ SCG26EA Greece GUN at logic index 105 not found');
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      mission: row[7],
      missionTimer: row[8],
      attackCooldown: row[23],
      targetKind: row[30],
      targetValue: row[31],
    };
  }, undefined);
}

async function tsGunSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const agentState = (window as any).__agentState();
    const gun = game.structures.find((structure: any) =>
      structure.type === 'GUN' &&
      structure.house === 'Greece' &&
      structure.cx === 34 &&
      structure.cy === 72);
    if (!gun) throw new Error('TS SCG26EA Greece GUN at (34,72) not found');
    const target = game.entities.find((entity: any) => entity.id === gun.targetEntityId);
    return {
      tick: agentState.tick,
      rngState: agentState.rngState >>> 0,
      mission: gun.mission,
      missionTimer: gun.missionTimer,
      attackCooldown: gun.attackCooldown,
      target: target
        ? { type: target.type, house: target.house, cx: target.cell.cx, cy: target.cell.cy }
        : null,
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG26 GUN AP shell scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('consumes the same launch scatter RNG when a GUN fires AP at infantry', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 82);
      const cpp = await wasmGunSnapshot(handle.wasm);
      const ts = await tsGunSnapshot(handle.ts);

      expect(result.wasm.state.tick).toBe(82);
      expect(result.ts.state.tick).toBe(82);
      expect(cpp.tick).toBe(ts.tick);
      expect(cpp.mission).toBe(1);
      expect(ts.mission).toBe('ATTACK');
      expect(cpp.attackCooldown).toBeGreaterThan(0);
      expect(ts.attackCooldown).toBe(cpp.attackCooldown);
      expect(ts.target).toEqual({ type: 'E1', house: 'USSR', cx: 37, cy: 67 });
      expect(ts.rngState).toBe(cpp.rngState);
    }, { wasmSeed: 0 });
  }, 180_000);
});
