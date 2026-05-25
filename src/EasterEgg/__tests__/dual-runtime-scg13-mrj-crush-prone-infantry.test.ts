/**
 * Dual-runtime check for UnitClass::Overrun_Square deleting crush victims.
 *
 * SCG13EA has a USSR MRJ driving through a prone Greece E1 at cell (12,55).
 * C++ unit.cpp:4422-4435 deletes the crushable object directly; it does not run
 * InfantryClass::Take_Damage, so prone damage bias cannot leave the infantry
 * alive. If TS routes this through normal damage, the E1 survives and later
 * consumes an extra Mission_Guard firing RNG at tick 1037.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
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

async function stepBothInChunks(handle: DualRuntimeHandle, ticks: number): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 250);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmCrushState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const rows = (state.logicLayer ?? []) as any[];
    const victim = rows.find(row =>
      row[1] === 'E1' &&
      row[2] === 'Greece' &&
      row[3] === 12 &&
      row[4] === 55 &&
      row[12] === 3264 &&
      row[13] === 14144);
    const mrj = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((unit: any) => unit.id === 1835016);
    return {
      tick: state.tick,
      rngState: state.rngState,
      victim: victim
        ? {
            logicIndex: victim[0],
            type: victim[1],
            house: victim[2],
            cx: victim[3],
            cy: victim[4],
            mission: victim[7],
            missionTimer: victim[8],
            isDriving: victim[10],
            leptonX: victim[12],
            leptonY: victim[13],
            hp: victim[14],
          }
        : null,
      mrj: mrj
        ? {
            cx: mrj.cx,
            cy: mrj.cy,
            leptonX: mrj.lx,
            leptonY: mrj.ly,
            hp: mrj.hp,
            mission: mrj.m,
            missionTimer: mrj.mt,
          }
        : null,
    };
  });
}

async function tsCrushState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const victim = game.entities.find((entity: any) =>
      entity.alive &&
      !entity.inLimbo &&
      entity.type === 'E1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 12 &&
      entity.cell?.cy === 55 &&
      entity.leptonX === 3264 &&
      entity.leptonY === 14144);
    const liveAtCell = game.entities.find((entity: any) =>
      entity.alive &&
      !entity.inLimbo &&
      entity.type === 'E1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 12 &&
      entity.cell?.cy === 55 &&
      entity.leptonX === 3264 &&
      entity.leptonY === 14144);
    const mrj = game.entities.find((entity: any) =>
      entity.alive &&
      !entity.inLimbo &&
      entity.type === 'MRJ' &&
      entity.house === 'USSR' &&
      entity.teamRef?.typeName === 'mrj1');
    return {
      tick: state.tick,
      rngState: state.rngState,
      victim: victim
        ? {
            logicIndex: victim.logicIndexHint,
            id: victim.id,
            type: victim.type,
            house: victim.house,
            cx: victim.cell?.cx,
            cy: victim.cell?.cy,
            alive: victim.alive,
            inLimbo: victim.inLimbo,
            occupiesCppLogic: victim.occupiesCppLogic(),
            mission: victim.mission,
            missionTimer: victim.missionTimer,
            isDriving: victim.isDriving,
            leptonX: victim.leptonX,
            leptonY: victim.leptonY,
            hp: victim.hp,
          }
        : null,
      liveAtCell: liveAtCell
        ? {
            id: liveAtCell.id,
            hp: liveAtCell.hp,
            mission: liveAtCell.mission,
            missionTimer: liveAtCell.missionTimer,
          }
        : null,
      mrj: mrj
        ? {
            cx: mrj.cell?.cx,
            cy: mrj.cell?.cy,
            leptonX: mrj.leptonX,
            leptonY: mrj.leptonY,
            hp: mrj.hp,
            mission: mrj.mission,
            missionTimer: mrj.missionTimer,
          }
        : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG13 MRJ crushes prone infantry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('deletes the prone E1 at the MRJ overrun boundary and preserves RNG parity', async () => {
    await withDualScenario('SCG13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 1031);
      const cppBefore = await wasmCrushState(handle.wasm);
      const tsBefore = await tsCrushState(handle.ts);

      expect(cppBefore.victim).toMatchObject({
        logicIndex: 123,
        type: 'E1',
        house: 'Greece',
        cx: 12,
        cy: 55,
        leptonX: 3264,
        leptonY: 14144,
      });
      expect(tsBefore.victim).toMatchObject({
        logicIndex: 123,
        type: 'E1',
        house: 'Greece',
        cx: 12,
        cy: 55,
        alive: true,
        inLimbo: false,
        leptonX: 3264,
        leptonY: 14144,
      });

      await stepBoth(handle, 1);
      const cppAfter = await wasmCrushState(handle.wasm);
      const tsAfter = await tsCrushState(handle.ts);

      expect(cppAfter.tick).toBe(1032);
      expect(tsAfter.tick).toBe(1032);
      expect(cppAfter.victim).toBeNull();
      expect(tsAfter.liveAtCell).toBeNull();
      expect(tsAfter.mrj).toMatchObject({
        cx: cppAfter.mrj?.cx,
        cy: cppAfter.mrj?.cy,
        leptonX: cppAfter.mrj?.leptonX,
        leptonY: cppAfter.mrj?.leptonY,
      });

      await stepBothInChunks(handle, 5);
      const cppLater = await wasmCrushState(handle.wasm);
      const tsLater = await tsCrushState(handle.ts);
      expect(cppLater.tick).toBe(1037);
      expect(tsLater.tick).toBe(1037);
      expect(tsLater.rngState >>> 0).toBe(cppLater.rngState >>> 0);
    }, { preserveSourceFog: true });
  }, 180_000);
});
