/**
 * Region trace harness for mission parity debugging.
 *
 * Captures C++ WASM and TS state near an arbitrary map region at selected
 * ticks. This is intentionally data-gathering only: it saves local entity,
 * structure, bullet, animation, and target state under artifacts/ so visible
 * screen divergences can be tied back to gameplay state without mission-specific
 * assertions.
 *
 * Usage:
 *   BASE_URL=http://localhost:3001 TS_BASE_URL=http://localhost:3001 \
 *   SCENARIO=SCG12EA REGION=80,77,85,84 TICKS=0,1,25,50 \
 *   pnpm exec playwright test scripts/test-region-trace.ts --reporter=line
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const SCENARIO = process.env.SCENARIO ?? 'SCG12EA';
const REGION = parseRegion(process.env.REGION ?? '80,77,85,84');
const TICKS = (process.env.TICKS ?? '0,1,25,50').split(',').map(Number);
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'artifacts', 'region-trace');
const HARNESS_SALT = process.env.HARNESS_SALT ?? 'anti-shim-region-v1';
const CAPTURE_SCREEN = process.env.CAPTURE_SCREEN === '1';
const TS_FOG_MODE = process.env.TS_FOG_MODE;
const WATCH_TS_CELL = process.env.WATCH_TS_CELL ? parseCell(process.env.WATCH_TS_CELL) : null;
const WATCH_TS_TICK = process.env.WATCH_TS_TICK === undefined ? null : Number(process.env.WATCH_TS_TICK);
const WATCH_TS_TYPE = process.env.WATCH_TS_TYPE;

type Side = 'wasm' | 'ts';

function parseRegion(raw: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const [minX, minY, maxX, maxY] = raw.split(',').map(Number);
  if ([minX, minY, maxX, maxY].some(n => !Number.isFinite(n))) {
    throw new Error(`REGION must be "minX,minY,maxX,maxY", got ${raw}`);
  }
  return { minX, minY, maxX, maxY };
}

function parseCell(raw: string): { cx: number; cy: number } {
  const [cx, cy] = raw.split(',').map(Number);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    throw new Error(`WATCH_TS_CELL must be "cx,cy", got ${raw}`);
  }
  return { cx, cy };
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function baseWithSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function addHarnessNoise(url: URL, side: Side): string {
  const hash = hashText(`${HARNESS_SALT}:${SCENARIO}:${side}`);
  url.searchParams.set('__parityHarness', 'region-salted');
  url.searchParams.set('__parityToken', hash.toString(36));
  url.searchParams.set('__paritySide', side);
  url.searchParams.set('__noop', `${(hash >>> 7) % 997}`);
  return url.toString();
}

function wasmUrl(): string {
  const url = new URL('/ra/original.html', baseWithSlash(BASE_URL));
  url.searchParams.set('scenario', `${SCENARIO}.INI`);
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('agentharness', '1');
  url.searchParams.set('seed', '0');
  return addHarnessNoise(url, 'wasm');
}

function tsUrl(): string {
  const url = new URL(TS_BASE_URL);
  url.searchParams.set('anttest', 'agent');
  url.searchParams.set('scenario', SCENARIO);
  url.searchParams.set('difficulty', 'normal');
  if (TS_FOG_MODE) url.searchParams.set('fog', TS_FOG_MODE);
  return addHarnessNoise(url, 'ts');
}

function inRegion(cx: number, cy: number): boolean {
  return cx >= REGION.minX && cx <= REGION.maxX && cy >= REGION.minY && cy <= REGION.maxY;
}

function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
}

function saveFrame(filePath: string, dataUrl: string | null): void {
  if (!dataUrl) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, dataUrlToBuffer(dataUrl));
}

test(`${SCENARIO} region trace ${REGION.minX},${REGION.minY}-${REGION.maxX},${REGION.maxY}`, async ({ browser }) => {
  test.setTimeout(8 * 60 * 1000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(wasmUrl(), { waitUntil: 'load' }),
    tsPage.goto(tsUrl(), { waitUntil: 'load' }),
  ]);

  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as unknown as { Module?: { ccall?: (...args: unknown[]) => string } }).Module;
        if (!M?.ccall) return false;
        const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
        return (s.units?.length ?? 0) + (s.enemies?.length ?? 0) + (s.structures?.length ?? 0) > 0;
      } catch {
        return false;
      }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as unknown as { __agentReady?: boolean }).__agentReady === true, {
      timeout: 120_000,
      polling: 1000,
    }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as unknown as { Module: { ccall: (...args: unknown[]) => string } }).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tsPage.evaluate((seed: number) => {
    (window as unknown as { __syncRngSeed?: (seed: number) => void }).__syncRngSeed?.(seed);
  }, wasmSeed);

  const sortedTicks = [...TICKS].sort((a, b) => a - b);
  let prevTick = 0;
  const snapshots: unknown[] = [];

  for (const tick of sortedTicks) {
    const step = tick - prevTick;
    if (step < 0) throw new Error('TICKS must be nondecreasing');
    if (step > 0) {
      let remaining = step;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 300);
        remaining -= chunk;
        await Promise.all([
          wasmPage.evaluate(async (n: number) => {
            const r = (window as unknown as { __agentStep: (n: number) => Promise<unknown> | unknown }).__agentStep(n);
            if (r && typeof (r as Promise<unknown>).then === 'function') await r;
          }, chunk),
          tsPage.evaluate((n: number) => {
            (window as unknown as { __agentStep?: (n: number) => unknown }).__agentStep?.(n);
          }, chunk),
        ]);
      }
    }
    prevTick = tick;

    const [wasm, ts] = await Promise.all([
      wasmPage.evaluate((region) => {
        const inBox = (cx: number, cy: number) => cx >= region.minX && cx <= region.maxX && cy >= region.minY && cy <= region.maxY;
        const M = (window as unknown as { Module: { ccall: (...args: unknown[]) => string } }).Module;
        const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
        const localUnits = [...(s.units ?? []), ...(s.enemies ?? []), ...(s.infantry ?? []), ...(s.aircraft ?? []), ...(s.vessels ?? [])]
          .filter((u: { cx?: number; cy?: number }) => inBox(Number(u.cx), Number(u.cy)));
        const cells = [];
        for (let cy = region.minY; cy <= region.maxY; cy++) {
          for (let cx = region.minX; cx <= region.maxX; cx++) {
            try {
              cells.push(JSON.parse(M.ccall('agent_get_cell_info', 'string', ['number', 'number', 'number'], [cx, cy, -1])));
            } catch {
              cells.push({ cx, cy, error: 'agent_get_cell_info failed' });
            }
          }
        }
        return {
          tick: s.tick,
          rngState: s.rngState,
          rngCalls: s.rngCalls,
          alliedHouses: s.alliedHouses ?? [],
          units: localUnits,
          structures: (s.structures ?? []).filter((st: { cx?: number; cy?: number }) => inBox(Number(st.cx), Number(st.cy))),
          logicLayer: (s.logicLayer ?? []).filter((row: unknown[]) => inBox(Number(row[3]), Number(row[4]))),
          bullets: (s.bullets ?? []).filter((b: { cx?: number; cy?: number; tx?: number; ty?: number }) =>
            inBox(Number(b.cx), Number(b.cy)) || inBox(Number(b.tx), Number(b.ty))),
          bulletScatterLog: (s.bulletScatterLog ?? []).filter((entry: { cx?: number; cy?: number; tx?: number; ty?: number }) =>
            inBox(Number(entry.cx), Number(entry.cy)) || inBox(Number(entry.tx), Number(entry.ty))),
          anims: (s.anims ?? []).filter((a: { cx?: number; cy?: number }) => inBox(Number(a.cx), Number(a.cy))),
          cells,
          debugMoves: (s.debugMoves ?? []).filter((m: number[]) => {
            const x1 = Number(m[1]);
            const y1 = Number(m[2]);
            const x2 = Number(m[3]);
            const y2 = Number(m[4]);
            const c1x = Math.trunc(x1 / 256);
            const c1y = Math.trunc(y1 / 256);
            const c2x = Math.trunc(x2 / 256);
            const c2y = Math.trunc(y2 / 256);
            return inBox(c1x, c1y) || inBox(c2x, c2y);
          }),
          tarcomLog: (s.tarcomLog ?? []).filter((entry: { cell?: string; tcell?: string }) => {
            const text = `${entry.cell ?? ''} ${entry.tcell ?? ''}`;
            return text.includes(`(${region.minX},`) || text.includes(`,${region.minY})`) ||
              [...Array(region.maxX - region.minX + 1)].some((_, i) =>
                [...Array(region.maxY - region.minY + 1)].some((__, j) =>
                  text.includes(`(${region.minX + i},${region.minY + j})`)));
          }),
        };
      }, REGION),
      tsPage.evaluate((region) => {
        const inBox = (cx: number, cy: number) => cx >= region.minX && cx <= region.maxX && cy >= region.minY && cy <= region.maxY;
        const game = (window as unknown as { __agentGame?: unknown }).__agentGame as {
          tick: number;
          playerHouse: string;
          entities: Array<Record<string, unknown>>;
          structures: Array<Record<string, unknown>>;
          bullets?: Array<Record<string, unknown>>;
          inflightProjectiles?: Array<Record<string, unknown>>;
          anims?: Array<Record<string, unknown>>;
          isAllied?: (a: string, b: string) => boolean;
        };
        const state = (window as unknown as { __agentState?: () => Record<string, unknown> }).__agentState?.() ?? {};
        const entityRows = game.entities
          .filter((e) => e?.alive !== false && e.cell && inBox(Number((e.cell as { cx: number }).cx), Number((e.cell as { cy: number }).cy)))
          .map((e, idx) => ({
            idx,
            id: e.id,
            type: e.type,
            house: e.house,
            cell: e.cell,
            lx: e.leptonX,
            ly: e.leptonY,
            prevPos: e.prevPos,
            isDriving: e.isDriving,
            isLocked: e.isLocked,
            wasMoving: e.wasMoving,
            moveTarget: e.moveTarget,
            forceFirePos: e.forceFirePos,
            headToLX: e.headToLX,
            headToLY: e.headToLY,
            trackControlIndex: e.trackControlIndex,
            trackIndex: e.trackIndex,
            pathIndex: e.pathIndex,
            pathLength: Array.isArray(e.path) ? e.path.length : undefined,
            path: Array.isArray(e.path) ? e.path.slice(0, 16) : undefined,
            drivePathFacings: Array.isArray(e.drivePathFacings) ? e.drivePathFacings.slice(0, 16) : undefined,
            pathDelay: e.pathDelay,
            pathThreshold: e.pathThreshold,
            tryCount: e.tryCount,
            teamInitiated: e.teamInitiated,
            hp: e.hp,
            maxHp: e.maxHp,
            mission: e.mission,
            missionTimer: e.missionTimer,
            missionQueue: e.missionQueue ?? null,
            teamRef: !!e.teamRef,
            teamMissions: e.teamMissions,
            teamMissionIndex: e.teamMissionIndex,
            attackCooldown: e.attackCooldown,
            attackCooldown2: e.attackCooldown2,
            attackCooldownAtLogicStart: e.attackCooldownAtLogicStart,
            attackCooldown2AtLogicStart: e.attackCooldown2AtLogicStart,
            burstCount: e.burstCount,
            burstDelay: e.burstDelay,
            isSecondShot: e.isSecondShot,
            facing: e.facing,
            desiredFacing: e.desiredFacing,
            bodyFacing256: e.bodyFacing256,
            bodyFacing32: e.bodyFacing32,
            desiredFacing256: e.desiredFacing256,
            trackNumber: e.trackNumber,
            trackCellSpan: e.trackCellSpan,
            trackFlags: e.trackFlags,
            speedAccum: e.speedAccum,
            driveSpeed: e.driveSpeed,
            turretFacing: e.turretFacing,
            desiredTurretFacing: e.desiredTurretFacing,
            turretFacing256: e.turretFacing256,
            desiredTurretFacing256: e.desiredTurretFacing256,
            turretFacing32: e.turretFacing32,
            weapon: e.weapon && typeof e.weapon === 'object'
              ? (e.weapon as Record<string, unknown>).name
              : null,
            fireCoord: e.weapon && typeof (e as { fireCoordForWeapon?: unknown }).fireCoordForWeapon === 'function'
              ? (e as { fireCoordForWeapon: (weapon: unknown) => unknown }).fireCoordForWeapon(e.weapon)
              : null,
            target: e.target ? {
              id: (e.target as Record<string, unknown>).id,
              type: (e.target as Record<string, unknown>).type,
              house: (e.target as Record<string, unknown>).house,
              cell: (e.target as Record<string, unknown>).cell,
            } : null,
            targetStructure: e.targetStructure ? {
              type: (e.targetStructure as Record<string, unknown>).type,
              house: (e.targetStructure as Record<string, unknown>).house,
              cx: (e.targetStructure as Record<string, unknown>).cx,
              cy: (e.targetStructure as Record<string, unknown>).cy,
              hp: (e.targetStructure as Record<string, unknown>).hp,
            } : null,
            isPlayerUnit: e.isPlayerUnit,
            alive: e.alive,
          }));
        const structureRows = game.structures
          .filter((s) => s?.alive !== false && inBox(Number(s.cx), Number(s.cy)))
          .map((s, idx) => ({
            idx,
            type: s.type,
            house: s.house,
            cx: s.cx,
            cy: s.cy,
            hp: s.hp,
            maxHp: s.maxHp,
            triggerName: s.triggerName,
            mission: s.mission,
            missionTimer: s.missionTimer,
            alive: s.alive,
          }));
        const bulletRows = (game.bullets ?? []).filter((b) => {
          const c = b.cell as { cx?: number; cy?: number } | undefined;
          const t = b.targetCell as { cx?: number; cy?: number } | undefined;
          return (c && inBox(Number(c.cx), Number(c.cy))) || (t && inBox(Number(t.cx), Number(t.cy)));
        });
        const projectileRows = (game.inflightProjectiles ?? []).filter((p) => {
          const cx = Math.floor(Number(p.x ?? p.impactX ?? 0) / 24);
          const cy = Math.floor(Number(p.y ?? p.impactY ?? 0) / 24);
          const tx = Math.floor(Number(p.targetX ?? p.impactX ?? 0) / 24);
          const ty = Math.floor(Number(p.targetY ?? p.impactY ?? 0) / 24);
          const sx = Math.floor(Number(p.startX ?? p.logicalLX ?? 0) / 24);
          const sy = Math.floor(Number(p.startY ?? p.logicalLY ?? 0) / 24);
          return inBox(cx, cy) || inBox(tx, ty) || inBox(sx, sy);
        }).map((p) => ({
          type: p.type,
          weapon: p.weapon && typeof p.weapon === 'object'
            ? (p.weapon as Record<string, unknown>).name
            : undefined,
          startX: p.startX,
          startY: p.startY,
          x: p.x,
          y: p.y,
          targetX: p.targetX,
          targetY: p.targetY,
          impactX: p.impactX,
          impactY: p.impactY,
          logicalLX: p.logicalLX,
          logicalLY: p.logicalLY,
          headToLX: p.headToLX,
          headToLY: p.headToLY,
          arcHeight: p.arcHeight,
          arcRiser: p.arcRiser,
          facing256: p.facing256,
          directHit: p.directHit,
          currentFrame: p.currentFrame,
          travelFrames: p.travelFrames,
          fuelTimer: p.fuelTimer,
          fuseTimer: p.fuseTimer,
          speed: p.speed,
          speedAdd: p.speedAdd,
          speedAccum: p.speedAccum,
          timer: p.timer,
          sourceId: p.sourceId,
          attackerId: p.attackerId,
          targetId: p.targetId,
          logicIndexHint: p.logicIndexHint,
          processedLogicTick: p.processedLogicTick,
          targetStructure: p.targetStructure ? {
            type: (p.targetStructure as Record<string, unknown>).type,
            house: (p.targetStructure as Record<string, unknown>).house,
            cx: (p.targetStructure as Record<string, unknown>).cx,
            cy: (p.targetStructure as Record<string, unknown>).cy,
          } : null,
        }));
        const animRows = (game.anims ?? []).filter((a) => {
          const c = a.cell as { cx?: number; cy?: number } | undefined;
          return c && inBox(Number(c.cx), Number(c.cy));
        });
        const effectRows = (game.effects ?? []).filter((e) => {
          const cx = Math.trunc(Number(e.x) / 24);
          const cy = Math.trunc(Number(e.y) / 24);
          return inBox(cx, cy);
        });
        const cellRows = [];
        const map = game.map as {
          getTerrain?: (cx: number, cy: number) => unknown;
          getWallType?: (cx: number, cy: number) => string;
          getWallOwner?: (cx: number, cy: number) => unknown;
          isBridgeCell?: (cx: number, cy: number) => boolean;
          getOccupancy?: (cx: number, cy: number) => number;
          getVehicleTrackReservation?: (cx: number, cy: number) => number;
          templateType?: Uint16Array | number[];
          templateIcon?: Uint8Array | number[];
          overlay?: Uint8Array | number[];
        } | undefined;
        for (let cy = region.minY; cy <= region.maxY; cy++) {
          for (let cx = region.minX; cx <= region.maxX; cx++) {
            const cellIndex = cy * 128 + cx;
            cellRows.push({
              cx,
              cy,
              terrain: map?.getTerrain?.(cx, cy),
              wallType: map?.getWallType?.(cx, cy),
              wallOwner: map?.getWallOwner?.(cx, cy),
              bridge: map?.isBridgeCell?.(cx, cy),
              templateType: map?.templateType?.[cellIndex],
              templateIcon: map?.templateIcon?.[cellIndex],
              overlay: map?.overlay?.[cellIndex],
              occupancy: map?.getOccupancy?.(cx, cy) ?? 0,
              reservation: map?.getVehicleTrackReservation?.(cx, cy) ?? 0,
            });
          }
        }
        return {
          tick: game.tick,
          playerHouse: game.playerHouse,
          alliedHouses: state.alliedHouses ?? [],
          rngState: state.rngState,
          rngCalls: state.rngCalls,
          mutationLog: ((window as unknown as { __tsMutationLog?: unknown[] }).__tsMutationLog ?? []).slice(-64),
          units: entityRows,
          structures: structureRows,
          bullets: bulletRows,
          projectiles: projectileRows,
          anims: animRows,
          effects: effectRows,
          cells: cellRows,
        };
      }, REGION),
    ]);

    const snapshot = { scenario: SCENARIO, region: REGION, tick, wasm, ts };
    snapshots.push(snapshot);
    saveJson(path.join(OUT_DIR, `${SCENARIO}_t${tick}_${REGION.minX}-${REGION.minY}_${REGION.maxX}-${REGION.maxY}.json`), snapshot);
    if (CAPTURE_SCREEN) {
      const [wasmFrame, tsFrame] = await Promise.all([
        wasmPage.evaluate(() => {
          const M = (window as unknown as { Module: { ccall: (...args: unknown[]) => unknown; HEAPU8?: Uint8Array } }).Module;
          M.ccall('agent_render', null, [], []);
          const ptr = (window as unknown as { __agentFramePtr?: number }).__agentFramePtr;
          if (!ptr || !M.HEAPU8) return null;
          const w = 640;
          const h = 400;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) return null;
          const img = ctx.createImageData(w, h);
          for (let i = 0; i < w * h * 4; i++) img.data[i] = M.HEAPU8[ptr + i];
          ctx.putImageData(img, 0, 0);
          return c.toDataURL('image/png');
        }),
        tsPage.evaluate(() => {
          (window as unknown as { __agentStep?: (n: number) => unknown }).__agentStep?.(0);
          const c = document.querySelector('canvas');
          return c?.toDataURL('image/png') ?? null;
        }),
      ]);
      const stem = `${SCENARIO}_t${tick}_${REGION.minX}-${REGION.minY}_${REGION.maxX}-${REGION.maxY}`;
      saveFrame(path.join(OUT_DIR, `${stem}_wasm.png`), wasmFrame);
      saveFrame(path.join(OUT_DIR, `${stem}_ts.png`), tsFrame);
    }

    const wasmAny = wasm as { units: unknown[]; structures: unknown[]; bullets: unknown[]; anims: unknown[] };
    const tsAny = ts as { units: unknown[]; structures: unknown[]; bullets: unknown[]; projectiles?: unknown[]; anims: unknown[] };
    console.log(
      `${SCENARIO} t${tick}: ` +
      `units ${wasmAny.units.length}/${tsAny.units.length}, ` +
      `structures ${wasmAny.structures.length}/${tsAny.structures.length}, ` +
      `bullets ${wasmAny.bullets.length}/${tsAny.bullets.length}, ` +
      `projectiles ${tsAny.projectiles?.length ?? 0}, ` +
      `anims ${wasmAny.anims.length}/${tsAny.anims.length}`,
    );

    if (WATCH_TS_CELL &&
        WATCH_TS_TICK !== null &&
        Number.isFinite(WATCH_TS_TICK) &&
        tick === WATCH_TS_TICK) {
      await tsPage.evaluate(({ watchCell, watchType }) => {
        const w = window as unknown as {
          __agentGame?: { entities: Array<Record<string, unknown>>; tick: number };
          __tsMutationLog?: Array<Record<string, unknown>>;
        };
        const game = w.__agentGame;
        if (!game) return;
        w.__tsMutationLog = [];
        const target = game.entities.find((e) => {
          const cell = e.cell as { cx?: number; cy?: number } | undefined;
          return e?.alive !== false &&
            (!watchType || e.type === watchType) &&
            Number(cell?.cx) === watchCell.cx &&
            Number(cell?.cy) === watchCell.cy;
        });
        if (!target) {
          w.__tsMutationLog.push({ tick: game.tick, event: 'watch-target-not-found', watchCell, watchType });
          return;
        }
        w.__tsMutationLog.push({
          tick: game.tick,
          event: 'watch-start',
          id: target.id,
          type: target.type,
          cell: target.cell,
        });
        for (const field of [
          'moveTarget', 'path', 'pathIndex', 'trackNumber', 'isDriving',
          'forceFirePos', 'desiredFacing256', 'desiredFacing',
          'desiredTurretFacing256', 'desiredTurretFacing', 'attackCooldown',
        ]) {
          let value = target[field];
          Object.defineProperty(target, field, {
            configurable: true,
            enumerable: true,
            get() { return value; },
            set(next) {
              const before = value;
              value = next;
              w.__tsMutationLog?.push({
                tick: game.tick,
                id: target.id,
                field,
                before,
                after: next,
                stack: new Error().stack,
              });
            },
          });
        }
      }, { watchCell: WATCH_TS_CELL, watchType: WATCH_TS_TYPE });
    }
  }

  saveJson(path.join(OUT_DIR, `${SCENARIO}_${REGION.minX}-${REGION.minY}_${REGION.maxX}-${REGION.maxY}_summary.json`), snapshots);

  await wasmCtx.close();
  await tsCtx.close();
});

void inRegion;
