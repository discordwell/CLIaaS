/**
 * Dual-runtime check for InfantryClass movement-facing persistence.
 *
 * SCU37EA produces a GoodGuy E3 from the TENT at (18,108). During the first
 * Head_To_Coord hop, C++ keeps PrimaryFacing at the value selected by
 * Start_Driver while Coord_Move advances the lepton coordinate. TS must not
 * rotate the infantry body facing again on each movement tick, because later
 * no-threat Scatter uses that PrimaryFacing to pick the fallback cell.
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
  evaluate<T>(fn: (logicIndex: number) => T, logicIndex: number): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmInfantryState(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((targetLogicIndex) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[][]).find(entry => entry[0] === targetLogicIndex);
    if (!row) throw new Error(`C++ infantry row ${targetLogicIndex} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        cx: row[3],
        cy: row[4],
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10] === true,
        leptonX: row[12],
        leptonY: row[13],
        primaryFacing: row[28],
        desiredFacing: row[29],
      },
    };
  }, logicIndex);
}

async function tsInfantryState(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((targetLogicIndex) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const infantry = ((game?.entities ?? []) as any[]).find(entity =>
      entity.logicIndexHint === targetLogicIndex);
    if (!infantry) throw new Error(`TS infantry logic row ${targetLogicIndex} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      infantry: {
        logicIndex: infantry.logicIndexHint,
        type: infantry.type,
        house: infantry.house,
        cx: infantry.cell.cx,
        cy: infantry.cell.cy,
        mission: infantry.mission,
        missionTimer: infantry.missionTimer,
        isDriving: infantry.isDriving === true,
        leptonX: infantry.leptonX,
        leptonY: infantry.leptonY,
        primaryFacing: infantry.bodyFacing256,
        desiredFacing: infantry.desiredFacing256,
        headToLX: infantry.headToLX,
        headToLY: infantry.headToLY,
      },
    };
  }, logicIndex);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU37 infantry move facing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps PrimaryFacing from Start_Driver while Coord_Move advances the hop', async () => {
    await withDualScenario('SCU37EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 230);
      const cppStart = await wasmInfantryState(handle.wasm, 170);
      const tsStart = await tsInfantryState(handle.ts, 170);
      expect(tsStart.tick).toBe(cppStart.tick);
      expect(tsStart.rngState >>> 0).toBe(cppStart.rngState >>> 0);
      expect(cppStart.infantry.type).toBe('E3');
      expect(tsStart.infantry.type).toBe('E3');
      expect(cppStart.infantry.primaryFacing).toBe(128);
      expect(tsStart.infantry.primaryFacing).toBe(cppStart.infantry.primaryFacing);
      expect(tsStart.infantry.leptonX).toBe(cppStart.infantry.leptonX);
      expect(tsStart.infantry.leptonY).toBe(cppStart.infantry.leptonY);

      await stepBothInCppSizedChunks(handle, 10);
      const cpp = await wasmInfantryState(handle.wasm, 170);
      const ts = await tsInfantryState(handle.ts, 170);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.infantry.isDriving).toBe(true);
      expect(ts.infantry.isDriving).toBe(true);
      expect(ts.infantry.leptonX).toBe(cpp.infantry.leptonX);
      expect(ts.infantry.leptonY).toBe(cpp.infantry.leptonY);
      expect(ts.infantry.desiredFacing).toBe(cpp.infantry.desiredFacing);
      expect(ts.infantry.primaryFacing).toBe(cpp.infantry.primaryFacing);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
