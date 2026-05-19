/**
 * Dual-runtime check for TeamClass::TMission_Deploy minelayer behavior.
 *
 * SCU13EA's Greek `mlay1` team alternates MOVE and DEPLOY missions. In C++,
 * TMission_Deploy queues MISSION_UNLOAD for the minelayer; UnitClass::Mission_Unload
 * then runs the normal minelayer deploy state machine before placing a mine.
 * TS must not collapse that script step into an immediate mine drop or GUARD.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

const CPP_MLAY1_MINELAYER_ID = 1835032;
const TS_MLAY1_MINELAYER_LOGIC_INDEX = 177;
const MISSION_UNLOAD = 15;
const UNLOAD_OPENING_DOOR = 2;
const MINE_CELL = { cx: 69, cy: 69 };

type EvalPage = {
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 100);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmMinelayer(adapter: unknown) {
  return adapterPage(adapter).evaluate((id) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const units = [...(state.units ?? []), ...(state.enemies ?? [])];
    const mnly = units.find((unit: any) => unit.id === id);
    if (!mnly) throw new Error('C++ SCU13EA mlay1 minelayer missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      minelayer: {
        type: mnly.t,
        house: mnly.house,
        cx: mnly.cx,
        cy: mnly.cy,
        mission: mnly.m,
        missionQueue: mnly.mq,
        missionTimer: mnly.mt,
        status: mnly.status,
        ammo: mnly.ammo,
      },
    };
  }, CPP_MLAY1_MINELAYER_ID) as Promise<{
    tick: number;
    rngState: number;
    minelayer: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      mission: number;
      missionQueue: number;
      missionTimer: number;
      status: number;
      ammo: number;
    };
  }>;
}

async function tsMinelayer(adapter: unknown) {
  return adapterPage(adapter).evaluate((logicIndex) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mnly = game.entities.find((entity: any) =>
      entity.logicIndexHint === logicIndex &&
      entity.type === 'MNLY' &&
      entity.house === 'Greece');
    if (!mnly) throw new Error('TS SCU13EA mlay1 minelayer missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      minelayer: {
        type: mnly.type,
        house: mnly.house,
        cx: mnly.cell.cx,
        cy: mnly.cell.cy,
        mission: mnly.mission,
        missionQueue: mnly.missionQueue ?? null,
        missionTimer: mnly.missionTimer,
        status: mnly.minelayerUnloadStatus,
        ammo: mnly.ammo,
        doorOpeningTicks: mnly.doorOpeningTicks,
        doorClosingTicks: mnly.doorClosingTicks,
        doorOpen: mnly.doorOpen,
      },
    };
  }, TS_MLAY1_MINELAYER_LOGIC_INDEX) as Promise<{
    tick: number;
    rngState: number;
    minelayer: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      mission: string;
      missionQueue: string | null;
      missionTimer: number;
      status: number;
      ammo: number;
      doorOpeningTicks: number;
      doorClosingTicks: number;
      doorOpen: boolean;
    };
  }>;
}

async function wasmMineStructure(adapter: unknown) {
  return adapterPage(adapter).evaluate((cell) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const mine = (state.structures ?? []).find((structure: any) =>
      structure.t === 'MINV' &&
      structure.house === 'Greece' &&
      structure.cx === cell.cx &&
      structure.cy === cell.cy);
    if (!mine) throw new Error('C++ SCU13EA mlay1 mine structure missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mine: {
        id: mine.id,
        type: mine.t,
        house: mine.house,
        cx: mine.cx,
        cy: mine.cy,
        hp: mine.hp,
        maxHp: mine.mhp,
      },
    };
  }, MINE_CELL) as Promise<{
    tick: number;
    rngState: number;
    mine: {
      id: number;
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      maxHp: number;
    };
  }>;
}

async function tsMineStructure(adapter: unknown) {
  return adapterPage(adapter).evaluate((cell) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mine = game.structures.find((structure: any) =>
      structure.type === 'MINV' &&
      structure.house === 'Greece' &&
      structure.cx === cell.cx &&
      structure.cy === cell.cy);
    if (!mine) throw new Error('TS SCU13EA mlay1 mine structure missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      mine: {
        logicIndexHint: mine.logicIndexHint,
        type: mine.type,
        house: mine.house,
        cx: mine.cx,
        cy: mine.cy,
        hp: mine.hp,
        maxHp: mine.maxHp,
        mission: mine.mission,
        missionTimer: mine.missionTimer,
      },
    };
  }, MINE_CELL) as Promise<{
    tick: number;
    rngState: number;
    mine: {
      logicIndexHint: number;
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      maxHp: number;
      mission: string;
      missionTimer: number;
    };
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13EA minelayer deploy unload', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the mlay1 minelayer in Mission_Unload while the APC door opens', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1203);
      const [cppBefore, tsBefore] = await Promise.all([
        wasmMinelayer(handle.wasm),
        tsMinelayer(handle.ts),
      ]);

      expect(cppBefore.tick).toBe(1203);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.minelayer).toMatchObject({
        type: 'MNLY',
        house: 'Greece',
        mission: MISSION_UNLOAD,
        missionTimer: 0,
        status: UNLOAD_OPENING_DOOR,
        ammo: 5,
      });
      expect(tsBefore.minelayer).toMatchObject({
        type: cppBefore.minelayer.type,
        house: cppBefore.minelayer.house,
        cx: cppBefore.minelayer.cx,
        cy: cppBefore.minelayer.cy,
        mission: 'UNLOAD',
        missionTimer: cppBefore.minelayer.missionTimer,
        status: cppBefore.minelayer.status,
        ammo: cppBefore.minelayer.ammo,
      });

      await stepBoth(handle, 1);
      const [cppAfter, tsAfter] = await Promise.all([
        wasmMinelayer(handle.wasm),
        tsMinelayer(handle.ts),
      ]);

      expect(cppAfter.tick).toBe(1204);
      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
      expect(tsAfter.minelayer).toMatchObject({
        mission: 'UNLOAD',
        missionTimer: cppAfter.minelayer.missionTimer,
        status: cppAfter.minelayer.status,
        ammo: cppAfter.minelayer.ammo,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('creates the deployed mine as a BuildingClass logic object', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1219);
      const [cppMine, tsMine] = await Promise.all([
        wasmMineStructure(handle.wasm),
        tsMineStructure(handle.ts),
      ]);

      expect(cppMine.tick).toBe(1219);
      expect(tsMine.tick).toBe(cppMine.tick);
      expect(tsMine.rngState >>> 0).toBe(cppMine.rngState >>> 0);
      expect(tsMine.mine).toMatchObject({
        type: cppMine.mine.type,
        house: cppMine.mine.house,
        cx: cppMine.mine.cx,
        cy: cppMine.mine.cy,
        hp: cppMine.mine.hp,
        maxHp: cppMine.mine.maxHp,
        mission: 'GUARD',
      });
      expect(tsMine.mine.logicIndexHint).toEqual(expect.any(Number));
      expect(tsMine.mine.missionTimer).toBeGreaterThan(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
