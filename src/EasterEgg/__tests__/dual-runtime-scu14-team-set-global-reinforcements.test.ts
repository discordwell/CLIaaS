/**
 * Dual-runtime check for TeamClass::TMission_Set_Global.
 *
 * In SCU14EA, the Greek `lst4` team reaches a SET_GLOBAL(2) team mission at
 * tick 483. C++ stores that scenario global immediately; on the next
 * LogicTriggers pass, GLOBAL_SET(2) fires the `air1` and `lst5` reinforcement
 * triggers. TS must set the global from first-class Team AI, not just advance
 * the team mission index.
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

async function wasmGlobalTeamState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return {
      tick: state.tick,
      rngState: state.rngState,
      globals: state.globals ?? [],
      teams: (state.teams ?? []).map((team: any) => ({
        name: team.cls,
        total: team.total,
        currentMission: team.cur,
      })),
      helis: [...(state.units ?? []), ...(state.enemies ?? []), ...(state.aircraft ?? [])]
        .filter((unit: any) => unit.t === 'HELI')
        .map((unit: any) => ({
          id: unit.id,
          house: unit.house,
          cell: { cx: unit.cx, cy: unit.cy },
          mission: unit.m,
          altitude: unit.hgt,
        })),
    };
  });
}

async function tsGlobalTeamState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    return {
      tick: state.tick,
      rngState: state.rngState,
      globals: state.globals ?? [],
      teams: ((window as any).__agentTeams?.() ?? []).map((team: any) => ({
        name: team.typeName,
        total: team.members,
        currentMission: team.currentMission,
      })),
      helis: ((window as any).__agentAircraft?.() ?? [])
        .filter((unit: any) => unit.type === 'HELI')
        .map((unit: any) => ({
          id: unit.id,
          house: unit.house,
          cell: { cx: unit.cx, cy: unit.cy },
          mission: unit.mission,
          altitude: unit.flightAltitude,
        })),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 team SET_GLOBAL reinforcements', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('sets global 2 from lst4 and fires the dependent air1/lst5 reinforcements', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 483);
      const globalSetCpp = await wasmGlobalTeamState(handle.wasm);
      const globalSetTs = await tsGlobalTeamState(handle.ts);

      expect(globalSetTs.tick).toBe(globalSetCpp.tick);
      expect(globalSetCpp.globals).toContain(2);
      expect(globalSetTs.globals).toContain(2);
      expect(globalSetTs.teams.some((team) => team.name === 'air1')).toBe(false);
      expect(globalSetTs.teams.some((team) => team.name === 'lst5')).toBe(false);

      await stepBoth(handle, 1);
      const reinforcedCpp = await wasmGlobalTeamState(handle.wasm);
      const reinforcedTs = await tsGlobalTeamState(handle.ts);

      expect(reinforcedTs.tick).toBe(reinforcedCpp.tick);
      expect(reinforcedTs.rngState >>> 0).toBe(reinforcedCpp.rngState >>> 0);
      expect(reinforcedTs.teams.find((team) => team.name === 'air1')?.total).toBe(4);
      expect(reinforcedTs.teams.find((team) => team.name === 'lst5')?.total).toBe(6);

      const cppReinforcementHelis = reinforcedCpp.helis
        .filter((heli) => heli.cell.cx === 45 && heli.cell.cy === 14);
      const tsReinforcementHelis = reinforcedTs.helis
        .filter((heli) => heli.cell.cx === 45 && heli.cell.cy === 14);

      expect(cppReinforcementHelis).toHaveLength(4);
      expect(tsReinforcementHelis).toHaveLength(4);
    }, { wasmSeed: 0 });
  }, 300_000);
});
