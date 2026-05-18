/**
 * Dual-runtime check for TeamClass::TMission_Spy building-target handoff.
 *
 * SCU33EA's `gen1` team runs MOVE -> SET_GLOBAL -> SPY(wp0). Waypoint 0 is
 * inside a Greek PDOX footprint, so C++ resolves the cell to the building
 * TARGET, keeps the team on TMISSION_SPY, and lets InfantryClass::Mission_Attack
 * convert the infiltrating GNRL into MISSION_CAPTURE.
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

async function wasmGen1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((r: any[]) => r[0] === 20);
    const team = (state.teams ?? []).find((t: any) => t.cls === 'gen1');
    if (!row || !team) throw new Error('C++ SCU33EA gen1/GNRL state not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team.cur,
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10] === true,
    };
  });
}

async function tsGen1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gnrl = game.entities.find((e: any) =>
      e.alive !== false && e.type === 'GNRL' && e.house === 'GoodGuy');
    const team = (window as any).__teamsList?.().find((t: any) => t.typeName === 'gen1');
    if (!gnrl || !team) throw new Error('TS SCU33EA gen1/GNRL state not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team.currentMission,
      mission: gnrl.mission,
      missionTimer: gnrl.missionTimer,
      isDriving: gnrl.isDriving === true,
    };
  });
}

async function wasmGen1Presence(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [
      ...(state.units ?? []),
      ...(state.infantry ?? []),
      ...(state.enemies ?? []),
      ...(state.neutrals ?? []),
    ];
    const gnrl = all.find((u: any) => u.t === 'GNRL' && String(u.h ?? u.house) === 'GoodGuy');
    const team = (state.teams ?? []).find((t: any) => t.cls === 'gen1');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team?.cur ?? null,
      gnrlAlive: Boolean(gnrl),
    };
  });
}

async function tsGen1Presence(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gnrl = game.entities.find((e: any) =>
      e.alive !== false && e.type === 'GNRL' && e.house === 'GoodGuy');
    const team = (window as any).__teamsList?.().find((t: any) => t.typeName === 'gen1');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team?.currentMission ?? null,
      gnrlAlive: Boolean(gnrl),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU33 team SPY capture handoff', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps SPY mission active and converts GNRL attack into capture', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 79);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmGen1State(handle.wasm);
      const ts = await tsGen1State(handle.ts);

      expect(cpp.tick).toBe(79);
      expect(cpp.teamMission).toBe(2);
      expect(cpp.mission).toBe(8);
      expect(cpp.isDriving).toBe(true);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.teamMission).toBe(cpp.teamMission);
      expect(ts.mission).toBe('CAPTURE');
      expect(ts.isDriving).toBe(cpp.isDriving);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('lets the capture mission enter the PDOX footprint and consumes the infiltrator', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 124);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmGen1Presence(handle.wasm);
      const ts = await tsGen1Presence(handle.ts);

      expect(cpp.tick).toBe(124);
      expect(cpp.teamMission).toBe(2);
      expect(cpp.gnrlAlive).toBe(false);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.teamMission).toBe(cpp.teamMission);
      expect(ts.gnrlAlive).toBe(false);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
