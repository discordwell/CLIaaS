/**
 * Dual-runtime check for scenario [General] Incoming reset behavior.
 *
 * C++ RulesClass::General reads Incoming with MPH_IMMOBILE as the default. When
 * a scenario has [General] but omits Incoming=, that pass resets Rule.Incoming
 * to zero instead of preserving rules.ini Incoming=10. SCU38EA has [General]
 * ParaTech=16 and no Incoming=, so its E2 grenade shots must not call
 * CellClass::Incoming or consume scatter RNG.
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

async function wasmScenarioTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tankRow = ((state.logicLayer ?? []) as any[]).find(entry => entry[0] === 98);
    const shooterRow = ((state.logicLayer ?? []) as any[]).find(entry => entry[0] === 149);
    if (!tankRow || !shooterRow) throw new Error('C++ SCU38EA logic rows 98/149 missing');
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === tankRow[6]);
    if (!tank) throw new Error('C++ SCU38EA 1TNK 1835010 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        logicIndex: tankRow[0],
        type: tankRow[1],
        house: tankRow[2],
        cx: tankRow[3],
        cy: tankRow[4],
        mission: tankRow[7],
        missionTimer: tankRow[8],
        missionQueue: tankRow[9],
        isDriving: tankRow[10],
        leptonX: tankRow[12],
        leptonY: tankRow[13],
        hp: tankRow[14],
        nav: tank.nlx === undefined ? null : { lx: tank.nlx, ly: tank.nly },
      },
      shooter: {
        logicIndex: shooterRow[0],
        type: shooterRow[1],
        mission: shooterRow[7],
        attackCooldown: shooterRow[23],
      },
    };
  });
}

async function tsScenarioTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const tank = game.entities.find((entity: any) => entity.logicIndexHint === 98);
    const shooter = game.entities.find((entity: any) => entity.logicIndexHint === 149);
    if (!tank || !shooter) throw new Error('TS SCU38EA logic hints 98/149 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      tank: {
        logicIndex: tank.logicIndexHint,
        type: tank.type,
        house: tank.house,
        cx: tank.cell?.cx,
        cy: tank.cell?.cy,
        mission: tank.mission,
        missionTimer: tank.missionTimer,
        missionQueue: tank.missionQueue ?? null,
        isDriving: tank.isDriving,
        leptonX: tank.leptonX,
        leptonY: tank.leptonY,
        hp: tank.hp,
        moveTarget: tank.moveTarget
          ? { lx: tank.moveTarget.lx, ly: tank.moveTarget.ly }
          : null,
      },
      shooter: {
        logicIndex: shooter.logicIndexHint,
        type: shooter.type,
        mission: shooter.mission,
        attackCooldown: shooter.attackCooldown,
      },
      incomingProjectileSpeed: game.incomingProjectileSpeed,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU38 scenario Incoming reset', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not call CellClass::Incoming for E2 grenades when scenario Incoming resets to zero', async () => {
    await withDualScenario('SCU38EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 142);
      const cppBefore = await wasmScenarioTank(handle.wasm);
      const tsBefore = await tsScenarioTank(handle.ts);
      expect(cppBefore.tank).toMatchObject({
        logicIndex: 98,
        type: '1TNK',
        house: 'Greece',
        mission: 14,
        missionQueue: -1,
        isDriving: true,
        nav: null,
      });
      expect(tsBefore.tank).toMatchObject({
        logicIndex: 98,
        type: '1TNK',
        house: 'Greece',
        mission: 'HUNT',
        missionQueue: null,
        isDriving: true,
        moveTarget: null,
      });
      expect(tsBefore.incomingProjectileSpeed).toBe(0);

      const step = await stepBoth(handle, 1);
      const cpp = await wasmScenarioTank(handle.wasm);
      const ts = await tsScenarioTank(handle.ts);

      expect(step.wasm.state.tick).toBe(143);
      expect(step.ts.state.tick).toBe(143);
      expect(cpp.tank).toMatchObject({
        logicIndex: 98,
        type: '1TNK',
        house: 'Greece',
        cx: 78,
        cy: 76,
        mission: 14,
        missionQueue: -1,
        isDriving: true,
        hp: 261,
        nav: null,
      });
      expect(ts.tank).toMatchObject({
        logicIndex: 98,
        type: '1TNK',
        house: 'Greece',
        cx: 78,
        cy: 76,
        mission: 'HUNT',
        missionQueue: null,
        isDriving: true,
        hp: 261,
        moveTarget: null,
      });
      expect(ts.tank.leptonX).toBe(cpp.tank.leptonX);
      expect(ts.tank.leptonY).toBe(cpp.tank.leptonY);
      expect(ts.shooter.attackCooldown).toBe(cpp.shooter.attackCooldown);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { preserveSourceFog: true });
  }, 180_000);
});
