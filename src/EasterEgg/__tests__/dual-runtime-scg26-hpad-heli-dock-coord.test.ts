/**
 * Dual-runtime behavioral regression for helipad-spawned helicopter docking.
 *
 * C++ BuildingClass uses the HPAD docking coordinate XYP_COORD(24,18) from
 * the building origin. SCG26EA's first Greece HPAD is at cell (33,77), so the
 * docked Longbow sits at lepton (8704,19904). Placing it at the top-right cell
 * center lands at (8832,19840), which is gameplay-visible and shifts rendering.
 * The same Unlimbo path uses AircraftClass::Pose_Dir(), so helicopters also
 * start with both PrimaryFacing and SecondaryFacing set to DIR_NE (32).
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

type DockedHeli = {
  type: string;
  house: string;
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: number | string;
  missionTimer: number;
  primaryCurrent?: number;
  primaryDesired?: number;
  secondaryCurrent?: number;
  secondaryDesired?: number;
  height?: number;
  aircraftState?: string;
  landedAtStructure?: number;
  dockedByHpad?: boolean;
};

async function wasmDockedHeli(adapter: unknown): Promise<DockedHeli | null> {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const unit = (state.units ?? []).find((entry: any) =>
      entry.t === 'HELI' &&
      entry.house === 'Greece' &&
      entry.cx === 34 &&
      entry.cy === 77
    );
    return unit ? {
      type: unit.t,
      house: unit.house,
      cx: unit.cx,
      cy: unit.cy,
      lx: unit.lx,
      ly: unit.ly,
      mission: unit.m,
      missionTimer: unit.mt,
      primaryCurrent: unit.pf,
      primaryDesired: unit.pfd,
      secondaryCurrent: unit.sf,
      secondaryDesired: unit.sfd,
      height: unit.hgt,
    } : null;
  });
}

async function tsDockedHeli(adapter: unknown): Promise<DockedHeli | null> {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const hpad = (game.structures ?? []).find((entry: any) =>
      entry.type === 'HPAD' &&
      entry.house === 'Greece' &&
      entry.cx === 33 &&
      entry.cy === 77
    );
    const heli = hpad
      ? (game.entities ?? []).find((entry: any) => entry.id === hpad.dockedAircraft)
      : null;
    return heli ? {
      type: heli.type,
      house: heli.house,
      cx: heli.cell.cx,
      cy: heli.cell.cy,
      lx: heli.leptonX,
      ly: heli.leptonY,
      mission: heli.mission,
      missionTimer: heli.missionTimer,
      primaryCurrent: heli.bodyFacing256,
      primaryDesired: heli.desiredFacing256,
      secondaryCurrent: heli.turretFacing256,
      secondaryDesired: heli.desiredTurretFacing256,
      height: heli.aircraftHeightLeptons,
      aircraftState: heli.aircraftState,
      landedAtStructure: heli.landedAtStructure,
      dockedByHpad: hpad?.dockedAircraft === heli.id,
    } : null;
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG26 HPAD helicopter docking', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('parks auto-created HPAD helicopters at the C++ docking coordinate', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmHeli, tsHeli] = await Promise.all([
        wasmDockedHeli(handle.wasm),
        tsDockedHeli(handle.ts),
      ]);

      expect(wasmHeli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        cx: 34,
        cy: 77,
        lx: 8704,
        ly: 19904,
        height: 0,
        primaryCurrent: 32,
        primaryDesired: 32,
        secondaryCurrent: 32,
        secondaryDesired: 32,
      });
      expect(tsHeli).toMatchObject({
        type: 'HELI',
        house: 'Greece',
        cx: 34,
        cy: 77,
        lx: wasmHeli!.lx,
        ly: wasmHeli!.ly,
        height: wasmHeli!.height,
        primaryCurrent: wasmHeli!.primaryCurrent,
        primaryDesired: wasmHeli!.primaryDesired,
        secondaryCurrent: wasmHeli!.secondaryCurrent,
        secondaryDesired: wasmHeli!.secondaryDesired,
        aircraftState: 'landed',
        dockedByHpad: true,
      });
    }, { wasmSeed: 0 });
  }, 180_000);
});
