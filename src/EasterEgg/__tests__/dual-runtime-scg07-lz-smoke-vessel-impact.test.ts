/**
 * Dual-runtime regression for the SCG07 visual mismatch around the landing zone.
 *
 * C++ source roots:
 * - taction.cpp:596-597 spawns ANIM_LZ_SMOKE for TACTION_DZ.
 * - adata.cpp:343-366 defines SMOKLAND as a 255-loop ground AnimClass.
 * - bullet.cpp:1037-1046 converts water explosions to VEH_HIT* when the
 *   impact cell is the same as the target vessel center cell.
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

async function wasmAnimState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const anims = state.anims ?? [];
    const lzSmoke = anims.find((anim: any) =>
      anim.name === 'SMOKLAND' && anim.cx === 25 && anim.cy === 58);
    const vesselHit = anims.find((anim: any) =>
      anim.name === 'VEH-HIT1' && anim.cx === 20 && anim.cy === 53);
    if (!lzSmoke) throw new Error('C++ SCG07EA tick-300 SMOKLAND missing');
    if (!vesselHit) throw new Error('C++ SCG07EA tick-300 VEH-HIT1 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      lzSmoke: {
        lx: lzSmoke.lx,
        ly: lzSmoke.ly,
        stage: lzSmoke.stage,
        loops: lzSmoke.loops,
      },
      vesselHit: {
        lx: vesselHit.lx,
        ly: vesselHit.ly,
        stage: vesselHit.stage,
      },
    };
  });
}

async function tsAnimState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const toLepton = (pixel: number) => Math.round(pixel * 256 / 24);
    const toCell = (pixel: number) => Math.floor(pixel / 24);
    const lzSmoke = (game.logicAnims ?? []).find((anim: any) =>
      anim.type === 'lz_smoke' && toLepton(anim.x) === 6528 && toLepton(anim.y) === 14976);
    const vesselHit = (game.logicAnims ?? []).find((anim: any) =>
      anim.type === 'veh-hit1' && toCell(anim.x) === 20 && toCell(anim.y) === 53);
    const sameCellWaterSplash = (game.logicAnims ?? []).find((anim: any) =>
      anim.type === 'water-exp1' && toCell(anim.x) === 20 && toCell(anim.y) === 53);
    if (!lzSmoke) throw new Error('TS SCG07EA tick-300 lz_smoke missing');
    if (!vesselHit) throw new Error('TS SCG07EA tick-300 veh-hit1 missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      lzSmoke: {
        lx: toLepton(lzSmoke.x),
        ly: toLepton(lzSmoke.y),
        stage: lzSmoke.stage,
        loops: lzSmoke.loops,
      },
      vesselHit: {
        lx: toLepton(vesselHit.x),
        ly: toLepton(vesselHit.y),
        stage: vesselHit.stage,
      },
      sameCellWaterSplash: Boolean(sameCellWaterSplash),
    };
  });
}

async function wasmSmudgesNearLz(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    return (state.smudges ?? [])
      .filter((s: any) => s.cx >= 22 && s.cx <= 32 && s.cy >= 56 && s.cy <= 65)
      .map((s: any) => ({ type: String(s.type).toLowerCase(), cx: s.cx, cy: s.cy, data: s.data ?? 0 }))
      .sort((a: any, b: any) => a.cy - b.cy || a.cx - b.cx || a.type.localeCompare(b.type) || a.data - b.data);
  });
}

async function tsSmudgesNearLz(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = (window as any).__agentState();
    return (state.smudges ?? [])
      .filter((s: any) => s.cx >= 22 && s.cx <= 32 && s.cy >= 56 && s.cy <= 65)
      .map((s: any) => ({ type: String(s.type).toLowerCase(), cx: s.cx, cy: s.cy, data: s.data ?? 0 }))
      .sort((a: any, b: any) => a.cy - b.cy || a.cx - b.cx || a.type.localeCompare(b.type) || a.data - b.data);
  });
}

async function wasmLandingZoneJeepTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const all = [...(state.units ?? []), ...(state.enemies ?? []), ...(state.infantry ?? [])];
    const jeep = all.find((u: any) =>
      u.house === 'England' && (u.type ?? u.t) === 'JEEP' && u.cx === 27 && u.cy === 58);
    const movingE4 = all.find((u: any) =>
      u.house === 'USSR' && (u.type ?? u.t) === 'E4' && u.cx === 30 && u.cy === 60);
    if (!jeep) throw new Error('C++ SCG07EA landing-zone JEEP missing');
    if (!movingE4) throw new Error('C++ SCG07EA moving E4 missing');
    return {
      tick: state.tick,
      target: {
        lx: jeep.tlx,
        ly: jeep.tly,
        cx: Math.floor(jeep.tlx / 256),
        cy: Math.floor(jeep.tly / 256),
      },
      movingE4Discovered: movingE4.dp,
    };
  });
}

async function tsLandingZoneJeepTarget(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const jeep = game.entities.find((e: any) =>
      e.house === 'England' && e.type === 'JEEP' && e.cell.cx === 27 && e.cell.cy === 58);
    const movingE4 = game.entities.find((e: any) =>
      e.house === 'USSR' && e.type === 'E4' && e.cell.cx === 30 && e.cell.cy === 60);
    if (!jeep) throw new Error('TS SCG07EA landing-zone JEEP missing');
    if (!movingE4) throw new Error('TS SCG07EA moving E4 missing');
    return {
      tick: state.tick,
      target: jeep.target ? {
        lx: jeep.target.leptonX,
        ly: jeep.target.leptonY,
        cx: jeep.target.cell.cx,
        cy: jeep.target.cell.cy,
      } : null,
      movingE4Discovered: game.discoveredEntityIds.has(movingE4.id),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07 LZ smoke and vessel impact anims', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps SMOKLAND alive and converts same-cell vessel water impacts to VEH-HIT1', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 300);
      const cpp = await wasmAnimState(handle.wasm);
      const ts = await tsAnimState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(ts.lzSmoke).toEqual(cpp.lzSmoke);
      expect(ts.vesselHit.stage).toBe(cpp.vesselHit.stage);
      expect(ts.sameCellWaterSplash).toBe(false);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('discovers the moving E4 through C++ Map_Cell expansion before the LZ JEEP fires', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 175);
      const cpp = await wasmLandingZoneJeepTarget(handle.wasm);
      const ts = await tsLandingZoneJeepTarget(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.movingE4Discovered).toBe(cpp.movingE4Discovered);
      expect(ts.movingE4Discovered).toBe(true);
      expect(ts.target).toEqual(cpp.target);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('matches napalm scorcher smudges near the landing zone', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 520);
      expect(await tsSmudgesNearLz(handle.ts)).toEqual(await wasmSmudgesNearLz(handle.wasm));
    }, { wasmSeed: 0 });
  }, 300_000);
});
