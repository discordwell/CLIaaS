/**
 * Dual-runtime check for CREATE_TEAM -> same-frame HouseClass::AI_Infantry.
 *
 * SCG05EB's player SPY enters the dog3 cell trigger during object AI. C++
 * creates two empty BadGuy teams before the later HouseClass::AI pass; new
 * empty TeamClass instances have JustAltered=false, so AI_Infantry counts them
 * immediately and rolls a new infantry build choice in that same frame.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
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
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmBadGuyBuildInfantry(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const house = (state.houses ?? []).find((h: any) => h.house === 'BadGuy');
    if (!house) throw new Error('C++ BadGuy house missing');
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      buildInfantry: house.buildInfName || null,
    };
  }) as Promise<{ tick: number; rngState: number; buildInfantry: string | null }>;
}

async function tsBadGuyBuildInfantry(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const aiState = game.aiStates.get('BadGuy');
    const teams = ((window as any).__rawTeams?.() ?? [])
      .filter((team: any) => team.house === 'BadGuy')
      .map((team: any) => ({
        typeName: team.typeName,
        total: team.members.length,
        isAltered: team.isAltered,
        justAltered: team.justAltered,
      }));
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      buildInfantry: aiState?.buildInfantry ?? null,
      teams,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    buildInfantry: string | null;
    teams: Array<{ typeName: string; total: number; isAltered: boolean; justAltered: boolean }>;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EB CREATE_TEAM AI_Infantry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('counts newly created empty teams in the same House AI infantry pass', async () => {
    await withDualScenario('SCG05EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothInCppSizedChunks(handle, 242);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBothInCppSizedChunks(handle, 1);
      const cpp = await wasmBadGuyBuildInfantry(handle.wasm);
      const ts = await tsBadGuyBuildInfantry(handle.ts);

      expect(cpp.buildInfantry).toBe('E1');
      expect(ts.buildInfantry).toBe(cpp.buildInfantry);
      expect(ts.teams.find(team => team.typeName === 'dog3')?.justAltered).toBe(false);
      expect(ts.teams.find(team => team.typeName === 'bak1')?.justAltered).toBe(false);
      expect(ts.rngState).toBe(cpp.rngState);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
