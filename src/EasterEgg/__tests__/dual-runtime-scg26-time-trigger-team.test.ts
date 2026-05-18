/**
 * Dual-runtime check for TEVENT_TIME frame parity.
 *
 * SCG26EA has trigger `t001` with TEVENT_TIME data=1, which creates team
 * `mtptrl`. C++ evaluates trigger timers against the current C++ Frame during
 * Logic.AI. The TS loop increments `game.tick` before Logic.AI, so using the
 * raw TS tick fires the trigger one frame early and lets the team consume its
 * activation RNG before C++.
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

async function wasmMtptrl(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const team = (state.teams ?? []).find((t: any) => t.cls === 'mtptrl');
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      team: team
        ? {
            total: team.total,
            desired: team.desired,
            isFullStrength: team.fs,
            isUnderStrength: team.us,
            isMoving: team.mv,
            isHasBeen: team.hb,
            isAltered: team.alt,
            currentMission: team.cur,
          }
        : null,
    };
  }, undefined);
}

async function tsMtptrl(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    const team = ((window as any).__rawTeams?.() ?? []).find((t: any) => t.typeName === 'mtptrl');
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      team: team
        ? {
            total: team._members?.length ?? 0,
            desired: (team.desiredMembers ?? []).reduce((sum: number, m: any) => sum + m.count, 0),
            isFullStrength: team.isFullStrength,
            isUnderStrength: team.isUnderStrength,
            isMoving: team.isMoving,
            isHasBeen: team.isHasBeen,
            isAltered: team.isAltered,
            currentMission: team.currentMission,
          }
        : null,
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG26 TEVENT_TIME team creation', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('creates mtptrl on the same frame and does not activate it early', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 90);
      const cpp90 = await wasmMtptrl(handle.wasm);
      const ts90 = await tsMtptrl(handle.ts);

      expect(cpp90.tick).toBe(90);
      expect(ts90.tick).toBe(90);
      expect(cpp90.team).toBeNull();
      expect(ts90.team).toBeNull();

      await stepBoth(handle, 1);
      const cpp91 = await wasmMtptrl(handle.wasm);
      const ts91 = await tsMtptrl(handle.ts);

      expect(cpp91.tick).toBe(91);
      expect(ts91.tick).toBe(91);
      expect(ts91.team).toEqual(cpp91.team);
      expect(ts91.rngState).toBe(cpp91.rngState);
    }, { wasmSeed: 0 });
  }, 180_000);
});
