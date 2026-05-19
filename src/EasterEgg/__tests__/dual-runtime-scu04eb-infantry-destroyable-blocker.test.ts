/**
 * Dual-runtime check for InfantryClass::Movement_AI MOVE_DESTROYABLE handling.
 *
 * In SCU04EB, a Greek E3 walking its HUNT path toward the Soviet MCV finds a
 * Soviet dog in the next path cell. C++ infantry.cpp:3939-3957 queues ATTACK
 * against Map[acell].Cell_Object(), clears the driver, and keeps the current
 * HUNT mission until the next InfantryClass::AI Commence gate. TS must follow
 * that branch instead of abandoning/repathing toward the old NavCom target.
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

const GREEK_E3_LOGIC_INDEX = 62;
const SOVIET_DOG_LOGIC_INDEX = 69;
const CPP_GREEK_E3_ID = 851970;
const CPP_SOVIET_DOG_ID = 851978;
const MISSION_ATTACK = 1;
const MISSION_AREA_GUARD = 10;
const MISSION_HUNT = 14;

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

async function wasmE3Dog(adapter: unknown) {
  return adapterPage(adapter).evaluate((ids) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const objects = [...(state.units ?? []), ...(state.enemies ?? [])];
    const e3 = objects.find((object: any) => object.id === ids.e3);
    const dog = objects.find((object: any) => object.id === ids.dog);
    if (!e3) throw new Error('C++ SCU04EB Greek E3 missing');
    if (!dog) throw new Error('C++ SCU04EB Soviet dog missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e3: {
        type: e3.t,
        house: e3.house,
        cx: e3.cx,
        cy: e3.cy,
        hp: e3.hp,
        mission: e3.m,
        missionQueue: e3.mq,
        isDriving: e3.drv === true,
        lx: e3.lx,
        ly: e3.ly,
        target: e3.tlx != null && e3.tly != null
          ? { lx: e3.tlx, ly: e3.tly }
          : null,
      },
      dog: {
        type: dog.t,
        house: dog.house,
        cx: dog.cx,
        cy: dog.cy,
        hp: dog.hp,
        mission: dog.m,
        lx: dog.lx,
        ly: dog.ly,
      },
    };
  }, { e3: CPP_GREEK_E3_ID, dog: CPP_SOVIET_DOG_ID }) as Promise<{
    tick: number;
    rngState: number;
    e3: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: number;
      missionQueue: number;
      isDriving: boolean;
      lx: number;
      ly: number;
      target: { lx: number; ly: number } | null;
    };
    dog: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: number;
      lx: number;
      ly: number;
    };
  }>;
}

async function tsE3Dog(adapter: unknown) {
  return adapterPage(adapter).evaluate((logicIndexes) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e3 = game.entities.find((entity: any) =>
      entity.logicIndexHint === logicIndexes.e3 &&
      entity.type === 'E3' &&
      entity.house === 'Greece');
    const dog = game.entities.find((entity: any) =>
      entity.logicIndexHint === logicIndexes.dog &&
      entity.type === 'DOG' &&
      entity.house === 'USSR');
    if (!e3) throw new Error('TS SCU04EB Greek E3 missing');
    if (!dog) throw new Error('TS SCU04EB Soviet dog missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      e3: {
        type: e3.type,
        house: e3.house,
        cx: e3.cell.cx,
        cy: e3.cell.cy,
        hp: e3.hp,
        mission: e3.mission,
        missionQueue: e3.missionQueue ?? null,
        isDriving: e3.isDriving === true,
        lx: e3.leptonX,
        ly: e3.leptonY,
        moveTarget: e3.moveTarget
          ? { lx: e3.moveTarget.lx, ly: e3.moveTarget.ly }
          : null,
        target: e3.target
          ? {
              type: e3.target.type,
              logicIndexHint: e3.target.logicIndexHint,
              lx: e3.target.leptonX,
              ly: e3.target.leptonY,
            }
          : null,
      },
      dog: {
        type: dog.type,
        house: dog.house,
        cx: dog.cell.cx,
        cy: dog.cell.cy,
        hp: dog.hp,
        mission: dog.mission,
        lx: dog.leptonX,
        ly: dog.leptonY,
      },
    };
  }, { e3: GREEK_E3_LOGIC_INDEX, dog: SOVIET_DOG_LOGIC_INDEX }) as Promise<{
    tick: number;
    rngState: number;
    e3: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: string;
      missionQueue: string | null;
      isDriving: boolean;
      lx: number;
      ly: number;
      moveTarget: { lx: number; ly: number } | null;
      target: {
        type: string;
        logicIndexHint: number;
        lx: number;
        ly: number;
      } | null;
    };
    dog: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: string;
      lx: number;
      ly: number;
    };
  }>;
}

async function wasmRestoredE3(adapter: unknown) {
  return adapterPage(adapter).evaluate((ids) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const objects = [...(state.units ?? []), ...(state.enemies ?? [])];
    const e3 = objects.find((object: any) => object.id === ids.e3);
    const mcv = objects.find((object: any) => object.t === 'MCV' && object.house === 'USSR');
    if (!e3) throw new Error('C++ SCU04EB Greek E3 missing after dog limbo');
    if (!mcv) throw new Error('C++ SCU04EB Soviet MCV missing after dog limbo');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e3: {
        type: e3.t,
        house: e3.house,
        cx: e3.cx,
        cy: e3.cy,
        hp: e3.hp,
        mission: e3.m,
        missionQueue: e3.mq,
        missionTimer: e3.mt,
        isDriving: e3.drv === true,
        lx: e3.lx,
        ly: e3.ly,
        target: e3.tlx != null && e3.tly != null
          ? { lx: e3.tlx, ly: e3.tly }
          : null,
        moveTarget: e3.nlx != null && e3.nly != null
          ? { lx: e3.nlx, ly: e3.nly }
          : null,
      },
      mcv: {
        type: mcv.t,
        house: mcv.house,
        cx: mcv.cx,
        cy: mcv.cy,
        hp: mcv.hp,
        lx: mcv.lx,
        ly: mcv.ly,
      },
    };
  }, { e3: CPP_GREEK_E3_ID }) as Promise<{
    tick: number;
    rngState: number;
    e3: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: number;
      missionQueue: number;
      missionTimer: number;
      isDriving: boolean;
      lx: number;
      ly: number;
      target: { lx: number; ly: number } | null;
      moveTarget: { lx: number; ly: number } | null;
    };
    mcv: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      lx: number;
      ly: number;
    };
  }>;
}

async function tsRestoredE3(adapter: unknown) {
  return adapterPage(adapter).evaluate((logicIndex) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e3 = game.entities.find((entity: any) =>
      entity.logicIndexHint === logicIndex &&
      entity.type === 'E3' &&
      entity.house === 'Greece');
    const mcv = game.entities.find((entity: any) =>
      entity.type === 'MCV' &&
      entity.house === 'USSR');
    if (!e3) throw new Error('TS SCU04EB Greek E3 missing after dog limbo');
    if (!mcv) throw new Error('TS SCU04EB Soviet MCV missing after dog limbo');

    return {
      tick: game.tick,
      rngState: state.rngState,
      e3: {
        type: e3.type,
        house: e3.house,
        cx: e3.cell.cx,
        cy: e3.cell.cy,
        hp: e3.hp,
        mission: e3.mission,
        missionQueue: e3.missionQueue ?? null,
        missionTimer: e3.missionTimer,
        isDriving: e3.isDriving === true,
        lx: e3.leptonX,
        ly: e3.leptonY,
        moveTarget: e3.moveTarget
          ? { lx: e3.moveTarget.lx, ly: e3.moveTarget.ly }
          : null,
        target: e3.target
          ? {
              type: e3.target.type,
              logicIndexHint: e3.target.logicIndexHint,
              lx: e3.target.leptonX,
              ly: e3.target.leptonY,
            }
          : null,
      },
      mcv: {
        type: mcv.type,
        house: mcv.house,
        cx: mcv.cell.cx,
        cy: mcv.cell.cy,
        hp: mcv.hp,
        lx: mcv.leptonX,
        ly: mcv.leptonY,
      },
    };
  }, GREEK_E3_LOGIC_INDEX) as Promise<{
    tick: number;
    rngState: number;
    e3: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      mission: string;
      missionQueue: string | null;
      missionTimer: number;
      isDriving: boolean;
      lx: number;
      ly: number;
      moveTarget: { lx: number; ly: number } | null;
      target: {
        type: string;
        logicIndexHint: number;
        lx: number;
        ly: number;
      } | null;
    };
    mcv: {
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      lx: number;
      ly: number;
    };
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU04EB infantry destroyable blocker', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('queues ATTACK when an infantry path cell is blocked by an enemy dog', async () => {
    await withDualScenario('SCU04EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1445);
      const [cpp, ts] = await Promise.all([
        wasmE3Dog(handle.wasm),
        tsE3Dog(handle.ts),
      ]);

      expect(cpp.tick).toBe(1445);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.e3).toMatchObject({
        type: 'E3',
        house: 'Greece',
        mission: MISSION_HUNT,
        missionQueue: MISSION_ATTACK,
        isDriving: false,
        target: { lx: cpp.dog.lx, ly: cpp.dog.ly },
      });
      expect(cpp.dog).toMatchObject({
        type: 'DOG',
        house: 'USSR',
        mission: MISSION_AREA_GUARD,
      });

      expect(ts.e3).toMatchObject({
        type: cpp.e3.type,
        house: cpp.e3.house,
        cx: cpp.e3.cx,
        cy: cpp.e3.cy,
        hp: cpp.e3.hp,
        mission: 'HUNT',
        missionQueue: 'ATTACK',
        isDriving: false,
        lx: cpp.e3.lx,
        ly: cpp.e3.ly,
        moveTarget: null,
        target: {
          type: 'DOG',
          logicIndexHint: SOVIET_DOG_LOGIC_INDEX,
          lx: cpp.dog.lx,
          ly: cpp.dog.ly,
        },
      });
      expect(ts.dog).toMatchObject({
        type: cpp.dog.type,
        house: cpp.dog.house,
        cx: cpp.dog.cx,
        cy: cpp.dog.cy,
        hp: cpp.dog.hp,
        mission: 'AREA_GUARD',
        lx: cpp.dog.lx,
        ly: cpp.dog.ly,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);

  it('restores the suspended HUNT mission when the dog enters limbo', async () => {
    await withDualScenario('SCU04EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 1472);
      const [cpp, ts] = await Promise.all([
        wasmRestoredE3(handle.wasm),
        tsRestoredE3(handle.ts),
      ]);

      expect(cpp.tick).toBe(1472);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.e3).toMatchObject({
        type: 'E3',
        house: 'Greece',
        mission: MISSION_HUNT,
        missionQueue: -1,
        missionTimer: 13,
        isDriving: true,
        target: { lx: cpp.mcv.lx, ly: cpp.mcv.ly },
      });

      expect(ts.e3).toMatchObject({
        type: cpp.e3.type,
        house: cpp.e3.house,
        cx: cpp.e3.cx,
        cy: cpp.e3.cy,
        hp: cpp.e3.hp,
        mission: 'HUNT',
        missionQueue: null,
        missionTimer: cpp.e3.missionTimer,
        isDriving: true,
        lx: cpp.e3.lx,
        ly: cpp.e3.ly,
        moveTarget: cpp.e3.moveTarget,
        target: {
          type: 'MCV',
          logicIndexHint: 47,
          lx: cpp.mcv.lx,
          ly: cpp.mcv.ly,
        },
      });
      expect(ts.mcv).toMatchObject({
        type: cpp.mcv.type,
        house: cpp.mcv.house,
        cx: cpp.mcv.cx,
        cy: cpp.mcv.cy,
        hp: cpp.mcv.hp,
        lx: cpp.mcv.lx,
        ly: cpp.mcv.ly,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
