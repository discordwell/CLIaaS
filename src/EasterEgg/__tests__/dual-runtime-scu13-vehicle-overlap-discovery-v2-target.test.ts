/**
 * Dual-runtime check for vehicle overlap discovery through mapped terrain.
 *
 * In SCU13EA, a Greek 2TNK drives with its center in shroud, but its C++
 * UnitClass::Overlap_List touches an already mapped PlayerPtr cell when
 * MapClass::Place_Down runs. CellClass::Overlap_Down calls Revealed(PlayerPtr),
 * so the USSR V2 can acquire that tank before it reaches a currently visible
 * center cell. TS must mirror the general overlap placement rule, not special
 * case this mission or wait for center-cell visibility.
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

async function wasmScu13Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const tank = allUnits.find((u: any) => u.id === 1835011);
    if (!tank) throw new Error('C++ SCU13EA Greek 2TNK 1835011 missing');

    const v2 = (state.logicLayer ?? []).find((row: any[]) => row[0] === 43);
    if (!v2) throw new Error('C++ SCU13EA USSR V2RL logic index 43 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        cx: tank.cx,
        cy: tank.cy,
        lx: tank.lx,
        ly: tank.ly,
        discoveredByPlayer: tank.dp === true,
        visible: tank.vis === true,
        mapped: tank.map === true,
      },
      v2: {
        missionTimer: v2[8],
        targetLx: v2[21],
        targetLy: v2[22],
        arm: v2[23],
      },
    };
  });
}

async function tsScu13Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((e: any) => e.logicIndexHint === 39);
    if (!tank) throw new Error('TS SCU13EA Greek 2TNK logic index 39 missing');

    const v2 = game.entities.find((e: any) => e.logicIndexHint === 43);
    if (!v2) throw new Error('TS SCU13EA USSR V2RL logic index 43 missing');

    const offsets = [0, -1, 1, -128, 128, -129, 129, 127, -127].slice(1);
    const overlapCells = offsets.map((offset: number) => {
      const cell = tank.cell.cy * 128 + tank.cell.cx + offset;
      const cx = cell % 128;
      const cy = Math.floor(cell / 128);
      return {
        cx,
        cy,
        mapped: game.isCellMappedForPlayer(cx, cy),
      };
    });

    return {
      tick: game.tick,
      rngState: state.rngState,
      tank: {
        id: tank.id,
        cx: tank.cell.cx,
        cy: tank.cell.cy,
        lx: tank.leptonX,
        ly: tank.leptonY,
        discoveredByPlayer: game.discoveredEntityIds.has(tank.id),
        visible: game.map.getVisibility(tank.cell.cx, tank.cell.cy) === 2,
        mapped: game.isCellMappedForPlayer(tank.cell.cx, tank.cell.cy),
        lastCellOccupierDownTick: tank.lastCellOccupierDownTick,
        overlapCells,
      },
      v2: {
        missionTimer: v2.missionTimer,
        targetId: v2.target?.id ?? null,
        targetType: v2.target?.type ?? null,
        targetLx: v2.target?.leptonX ?? 0,
        targetLy: v2.target?.leptonY ?? 0,
        arm: v2.attackCooldown,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 vehicle overlap discovery', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('reveals a moving 2TNK through C++ overlap placement before V2 guard acquisition', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 514);
      const [cpp514, ts514] = await Promise.all([
        wasmScu13Snapshot(handle.wasm),
        tsScu13Snapshot(handle.ts),
      ]);
      expect(ts514.tick).toBe(cpp514.tick);
      expect(cpp514.tank.discoveredByPlayer).toBe(false);
      expect(ts514.tank.discoveredByPlayer).toBe(false);

      await stepBoth(handle, 1);
      const [cpp515, ts515] = await Promise.all([
        wasmScu13Snapshot(handle.wasm),
        tsScu13Snapshot(handle.ts),
      ]);

      expect(cpp515.tick).toBe(515);
      expect(ts515.tick).toBe(cpp515.tick);
      expect(cpp515.tank).toMatchObject({
        cx: 99,
        cy: 43,
        discoveredByPlayer: true,
        visible: false,
        mapped: false,
      });
      expect(ts515.tank.lastCellOccupierDownTick).toBe(515);
      expect(ts515.tank.overlapCells.some((cell: { mapped: boolean }) => cell.mapped)).toBe(true);
      expect(ts515.tank).toMatchObject({
        cx: cpp515.tank.cx,
        cy: cpp515.tank.cy,
        discoveredByPlayer: true,
        visible: false,
        mapped: false,
      });

      await stepBoth(handle, 3);
      const [cpp518, ts518] = await Promise.all([
        wasmScu13Snapshot(handle.wasm),
        tsScu13Snapshot(handle.ts),
      ]);
      expect(cpp518.v2.targetLx).toBe(cpp518.tank.lx);
      expect(cpp518.v2.targetLy).toBe(cpp518.tank.ly);
      expect(ts518.v2.targetId).toBe(ts518.tank.id);
      expect(ts518.v2.targetType).toBe('2TNK');

      await stepBoth(handle, 2);
      const [cpp520, ts520] = await Promise.all([
        wasmScu13Snapshot(handle.wasm),
        tsScu13Snapshot(handle.ts),
      ]);
      expect(cpp520.v2.arm).toBe(399);
      expect(ts520.v2.arm).toBe(cpp520.v2.arm);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
