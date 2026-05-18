/**
 * Dual-runtime check for FootClass::Approach_Target movement-zone passability.
 *
 * SCU35EA starts several Greek E3 infantry on HUNT against a USSR BADR. The E3
 * primary warhead has Wall=yes, so C++ gives it MZONE_DESTROYER and
 * Approach_Target accepts wall overlay cells through CellClass::Is_Clear_To_Move.
 * If TS filters the sweep with ordinary terrain passability, it skips the wall
 * cell C++ chooses and diverges before the later firing RNG.
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
  evaluate<T>(fn: (...args: any[]) => T, arg?: unknown): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmGreekWeapFactories(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const factories = (state.structures ?? [])
      .filter((s: any) => s.t === 'WEAP' && s.house === 'Greece')
      .map((s: any) => ({
        exitCell: { cx: s.cx, cy: s.cy + 1 },
        type: s.factory?.t ?? null,
        progress: s.factory?.prog ?? null,
        done: s.factory?.done ?? null,
        building: s.factory?.building ?? null,
      }))
      .sort((a: any, b: any) => a.exitCell.cx - b.exitCell.cx);

    return {
      tick: state.tick,
      rngState: state.rngState,
      factories,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    factories: Array<{
      exitCell: { cx: number; cy: number };
      type: string | null;
      progress: number | null;
      done: boolean | null;
      building: boolean | null;
    }>;
  }>;
}

async function tsGreekWeapFactories(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const factories = (game.structures ?? [])
      .filter((s: any) => s.type === 'WEAP' && s.house === 'Greece')
      .map((s: any) => ({
        exitCell: { cx: s.cx + 1, cy: s.cy + 1 },
        type: s.aiFactory?.productType ?? null,
        progress: s.aiFactory?.stage ?? null,
        done: s.aiFactory ? s.aiFactory.stage >= 54 : null,
        building: s.aiFactory ? s.aiFactory.stage < 54 && !s.aiFactory.suspended : null,
      }))
      .sort((a: any, b: any) => a.exitCell.cx - b.exitCell.cx);

    return {
      tick: game.tick,
      rngState: state.rngState,
      factories,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    factories: Array<{
      exitCell: { cx: number; cy: number };
      type: string | null;
      progress: number | null;
      done: boolean | null;
      building: boolean | null;
    }>;
  }>;
}

async function wasmGreek2TnkAt(adapter: unknown, cx: number, cy: number) {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) =>
      entry[1] === '2TNK' &&
      entry[2] === 'Greece' &&
      entry[3] === x &&
      entry[4] === y);
    if (!row) throw new Error(`C++ SCU35EA Greek 2TNK at ${x},${y} missing`);

    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        type: row[1],
        house: row[2],
        cell: { cx: row[3], cy: row[4] },
        mission: row[7],
        missionTimer: row[8],
      },
    };
  }, { x: cx, y: cy }) as Promise<{
    tick: number;
    rngState: number;
    unit: {
      type: string;
      house: string;
      cell: { cx: number; cy: number };
      mission: number;
      missionTimer: number;
    };
  }>;
}

async function tsGreek2TnkAt(adapter: unknown, cx: number, cy: number) {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const entity = (game.entities ?? []).find((e: any) =>
      e.alive !== false &&
      e.type === '2TNK' &&
      e.house === 'Greece' &&
      e.cell?.cx === x &&
      e.cell?.cy === y);
    if (!entity) throw new Error(`TS SCU35EA Greek 2TNK at ${x},${y} missing`);

    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        type: entity.type,
        house: entity.house,
        cell: { cx: entity.cell.cx, cy: entity.cell.cy },
        mission: entity.mission === 'GUARD' ? 5 : entity.mission,
        missionTimer: entity.missionTimer,
      },
    };
  }, { x: cx, y: cy }) as Promise<{
    tick: number;
    rngState: number;
    unit: {
      type: string;
      house: string;
      cell: { cx: number; cy: number };
      mission: number | string;
      missionTimer: number;
    };
  }>;
}

const CPP_MISSION_NAMES: Record<number, string | null> = {
  [-1]: null,
  0: 'SLEEP',
  1: 'ATTACK',
  2: 'MOVE',
  3: 'MOVE',
  4: 'RETREAT',
  5: 'GUARD',
  6: 'STICKY',
  7: 'ENTER',
  8: 'CAPTURE',
  9: 'HARVEST',
  10: 'AREA_GUARD',
  11: 'RETURN',
  12: 'STOP',
  13: 'AMBUSH',
  14: 'HUNT',
  15: 'UNLOAD',
  16: 'SABOTAGE',
  17: 'CONSTRUCTION',
  18: 'DECONSTRUCTION',
  19: 'REPAIR',
  20: 'RESCUE',
  21: 'MISSILE',
  22: 'HARMLESS',
};

async function wasmGreekWeapExitTanks(
  adapter: unknown,
  cells: Array<{ cx: number; cy: number }> = [{ cx: 50, cy: 62 }, { cx: 57, cy: 62 }],
) {
  return adapterPage(adapter).evaluate((args: {
    cells: Array<{ cx: number; cy: number }>;
    missionNames: Record<string, string | null>;
  }) => {
    const { cells, missionNames } = args;
    const missionName = (mission: number) => {
      const key = String(mission);
      return Object.prototype.hasOwnProperty.call(missionNames, key)
        ? missionNames[key]
        : key;
    };
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const wanted = new Set(cells.map(cell => `${cell.cx},${cell.cy}`));
    const tanks = [...(state.units ?? []), ...(state.enemies ?? [])]
      .filter((unit: any) =>
        unit.t === '2TNK' &&
        unit.house === 'Greece' &&
        wanted.has(`${unit.cx},${unit.cy}`))
      .map((unit: any) => ({
        type: unit.t,
        house: unit.house,
        cell: { cx: unit.cx, cy: unit.cy },
        lx: unit.lx,
        ly: unit.ly,
        mission: missionName(unit.m),
        missionQueue: missionName(unit.mq),
        missionTimer: unit.mt,
        isDriving: unit.drv === true,
      }))
      .sort((a: any, b: any) => a.cell.cx - b.cell.cx);

    return {
      tick: state.tick,
      rngState: state.rngState,
      tanks,
    };
  }, {
    cells,
    missionNames: CPP_MISSION_NAMES,
  }) as Promise<{
    tick: number;
    rngState: number;
    tanks: Array<{
      type: string;
      house: string;
      cell: { cx: number; cy: number };
      lx: number;
      ly: number;
      mission: string | null;
      missionQueue: string | null;
      missionTimer: number;
      isDriving: boolean;
    }>;
  }>;
}

async function tsGreekWeapExitTanks(
  adapter: unknown,
  cells: Array<{ cx: number; cy: number }> = [{ cx: 50, cy: 62 }, { cx: 57, cy: 62 }],
) {
  return adapterPage(adapter).evaluate((cells: Array<{ cx: number; cy: number }>) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const wanted = new Set(cells.map(cell => `${cell.cx},${cell.cy}`));
    const tanks = (game.entities ?? [])
      .filter((entity: any) =>
        entity.alive !== false &&
        entity.type === '2TNK' &&
        entity.house === 'Greece' &&
        wanted.has(`${entity.cell?.cx},${entity.cell?.cy}`))
      .map((entity: any) => ({
        type: entity.type,
        house: entity.house,
        cell: { cx: entity.cell.cx, cy: entity.cell.cy },
        lx: entity.leptonX,
        ly: entity.leptonY,
        mission: entity.mission,
        missionQueue: entity.missionQueue ?? null,
        missionTimer: entity.missionTimer,
        isDriving: entity.isDriving === true,
      }))
      .sort((a: any, b: any) => a.cell.cx - b.cell.cx);

    return {
      tick: game.tick,
      rngState: state.rngState,
      tanks,
    };
  }, cells) as Promise<{
    tick: number;
    rngState: number;
    tanks: Array<{
      type: string;
      house: string;
      cell: { cx: number; cy: number };
      lx: number;
      ly: number;
      mission: string;
      missionQueue: string | null;
      missionTimer: number;
      isDriving: boolean;
    }>;
  }>;
}

async function wasmGreekE3Snapshot(adapter: unknown, logicIndex = 99) {
  return adapterPage(adapter).evaluate((hint: number) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === hint);
    if (!row) throw new Error(`C++ SCU35EA Greek E3 logic ${hint} missing`);

    const infantry = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!infantry) throw new Error('C++ SCU35EA Greek E3 detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      hp: infantry.hp,
      maxHp: infantry.mhp,
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10],
      doing: row[11],
      lx: row[12],
      ly: row[13],
      arm: row[23],
      target: row[32] >= 0 && row[33] >= 0
        ? { rtti: row[32], index: row[33], lx: row[21], ly: row[22] }
        : null,
      primaryFacing: row[28],
      primaryDesiredFacing: row[29],
      nav: infantry.nlx !== undefined && infantry.nly !== undefined
        ? { lx: infantry.nlx, ly: infantry.nly }
        : null,
      headTo: infantry.hlx !== undefined && infantry.hly !== undefined
        ? { lx: infantry.hlx, ly: infantry.hly }
        : null,
      path: [infantry.p0, infantry.p1, infantry.p2, infantry.p3, infantry.p4, infantry.p5]
        .filter((facing: unknown): facing is number => typeof facing === 'number'),
    };
  }, logicIndex) as Promise<{
    tick: number;
    rngState: number;
    hp: number;
    maxHp: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    doing: number;
    lx: number;
    ly: number;
    arm: number;
    target: { rtti: number; index: number; lx: number; ly: number } | null;
    primaryFacing: number;
    primaryDesiredFacing: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: number[];
  }>;
}

async function tsGreekE3Snapshot(adapter: unknown, logicIndex = 99) {
  return adapterPage(adapter).evaluate((hint: number) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.logicIndexHint === hint);
    if (!entity) throw new Error(`TS SCU35EA Greek E3 logic ${hint} missing`);

    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      alive: entity.alive,
      hp: entity.hp,
      maxHp: entity.maxHp,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      doing: entity.doing,
      lx: entity.leptonX,
      ly: entity.leptonY,
      arm: entity.attackCooldown,
      target: entity.target
        ? {
            id: entity.target.id,
            type: entity.target.type,
            lx: entity.target.targetCoordLeptons().lx,
            ly: entity.target.targetCoordLeptons().ly,
            height: entity.target.objectHeightLeptons(),
          }
        : null,
      bodyFacing: entity.bodyFacing256,
      desiredFacing: entity.desiredFacing256,
      firePrepActive: entity.firePrepActive,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      headTo: entity.headToLX || entity.headToLY
        ? { lx: entity.headToLX, ly: entity.headToLY }
        : null,
      facings: entity.drivePathFacings.slice(0, 6),
    };
  }, logicIndex) as Promise<{
    tick: number;
    rngState: number;
    alive: boolean;
    hp: number;
    maxHp: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    doing: string;
    lx: number;
    ly: number;
    arm: number;
    target: { id: number; type: string; lx: number; ly: number; height: number } | null;
    bodyFacing: number;
    desiredFacing: number;
    firePrepActive: boolean;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    facings: number[];
  }>;
}

async function wasmVolkovSniperBulletSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const bullet = (state.bullets ?? [])
      .find((entry: any) => entry.type === 'Invisible' && entry.str === 100 && entry.wh === 1);
    return bullet
      ? {
          tick: state.tick,
          exists: true,
          lx: bullet.lx,
          ly: bullet.ly,
          tx: bullet.tx,
          ty: bullet.ty,
          timer: bullet.timer,
          max: bullet.max,
        }
      : { tick: state.tick, exists: false };
  }) as Promise<
    | { tick: number; exists: true; lx: number; ly: number; tx: number; ty: number; timer: number; max: number }
    | { tick: number; exists: false }
  >;
}

async function tsVolkovSniperBulletSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const volkov = game.entities.find((e: any) => e.type === 'GNRL' && e.house === 'USSR');
    const projectile = game.inflightProjectiles.find((entry: any) =>
      entry.weapon.name === 'Sniper' && entry.attackerId === volkov?.id);
    return projectile
      ? {
          tick: game.tick,
          exists: true,
          logicalLX: projectile.logicalLX,
          logicalLY: projectile.logicalLY,
          headToLX: projectile.headToLX,
          headToLY: projectile.headToLY,
          fuseTimer: projectile.fuseTimer,
          speed: projectile.speed,
        }
      : { tick: game.tick, exists: false };
  }) as Promise<
    | { tick: number; exists: true; logicalLX: number; logicalLY: number; headToLX: number; headToLY: number; fuseTimer: number; speed: number }
    | { tick: number; exists: false }
  >;
}

async function wasmRuntimeSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return {
      tick: state.tick,
      rngState: state.rngState,
      anims: (state.anims ?? []).map((entry: any) => ({
        logicIndex: entry.logicIndex,
        name: entry.name,
        stage: entry.stage,
        loops: entry.loops,
      })),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    anims: Array<{ logicIndex: number; name: string; stage: number; loops: number }>;
  }>;
}

async function tsRuntimeSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      logicAnims: game.logicAnims.map((entry: any) => ({
        logicIndex: entry.logicIndexHint,
        type: entry.type,
        x: entry.x,
        y: entry.y,
        stage: entry.stage,
        loops: entry.loops,
      })),
      cppSlotEffects: game.effects
        .filter((entry: any) => entry.cppLogicSlot === true)
        .map((entry: any) => ({
          logicIndex: entry.logicIndexHint,
          sprite: entry.sprite,
          frame: entry.frame,
          loops: entry.loops,
        })),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    logicAnims: Array<{ logicIndex: number; type: string; x: number; y: number; stage: number; loops: number }>;
    cppSlotEffects: Array<{ logicIndex: number; sprite?: string; frame: number; loops?: number }>;
  }>;
}

async function wasmBadrSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const badr = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.t === 'BADR');
    return badr
      ? { tick: state.tick, id: badr.id, hp: badr.hp, lx: badr.lx, ly: badr.ly, height: badr.hgt }
      : { tick: state.tick, id: null, hp: 0, lx: null, ly: null, height: null };
  }) as Promise<{
    tick: number;
    id: number | null;
    hp: number;
    lx: number | null;
    ly: number | null;
    height: number | null;
  }>;
}

async function tsBadrSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const badr = game.entities.find((e: any) => e.type === 'BADR');
    return badr
      ? {
          tick: game.tick,
          id: badr.id,
          alive: badr.alive,
          hp: badr.hp,
          lx: badr.leptonX,
          ly: badr.leptonY,
          height: badr.objectHeightLeptons(),
        }
      : { tick: game.tick, id: null, alive: false, hp: 0, lx: null, ly: null, height: null };
  }) as Promise<{
    tick: number;
    id: number | null;
    alive: boolean;
    hp: number;
    lx: number | null;
    ly: number | null;
    height: number | null;
  }>;
}

async function wasmSuperTeamSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return [237, 239].map((logicIndex) => {
      const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === logicIndex);
      if (!row) throw new Error(`C++ SCU35EA super-team logic ${logicIndex} missing`);
      const infantry = [...(state.units ?? []), ...(state.enemies ?? [])]
        .find((entry: any) => entry.id === row[6]);
      if (!infantry) throw new Error(`C++ SCU35EA super-team detail ${logicIndex} missing`);
      return {
        logicIndex,
        type: infantry.t,
        cx: infantry.cx,
        cy: infantry.cy,
        lx: infantry.lx,
        ly: infantry.ly,
        hp: infantry.hp,
        maxHp: infantry.mhp,
        mission: row[7],
        missionTimer: row[8],
        targetRtti: row[32],
        targetIndex: row[33],
      };
    });
  }) as Promise<Array<{
    logicIndex: number;
    type: string;
    cx: number;
    cy: number;
    lx: number;
    ly: number;
    hp: number;
    maxHp: number;
    mission: number;
    missionTimer: number;
    targetRtti: number;
    targetIndex: number;
  }>>;
}

async function tsSuperTeamSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    return [237, 239].map((logicIndex) => {
      const entity = game.entities.find((e: any) => e.logicIndexHint === logicIndex);
      if (!entity) throw new Error(`TS SCU35EA super-team logic ${logicIndex} missing`);
      return {
        logicIndex,
        type: entity.type,
        cx: entity.cell.cx,
        cy: entity.cell.cy,
        lx: entity.leptonX,
        ly: entity.leptonY,
        hp: entity.hp,
        maxHp: entity.maxHp,
        mission: entity.mission,
        missionTimer: entity.missionTimer,
        targetType: entity.target?.type ?? null,
      };
    });
  }) as Promise<Array<{
    logicIndex: number;
    type: string;
    cx: number;
    cy: number;
    lx: number;
    ly: number;
    hp: number;
    maxHp: number;
    mission: string;
    missionTimer: number;
    targetType: string | null;
  }>>;
}

async function wasmSovietDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const details = [...(state.units ?? []), ...(state.enemies ?? [])];
    const row = (state.logicLayer ?? []).find((entry: any[]) => {
      if (entry[1] !== 'DOG' || entry[2] !== 'USSR' || entry[3] !== 25 || entry[4] !== 81) return false;
      const detail = details.find((unit: any) => unit.id === entry[6]);
      return detail?.hp === 855;
    });
    if (!row) throw new Error('C++ SCU35EA dog-rider at (25,81) missing');

    const infantry = details.find((entry: any) => entry.id === row[6]);
    if (!infantry) throw new Error('C++ SCU35EA dog-rider detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      logicIndex: row[0],
      id: row[6],
      mission: row[7],
      missionTimer: row[8],
      doing: row[11],
      lx: row[12],
      ly: row[13],
      hp: infantry.hp,
      stage: infantry.stage ?? null,
      fear: infantry.fear ?? null,
      targetRtti: row[32],
      targetIndex: row[33],
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    logicIndex: number;
    id: number;
    mission: number;
    missionTimer: number;
    doing: number;
    lx: number;
    ly: number;
    hp: number;
    stage: number | null;
    fear: number | null;
    targetRtti: number;
    targetIndex: number;
  }>;
}

async function tsSovietDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((entry: any) =>
      entry.type === 'DOG' &&
      entry.house === 'USSR' &&
      entry.cell.cx === 25 &&
      entry.cell.cy === 81 &&
      entry.hp === 855
    );
    if (!entity) throw new Error('TS SCU35EA dog-rider at (25,81) missing');

    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      logicIndex: entity.logicIndexHint,
      id: entity.id,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      doing: entity.doing,
      doingStage: entity.doingStage,
      lx: entity.leptonX,
      ly: entity.leptonY,
      hp: entity.hp,
      fear: entity.fear,
      targetType: entity.target?.type ?? null,
      lastLogicProcessedTick: entity.lastLogicProcessedTick,
      unlimboTick: entity.unlimboTick,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    logicIndex: number;
    id: number;
    mission: string;
    missionTimer: number;
    doing: string;
    doingStage: number;
    lx: number;
    ly: number;
    hp: number;
    fear: number;
    targetType: string | null;
    lastLogicProcessedTick: number;
    unlimboTick: number;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU35 HUNT approach wall destroyer', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('allows a wall-destroying infantry HUNT approach to choose the C++ wall cell', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 1);
      const cpp = await wasmGreekE3Snapshot(handle.wasm);
      const ts = await tsGreekE3Snapshot(handle.ts);

      expect(cpp.tick).toBe(1);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.nav).toEqual({ lx: 6024, ly: 22152 });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts).toMatchObject({
        mission: 'HUNT',
        missionTimer: cpp.missionTimer,
        isDriving: cpp.isDriving,
        lx: cpp.lx,
        ly: cpp.ly,
        nav: cpp.nav,
        headTo: cpp.headTo,
      });
      expect(ts.facings.slice(0, cpp.path.length)).toEqual(cpp.path);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('applies the C++ multi-factory build-time divisor to Greek WEAP production', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 380);
      const cppFactories = await wasmGreekWeapFactories(handle.wasm);
      const tsFactories = await tsGreekWeapFactories(handle.ts);

      expect(cppFactories.tick).toBe(380);
      expect(tsFactories.tick).toBe(cppFactories.tick);
      expect(tsFactories.rngState >>> 0).toBe(cppFactories.rngState >>> 0);
      expect(cppFactories.factories).toEqual([
        {
          exitCell: { cx: 50, cy: 62 },
          type: '2TNK',
          progress: 54,
          done: true,
          building: false,
        },
        {
          exitCell: { cx: 57, cy: 62 },
          type: '2TNK',
          progress: 53,
          done: false,
          building: true,
        },
      ]);
      expect(tsFactories.factories).toEqual(cppFactories.factories);

      await stepBoth(handle, 1);
      const cppTank = await wasmGreek2TnkAt(handle.wasm, 50, 62);
      const tsTank = await tsGreek2TnkAt(handle.ts, 50, 62);

      expect(tsTank.tick).toBe(cppTank.tick);
      expect(tsTank.rngState >>> 0).toBe(cppTank.rngState >>> 0);
      expect(tsTank.unit).toEqual(cppTank.unit);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('queues MOVE while WEAP products drive out on the C++ factory track', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 429);
      const cpp = await wasmGreekWeapExitTanks(handle.wasm);
      const ts = await tsGreekWeapExitTanks(handle.ts);

      expect(cpp.tick).toBe(429);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.tanks).toEqual([
        {
          type: '2TNK',
          house: 'Greece',
          cell: { cx: 50, cy: 62 },
          lx: 12928,
          ly: 15872,
          mission: 'GUARD',
          missionQueue: 'MOVE',
          missionTimer: 35,
          isDriving: true,
        },
        {
          type: '2TNK',
          house: 'Greece',
          cell: { cx: 57, cy: 62 },
          lx: 14720,
          ly: 15872,
          mission: 'GUARD',
          missionQueue: 'MOVE',
          missionTimer: 36,
          isDriving: true,
        },
      ]);
      expect(ts.tanks).toEqual(cpp.tanks);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('preserves WEAP product team movement through the forced factory track', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 466);
      const cells = [{ cx: 50, cy: 63 }, { cx: 57, cy: 63 }];
      const cpp = await wasmGreekWeapExitTanks(handle.wasm, cells);
      const ts = await tsGreekWeapExitTanks(handle.ts, cells);

      expect(cpp.tick).toBe(466);
      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.tanks).toEqual([
        {
          type: '2TNK',
          house: 'Greece',
          cell: { cx: 50, cy: 63 },
          lx: 12928,
          ly: 16256,
          mission: 'MOVE',
          missionQueue: null,
          missionTimer: 14,
          isDriving: false,
        },
        {
          type: '2TNK',
          house: 'Greece',
          cell: { cx: 57, cy: 63 },
          lx: 14720,
          ly: 16256,
          mission: 'MOVE',
          missionQueue: null,
          missionTimer: 15,
          isDriving: false,
        },
      ]);
      expect(ts.tanks).toEqual(cpp.tanks);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps the retreating BADR alive until the C++ homing missile impact frame', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 105);
      const cppBeforeImpact = await wasmBadrSnapshot(handle.wasm);
      const tsBeforeImpact = await tsBadrSnapshot(handle.ts);

      expect(cppBeforeImpact).toMatchObject({
        tick: 105,
        hp: 3,
        lx: 5825,
        ly: 19904,
        height: 256,
      });
      expect(tsBeforeImpact).toMatchObject({
        tick: cppBeforeImpact.tick,
        alive: true,
        hp: cppBeforeImpact.hp,
        lx: cppBeforeImpact.lx,
        ly: cppBeforeImpact.ly,
        height: cppBeforeImpact.height,
      });

      await stepBoth(handle, 1);
      const cppAfterImpact = await wasmBadrSnapshot(handle.wasm);
      const tsAfterImpact = await tsBadrSnapshot(handle.ts);
      const cppShooter = await wasmGreekE3Snapshot(handle.wasm, 105);
      const tsShooter = await tsGreekE3Snapshot(handle.ts, 105);

      expect(cppAfterImpact).toMatchObject({ tick: 106, id: null, hp: 0 });
      expect(tsAfterImpact).toMatchObject({
        tick: cppAfterImpact.tick,
        alive: false,
        hp: 0,
      });
      expect(cppShooter.arm).toBe(49);
      expect(tsShooter.arm).toBe(cppShooter.arm);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('starts the RedEye firing animation at the C++ tick against falling Volkov', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 130);
      const cpp = await wasmGreekE3Snapshot(handle.wasm);
      const ts = await tsGreekE3Snapshot(handle.ts);

      expect(cpp.target).toMatchObject({ rtti: 13, index: 57 });
      expect(cpp.doing).toBe(4); // DO_FIRE_WEAPON
      expect(cpp.primaryFacing).toBe(160);

      expect(ts.target).toMatchObject({
        type: 'GNRL',
        lx: cpp.target!.lx,
      });
      expect(ts.target!.height).toBeGreaterThan(0);
      expect(ts.doing).toBe('fire');
      expect(ts.firePrepActive).toBe(true);
      expect(ts.bodyFacing).toBe(cpp.primaryFacing);
      expect(ts.desiredFacing).toBe(cpp.primaryDesiredFacing);
      expect(ts.arm).toBe(cpp.arm);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('launches a pending infantry shot at FireLaunch after the target has landed', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 160);
      const cpp = await wasmGreekE3Snapshot(handle.wasm, 105);
      const ts = await tsGreekE3Snapshot(handle.ts, 105);

      expect(cpp.tick).toBe(160);
      expect(cpp.doing).toBe(4); // DO_FIRE_WEAPON
      expect(cpp.arm).toBeGreaterThan(0);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.arm).toBe(cpp.arm);
      expect(ts.firePrepActive).toBe(false);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('approaches ground infantry using the selected Dragon range, not RedEye range', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 165);
      const cpp = await wasmGreekE3Snapshot(handle.wasm, 103);
      const ts = await tsGreekE3Snapshot(handle.ts, 103);

      expect(cpp.tick).toBe(165);
      expect(cpp.target).toMatchObject({ rtti: 13, index: 57 });
      expect(cpp.isDriving).toBe(true);
      expect(cpp.headTo).not.toBeNull();

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.target).toMatchObject({ type: 'GNRL' });
      expect(ts).toMatchObject({
        mission: 'HUNT',
        missionTimer: cpp.missionTimer,
        isDriving: cpp.isDriving,
        doing: 'walk',
        lx: cpp.lx,
        ly: cpp.ly,
        arm: cpp.arm,
        nav: cpp.nav,
        headTo: cpp.headTo,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('paradrops BADR cargo in C++ linked-list order with scenario overrides', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 154);
      const cpp = await wasmSuperTeamSnapshot(handle.wasm);
      const ts = await tsSuperTeamSnapshot(handle.ts);

      expect(cpp).toEqual([
        expect.objectContaining({
          logicIndex: 237,
          type: 'DOG',
          cx: 21,
          cy: 83,
          hp: 999,
          maxHp: 1000,
          mission: 5, // MISSION_GUARD
          missionTimer: 41,
        }),
        expect.objectContaining({
          logicIndex: 239,
          type: 'GNRL',
          cx: 21,
          cy: 82,
          hp: 2492,
          maxHp: 2500,
          mission: 5,
          missionTimer: 0,
        }),
      ]);

      expect(ts).toEqual([
        expect.objectContaining({
          logicIndex: 237,
          type: cpp[0].type,
          cx: cpp[0].cx,
          cy: cpp[0].cy,
          lx: cpp[0].lx,
          ly: cpp[0].ly,
          hp: cpp[0].hp,
          maxHp: cpp[0].maxHp,
          mission: 'GUARD',
          missionTimer: cpp[0].missionTimer,
        }),
        expect.objectContaining({
          logicIndex: 239,
          type: cpp[1].type,
          cx: cpp[1].cx,
          cy: cpp[1].cy,
          lx: cpp[1].lx,
          ly: cpp[1].ly,
          hp: cpp[1].hp,
          maxHp: cpp[1].maxHp,
          mission: 'GUARD',
          missionTimer: cpp[1].missionTimer,
        }),
      ]);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps Volkov sniper fire as an in-flight bullet when scenario Speed is inherited', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 204);
      const cppTarget = await wasmGreekE3Snapshot(handle.wasm, 100);
      const tsTarget = await tsGreekE3Snapshot(handle.ts, 100);
      const cppBullet = await wasmVolkovSniperBulletSnapshot(handle.wasm);
      const tsBullet = await tsVolkovSniperBulletSnapshot(handle.ts);

      expect(cppTarget).toMatchObject({
        tick: 204,
        hp: 45,
      });
      expect(tsTarget).toMatchObject({
        tick: cppTarget.tick,
        alive: true,
        hp: cppTarget.hp,
      });
      expect(cppBullet).toMatchObject({
        tick: 204,
        exists: true,
        tx: 6592,
        ty: 20800,
        max: 253,
      });
      expect(tsBullet).toMatchObject({
        tick: cppBullet.tick,
        exists: true,
        headToLX: 6592,
        headToLY: 20800,
        speed: 253,
      });
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps projectile and smoke AnimClass traversal in sync through tick 210', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 210);
      const cpp = await wasmRuntimeSnapshot(handle.wasm);
      const ts = await tsRuntimeSnapshot(handle.ts);

      expect(cpp.tick).toBe(210);
      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.anims.some(anim => anim.name === 'SMOKE_M')).toBe(true);
      expect(ts.logicAnims.some(anim => anim.type === 'smoke_m')).toBe(true);
      expect(ts.cppSlotEffects.some(effect => effect.sprite === 'smoke_m')).toBe(false);
      expect(ts.logicAnims.some(anim =>
        anim.type === 'art-exp1' &&
        Math.round(anim.x) === 618 &&
        Math.round(anim.y) === 1950
      )).toBe(false);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('keeps dog-rider unlimbo MissionClass timer on the C++ frame', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 225);
      const cppUnlimbo = await wasmSovietDogSnapshot(handle.wasm);
      const tsUnlimbo = await tsSovietDogSnapshot(handle.ts);
      expect(cppUnlimbo).toMatchObject({
        tick: 225,
        mission: 5, // MISSION_GUARD
        missionTimer: 14,
        doing: 20, // DO_DOG_MAUL
        hp: 855,
      });
      expect(tsUnlimbo).toMatchObject({
        tick: cppUnlimbo.tick,
        mission: 'GUARD',
        missionTimer: cppUnlimbo.missionTimer,
        doing: 'dog_maul',
        doingStage: 0,
        hp: cppUnlimbo.hp,
        targetType: null,
      });
      expect(tsUnlimbo.rngState >>> 0).toBe(cppUnlimbo.rngState >>> 0);

      await stepBoth(handle, 13);
      const cppBeforeGuard = await wasmSovietDogSnapshot(handle.wasm);
      const tsBeforeGuard = await tsSovietDogSnapshot(handle.ts);
      expect(cppBeforeGuard).toMatchObject({ tick: 238, missionTimer: 1 });
      expect(tsBeforeGuard.missionTimer).toBe(cppBeforeGuard.missionTimer);
      expect(tsBeforeGuard.targetType).toBeNull();
      expect(tsBeforeGuard.rngState >>> 0).toBe(cppBeforeGuard.rngState >>> 0);

      await stepBoth(handle, 1);
      const cppZero = await wasmSovietDogSnapshot(handle.wasm);
      const tsZero = await tsSovietDogSnapshot(handle.ts);
      expect(cppZero).toMatchObject({ tick: 239, missionTimer: 0 });
      expect(tsZero.missionTimer).toBe(cppZero.missionTimer);
      expect(tsZero.targetType).toBeNull();
      expect(tsZero.rngState >>> 0).toBe(cppZero.rngState >>> 0);

      await stepBoth(handle, 1);
      const cppGuard = await wasmSovietDogSnapshot(handle.wasm);
      const tsGuard = await tsSovietDogSnapshot(handle.ts);
      expect(cppGuard).toMatchObject({ tick: 240, missionTimer: 43 });
      expect(tsGuard.missionTimer).toBe(cppGuard.missionTimer);
      expect(tsGuard.targetType).toBe('E3');
      expect(tsGuard.rngState >>> 0).toBe(cppGuard.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
