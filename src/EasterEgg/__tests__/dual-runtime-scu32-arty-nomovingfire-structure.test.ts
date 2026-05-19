/**
 * Dual-runtime check for UnitClass NoMovingFire against structure TarCom.
 *
 * SCU32EA reaches a synced state at tick 922 where the Greek ARTY at C++
 * logic row 62 is driving toward a USSR TSLA target. C++ UnitClass::Can_Fire
 * returns FIRE_MOVING while IsNoFireWhileMoving and NavCom are legal, so the
 * ARTY must not create a 155mm shell or consume projectile scatter RNG yet.
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

async function wasmArtyState(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((targetLogicIndex) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = ((state.logicLayer ?? []) as any[][]).find(entry => entry[0] === targetLogicIndex);
    const all = [
      ...(state.units ?? []),
      ...(state.enemies ?? []),
      ...(state.vessels ?? []),
      ...(state.infantry ?? []),
    ];
    const unit = all.find((entry: any) =>
      entry.t === 'ARTY' &&
      entry.house === 'Greece' &&
      entry.cx === 63 &&
      entry.cy === 99);
    if (!row || !unit) throw new Error(`C++ ARTY row ${targetLogicIndex} missing`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        mission: row[7],
        missionTimer: row[8],
        isDriving: row[10] === true,
        cx: row[3],
        cy: row[4],
        leptonX: row[12],
        leptonY: row[13],
        arm: unit.arm,
        navCell: { cx: unit.ncx, cy: unit.ncy },
        targetLeptons: { lx: unit.tlx, ly: unit.tly },
      },
      shells: ((state.bullets ?? []) as any[]).filter(bullet =>
        bullet.weapon === '155mm' || bullet.wpn === '155mm' || bullet.t === '155mm').length,
    };
  }, logicIndex);
}

async function tsArtyState(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((targetLogicIndex) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const unit = ((game?.entities ?? []) as any[]).find(entity =>
      entity.logicIndexHint === targetLogicIndex);
    if (!unit) throw new Error(`TS ARTY row ${targetLogicIndex} missing`);
    const shells = ((game?.inflightProjectiles ?? []) as any[]).filter(projectile =>
      projectile.weapon?.name === '155mm' && projectile.attackerId === unit.id);
    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        logicIndex: unit.logicIndexHint,
        id: unit.id,
        type: unit.type,
        house: unit.house,
        mission: unit.mission,
        missionTimer: unit.missionTimer,
        isDriving: unit.isDriving === true,
        cx: unit.cell.cx,
        cy: unit.cell.cy,
        leptonX: unit.leptonX,
        leptonY: unit.leptonY,
        attackCooldown: unit.attackCooldown,
        moveTarget: unit.moveTarget
          ? { cx: Math.floor(unit.moveTarget.lx / 256), cy: Math.floor(unit.moveTarget.ly / 256) }
          : null,
        targetStructure: unit.targetStructure
          ? { type: unit.targetStructure.type, cx: unit.targetStructure.cx, cy: unit.targetStructure.cy }
          : null,
      },
      shells: shells.length,
    };
  }, logicIndex);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU32 ARTY NoMovingFire vs structures', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not fire 155mm at a structure while NavCom is still legal', async () => {
    await withDualScenario('SCU32EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 922);
      const cppBefore = await wasmArtyState(handle.wasm, 62);
      const tsBefore = await tsArtyState(handle.ts, 62);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(cppBefore.unit.type).toBe('ARTY');
      expect(tsBefore.unit.type).toBe('ARTY');
      expect(cppBefore.unit.isDriving).toBe(true);
      expect(tsBefore.unit.isDriving).toBe(true);
      expect(cppBefore.unit.arm).toBe(0);
      expect(tsBefore.unit.attackCooldown).toBe(0);
      expect(tsBefore.unit.targetStructure).toEqual({ type: 'TSLA', cx: 56, cy: 97 });
      expect(tsBefore.shells).toBe(0);

      const step = await stepBoth(handle, 1);
      expect(step.ts.state.tick).toBe(step.wasm.state.tick);
      expect(step.ts.state.rngState! >>> 0).toBe(step.wasm.state.rngState! >>> 0);

      const cpp = await wasmArtyState(handle.wasm, 62);
      const ts = await tsArtyState(handle.ts, 62);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.unit.isDriving).toBe(true);
      expect(ts.unit.isDriving).toBe(true);
      expect(cpp.unit.arm).toBe(0);
      expect(ts.unit.attackCooldown).toBe(0);
      expect(ts.shells).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
