/**
 * Dual-runtime check for SCG07EA submarine cloak and first torpedo timing.
 *
 * Ordinary anti-sub vessels are scanner-adjacent detectors in C++; they do not
 * create a passive global sonar pulse. The USSR HUNT submarine at Logic[73]
 * should stay in the normal cloaking sequence at tick 31, then only fire its
 * first torpedo after the C++ VesselClass::Can_Fire cloak/facing gates open.
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

async function wasmSubState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) =>
      entry[0] === 73 && entry[1] === 'SS' && entry[2] === 'USSR');
    if (!row) throw new Error('C++ SCG07EA Logic[73] submarine missing');

    const torps = (state.bullets ?? [])
      .filter((bullet: any) => bullet.type === 'Torpedo' && bullet.pb === 1966084)
      .map((bullet: any) => ({
        lx: bullet.lx,
        ly: bullet.ly,
        timer: bullet.timer,
        strength: bullet.str,
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      sub: {
        cloak: row[16],
        cloakStage: row[17],
        arm: row[23],
      },
      torps,
    };
  });
}

async function tsSubState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const sub = game.entities.find((entity: any) =>
      entity.alive &&
      entity.logicIndexHint === 73 &&
      entity.type === 'SS' &&
      entity.house === 'USSR');
    if (!sub) throw new Error('TS SCG07EA Logic[73] submarine missing');

    const torps = game.inflightProjectiles
      .filter((projectile: any) => projectile.weapon?.name === 'TorpTube' && projectile.attackerId === sub.id)
      .map((projectile: any) => ({
        lx: projectile.logicalLX,
        ly: projectile.logicalLY,
        timer: projectile.fuseTimer,
        strength: projectile.strength,
      }));

    return {
      tick: game.tick,
      rngState: state.rngState,
      sub: {
        cloak: sub.cloakState,
        cooldown: sub.attackCooldown,
        sonarPulseTimer: sub.sonarPulseTimer,
      },
      torps,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07EA submarine sonar and fire gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not treat passive DD presence as global sonar and fires the first torpedo on the C++ tick', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      await stepBoth(handle, 31);
      const cpp31 = await wasmSubState(handle.wasm);
      const ts31 = await tsSubState(handle.ts);

      expect(ts31.tick).toBe(cpp31.tick);
      expect(ts31.rngState >>> 0).toBe(cpp31.rngState >>> 0);
      expect(cpp31.sub.cloak).toBe(1);
      expect(cpp31.sub.cloakStage).toBe(30);
      expect(ts31.sub.cloak).toBe(cpp31.sub.cloak);
      expect(ts31.sub.sonarPulseTimer).toBe(0);
      expect(ts31.torps).toHaveLength(0);
      expect(cpp31.torps).toHaveLength(0);

      await stepBoth(handle, 49);
      const cpp80 = await wasmSubState(handle.wasm);
      const ts80 = await tsSubState(handle.ts);

      expect(ts80.tick).toBe(80);
      expect(ts80.tick).toBe(cpp80.tick);
      expect(ts80.rngState >>> 0).toBe(cpp80.rngState >>> 0);
      expect(cpp80.sub.cloak).toBe(3);
      expect(ts80.sub.cloak).toBe(cpp80.sub.cloak);
      expect(cpp80.sub.arm).toBe(0);
      expect(ts80.sub.cooldown).toBe(0);
      expect(ts80.torps).toHaveLength(0);
      expect(cpp80.torps).toHaveLength(0);

      await stepBoth(handle, 5);
      const cpp85 = await wasmSubState(handle.wasm);
      const ts85 = await tsSubState(handle.ts);

      expect(ts85.tick).toBe(85);
      expect(ts85.tick).toBe(cpp85.tick);
      expect(ts85.rngState >>> 0).toBe(cpp85.rngState >>> 0);
      expect(ts85.sub.cooldown).toBe(cpp85.sub.arm);
      expect(ts85.torps).toEqual(cpp85.torps);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
