/**
 * Dual-runtime check for full-map HUNT scoring when structures compete with
 * mobile units.
 *
 * SCG26EA tick 1 has a USSR grenadier whose C++ Mission_Hunt scan selects the
 * Greece HBOX at (38,72). BuildingClass candidates use the same
 * TechnoClass::Evaluate_Object score modifiers as mobile candidates. TS used
 * bare 2*Points scoring for structures, so the nearby HARV outranked the HBOX
 * and the grenadier started down a different path.
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

async function wasmGrenadierTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) => r[6] === 851987);
    if (!row) throw new Error('C++ SCG26EA grenadier logic row missing');
    const targetKind = row[30];
    const targetIndex = row[33];
    const target = targetKind === 5 ? state.structures[targetIndex] : null;
    return {
      tick: state.tick,
      targetKind,
      targetType: target?.t ?? null,
      targetCell: target ? { cx: target.cx, cy: target.cy } : null,
    };
  });
}

async function tsGrenadierTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const grenadier = game.entities.find((e: any) => e.logicIndexHint === 90);
    if (!grenadier) throw new Error('TS SCG26EA grenadier missing');
    return {
      tick: game.tick,
      targetType: grenadier.targetStructure?.type ?? grenadier.target?.type ?? null,
      targetCell: grenadier.targetStructure
        ? { cx: grenadier.targetStructure.cx, cy: grenadier.targetStructure.cy }
        : grenadier.target
          ? { cx: grenadier.target.cell.cx, cy: grenadier.target.cell.cy }
          : null,
      moveTarget: grenadier.moveTarget
        ? { lx: grenadier.moveTarget.lx, ly: grenadier.moveTarget.ly }
        : null,
      headTo: grenadier.headTo
        ? { lx: grenadier.headTo.lx, ly: grenadier.headTo.ly }
        : null,
      targetIsStructure: !!grenadier.targetStructure,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG26 HUNT structure scoring', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('selects the HBOX instead of the HARV on the opening grenadier HUNT scan', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 1);
      const cpp = await wasmGrenadierTarget(handle.wasm);
      const ts = await tsGrenadierTarget(handle.ts);

      expect(cpp.tick).toBe(1);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.targetKind).toBe(5);
      expect(cpp.targetType).toBe('HBOX');
      expect(cpp.targetCell).toEqual({ cx: 38, cy: 72 });

      expect(ts.targetIsStructure).toBe(true);
      expect(ts.targetType).toBe(cpp.targetType);
      expect(ts.targetCell).toEqual(cpp.targetCell);
    }, { wasmSeed: 0 });
  }, 180_000);
});
