/**
 * Dual-runtime check for BuildingClass::Greatest_Threat dead-infantry scan
 * poisoning.
 *
 * SCG26EA tick 150 has the Greece HBOX at (38,72) scan while a zero-strength
 * USSR E1 is still active in C++ Cell_Occupier at radius 3. C++ returns that
 * dead object at the crange/2 bailout, Assign_Target clears it, and the HBOX
 * rolls its normal weapon guard delay. TS must not skip that corpse and acquire
 * the live E1/E2 one ring farther out.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmDeadOccupier(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const occ = JSON.parse((window as any).Module.ccall(
      'agent_get_cell_occupiers',
      'string',
      ['number', 'number'],
      [37, 69],
    ));
    const corpse = occ.occ.find((o: any) => o.t === 'E1' && o.house === 'USSR' && o.hp === 0);
    return {
      tick: occ.tick,
      corpse: corpse
        ? {
            id: corpse.id,
            type: corpse.t,
            house: corpse.house,
            hp: corpse.hp,
            discoveredByPlayer: corpse.dp,
            mission: corpse.m,
          }
        : null,
    };
  });
}

async function tsDeadOccupier(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const corpse = game.entities.find((e: any) =>
      e.type === 'E1' &&
      e.house === 'USSR' &&
      e.cell.cx === 37 &&
      e.cell.cy === 69 &&
      e.hp === 0
    );
    return {
      tick: game.tick,
      corpse: corpse
        ? {
            id: corpse.id,
            type: corpse.type,
            house: corpse.house,
            hp: corpse.hp,
            alive: corpse.alive,
            inLimbo: corpse.inLimbo,
            deathVariant: corpse.deathVariant,
            deathComplete: corpse.isInfantryDeathAnimationComplete(),
          }
        : null,
    };
  });
}

async function wasmHbox(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) =>
      r[5] === 'B' && r[1] === 'HBOX' && r[2] === 'Greece' && r[3] === 38 && r[4] === 72
    );
    if (!row) throw new Error('C++ SCG26EA HBOX (38,72) logic row missing');
    const targetAgentId = row[32] >= 0 && row[33] >= 0
      ? ((row[32] << 16) + row[33])
      : null;
    const targetRow = targetAgentId !== null
      ? state.logicLayer.find((r: any[]) => r[6] === targetAgentId)
      : null;
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      mission: row[7],
      missionTimer: row[8],
      targetKind: row[30],
      targetRtti: row[32],
      targetObjectIndex: row[33],
      targetLogicIndex: targetRow?.[0] ?? null,
    };
  });
}

async function tsHbox(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const hbox = game.structures.find((s: any) =>
      s.type === 'HBOX' && s.house === 'Greece' && s.cx === 38 && s.cy === 72
    );
    if (!hbox) throw new Error('TS SCG26EA HBOX (38,72) missing');
    const target = hbox.targetEntityId !== undefined
      ? game.entityById.get(hbox.targetEntityId)
      : null;
    return {
      tick: state.tick,
      rngState: state.rngState >>> 0,
      mission: hbox.mission,
      missionTimer: hbox.missionTimer,
      targetEntityId: hbox.targetEntityId ?? null,
      targetLogicIndex: target?.logicIndexHint ?? null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG26 HBOX dead-infantry scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('lets the dead E1 poison the scan and roll weapon guard delay at tick 150', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 149);
      const cppCorpse = await wasmDeadOccupier(handle.wasm);
      const tsCorpse = await tsDeadOccupier(handle.ts);

      expect(cppCorpse.tick).toBe(149);
      expect(tsCorpse.tick).toBe(cppCorpse.tick);
      expect(cppCorpse.corpse).toMatchObject({
        type: 'E1',
        house: 'USSR',
        hp: 0,
        discoveredByPlayer: true,
      });
      expect(tsCorpse.corpse).toMatchObject({
        type: 'E1',
        house: 'USSR',
        hp: 0,
        alive: false,
        inLimbo: false,
        deathVariant: 1,
        deathComplete: false,
      });

      await stepBoth(handle, 1);
      const cpp = await wasmHbox(handle.wasm);
      const ts = await tsHbox(handle.ts);

      expect(cpp.tick).toBe(150);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.mission).toBe(5);
      expect(cpp.targetKind).toBe(-1);
      expect(cpp.targetRtti).toBe(-1);
      expect(cpp.targetObjectIndex).toBe(-1);

      expect(ts.mission).toBe('GUARD');
      expect(ts.targetEntityId).toBeNull();
      expect(ts.missionTimer).toBe(cpp.missionTimer);
      expect(ts.rngState).toBe(cpp.rngState);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('matches the same-cell Cell_Occupier head when the HBOX acquires at tick 166', async () => {
    await withDualScenario('SCG26EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 165);
      const chain = await adapterPage(handle.wasm).evaluate(() =>
        JSON.parse((window as any).Module.ccall(
          'agent_get_cell_occupiers',
          'string',
          ['number', 'number'],
          [38, 69],
        ))
      );

      expect(chain.tick).toBe(165);
      expect(chain.occ[0]).toMatchObject({ t: 'E1', house: 'USSR' });

      await stepBoth(handle, 1);
      const cpp = await wasmHbox(handle.wasm);
      const ts = await tsHbox(handle.ts);

      expect(cpp.tick).toBe(166);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.targetRtti).toBe(13);
      expect(cpp.targetLogicIndex).toBe(92);
      expect(ts.targetLogicIndex).toBe(cpp.targetLogicIndex);
      expect(ts.rngState).toBe(cpp.rngState);
    }, { wasmSeed: 0 });
  }, 180_000);
});
