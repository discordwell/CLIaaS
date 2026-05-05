/**
 * Dual-runtime behavioral checks for C++ ports that affect RNG parity.
 *
 * These tests run the TS engine and the original C++/WASM engine side by side.
 * They intentionally validate observable behavior rather than scenario-specific
 * state edits.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import { WEAPON_STATS } from '../engine/types.js';
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

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function tsWeaponSup(state: AgentState, name: string): boolean | undefined {
  return state.weapons?.find(w => w.name === name)?.sup ?? !!WEAPON_STATS[name]?.isSupressed;
}

function wasmWeaponSup(state: RAGameState, name: string): boolean | undefined {
  return state.weapons?.find(w => w.name === name)?.sup;
}

const WASM_MISSION_MOVE = 2;
const WASM_MISSION_GUARD = 5;
const WASM_MISSION_NONE = -1;

function cellFromLepton(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.floor(v / 256);
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function tsBadGuySubs(state: AgentState): AgentUnit[] {
  return allTsUnits(state)
    .filter(u => u.t === 'SS' && u.h === 'BadGuy')
    .sort((a, b) => a.id - b.id);
}

function wasmBadGuySubs(state: RAGameState): RAEntity[] {
  return allWasmUnits(state)
    .filter(u => u.t === 'SS' && u.house === 'BadGuy')
    .sort((a, b) => a.id - b.id);
}

function wasmMissionName(m: number): 'MOVE' | 'GUARD' | `MISSION_${number}` {
  if (m === WASM_MISSION_MOVE) return 'MOVE';
  if (m === WASM_MISSION_GUARD) return 'GUARD';
  return `MISSION_${m}`;
}

function tsSubMissions(state: AgentState): Record<string, number> {
  return countBy(tsBadGuySubs(state).map(u => u.m));
}

function wasmSubMissions(state: RAGameState): Record<string, number> {
  return countBy(wasmBadGuySubs(state).map(u => wasmMissionName(u.m)));
}

function tsMoveNavCells(state: AgentState): string[] {
  return tsBadGuySubs(state)
    .filter(u => u.m === 'MOVE' || u.mq === 'MOVE')
    .map(u => u.mtx === undefined || u.mty === undefined ? undefined : `${u.mtx},${u.mty}`)
    .filter((v): v is string => v !== undefined)
    .sort();
}

function wasmMoveNavCells(state: RAGameState): string[] {
  return wasmBadGuySubs(state)
    .filter(u => u.m === WASM_MISSION_MOVE || u.mq === WASM_MISSION_MOVE)
    .map(u => {
      const cx = cellFromLepton(u.nlx);
      const cy = cellFromLepton(u.nly);
      return cx === undefined || cy === undefined ? undefined : `${cx},${cy}`;
    })
    .filter((v): v is string => v !== undefined)
    .sort();
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: WeaponTypeClass::IsSupressed', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('C++/WASM and TS agree on WeaponTypeClass::IsSupressed for CA and V2RL primaries', async () => {
    await withDualScenario('SCU06EA', async (handle) => {
      const tsCa = allTsUnits(handle.tsState).find(u => u.t === 'CA');
      const wasmCa = allWasmUnits(handle.wasmState).find(u => u.t === 'CA');
      const tsV2 = allTsUnits(handle.tsState).find(u => u.t === 'V2RL');
      const wasmV2 = allWasmUnits(handle.wasmState).find(u => u.t === 'V2RL');

      expect(tsCa, 'TS SCU06EA should include a cruiser').toBeTruthy();
      expect(wasmCa, 'WASM SCU06EA should include a cruiser').toBeTruthy();
      expect(tsV2, 'TS SCU06EA should include a V2RL').toBeTruthy();
      expect(wasmV2, 'WASM SCU06EA should include a V2RL').toBeTruthy();

      expect(tsCa!.wpn).toBe('8Inch');
      expect(tsV2!.wpn).toBe('SCUD');

      expect(tsWeaponSup(handle.tsState, '8Inch')).toBe(true);
      expect(wasmWeaponSup(handle.wasmState, '8Inch')).toBe(true);
      expect(tsWeaponSup(handle.tsState, 'SCUD')).toBe(false);
      expect(wasmWeaponSup(handle.wasmState, 'SCUD')).toBe(false);
    });
  }, 300_000);
});

describe.skipIf(!serverUp)('Dual runtime C++ parity: DriveClass::Mark_Track / SCG07EA subz activation', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('C++/WASM and TS agree on SCG07EA subz regroup/drive cadence through tick 6', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      const tick4 = await stepBoth(handle, 4);

      expect(tsBadGuySubs(tick4.ts.state), 'TS SCG07EA should expose the three BadGuy SS members').toHaveLength(3);
      expect(wasmBadGuySubs(tick4.wasm.state), 'WASM SCG07EA should expose the three BadGuy SS members').toHaveLength(3);

      expect(tsSubMissions(tick4.ts.state)).toEqual({ GUARD: 1, MOVE: 2 });
      expect(wasmSubMissions(tick4.wasm.state)).toEqual({ GUARD: 1, MOVE: 2 });

      // The two far subs receive NavCom/MOVE and reserve their drive tracks.
      // The close/head sub remains in GUARD until the next mission advance.
      expect(tsMoveNavCells(tick4.ts.state)).toHaveLength(2);
      expect(wasmMoveNavCells(tick4.wasm.state)).toHaveLength(2);
      expect(tsMoveNavCells(tick4.ts.state)).toEqual(['99,48', '99,48']);
      expect(wasmMoveNavCells(tick4.wasm.state)).toEqual(['99,48', '99,48']);

      const guardedTs = tsBadGuySubs(tick4.ts.state).filter(u => u.m === 'GUARD');
      const guardedWasm = wasmBadGuySubs(tick4.wasm.state).filter(u => u.m === WASM_MISSION_GUARD);
      expect(guardedTs).toHaveLength(1);
      expect(guardedWasm).toHaveLength(1);
      expect(guardedTs[0].mq).toBeNull();
      expect(guardedWasm[0].mq ?? WASM_MISSION_NONE).toBe(WASM_MISSION_NONE);

      const tick6 = await stepBoth(handle, 2);

      expect(tsSubMissions(tick6.ts.state)).toEqual({ MOVE: 3 });
      expect(wasmSubMissions(tick6.wasm.state)).toEqual({ MOVE: 3 });
      expect(tsMoveNavCells(tick6.ts.state)).toEqual(['68,46', '68,46', '68,46']);
      expect(wasmMoveNavCells(tick6.wasm.state)).toEqual(['68,46', '68,46', '68,46']);
    });
  }, 300_000);
});
