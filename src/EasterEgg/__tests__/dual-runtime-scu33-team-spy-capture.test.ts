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

async function wasmGen2PopOutState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((r: any[]) => r[0] === 56);
    const team = (state.teams ?? []).find((t: any) => t.cls === 'gen2');
    if (!row || !team) throw new Error('C++ SCU33EA gen2/GNRL state not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team.cur,
      type: row[1],
      house: row[2],
      cx: row[3],
      cy: row[4],
      mission: row[7],
      missionTimer: row[8],
      missionQueue: row[9],
      isDriving: row[10] === true,
      lx: row[12],
      ly: row[13],
      facing: row[28],
    };
  });
}

async function tsGen2PopOutState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gnrl = game.entities.find((e: any) =>
      e.alive !== false && e.type === 'GNRL' && e.house === 'GoodGuy' && e.logicIndexHint === 56);
    const team = (window as any).__teamsList?.().find((t: any) => t.typeName === 'gen2');
    if (!gnrl || !team) throw new Error('TS SCU33EA gen2/GNRL state not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      teamMission: team.currentMission,
      type: gnrl.type,
      house: gnrl.house,
      cx: gnrl.cell.cx,
      cy: gnrl.cell.cy,
      mission: gnrl.mission,
      missionTimer: gnrl.missionTimer,
      missionQueue: gnrl.missionQueue,
      isDriving: gnrl.isDriving === true,
      lx: gnrl.leptonX,
      ly: gnrl.leptonY,
      facing: gnrl.bodyFacing256,
    };
  });
}

async function wasmAtk2MoveTailState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((r: any[]) => r[0] === 58);
    if (!row) throw new Error('C++ SCU33EA atk2 E1 logic row 58 not found');
    const all = [
      ...(state.units ?? []),
      ...(state.infantry ?? []),
      ...(state.enemies ?? []),
      ...(state.neutrals ?? []),
    ];
    const foot = all.find((u: any) => u.id === row[6]);
    if (!foot) throw new Error('C++ SCU33EA atk2 E1 foot state not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: row[1],
      house: row[2],
      cx: row[3],
      cy: row[4],
      mission: row[7],
      missionTimer: row[8],
      missionQueue: row[9],
      isDriving: row[10] === true,
      lx: row[12],
      ly: row[13],
      headToLX: foot.hlx ?? 0,
      headToLY: foot.hly ?? 0,
    };
  });
}

async function tsAtk2MoveTailState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e1 = game.entities.find((e: any) =>
      e.alive !== false && e.type === 'E1' && e.house === 'Greece' && e.logicIndexHint === 58);
    if (!e1) throw new Error('TS SCU33EA atk2 E1 logic hint 58 not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      type: e1.type,
      house: e1.house,
      cx: e1.cell.cx,
      cy: e1.cell.cy,
      mission: e1.mission,
      missionTimer: e1.missionTimer,
      missionQueue: e1.missionQueue,
      isDriving: e1.isDriving === true,
      lx: e1.leptonX,
      ly: e1.leptonY,
      headToLX: e1.headToLX,
      headToLY: e1.headToLY,
      path: e1.path.slice(e1.pathIndex).map((p: any) => [p.cx, p.cy]),
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

  it('pops gen2 infantry reinforcements from the PDOX instead of relocating them', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 304);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmGen2PopOutState(handle.wasm);
      const ts = await tsGen2PopOutState(handle.ts);

      expect(cpp.tick).toBe(304);
      expect(cpp.type).toBe('GNRL');
      expect(cpp.house).toBe('GoodGuy');
      expect(cpp.mission).toBe(5);
      expect(cpp.missionQueue).toBe(-1);
      expect(cpp.isDriving).toBe(false);
      expect(cpp.teamMission).toBe(1);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.teamMission).toBe(cpp.teamMission);
      expect(ts.type).toBe(cpp.type);
      expect(ts.house).toBe(cpp.house);
      expect(ts.cx).toBe(cpp.cx);
      expect(ts.cy).toBe(cpp.cy);
      expect(ts.lx).toBe(cpp.lx);
      expect(ts.ly).toBe(cpp.ly);
      expect(ts.mission).toBe('GUARD');
      expect(ts.missionQueue).toBeNull();
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.isDriving).toBe(cpp.isDriving);
      expect(ts.facing).toBe(cpp.facing);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('preserves a driving infantry path tail when Team MOVE rewrites NavCom', async () => {
    await withDualScenario('SCU33EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBoth(handle, 342);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = await wasmAtk2MoveTailState(handle.wasm);
      const ts = await tsAtk2MoveTailState(handle.ts);

      expect(cpp.tick).toBe(342);
      expect(cpp.type).toBe('E1');
      expect(cpp.house).toBe('Greece');
      expect(cpp.mission).toBe(2);
      expect(cpp.isDriving).toBe(true);
      expect(cpp.headToLX).toBe(11328);
      expect(cpp.headToLY).toBe(17472);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.type).toBe(cpp.type);
      expect(ts.house).toBe(cpp.house);
      expect(ts.cx).toBe(cpp.cx);
      expect(ts.cy).toBe(cpp.cy);
      expect(ts.lx).toBe(cpp.lx);
      expect(ts.ly).toBe(cpp.ly);
      expect(ts.mission).toBe('MOVE');
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.missionQueue).toBeNull();
      expect(ts.isDriving).toBe(cpp.isDriving);
      expect(ts.headToLX).toBe(cpp.headToLX);
      expect(ts.headToLY).toBe(cpp.headToLY);
      expect(ts.path).toEqual([[44, 68]]);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
