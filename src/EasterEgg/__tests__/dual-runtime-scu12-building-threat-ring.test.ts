/**
 * Dual-runtime check for BuildingClass::Greatest_Threat cell-ring targeting.
 *
 * In SCU12EA the Greece GUN near (32,42) fires a TurretGun shell at tick 373.
 * C++ does not globally score every in-range target. Its THREAT_RANGE path scans
 * cells outward from Fire_Coord, keeps the last valid cell target in ring order,
 * and returns at the crange/2 bailout. That selects the USSR E2 near (35,41).
 * TS used to select the higher-value 4TNK near (35,39), which kept RNG parity
 * until the shell detonated and then put the nearby infantry on the wrong
 * damage/fear/random-animation path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualStepResult,
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmGreeceGunShell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const shell = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'Cannon' &&
      bullet.str === 40 &&
      bullet.wh === 2 &&
      bullet.pb === 327715);
    if (!shell) throw new Error('C++ SCU12EA Greece GUN Cannon shell missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      shell,
    };
  });
}

async function tsGreeceGunShell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const shell = game.inflightProjectiles.find((projectile: any) =>
      projectile.weapon?.name === 'TurretGun' &&
      projectile.attackerStructure?.type === 'GUN' &&
      projectile.attackerStructure?.house === 'Greece' &&
      projectile.attackerStructure?.cx === 32 &&
      projectile.attackerStructure?.cy === 42);
    if (!shell) throw new Error('TS SCU12EA Greece GUN TurretGun shell missing');
    const target = game.entityById.get(shell.targetId);
    return {
      tick: state.tick,
      rngState: state.rngState,
      shell: {
        weapon: shell.weapon?.name,
        currentFrame: shell.currentFrame,
        fuseTimer: shell.fuseTimer,
        logicalLX: shell.logicalLX,
        logicalLY: shell.logicalLY,
        headToLX: shell.headToLX,
        headToLY: shell.headToLY,
        targetType: target?.type ?? null,
        targetHouse: target?.house ?? null,
        targetCell: target ? { cx: target.cell.cx, cy: target.cell.cy } : null,
      },
    };
  });
}

async function wasmGoodGuyGunTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicLayer = state.logicLayer ?? [];
    const gun = logicLayer.find((entry: any[]) =>
      entry[5] === 'B' &&
      entry[1] === 'GUN' &&
      entry[2] === 'GoodGuy' &&
      entry[3] === 38 &&
      entry[4] === 42);
    if (!gun) throw new Error('C++ SCU12EA GoodGuy GUN missing from logic layer');
    const target = logicLayer.find((entry: any[]) =>
      entry[5] === 'U' &&
      entry[6] === ((gun[32] << 16) | gun[33]));
    return {
      tick: state.tick,
      rngState: state.rngState,
      target: target
        ? {
            type: target[1],
            house: target[2],
            cell: { cx: target[3], cy: target[4] },
          }
        : null,
    };
  });
}

async function tsGoodGuyGunTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gun = game.structures.find((structure: any) =>
      structure.type === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 38 &&
      structure.cy === 42);
    if (!gun) throw new Error('TS SCU12EA GoodGuy GUN missing');
    const target = gun.targetEntityId !== undefined
      ? game.entityById.get(gun.targetEntityId)
      : undefined;
    return {
      tick: state.tick,
      rngState: state.rngState,
      target: target
        ? {
            type: target.type,
            house: target.house,
            cell: { cx: target.cell.cx, cy: target.cell.cy },
          }
        : null,
    };
  });
}

async function wasmGoodGuyGunAndFourTankShell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const gun = (state.structures ?? []).find((structure: any) =>
      structure.t === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 38 &&
      structure.cy === 42);
    const shell = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'Cannon' &&
      bullet.str === 40 &&
      bullet.wh === 2 &&
      bullet.pb === 1835033);
    return {
      tick: state.tick,
      rngState: state.rngState,
      gun: gun
        ? { type: gun.t, house: gun.house, cx: gun.cx, cy: gun.cy, hp: gun.hp, maxHp: gun.mhp }
        : null,
      shell: shell
        ? {
            type: shell.type,
            strength: shell.str,
            warhead: shell.wh,
            payback: shell.pb,
            lx: shell.lx,
            ly: shell.ly,
            tx: shell.tx,
            ty: shell.ty,
            fx: shell.fx,
            fy: shell.fy,
            timer: shell.timer,
          }
        : null,
    };
  });
}

async function tsGoodGuyGunAndFourTankShell(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const gun = game.structures.find((structure: any) =>
      structure.type === 'GUN' &&
      structure.house === 'GoodGuy' &&
      structure.cx === 38 &&
      structure.cy === 42);
    const shell = (game.inflightProjectiles ?? []).find((projectile: any) => {
      const attacker = game.entityById.get(projectile.attackerId);
      return projectile.weapon?.name === '120mm' &&
        projectile.weapon?.warhead === 'AP' &&
        projectile.damage === 40 &&
        attacker?.type === '4TNK' &&
        attacker?.house === 'USSR';
    });
    return {
      tick: state.tick,
      rngState: state.rngState,
      gun: gun
        ? {
            type: gun.type,
            house: gun.house,
            cx: gun.cx,
            cy: gun.cy,
            hp: gun.hp,
            maxHp: gun.maxHp,
            alive: gun.alive,
            mission: gun.mission,
            sellProgress: gun.sellProgress ?? null,
          }
        : null,
      shell: shell
        ? {
            weapon: shell.weapon?.name,
            damage: shell.damage,
            warhead: shell.weapon?.warhead,
            logicalLX: shell.logicalLX,
            logicalLY: shell.logicalLY,
            headToLX: shell.headToLX,
            headToLY: shell.headToLY,
            fuseTimer: shell.fuseTimer,
          }
        : null,
    };
  });
}

async function wasmGoodGuyE3AtSouthAirstrike(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer ?? [];
    const rifle = logic.find((entry: any[]) =>
      entry[5] === 'I' &&
      entry[1] === 'E3' &&
      entry[2] === 'GoodGuy' &&
      entry[3] === 32 &&
      entry[4] === 89);
    if (!rifle) throw new Error('C++ SCU12EA GoodGuy E3 at (32,89) missing');
    const target = logic.find((entry: any[]) =>
      entry[6] === ((rifle[32] << 16) | rifle[33]));
    return {
      tick: state.tick,
      rngState: state.rngState,
      rifle: {
        mission: rifle[7],
        missionTimer: rifle[8],
        attackCooldown: rifle[23],
        target: target
          ? {
              type: target[1],
              house: target[2],
              cell: { cx: target[3], cy: target[4] },
            }
          : null,
      },
    };
  });
}

async function tsGoodGuyE3AtSouthAirstrike(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const rifle = game.entities.find((entity: any) =>
      entity.type === 'E3' &&
      entity.house === 'GoodGuy' &&
      entity.cell?.cx === 32 &&
      entity.cell?.cy === 89);
    if (!rifle) throw new Error('TS SCU12EA GoodGuy E3 at (32,89) missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      rifle: {
        mission: rifle.mission,
        missionTimer: rifle.missionTimer,
        attackCooldown: rifle.attackCooldown,
        target: rifle.target
          ? {
              type: rifle.target.type,
              house: rifle.target.house,
              cell: { cx: rifle.target.cell.cx, cy: rifle.target.cell.cy },
            }
          : null,
      },
    };
  });
}

async function wasmGoodGuyAreaGuardE3AircraftTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = state.logicLayer ?? [];
    const rifle = logic.find((entry: any[]) =>
      entry[5] === 'I' &&
      entry[1] === 'E3' &&
      entry[2] === 'GoodGuy' &&
      entry[3] === 36 &&
      entry[4] === 79 &&
      entry[7] === 10);
    if (!rifle) throw new Error('C++ SCU12EA GoodGuy AREA_GUARD E3 at (36,79) missing');
    const target = logic.find((entry: any[]) =>
      entry[6] === ((rifle[32] << 16) | rifle[33]));
    return {
      tick: state.tick,
      rngState: state.rngState,
      rifle: {
        mission: rifle[7],
        missionTimer: rifle[8],
        isDriving: rifle[10],
        target: target
          ? {
              type: target[1],
              house: target[2],
              cell: { cx: target[3], cy: target[4] },
            }
          : null,
      },
    };
  });
}

async function tsGoodGuyAreaGuardE3AircraftTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const rifle = game.entities.find((entity: any) =>
      entity.type === 'E3' &&
      entity.house === 'GoodGuy' &&
      entity.mission === 'AREA_GUARD' &&
      entity.cell?.cx === 36 &&
      entity.cell?.cy === 79);
    if (!rifle) throw new Error('TS SCU12EA GoodGuy AREA_GUARD E3 at (36,79) missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      rifle: {
        mission: rifle.mission,
        missionTimer: rifle.missionTimer,
        isDriving: rifle.isDriving,
        moveTarget: rifle.moveTarget
          ? {
              lx: rifle.moveTarget.lx,
              ly: rifle.moveTarget.ly,
            }
          : null,
        target: rifle.target
          ? {
              type: rifle.target.type,
              house: rifle.target.house,
              cell: { cx: rifle.target.cell.cx, cy: rifle.target.cell.cy },
            }
          : null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 building threat ring scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('aims the Greece GUN shell at the same E2 selected by the C++ ring scan', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 373);
      const [cpp, ts] = await Promise.all([
        wasmGreeceGunShell(handle.wasm),
        tsGreeceGunShell(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.shell.weapon).toBe('TurretGun');
      expect(ts.shell.fuseTimer).toBe(cpp.shell.timer);
      expect(ts.shell.logicalLX).toBe(cpp.shell.lx);
      expect(ts.shell.logicalLY).toBe(cpp.shell.ly);
      expect(ts.shell.headToLX).toBe(cpp.shell.tx);
      expect(ts.shell.headToLY).toBe(cpp.shell.ty);
      expect(ts.shell.targetType).toBe('E2');
      expect(ts.shell.targetHouse).toBe('USSR');
      expect(ts.shell.targetCell).toEqual({ cx: 35, cy: 41 });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('retargets the damaged GoodGuy GUN to the 3TNK that hit it', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 328);
      const [cpp, ts] = await Promise.all([
        wasmGoodGuyGunTarget(handle.wasm),
        tsGoodGuyGunTarget(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.target).toMatchObject({
        type: '3TNK',
        house: 'USSR',
        cell: { cx: 38, cy: 41 },
      });
      expect(ts.target).toEqual(cpp.target);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('does not auto-sell the damaged GoodGuy GUN before the 4TNK launches the C++ shell', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 403);
      const [cppBefore, tsBefore] = await Promise.all([
        wasmGoodGuyGunAndFourTankShell(handle.wasm),
        tsGoodGuyGunAndFourTankShell(handle.ts),
      ]);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.gun).not.toBeNull();
      expect(tsBefore.gun).not.toBeNull();
      expect(tsBefore.gun).toMatchObject({
        type: 'GUN',
        house: 'GoodGuy',
        cx: 38,
        cy: 42,
        alive: true,
        sellProgress: null,
      });
      expect(tsBefore.gun!.hp).toBeGreaterThan(0);

      await stepBothOneTickAtATime(handle, 1);
      const [cppAfter, tsAfter] = await Promise.all([
        wasmGoodGuyGunAndFourTankShell(handle.wasm),
        tsGoodGuyGunAndFourTankShell(handle.ts),
      ]);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
      expect(cppAfter.shell).not.toBeNull();
      expect(tsAfter.shell).toEqual({
        weapon: '120mm',
        damage: cppAfter.shell!.strength,
        warhead: 'AP',
        logicalLX: cppAfter.shell!.lx,
        logicalLY: cppAfter.shell!.ly,
        headToLX: cppAfter.shell!.fx,
        headToLY: cppAfter.shell!.fy,
        fuseTimer: cppAfter.shell!.timer,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('clears the south E3 aircraft target when C++ target-range maintenance clears it', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 349);
      const [cpp, ts] = await Promise.all([
        wasmGoodGuyE3AtSouthAirstrike(handle.wasm),
        tsGoodGuyE3AtSouthAirstrike(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.rifle.mission).toBe('GUARD');
      expect(ts.rifle.missionTimer).toBe(cpp.rifle.missionTimer);
      expect(ts.rifle.attackCooldown).toBe(cpp.rifle.attackCooldown);
      expect(cpp.rifle.target).toBeNull();
      expect(ts.rifle.target).toBeNull();
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps AREA_GUARD top-layer aircraft target selection independent of movement zone', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 296);
      const [cpp, ts] = await Promise.all([
        wasmGoodGuyAreaGuardE3AircraftTarget(handle.wasm),
        tsGoodGuyAreaGuardE3AircraftTarget(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.rifle.target).toEqual({
        type: 'MIG',
        house: 'BadGuy',
        cell: { cx: 37, cy: 74 },
      });
      expect(ts.rifle.target).toEqual(cpp.rifle.target);
      expect(ts.rifle.mission).toBe('AREA_GUARD');
      expect(ts.rifle.missionTimer).toBe(cpp.rifle.missionTimer);
      expect(ts.rifle.isDriving).toBe(cpp.rifle.isDriving);
      expect(ts.rifle.moveTarget).toBeNull();
    }, { wasmSeed: 0 });
  }, 300_000);
});
