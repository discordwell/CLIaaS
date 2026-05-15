/**
 * Dual-runtime check for LST cargo IsToScatter during team release.
 *
 * C++ TeamClass::~TeamClass removes remaining members and TeamClass::Remove()
 * calls each member's virtual Enter_Idle_Mode(). For land vehicles unloaded
 * from an LST, UnitClass::Enter_Idle_Mode consumes IsToScatter with
 * Scatter(0, true), assigns a clear nearby NavCom, and keeps the vehicle in
 * MISSION_MOVE. Clearing that flag at TMission_Unload completion makes released
 * cargo idle into GUARD instead and drops the later Mission_Move jitter.
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

async function wasmReleasedTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835031);
    if (!tank) throw new Error('C++ SCU14EA released USSR 3TNK 1835031 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        mission: tank.m,
        missionQueue: tank.mq,
        missionTimer: tank.mt,
        nav: typeof tank.nlx === 'number' ? { lx: tank.nlx, ly: tank.nly } : null,
        path0: tank.p0,
        isDriving: tank.drv,
        primaryFacing256: tank.pf,
        desiredFacing256: tank.pfd,
      },
      teams: (state.teams ?? []).filter((team: any) => team.cls === 'lst1'),
    };
  });
}

async function tsReleasedTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === '3TNK' &&
      e.house === 'USSR' &&
      e.cell.cx === 89 &&
      e.cell.cy === 85);
    if (!tank) throw new Error('TS SCU14EA released USSR 3TNK missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        mission: tank.mission,
        missionQueue: tank.missionQueue,
        missionTimer: tank.missionTimer,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
        path0: tank.drivePathFacings?.[0] ?? null,
        isDriving: tank.isDriving,
        primaryFacing256: tank.bodyFacing256,
        desiredFacing256: tank.desiredFacing256,
      },
      teams: ((window as any).__agentTeams?.() ?? []).filter((team: any) => team.typeName === 'lst1'),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 team release scatter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('released LST cargo consumes IsToScatter and remains on the C++ MOVE path', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 714);
      const cpp = await wasmReleasedTank(handle.wasm);
      const ts = await tsReleasedTank(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.teams).toHaveLength(0);
      expect(ts.teams).toHaveLength(0);
      expect(cpp.tank.mission).toBe(2);
      expect(ts.tank.mission).toBe('MOVE');
      expect(ts.tank.missionQueue).toBeNull();
      expect(cpp.tank.missionQueue).toBe(-1);
      expect(ts.tank.missionTimer).toBe(cpp.tank.missionTimer);
      expect(ts.tank.nav).toEqual(cpp.tank.nav);
      expect(ts.tank.path0).toBe(cpp.tank.path0);
      expect(ts.tank.isDriving).toBe(cpp.tank.isDriving);
      expect(ts.tank.primaryFacing256).toBe(cpp.tank.primaryFacing256);
      expect(ts.tank.desiredFacing256).toBe(cpp.tank.desiredFacing256);
    }, { wasmSeed: 0 });
  }, 300_000);
});
