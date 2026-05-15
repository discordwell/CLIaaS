/**
 * Dual-runtime check for UnitClass::Scatter clear-cell filtering.
 *
 * SCU14EA exposes a damage fallback scatter where the first TS Nearby_Location
 * candidate is occupied by a MINV structure. C++ routes candidates through
 * CellClass::Is_Clear_To_Move, so it skips that occupied cell and selects the
 * next clear scatter cell. TS must not assign a building-occupied NavCom just
 * because terrain/vehicle occupancy are clear.
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

async function wasmScatterTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const cell9476 = JSON.parse(module.ccall(
      'agent_get_cell_info',
      'string',
      ['number', 'number', 'number'],
      [94, 76, -1],
    ));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835019);
    if (!tank) throw new Error('C++ SCU14EA Greek 2TNK 1835019 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cx,
        cy: tank.cy,
        lx: tank.lx,
        ly: tank.ly,
        mission: tank.m,
        missionTimer: tank.mt,
        targetType: tank.tt ?? null,
        targetHouse: tank.thouse ?? null,
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
      },
      cell9476: {
        flag: cell9476.flag,
        canEnter: cell9476.canEnter,
      },
    };
  });
}

async function tsScatterTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.id === 101)
      ?? game.entities.find((e: any) =>
        e.alive !== false &&
        e.type === '2TNK' &&
        e.house === 'Greece' &&
        e.cell.cx === 92 &&
        e.cell.cy === 77);
    if (!tank) throw new Error('TS SCU14EA Greek 2TNK missing');

    const occupiedCells = [];
    for (const structure of game.structures) {
      if (structure.alive === false || structure.rubble === true) continue;
      const [width, height] = (window as any).__STRUCTURE_SIZE?.[structure.type] ?? [1, 1];
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          occupiedCells.push({
            type: structure.type,
            house: structure.house,
            cx: structure.cx + dx,
            cy: structure.cy + dy,
          });
        }
      }
    }

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        targetType: tank.target?.type ?? null,
        targetHouse: tank.target?.house ?? null,
        nav: tank.moveTarget ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly } : null,
      },
      occupiedCells,
      cell9476: {
        occupancy: game.map.getOccupancy(94, 76),
        reservation: game.map.getVehicleTrackReservation(94, 76),
        vehicle: game.map.vehicleOccupancy.has(76 * 128 + 94),
      },
    };
  });
}

function navCell(nav: { lx: number; ly: number } | null): { cx: number; cy: number } | null {
  return nav ? { cx: Math.floor(nav.lx / 256), cy: Math.floor(nav.ly / 256) } : null;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 damage scatter skips blocked structure cells', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not assign damage scatter NavCom onto a MINV footprint', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 227);
      const cpp = await wasmScatterTank(handle.wasm);
      const ts = await tsScatterTank(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.tank).toMatchObject({
        cx: cpp.tank.cx,
        cy: cpp.tank.cy,
        lx: cpp.tank.lx,
        ly: cpp.tank.ly,
        mission: 'HUNT',
        missionTimer: cpp.tank.missionTimer,
      });

      expect(ts.occupiedCells).toContainEqual(expect.objectContaining({
        type: 'MINV',
        cx: 92,
        cy: 78,
      }));
      expect(navCell(cpp.tank.nav)).toEqual({ cx: 93, cy: 76 });
      expect(ts.occupiedCells).not.toContainEqual(expect.objectContaining(navCell(cpp.tank.nav)!));
      expect(ts.tank.nav).toEqual(cpp.tank.nav);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('clears a same-tick destroyed vehicle before zero-threat UnitClass scatter', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 286);
      const cpp = await wasmScatterTank(handle.wasm);
      const ts = await tsScatterTank(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.cell9476.flag, 'C++ destroyed 2TNK cell should be clear').toBe(0);
      expect(ts.cell9476).toEqual({
        occupancy: 0,
        reservation: 0,
        vehicle: false,
      });
      expect(navCell(cpp.tank.nav)).toEqual({ cx: 94, cy: 75 });
      expect(ts.tank.nav).toEqual(cpp.tank.nav);
    }, { wasmSeed: 0 });
  }, 300_000);
});
