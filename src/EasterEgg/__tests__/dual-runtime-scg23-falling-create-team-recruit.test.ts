/**
 * Dual-runtime check for TeamClass::Recruit eligibility.
 *
 * SCG23EA cell trigger `stav` creates a Greek team for the already-on-map
 * GNRL while he is still paradropping. C++ TeamClass::Can_Add does not reject
 * nonzero Height, so the team recruits him on tick 277 and activates on tick
 * 278. TS must not gate Create Team recruitment on its `isFalling` flag.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothTicks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | undefined;
  for (let tick = 0; tick < ticks; tick++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('stepBothTicks requires ticks > 0');
  return result;
}

async function wasmStavSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    return {
      tick: state.tick,
      rngState: state.rngState,
      team: (state.teams ?? []).find((entry: any) => entry.cls === 'stav') ?? null,
    };
  });
}

async function tsStavSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const teams = ((window as any).__agentTeams?.() ?? []) as any[];
    const team = teams.find((entry) => entry.typeName === 'stav');
    const gnrl = (game.entities ?? []).find((entity: any) =>
      entity.type === 'GNRL' && entity.house === 'Greece');

    return {
      tick: game.tick,
      team,
      gnrl: gnrl
        ? {
            logicIndexHint: gnrl.logicIndexHint,
            isFalling: gnrl.isFalling,
            inLimbo: gnrl.inLimbo,
            mission: gnrl.mission,
            teamRef: gnrl.teamRef?.typeName ?? null,
          }
        : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 falling Create Team recruit', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('recruits a paradropping GNRL into the created stav team', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothTicks(handle, 276);
      const before = await tsStavSnapshot(handle.ts);
      const cppBefore = await wasmStavSnapshot(handle.wasm);
      expect(cppBefore.team).toMatchObject({
        cls: 'stav',
        total: 0,
        desired: 1,
      });
      expect(before.gnrl).toMatchObject({
        isFalling: true,
        inLimbo: false,
        mission: 'GUARD',
        teamRef: null,
      });

      const recruited = await stepBothTicks(handle, 1);
      const cppTeam = (await wasmStavSnapshot(handle.wasm)).team;
      const tsAfterRecruit = await tsStavSnapshot(handle.ts);

      expect(cppTeam).toMatchObject({
        cls: 'stav',
        total: 1,
        desired: 1,
        fs: false,
        mv: false,
      });
      expect(cppTeam.members).toEqual([
        expect.objectContaining({ type: 'GNRL', want: 1, have: 1 }),
      ]);
      expect(tsAfterRecruit.gnrl).toMatchObject({
        isFalling: true,
        inLimbo: false,
        mission: 'GUARD',
        teamRef: 'stav',
      });
      expect(tsAfterRecruit.team).toMatchObject({
        typeName: 'stav',
        isMoving: false,
        isFullStrength: false,
        members: 1,
      });

      const activated = await stepBothTicks(handle, 1);
      const cppActivated = (await wasmStavSnapshot(handle.wasm)).team;
      const tsActivated = await tsStavSnapshot(handle.ts);

      expect(cppActivated).toMatchObject({
        cls: 'stav',
        total: 1,
        fs: true,
        mv: true,
      });
      expect(tsActivated.team).toMatchObject({
        typeName: 'stav',
        members: 1,
        isFullStrength: true,
        isMoving: true,
      });
      expect(activated.ts.state.rngState).toBe(activated.wasm.state.rngState);

      const landed = await stepBothTicks(handle, 2);
      const tsAfterLanding = await tsStavSnapshot(handle.ts);
      expect(tsAfterLanding.gnrl).toMatchObject({
        isFalling: false,
        inLimbo: false,
        mission: 'GUARD',
      });
      expect(tsAfterLanding.gnrl?.teamRef).toBeNull();
      expect(landed.ts.state.tick).toBe(280);
      expect(landed.wasm.state.tick).toBe(280);
      expect(landed.ts.state.rngState).toBe(landed.wasm.state.rngState);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
