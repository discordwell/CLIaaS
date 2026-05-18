/**
 * Dual-runtime check for TechnoClass::Can_Fire's IsFalling gate.
 *
 * SCG08EA has a Soviet E1 still descending under a parachute at tick 645. C++
 * keeps TarCom from retaliation but Can_Fire returns FIRE_CANT while IsFalling,
 * so the paratrooper cannot start DO_FIRE_WEAPON. TS used to preserve the
 * falling state but still start fire prep, producing a same-tick M1Carbine shot
 * and one extra invisible-bullet Coord_Scatter RNG call.
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

const WASM_FIRE_CANT = 6;

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmFallingRifleman(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) =>
      r[5] === 'I' &&
      r[1] === 'E1' &&
      r[2] === 'USSR' &&
      r[3] === 59 &&
      r[4] === 100);
    if (!row) throw new Error('C++ SCG08EA falling USSR E1 not found');
    const units = [...(state.units ?? []), ...(state.enemies ?? [])];
    const e1 = units.find((u: any) => u.id === row[6]);
    const target = units.find((u: any) => u.t === 'E1' && u.house === 'Greece' && u.cx === 57 && u.cy === 101);
    return {
      tick: state.tick,
      hp: row[14],
      arm: row[23],
      canFirePrimary: row[37],
      targetHp: target?.hp,
      height: e1?.hgt,
      firing: e1?.firing,
    };
  });
}

async function tsFallingRifleman(adapter: unknown) {
  const page = adapterPage(adapter);
  return page.evaluate(() => {
    const game = (window as any).__agentGame;
    const e1 = game.entities.find((e: any) =>
      e.type === 'E1' &&
      e.house === 'USSR' &&
      e.cell.cx === 59 &&
      e.cell.cy === 100);
    if (!e1) throw new Error('TS SCG08EA falling USSR E1 not found');
    const target = game.entities.find((e: any) =>
      e.type === 'E1' &&
      e.house === 'Greece' &&
      e.cell.cx === 57 &&
      e.cell.cy === 101);
    return {
      tick: game.tick,
      hp: e1.hp,
      arm: e1.attackCooldown,
      targetHp: target?.hp,
      isFalling: e1.isFalling,
      height: e1.fallHeightLeptons,
      firePrepActive: e1.firePrepActive,
      doing: e1.doing,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: falling infantry cannot start firing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps SCG08EA paratrooper TarCom without firing until the fall completes', async () => {
    await withDualScenario('SCG08EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 645);
      const wasm = await wasmFallingRifleman(handle.wasm);
      const ts = await tsFallingRifleman(handle.ts);

      expect(wasm).toMatchObject({
        tick: 645,
        hp: 47,
        arm: 0,
        canFirePrimary: WASM_FIRE_CANT,
        targetHp: 50,
        firing: false,
      });
      expect(wasm.height).toBeGreaterThan(0);

      expect(ts).toMatchObject({
        tick: 645,
        hp: wasm.hp,
        arm: wasm.arm,
        targetHp: wasm.targetHp,
        isFalling: true,
        firePrepActive: false,
      });
      expect(ts.height).toBeGreaterThan(0);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
