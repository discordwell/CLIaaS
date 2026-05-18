/**
 * Dual-runtime check for InfantryClass death-animation occupy bits.
 *
 * In C++ InfantryClass::Take_Damage calls Stop_Driver() before starting a
 * non-instant death animation. That leaves the dead infantry's current
 * sub-cell occupied until Doing_AI reaches the terminal death stage and deletes
 * the object. SCG10EB exposes this through the ast3 infantry column: if TS
 * clears the zero-strength infantry's sub-cell early, the next E1 starts its
 * hop toward a different StoppingCoordAbs slot and later target selection/RNG
 * diverges.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RAEntity, RAGameState } from '../oracle/WasmAdapter.js';
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

const OCCUPIED_DEATH_CELL = { cx: 67, cy: 71, subCell: 2, flag: 4 };
const NEXT_WALKER_COORD = { lx: 17600, ly: 17984 };

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

async function wasmCellInfo(adapter: unknown, cell: typeof OCCUPIED_DEATH_CELL) {
  return adapterPage(adapter).evaluate((c) => {
    const module = (window as any).Module;
    return JSON.parse(module.ccall(
      'agent_get_cell_info',
      'string',
      ['number', 'number', 'number'],
      [c.cx, c.cy, -1],
    ));
  }, cell) as Promise<{ cx: number; cy: number; flag: number; infType?: number }>;
}

async function tsCellInfo(adapter: unknown, cell: typeof OCCUPIED_DEATH_CELL) {
  return adapterPage(adapter).evaluate((c) => {
    const game = (window as any).__agentGame;
    const cellIdx = c.cy * 128 + c.cx;
    const slots = game.map.subCellOccupancy.get(cellIdx) ?? [0, 0, 0, 0, 0];
    const deadInfantry = game.entities
      .filter((e: any) =>
        e.alive === false &&
        e.type === 'E1' &&
        e.house === 'USSR' &&
        e.deathVariant >= 1 &&
        e.deathVariant <= 4 &&
        e.cell.cx === c.cx &&
        e.cell.cy === c.cy)
      .map((e: any) => ({
        id: e.id,
        lx: e.leptonX,
        ly: e.leptonY,
        claimedCellIdx: e.claimedCellIdx,
        claimedSubCell: e.claimedSubCell,
        deathVariant: e.deathVariant,
        deathTick: e.deathTick,
      }));

    return {
      tick: game.tick,
      slots: [...slots],
      occupancy: game.map.getOccupancy(c.cx, c.cy),
      deadInfantry,
    };
  }, cell) as Promise<{
    tick: number;
    slots: number[];
    occupancy: number;
    deadInfantry: Array<{
      id: number;
      lx: number;
      ly: number;
      claimedCellIdx: number;
      claimedSubCell: number;
      deathVariant: number;
      deathTick: number;
    }>;
  }>;
}

function wasmSovietE1At(state: RAGameState, lx: number, ly: number): RAEntity {
  const unit = [...state.units, ...state.enemies].find(u =>
    u.t === 'E1' &&
    u.house === 'USSR' &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `C++ USSR E1 at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

async function tsSovietE1At(adapter: unknown, coord: typeof NEXT_WALKER_COORD) {
  return adapterPage(adapter).evaluate((c) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'E1' &&
      e.house === 'USSR' &&
      e.leptonX === c.lx &&
      e.leptonY === c.ly);
    if (!entity) throw new Error(`TS USSR E1 at lepton (${c.lx},${c.ly}) missing`);
    return {
      id: entity.id,
      lx: entity.leptonX,
      ly: entity.leptonY,
      isDriving: entity.isDriving,
      headToLX: entity.headToLX,
      headToLY: entity.headToLY,
      claimedCellIdx: entity.claimedCellIdx,
      claimedSubCell: entity.claimedSubCell,
    };
  }, coord) as Promise<{
    id: number;
    lx: number;
    ly: number;
    isDriving: boolean;
    headToLX: number;
    headToLY: number;
    claimedCellIdx: number;
    claimedSubCell: number;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG10EB infantry death occupy bit', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps a dead infantry sub-cell occupied until the death animation deletes it', async () => {
    await withDualScenario('SCG10EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothInCppSizedChunks(handle, 309);
      const cppCell = await wasmCellInfo(handle.wasm, OCCUPIED_DEATH_CELL);
      const tsCell = await tsCellInfo(handle.ts, OCCUPIED_DEATH_CELL);

      expect(tsCell.tick).toBe(result.wasm.state.tick);
      expect((cppCell.flag & OCCUPIED_DEATH_CELL.flag) !== 0).toBe(true);
      expect(cppCell.infType).toBe(OCCUPIED_DEATH_CELL.subCell);
      expect(tsCell.deadInfantry).toHaveLength(1);
      expect(tsCell.slots[OCCUPIED_DEATH_CELL.subCell] !== 0)
        .toBe((cppCell.flag & OCCUPIED_DEATH_CELL.flag) !== 0);

      result = await stepBothInCppSizedChunks(handle, 1);
      const cppWalker = wasmSovietE1At(result.wasm.state, NEXT_WALKER_COORD.lx, NEXT_WALKER_COORD.ly);
      const tsWalker = await tsSovietE1At(handle.ts, NEXT_WALKER_COORD);

      expect(cppWalker.drv).toBe(true);
      expect(tsWalker.isDriving).toBe(true);
      expect(tsWalker.headToLX).toBe(cppWalker.hlx);
      expect(tsWalker.headToLY).toBe(cppWalker.hly);
      expect(tsWalker.claimedCellIdx).toBe(OCCUPIED_DEATH_CELL.cy * 128 + OCCUPIED_DEATH_CELL.cx);
      expect(tsWalker.claimedSubCell).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
