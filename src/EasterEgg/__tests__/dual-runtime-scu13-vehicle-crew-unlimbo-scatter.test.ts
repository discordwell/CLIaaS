/**
 * Dual-runtime check for vehicle death crew Unlimbo + Scatter parity.
 *
 * C++ unit.cpp:1056-1060 spawns vehicle survivors through InfantryClass::Unlimbo
 * at the destroyed unit coordinate, then calls Scatter(0, true). Unlimbo snaps
 * the crew to the closest infantry sub-cell before the no-threat scatter facing
 * is computed. SCU13EA's Greek MGG death at tick 1000 exposes both pieces:
 * center-spawning or browser atan2 facing sends the C1 to the wrong NavCom.
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

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmCrewState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const crew = [...(state.units ?? []), ...(state.enemies ?? [])].find((unit: any) =>
      unit.t === 'C1' &&
      unit.house === 'Greece' &&
      unit.lx === 26816 &&
      unit.ly === 10432);
    if (!crew) throw new Error('C++ SCU13EA vehicle survivor C1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      hp: crew.hp,
      mission: crew.m,
      missionTimer: crew.mt,
      missionQueue: crew.mq,
      isDriving: !!crew.drv,
      pos: { lx: crew.lx, ly: crew.ly, cx: crew.cx, cy: crew.cy },
      nav: { lx: crew.nlx, ly: crew.nly },
    };
  });
}

async function tsCrewState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const crew = game.entities.find((entity: any) =>
      entity.alive !== false &&
      entity.type === 'C1' &&
      entity.house === 'Greece' &&
      entity.leptonX === 26816 &&
      entity.leptonY === 10432);
    if (!crew) throw new Error('TS SCU13EA vehicle survivor C1 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      hp: crew.hp,
      mission: crew.mission,
      missionTimer: crew.missionTimer,
      missionQueue: crew.missionQueue,
      isDriving: crew.isDriving,
      pos: { lx: crew.leptonX, ly: crew.leptonY, cx: crew.cell.cx, cy: crew.cell.cy },
      nav: crew.moveTarget ? { lx: crew.moveTarget.lx, ly: crew.moveTarget.ly } : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 vehicle crew unlimbo scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('snaps vehicle crew to the infantry sub-cell before no-threat scatter', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1000);
      const cpp = await wasmCrewState(handle.wasm);
      const ts = await tsCrewState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.hp).toBe(cpp.hp);
      expect(ts.pos).toEqual(cpp.pos);
      expect(cpp.nav).toEqual({ lx: 27016, ly: 10376 });
      expect(ts.nav).toEqual(cpp.nav);
      expect(ts.mission).toBe('HUNT');
      expect(cpp.mission).toBe(14);
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.missionQueue).toBeNull();
      expect(cpp.missionQueue).toBe(-1);
      expect(ts.isDriving).toBe(cpp.isDriving);
    }, { wasmSeed: 0 });
  }, 300_000);
});
