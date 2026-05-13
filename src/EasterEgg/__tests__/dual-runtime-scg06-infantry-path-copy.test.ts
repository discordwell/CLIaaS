/**
 * Dual-runtime check for infantry Basic_Path copy behavior.
 *
 * SCG06EA exposes a C++ Path[0] invalidation case: Mission_Move's periodic
 * Target_Something_Nearby call reaches InfantryClass::Assign_Target(TARGET_NONE),
 * which clears Path[0] even while the dog keeps walking to its current
 * Head_To_Coord. A following E1 in the same cell must not copy that invalidated
 * path from the dog; C++ runs Basic_Path instead and reaches the guard cell in
 * time for the next Mission_Guard pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
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

const WASM_MISSION_GUARD = 5;

interface RifleState {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: string | number;
  driving: boolean;
  navCell: string | null;
}

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function navCellFromLeptons(lx: number | undefined, ly: number | undefined): string | null {
  if (lx === undefined || ly === undefined) return null;
  return `${Math.floor(lx / 256)},${Math.floor(ly / 256)}`;
}

function inGuardCellRegion(cx: number, cy: number): boolean {
  return cx >= 78 && cx <= 81 && cy >= 91 && cy <= 93;
}

function tsRifleClosestTo(state: AgentState, reference: RifleState): RifleState {
  const matches = allTsUnits(state)
    .filter(u => u.t === 'E1' && u.h === 'USSR')
    .sort((a, b) => {
      const da = Math.abs(a.cx - reference.cx) + Math.abs(a.cy - reference.cy);
      const db = Math.abs(b.cx - reference.cx) + Math.abs(b.cy - reference.cy);
      return da - db;
    });
  expect(matches.length).toBeGreaterThan(0);
  const unit = matches[0];
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: unit.m,
    driving: !!unit.drv,
    navCell: unit.mtx === undefined || unit.mty === undefined ? null : `${unit.mtx},${unit.mty}`,
  };
}

function wasmRifle(state: RAGameState): RifleState | null {
  const matches = allWasmUnits(state).filter(u =>
    u.t === 'E1' &&
    u.house === 'USSR' &&
    inGuardCellRegion(u.cx, u.cy));
  if (matches.length === 0) return null;
  expect(matches).toHaveLength(1);
  const unit = matches[0];
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: unit.m,
    driving: !!unit.drv,
    navCell: navCellFromLeptons(unit.nlx, unit.nly),
  };
}

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let remaining = ticks;
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  while (remaining > 0) {
    const step = Math.min(remaining, 100);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG06EA infantry path-copy invalidation', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not copy a moving infantry path whose C++ Path[0] was cleared', async () => {
    await withDualScenario('SCG06EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      const result = await stepBothChunked(handle, 996);
      const wasm = wasmRifle(result.wasm.state);
      expect(wasm).not.toBeNull();
      expect(wasm!.mission).toBe(WASM_MISSION_GUARD);
      expect(wasm!.driving).toBe(false);
      expect(wasm!.navCell).toBeNull();

      expect(tsRifleClosestTo(result.ts.state, wasm!), 'SCG06EA rifle state at tick 996').toEqual({
        ...wasm,
        mission: 'GUARD',
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
