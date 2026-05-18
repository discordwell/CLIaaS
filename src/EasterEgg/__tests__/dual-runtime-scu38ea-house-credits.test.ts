/**
 * Dual-runtime check for SCU38EA house starting money.
 *
 * C++ HouseClass::Read_INI initializes each house's Credits directly from
 * that house's INI Credits= field. Refineries add storage capacity and let
 * harvesters return ore; they do not grant starting cash. SCU38EA has a
 * GoodGuy refinery but no [GoodGuy] Credits= entry, so GoodGuy must start
 * with zero money and must not enter BuildingClass::Repair_AI at tick 0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState } from '../engine/agentHarness.js';
import type { RAGameState } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

function tsMoney(state: AgentState, house: string): number {
  const entry = state.houses.find(h => h.house === house);
  if (!entry) throw new Error(`TS house ${house} not found`);
  return entry.money;
}

function wasmMoney(state: RAGameState, house: string): number {
  const entry = state.houses?.find(h => h.house === house);
  if (!entry) throw new Error(`C++ house ${house} not found`);
  return entry.money;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU38EA house credits', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('initializes AI house money from INI Credits= only, not refinery count', async () => {
    await withDualScenario('SCU38EA', async ({ tsState, wasmState }) => {
      expect(wasmMoney(wasmState, 'GoodGuy')).toBe(0);
      expect(tsMoney(tsState, 'GoodGuy')).toBe(wasmMoney(wasmState, 'GoodGuy'));

      expect(wasmMoney(wasmState, 'Greece')).toBe(10100);
      expect(tsMoney(tsState, 'Greece')).toBe(wasmMoney(wasmState, 'Greece'));
    }, { wasmSeed: 0 });
  }, 240_000);
});
