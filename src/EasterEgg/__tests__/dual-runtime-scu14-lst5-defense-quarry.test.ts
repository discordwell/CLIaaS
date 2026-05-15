/**
 * Dual-runtime check for SCU14 `lst5` team attack quarry coordination.
 *
 * C++ applies the THREAT_BASE_DEFENSE primary-weapon filter to all technos, not
 * just buildings. That makes `lst5` choose the armed USSR 4TNK at (93,84)
 * instead of the retreating weaponless LST. One stationary 2TNK also remains in
 * GUARD for this tick because Coordinate_Attack clears its DriveClass NavCom,
 * and DriveClass::Start_Of_Move queues Enter_Idle_Mode over the pending ATTACK.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type EvalPage = {
  evaluate<T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothFrames(wasm: unknown, ts: unknown, ticks: number): Promise<void> {
  const wasmPage = adapterPage(wasm);
  const tsPage = adapterPage(ts);
  await Promise.all([
    wasmPage.evaluate((n) => {
      (window as any).Module.ccall('agent_tick_only', 'number', ['number'], [n]);
    }, ticks),
    tsPage.evaluate((n) => {
      (window as any).__agentStep?.(n);
    }, ticks),
  ]);
}

async function wasmCell(adapter: unknown, cx: number, cy: number) {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    return JSON.parse((window as any).Module.ccall(
      'agent_get_cell_occupiers',
      'string',
      ['number', 'number'],
      [x, y],
    ));
  }, { x: cx, y: cy });
}

function findCppOcc(cell: any, type: string, house: string) {
  const occ = (cell.occ ?? []).find((entry: any) => entry.t === type && entry.house === house);
  if (!occ) throw new Error(`C++ ${house} ${type} missing at (${cell.cx},${cell.cy})`);
  return occ;
}

async function tsLst5Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const findAt = (cx: number, cy: number, type: string, house: string) => {
      const entity = game.entities.find((candidate: any) =>
        candidate.type === type &&
        candidate.house === house &&
        candidate.cell?.cx === cx &&
        candidate.cell?.cy === cy);
      if (!entity) throw new Error(`TS ${house} ${type} missing at (${cx},${cy})`);
      return {
        type: entity.type,
        house: entity.house,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        missionQueue: entity.missionQueue,
        isDriving: entity.isDriving,
        leptonX: entity.leptonX,
        leptonY: entity.leptonY,
        targetType: entity.target?.type ?? null,
        targetHouse: entity.target?.house ?? null,
        targetCell: entity.target?.cell ? { ...entity.target.cell } : null,
        moveTarget: entity.moveTarget ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly } : null,
      };
    };

    return {
      tick: state.tick,
      rngState: state.rngState,
      stationary: findAt(99, 98, '2TNK', 'Greece'),
      moving: findAt(98, 99, '2TNK', 'Greece'),
      target: findAt(93, 84, '4TNK', 'USSR'),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 lst5 defense quarry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('selects the armed defense quarry target and preserves DriveClass idle reentry', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothFrames(handle.wasm, handle.ts, 766);

      const [cppStationaryCell, cppMovingCell, cppTargetCell, ts] = await Promise.all([
        wasmCell(handle.wasm, 99, 98),
        wasmCell(handle.wasm, 98, 99),
        wasmCell(handle.wasm, 93, 84),
        tsLst5Snapshot(handle.ts),
      ]);

      const cppStationary = findCppOcc(cppStationaryCell, '2TNK', 'Greece');
      const cppMoving = findCppOcc(cppMovingCell, '2TNK', 'Greece');
      const cppTarget = findCppOcc(cppTargetCell, '4TNK', 'USSR');

      expect(ts.tick).toBe(cppStationaryCell.tick);
      expect(ts.rngState >>> 0).toBe(cppStationaryCell.rngState >>> 0);

      expect(cppTarget.lx).toBe(23936);
      expect(cppTarget.ly).toBe(21632);
      expect(ts.target.leptonX).toBe(cppTarget.lx);
      expect(ts.target.leptonY).toBe(cppTarget.ly);

      expect(cppMoving.m).toBe(2); // MISSION_MOVE
      expect(cppMoving.mq).toBe(1); // MISSION_ATTACK
      expect(cppMoving.tarRtti).toBe(28); // RTTI_UNIT
      expect(cppMoving.tarX).toBe(cppTarget.lx);
      expect(cppMoving.tarY).toBe(cppTarget.ly);
      expect(ts.moving.mission).toBe('MOVE');
      expect(ts.moving.missionQueue).toBe('ATTACK');
      expect(ts.moving.targetType).toBe('4TNK');
      expect(ts.moving.targetCell).toEqual({ cx: 93, cy: 84 });

      expect(cppStationary.m).toBe(5); // MISSION_GUARD
      expect(cppStationary.mt).toBe(43);
      expect(cppStationary.mq).toBe(-1);
      expect(cppStationary.drv).toBe(false);
      expect(cppStationary.tarKind).toBe(-1);
      expect(cppStationary.navKind).toBe(-1);
      expect(ts.stationary.mission).toBe('GUARD');
      expect(ts.stationary.missionTimer).toBe(cppStationary.mt);
      expect(ts.stationary.missionQueue).toBeNull();
      expect(ts.stationary.isDriving).toBe(false);
      expect(ts.stationary.targetType).toBeNull();
      expect(ts.stationary.moveTarget).toBeNull();
    }, { wasmSeed: 0 });
  }, 300_000);
});
