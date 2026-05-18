/**
 * Per-entity RNG diff — tick-by-tick comparison of WASM vs TS RNG call logs.
 *
 * Both engines already have per-entity source tagging:
 *   WASM: g_rng_source_tag in logic.cpp → rngLog in agent_get_state
 *   TS:   ScenarioRandom._sourceTag → _seedLog via __rngTagControl
 *
 * Tag scheme (matching logic.cpp:288-296):
 *   10000 + logicIdx  = infantry
 *   11000 + logicIdx  = units (vehicles)
 *   12000 + logicIdx  = buildings
 *   13000 + logicIdx  = aircraft
 *   14000 + logicIdx  = vessels
 *   15000 + logicIdx  = bullets
 *   16000 + logicIdx  = anims
 *   1 = Team AI, 3 = Map.Logic, 4 = Factory AI, 5 = House AI preamble
 *   20 = Do_Fade_AI, 21 = LogicTrigger
 *
 * Usage:
 *   SCENARIO=SCG08EA START=89 END=100 npx playwright test scripts/test-rng-entity-diff.ts
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const TS_FOG_MODE = process.env.TS_FOG_MODE ?? 'source';
const scenario = process.env.SCENARIO ?? 'SCG08EA';
const startTick = Number(process.env.START ?? 89);
const endTick = Number(process.env.END ?? 100);
const HARNESS_SALT = process.env.HARNESS_SALT ?? 'anti-shim-v1';
const DUMP_SPLASH = process.env.DUMP_SPLASH === '1';
const DUMP_PROJECTILES = process.env.DUMP_PROJECTILES === '1';
const DUMP_VESSELS = process.env.DUMP_VESSELS === '1';
const DUMP_AIRCRAFT = process.env.DUMP_AIRCRAFT === '1';
const DUMP_HOUSES = process.env.DUMP_HOUSES === '1';
const DUMP_UNITS = process.env.DUMP_UNITS === '1';
const DUMP_FOOT = process.env.DUMP_FOOT === '1';
const DUMP_ANIMS = process.env.DUMP_ANIMS === '1';
const DUMP_PRE_ANIMS = process.env.DUMP_PRE_ANIMS === '1';
const DUMP_WASM_DEBUG = process.env.DUMP_WASM_DEBUG === '1';
const DUMP_TRIGGERS = process.env.DUMP_TRIGGERS === '1';
const DUMP_STRUCTURES = process.env.DUMP_STRUCTURES === '1';
const DUMP_LOGIC_LAYER = process.env.DUMP_LOGIC_LAYER !== '0';
const DUMP_TAGGED = process.env.DUMP_TAGGED !== '0';
// agent_harness.cpp serializes at most this many RNG log entries. Past the cap,
// a matching post-tick seed means RNG parity held, but log length comparisons
// are incomplete on the C++ side.
const WASM_RNG_LOG_CAP = 1024;

const MULT_CONSTANT = 0x41C64E6D;
const ADD_CONSTANT = 0x00003039;

function nextScenarioSeed(seed: number): number {
  return (Math.imul(seed >>> 0, MULT_CONSTANT) + ADD_CONSTANT) >>> 0;
}

function filterScenarioRngLog(log: Array<[number, number, number]>, startSeed: number): Array<[number, number, number]> {
  const filtered: Array<[number, number, number]> = [];
  let seed = startSeed >>> 0;
  for (const entry of log) {
    const expected = nextScenarioSeed(seed);
    if ((entry[0] >>> 0) === expected) {
      filtered.push(entry);
      seed = expected;
    }
  }
  return filtered;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addHarnessNoise(url: URL, scenarioName: string, side: 'wasm' | 'ts'): string {
  const hash = hashText(`${HARNESS_SALT}:${scenarioName}:${side}`);
  url.searchParams.set('__parityHarness', 'salted');
  url.searchParams.set('__parityToken', hash.toString(36));
  url.searchParams.set('__paritySide', side);
  url.searchParams.set('__noop', `${(hash >>> 7) % 997}`);
  return url.toString();
}

function wasmUrl(baseUrl: string, scenarioName: string): string {
  const url = new URL('/ra/original.html', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('scenario', `${scenarioName}.INI`);
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('agentharness', '1');
  url.searchParams.set('seed', '0');
  return addHarnessNoise(url, scenarioName, 'wasm');
}

function tsUrl(baseUrl: string, scenarioName: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('anttest', 'agent');
  url.searchParams.set('scenario', scenarioName);
  url.searchParams.set('difficulty', 'normal');
  if (TS_FOG_MODE) url.searchParams.set('fog', TS_FOG_MODE);
  return addHarnessNoise(url, scenarioName, 'ts');
}

function stepPlan(total: number, key: string, maxChunk: number): number[] {
  const plan: number[] = [];
  let remaining = total;
  let state = hashText(`${HARNESS_SALT}:${key}:${total}:${maxChunk}`);
  while (remaining > 0) {
    state = (Math.imul(state ^ 0x9e3779b9, 0x85ebca6b) + 0xc2b2ae35) >>> 0;
    const cap = Math.min(remaining, maxChunk);
    const chunk = 1 + (state % cap);
    plan.push(chunk);
    remaining -= chunk;
  }
  return plan;
}

function tagName(tag: number): string {
  // ============================================================================
  // Tag-range disambiguation (Phase 0 checkpoint 0.1 — plan §0 line 132).
  //
  // Prior sessions observed collapsing of 200-1999 tags to `Expert_AI`; the
  // canonical ranges are:
  //   200-1999   → house AI subranges (tag=200 Expert_AI, 100-199 cascade,
  //                remaining 201-1999 reserved for future house-tag overrides)
  //   2000-9999  → terrain index (logic-layer TERRAIN_MINE default)
  //   10000+     → logic-indexed entity tags (infantry/unit/building/etc.)
  //
  // Granular override tags (30000/40000/50000/60000/70000 ranges) below are
  // set INSIDE specific functions and fire ON TOP of the logic-layer tag.
  // ============================================================================

  // --- 10000+: logic-indexed entity tags (logic.cpp:288-298) ---
  // Object-AI loop assigns these per iteration; a granular tag override may
  // fire ON TOP of this within the entity's AI — but the RNG log captures
  // whichever was active at call time.
  if (tag >= 16000 && tag < 17000) return `anim[${tag - 16000}]`;
  if (tag >= 15000 && tag < 16000) return `bullet[${tag - 15000}]`;
  if (tag >= 14000 && tag < 15000) return `vessel[${tag - 14000}]`;
  if (tag >= 13000 && tag < 14000) return `aircraft[${tag - 13000}]`;
  if (tag >= 12000 && tag < 13000) return `building[${tag - 12000}]`;
  if (tag >= 11000 && tag < 12000) return `unit[${tag - 11000}]`;
  if (tag >= 10000 && tag < 11000) return `infantry[${tag - 10000}]`;

  // --- 2000-9999: terrain / logic idx fallback ---
  if (tag >= 2000 && tag < 10000) return `logic[${tag - 2000}]`; // TERRAIN_MINE / default

  // Granular source_tag overrides (set inside specific functions — building.cpp,
  // foot.cpp, aircraft.cpp, infantry.cpp, combat.cpp, coord.cpp).
  const granular: Record<number, string> = {
    30000: 'Mission_Guard_Area',
    30001: 'RandomAnim_IdleTimer',
    30002: 'RandomAnim_switch',
    30003: 'RandomAnim_facing',
    40000: 'Aircraft_AI_entry',
    40001: 'Aircraft_FootAI',
    40002: 'Aircraft_Rotation_AI',
    40003: 'Aircraft_Movement_AI',
    40010: 'Mission_Hunt',
    40020: 'Mission_Unload',
    40030: 'Mission_Retreat',
    40040: 'Mission_Move_air',
    40050: 'Mission_Attack_air',
    40060: 'Paradrop_Cargo',
    40090: 'Mission_Guard_air_entry',
    40091: 'EnterIdle_air',
    50000: 'Explosion_bridge',
    50001: 'Wide_Area_Damage',
    50002: 'Coord_Scatter',
    60010: 'Mission_Move_foot',
    60020: 'FootAI_60020',
    60030: 'FootAI_60030',
    60040: 'Mission_Guard_general',
    60041: 'Mission_Guard_vessel_DDPT',
    60042: 'Mission_Guard_vessel_CA',
    60043: 'Mission_Guard_infantry_E1E3',
    60050: 'FootAI_60050',
    60060: 'FootAI_60060',
    60070: 'FootAI_60070',
    60080: 'FootAI_60080',
    60081: 'FootAI_60081',
    60082: 'FootAI_60082',
    60090: 'FootAI_60090',
    60091: 'FootAI_60091',
    70001: 'Building_AI_70001',
    70002: 'Building_AI_70002',
    70003: 'Building_AI_70003',
    70010: 'Factory_AI',
    70011: 'Building_70011',
    70012: 'Charging_AI',
    70013: 'Repair_AI_entry',
    70014: 'Building_70014',
    70015: 'Building_70015',
    70020: 'Repair_RepairTimer',
    70021: 'Repair_SellBack',
  };
  if (granular[tag] !== undefined) return granular[tag];

  // --- 200-1999: house AI subranges (house.cpp Expert_AI cascade) ---
  // tag=200 is Expert_AI, 100-199 sub-cascade; 201-1999 is currently reserved
  // (no known granular overrides in this band — keep labelled so future
  // house-tag additions surface distinctly instead of as raw `tag[...]`).
  if (tag === 200) return 'Expert_AI';
  if (tag >= 100 && tag < 200) return `House_AI[${tag}]`;
  if (tag >= 201 && tag < 2000) return `HouseAI_sub[${tag}]`;

  const base: Record<number, string> = {
    0: 'untagged', 1: 'TeamAI', 3: 'Map.Logic', 4: 'FactoryAI',
    5: 'House_AI_preamble', 20: 'Do_Fade_AI', 21: 'LogicTrigger',
  };
  return base[tag] ?? `tag[${tag}]`;
}

test(`${scenario} per-entity RNG diff ticks ${startTick}-${endTick}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  console.log(`\n=== ${scenario} per-entity RNG diff: ticks ${startTick}→${endTick} ===\n`);

  // Launch both engines
  await Promise.all([
    wasmPage.goto(wasmUrl(BASE_URL, scenario), { waitUntil: 'load' }),
    tsPage.goto(tsUrl(TS_BASE_URL, scenario), { waitUntil: 'load' }),
  ]);

  // Wait for both to be ready
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        if (!M?.ccall) return false;
        const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
        return (s.units?.length ?? 0) + (s.enemies?.length ?? 0) + (s.structures?.length ?? 0) > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(
      () => (window as any).__agentReady === true,
      { timeout: 120_000, polling: 1000 },
    ),
  ]);

  // Sync RNG seed from WASM to TS
  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  console.log(`Synced seed: ${wasmSeed}\n`);

  // Capture TS console.log for debugging
  tsPage.on('console', (msg) => {
    const t = msg.text();
    if (
      t.includes('INVISIBLE_SCATTER') ||
      t.includes('[FIRE_AT]') ||
      t.includes('[TRIGGER]') ||
      t.includes('[logicAlloc]') ||
      t.includes('[logicRelease]')
    ) {
      console.log(`    [TS-LOG] ${t}`);
    }
  });

  // Enable TS tag logging
  await tsPage.evaluate(() => { (window as any).__rngTagControl('enable'); });
  if (process.env.DUMP_ALLOC === '1') {
    await tsPage.evaluate(() => { (window as any).__traceLogicAlloc = true; });
  }

  // Step both to startTick. NO_BULK=1 is slower but keeps the harness on the
  // same one-frame path as test-first-divergence for late-tick investigations.
  if (startTick > 1) {
    const bulkStep = startTick - 1;
    if (process.env.NO_BULK === '1') {
      for (let i = 0; i < bulkStep; i++) {
        await Promise.all([
          wasmPage.evaluate(async () => {
            const r = (window as any).__agentStep(1);
            if (r?.then) await r;
          }),
          tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
        ]);
      }
    } else {
      const plan = stepPlan(bulkStep, `${scenario}:rng-diff-bulk`, 271);
      for (const batch of plan) {
        await Promise.all([
          wasmPage.evaluate(async (n: number) => {
            const r = (window as any).__agentStep(n);
            if (r?.then) await r;
          }, batch),
          tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, batch),
        ]);
      }
    }
    // Read WASM state to reset its log, read+reset TS log
    await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        JSON.parse(M.ccall('agent_get_state', 'string', [], []));
      }),
      tsPage.evaluate(() => {
        (window as any).__rngTagControl('reset');
      }),
    ]);
    console.log(`Bulk-stepped to tick ${startTick}. Starting per-tick diff...\n`);
  }

  // Read seeds before tick-by-tick stepping (WASM agent_get_state resets rng log — fine here)
  const [wasmPreSeed, tsPreSeed] = await Promise.all([
    wasmPage.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState as number;
    }),
    tsPage.evaluate(() => {
      (window as any).__rngTagControl('reset');
      return (window as any).__rngTagControl('read').seed as number;
    }),
  ]);
  console.log(`Pre-loop seeds — WASM: ${wasmPreSeed >>> 0}, TS: ${tsPreSeed >>> 0}, match: ${(wasmPreSeed >>> 0) === (tsPreSeed >>> 0)}\n`);
  let wasmScenarioSeed = wasmPreSeed >>> 0;

  // Enable invisible-scatter debug
  await tsPage.evaluate(() => {
    (globalThis as any)._debugInvisibleScatter = true;
    const g = (window as any).game;
    if (g) (g as any)._debugInvisibleScatter = true;
  });

  // Tick-by-tick diff
  let totalDivergences = 0;
  for (let tick = startTick; tick <= endTick; tick++) {
    // Reset TS log before stepping
    await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });
    if (DUMP_TRIGGERS) {
      await tsPage.evaluate(() => {
        const game = (window as any).__agentGame;
        if (game) game.debugTriggers = true;
      });
    }
    if (DUMP_SPLASH) {
      await tsPage.evaluate(() => {
        (globalThis as any).__easterSplashTrace = [];
        (globalThis as any).__easterDamageTrace = [];
      });
    }
    if (DUMP_PROJECTILES) {
      await tsPage.evaluate(() => { (globalThis as any).__easterProjectileTrace = []; });
    }
    // Dump PRE-STEP aircraft state (for debugging tick-by-tick transitions)
    const preAircraft = await tsPage.evaluate(() => {
      const dbg = (window as any).__agentAircraft;
      return dbg ? dbg() : [];
    });
    const preAnimData = DUMP_ANIMS || DUMP_PRE_ANIMS ? await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
        return {
          tick: s.tick as number,
          seed: s.rngState as number,
          anims: (s.anims ?? []) as any[],
        };
      }),
      tsPage.evaluate(() => {
        const game = (window as any).__agentGame;
        const logicAnims = ((game?.logicAnims ?? []) as any[]).map((a, i) => ({
          slot: i,
          type: a.type,
          x: a.x,
          y: a.y,
          cx: Math.floor((a.x ?? 0) / 24),
          cy: Math.floor((a.y ?? 0) / 24),
          stage: a.stage,
          timer: a.timer,
          loops: a.loops,
          delay: a.delay,
          isBrandNew: a.isBrandNew,
          logicIndexHint: a.logicIndexHint,
        }));
        const effects = ((game?.effects ?? []) as any[]).map((e, i) => ({
          slot: i,
          type: e.type,
          sprite: e.sprite,
          x: e.x,
          y: e.y,
          cx: Math.floor((e.x ?? 0) / 24),
          cy: Math.floor((e.y ?? 0) / 24),
          frame: e.frame,
          maxFrames: e.maxFrames,
          loops: e.loops,
          loopStart: e.loopStart,
          loopEnd: e.loopEnd,
          followUp: e.followUp,
          cppLogicSlot: e.cppLogicSlot,
          logicIndexHint: e.logicIndexHint,
        }));
        const attachedSmoke = ((game?.entities ?? []) as any[])
          .filter(e => e.damageSmokeStartTick >= 0)
          .map(e => ({ id: e.id, type: e.type, house: e.house, start: e.damageSmokeStartTick, hint: e.damageSmokeLogicIndexHint }));
        const attachedParachutes = ((game?.entities ?? []) as any[])
          .filter(e => e.fallParachuteAnimActive === true)
          .map(e => ({
            id: e.id,
            type: e.type,
            house: e.house,
            stage: e.fallParachuteAnimStage,
            timer: e.fallParachuteAnimTimer,
            loops: e.fallParachuteAnimLoops,
            hint: e.fallParachuteAnimLogicIndexHint,
          }));
        const corpses = ((game?.corpses ?? []) as any[]).map((c, i) => ({
          slot: i,
          type: c.type,
          x: c.x,
          y: c.y,
          deathVariant: c.deathVariant,
          isInfantry: c.isInfantry,
          alpha: c.alpha,
          cppAnimStartTick: c.cppAnimStartTick,
          logicIndexHint: c.logicIndexHint,
        }));
        const activeCppCorpses = corpses.filter(c =>
          c.isInfantry === true &&
          c.type !== 'DOG' &&
          c.deathVariant >= 1 &&
          c.deathVariant <= 4 &&
          c.cppAnimStartTick !== undefined &&
          (game?.tick ?? 0) - c.cppAnimStartTick < 30 * 6
        );
        return {
          tick: game?.tick ?? null,
          seed: (window as any).__rngTagControl('read').seed as number,
          logicAnims,
          effects,
          attachedSmoke,
          attachedParachutes,
          corpses,
          cppSlotCount:
            logicAnims.length +
            effects.filter(e => e.cppLogicSlot === true).length +
            attachedSmoke.length +
            attachedParachutes.length +
            activeCppCorpses.length,
        };
      }),
    ]) : null;

    // Step both engines 1 tick — capture rngLog from step return (not separate agent_get_state)
    const [wasmStepResult, _] = await Promise.all([
      wasmPage.evaluate(async () => {
        const r = (window as any).__agentStep(1);
        const result = r?.then ? await r : r;
        // rngLog is inside .state (agent_step returns {results: ..., state: ...})
        const s = result?.state ?? result;
        return {
          tick: s.tick as number,
          seed: s.rngState as number,
          calls: s.rngCalls as number,
          log: (s.rngLog ?? []) as [number, number, number][],
          logicLayer: (s.logicLayer ?? []) as [number, string, string, number, number][],
          houses: (s.houses ?? []) as any[],
          structures: (s.structures ?? []) as any[],
          units: (s.units ?? []) as any[],
          enemies: (s.enemies ?? []) as any[],
          bullets: (s.bullets ?? []) as any[],
          anims: (s.anims ?? []) as any[],
          debugMoves: (s.debugMoves ?? []) as number[][],
        };
      }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);

    // Read TS RNG log
    const wasmRawLog = wasmStepResult.log;
    const wasmData = {
      ...wasmStepResult,
      rawLog: wasmRawLog,
      log: filterScenarioRngLog(wasmRawLog, wasmScenarioSeed),
    };
    const tsData = await tsPage.evaluate(() => {
      const r = (window as any).__rngTagControl('read');
      const s = (window as any).__agentState();
      const dbg = (window as any).__agentAircraft;
      return {
        tick: s.tick as number,
        seed: r.seed as number,
        calls: r.callCount as number,
        log: (r.seedLog ?? []) as [number, number][],
        taggedLog: (r.taggedLog ?? []) as string[],
        units: s.units ?? [],
        enemies: s.enemies ?? [],
        aircraft: dbg ? dbg() : [],
        houses: Array.from((((window as any).__agentGame?.aiStates ?? new Map()) as Map<any, any>).entries())
          .map(([house, state]) => ({
            house,
            phase: state.phase,
            underAttack: state.underAttack,
            lastBaseAttackTick: state.lastBaseAttackTick,
            iq: state.iq,
          })),
        vessels: (((window as any).__agentGame?.entities ?? []) as any[])
          .filter(e => e.isNavalUnit)
          .map(e => ({
            id: e.id,
            type: e.type,
            house: e.house,
            alive: e.alive,
            inLimbo: e.inLimbo,
            cx: e.cell?.cx,
            cy: e.cell?.cy,
            mission: e.mission,
            missionQueue: e.missionQueue,
            missionTimer: e.missionTimer,
            moveTarget: e.moveTarget ? { lx: e.moveTarget.lx, ly: e.moveTarget.ly } : null,
            isDriving: e.isDriving,
            pathLength: e.path?.length ?? 0,
            pathIndex: e.pathIndex,
            attackCooldown: e.attackCooldown,
            targetId: e.target?.id ?? null,
            targetStructureType: e.targetStructure?.type ?? null,
            leptonX: e.leptonX,
            leptonY: e.leptonY,
            bodyFacing256: e.bodyFacing256,
            turretFacing256: e.turretFacing256,
            facing: e.facing,
            turretFacing: e.turretFacing,
            isSecondShot: e.isSecondShot,
            fireCoord: e.weapon && typeof e.fireCoordForWeapon === 'function'
              ? e.fireCoordForWeapon(e.weapon)
              : null,
          })),
        debugFoot: (((window as any).__agentGame?.entities ?? []) as any[])
          .filter(e => !e.isAirUnit && !e.isNavalUnit)
          .map(e => ({
            id: e.id,
            type: e.type,
            house: e.house,
            alive: e.alive,
            inLimbo: e.inLimbo,
            hp: e.hp,
            maxHp: e.maxHp,
            fear: e.fear,
            isProne: e.isProne,
            logicIndexHint: e.logicIndexHint,
            unlimboTick: e.unlimboTick,
            lastLogicProcessedTick: e.lastLogicProcessedTick,
            cx: e.cell?.cx,
            cy: e.cell?.cy,
            lx: e.leptonX,
            ly: e.leptonY,
            mission: e.mission,
            missionQueue: e.missionQueue,
            missionTimer: e.missionTimer,
            doing: e.doing,
            doingStage: e.doingStage,
            doingRate: e.doingRate,
            randomAnimateTimer: e.randomAnimateTimer,
            randomAnimateReady: typeof e.isReadyToRandomAnimate === 'function'
              ? e.isReadyToRandomAnimate()
              : undefined,
            teamId: e.teamRef?.id ?? null,
            teamName: e.teamRef?.name ?? e.teamRef?.teamTypeName ?? null,
            attackCooldown: e.attackCooldown,
            targetId: e.target?.id ?? null,
            targetType: e.target?.type ?? null,
            targetStructureIndex: e.targetStructure
              ? ((window as any).__agentGame?.structures ?? []).indexOf(e.targetStructure)
              : null,
            targetStructureType: e.targetStructure?.type ?? null,
            targetStructureCell: e.targetStructure
              ? { cx: e.targetStructure.cx, cy: e.targetStructure.cy }
              : null,
            bodyFacing256: e.bodyFacing256,
            desiredFacing256: e.desiredFacing256,
            turretFacing256: e.turretFacing256,
            desiredTurretFacing256: e.desiredTurretFacing256,
            hasTurret: e.hasTurret,
            weapon: e.weapon?.name ?? null,
            fireCoord: e.weapon && typeof e.fireCoordForWeapon === 'function'
              ? e.fireCoordForWeapon(e.weapon)
              : null,
          })),
        projectiles: (((window as any).__agentGame?.inflightProjectiles ?? []) as any[]).map(p => ({
          weapon: p.weapon?.name,
          hint: p.logicIndexHint,
          currentFrame: p.currentFrame,
          travelFrames: p.travelFrames,
          fuelTimer: p.fuelTimer,
          fuseTimer: p.fuseTimer,
          proximity: p.proximity,
          logicalLX: p.logicalLX,
          logicalLY: p.logicalLY,
          headToLX: p.headToLX,
          headToLY: p.headToLY,
          impactX: p.impactX,
          impactY: p.impactY,
        })),
        anims: (((window as any).__agentGame?.logicAnims ?? []) as any[]).map((a, i) => ({
          slot: i,
          type: a.type,
          x: a.x,
          y: a.y,
          cx: Math.floor((a.x ?? 0) / 24),
          cy: Math.floor((a.y ?? 0) / 24),
          stage: a.stage,
          timer: a.timer,
          loops: a.loops,
          delay: a.delay,
          isBrandNew: a.isBrandNew,
          logicIndexHint: a.logicIndexHint,
        })),
        effects: (((window as any).__agentGame?.effects ?? []) as any[]).map((e, i) => ({
          slot: i,
          type: e.type,
          sprite: e.sprite,
          x: e.x,
          y: e.y,
          cx: Math.floor((e.x ?? 0) / 24),
          cy: Math.floor((e.y ?? 0) / 24),
          frame: e.frame,
          maxFrames: e.maxFrames,
          loops: e.loops,
          loopStart: e.loopStart,
          loopEnd: e.loopEnd,
          followUp: e.followUp,
          cppLogicSlot: e.cppLogicSlot,
          logicIndexHint: e.logicIndexHint,
        })),
        structuresDebug: (((window as any).__agentGame?.structures ?? []) as any[]).map((s, i) => ({
          index: i,
          type: s.type,
          house: s.house,
          cx: s.cx,
          cy: s.cy,
          alive: s.alive,
          hp: s.hp,
          debrisCountdown: s.debrisCountdown,
          debrisDropped: s.debrisDropped,
          sellProgress: s.sellProgress,
        })),
        splashTrace: (globalThis as any).__easterSplashTrace ?? [],
        damageTrace: (globalThis as any).__easterDamageTrace ?? [],
        projectileTrace: (globalThis as any).__easterProjectileTrace ?? [],
      };
    });

    const seedMatch = (wasmData.seed >>> 0) === (tsData.seed >>> 0);
    const callDiff = wasmData.log.length - tsData.log.length;
    const wasmLogCapped = wasmData.rawLog.length >= WASM_RNG_LOG_CAP;
    const callCountReliable = !(seedMatch && wasmLogCapped);

    // Check for tracked building calls (building[139] in WASM = building[39] in TS)
    const TRACK_WASM = [139, 146]; // WASM Logic indices to track
    const TRACK_TS = [39, 46]; // TS logicIdx equivalents
    const wasmTracked = wasmData.log.filter(([_, tag]) => TRACK_WASM.some(t => tag === 12000 + t));
    const tsTracked = tsData.log.filter(([_, tag]) => TRACK_TS.some(t => tag === 12000 + t));
    const trackInfo = wasmTracked.length > 0 || tsTracked.length > 0
      ? ` | tracked: W=${wasmTracked.map(e => tagName(e[1])).join(',')||'—'} T=${tsTracked.map(e => tagName(e[1])).join(',')||'—'}`
      : '';

    // Always print tick header
    const marker = seedMatch && (!callCountReliable || callDiff === 0) ? '✓' : '✗';
    const rawNote = wasmData.rawLog.length === wasmData.log.length ? '' : ` rawWASM=${wasmData.rawLog.length}`;
    const capNote = wasmLogCapped ? ` wasmLogCap=${WASM_RNG_LOG_CAP}${callCountReliable ? '' : ' seed-only'}` : '';
    console.log(
      `tick ${tick}: ${marker}  WASM(${wasmData.log.length} scenario calls, seed=${wasmData.seed >>> 0})  TS(${tsData.log.length} calls, seed=${tsData.seed >>> 0})  Δcalls=${callDiff}${rawNote}${capNote}${trackInfo}`,
    );

    const ALWAYS_DUMP = process.env.DUMP_ALL === '1';
    if (!seedMatch || (callCountReliable && callDiff !== 0) || ALWAYS_DUMP) {
      if (!seedMatch || (callCountReliable && callDiff !== 0)) totalDivergences++;

      // Print side-by-side log comparison
      const maxLen = Math.max(wasmData.log.length, tsData.log.length);
      for (let i = 0; i < maxLen; i++) {
        const wEntry = wasmData.log[i];
        const tEntry = tsData.log[i];
        const wEnt = wEntry && wEntry[2] !== undefined ? ` ent=${tagName(wEntry[2])}` : '';
        const tEnt = tEntry && (tEntry as any)[2] !== undefined ? ` ent=${tagName((tEntry as any)[2])}` : '';
        const wStr = wEntry ? `[${tagName(wEntry[1]).padEnd(18)} seed=${(wEntry[0] >>> 0)} stag=${wEntry[1]}${wEnt}]` : '(none)'.padEnd(35);
        const tStr = tEntry ? `[${tagName(tEntry[1]).padEnd(18)} seed=${(tEntry[0] >>> 0)} stag=${tEntry[1]}${tEnt}]` : '(none)'.padEnd(35);

        const match = wEntry && tEntry && (wEntry[0] >>> 0) === (tEntry[0] >>> 0) && wEntry[1] === tEntry[1];
        const seedSame = wEntry && tEntry && (wEntry[0] >>> 0) === (tEntry[0] >>> 0);
        const tagSame = wEntry && tEntry && wEntry[1] === tEntry[1];
        let flag = '';
        if (!match) {
          if (!wEntry) flag = ' << WASM missing';
          else if (!tEntry) flag = ' << TS missing';
          else if (!tagSame) flag = ' << TAG MISMATCH';
          else if (!seedSame) flag = ' << SEED MISMATCH';
        }
        console.log(`  [${String(i).padStart(3)}] WASM: ${wStr}  TS: ${tStr}${flag}`);
      }
      console.log('');
    }

    // Also dump entity info at divergent ticks for context
    if (!seedMatch || (callCountReliable && callDiff !== 0) || ALWAYS_DUMP) {
      if (DUMP_LOGIC_LAYER) {
        console.log(`  WASM Logic layer (${wasmData.logicLayer.length} entities):`);
        for (const [idx, type, house, cx, cy] of wasmData.logicLayer) {
          console.log(`    [${idx}] ${type} (${house}) cell(${cx},${cy})`);
        }
      }
      console.log(`  TS aircraft PRE-STEP (${preAircraft.length}):`);
      for (const a of preAircraft) {
        console.log(`    ${a.type}#${a.id} (h=${a.house}) cell(${a.cx},${a.cy}) lx=${a.lx ?? '-'} ly=${a.ly ?? '-'} f=${a.facing256 ?? '-'} fd=${a.desiredFacing256 ?? '-'} sf=${a.turretFacing256 ?? '-'} sfd=${a.desiredTurretFacing256 ?? '-'} mission=${a.mission} mq=${a.missionQueue} mt=${a.missionTimer} arm=${a.attackCooldown ?? '-'} ast=${a.aircraftAttackStatus ?? '-'} target=${a.targetId ?? a.targetStructureType ?? '-'} hasT=${a.hasTarget ?? '-'} hasS=${a.hasTargetStructure ?? '-'} land=${a.landedAtStructure ?? '-'} hint=${a.logicIndexHint ?? '-'} proc=${a.processedInBuildingPass ?? '-'} alive=${a.alive} inLimbo=${a.inLimbo} aircraftState=${a.aircraftState} alt=${a.flightAltitude} cargo=${a.cargo} moveTarget=${a.moveTarget ? `(${a.moveTarget.lx},${a.moveTarget.ly})` : '-'} team=${a.teamRef} tmi=${a.teamMissionIndex}/${a.teamMissions}`);
      }
      console.log(`  TS aircraft POST-STEP (${(tsData as any).aircraft?.length ?? 0}):`);
      for (const a of (tsData as any).aircraft ?? []) {
        console.log(`    ${a.type}#${a.id} (h=${a.house}) cell(${a.cx},${a.cy}) lx=${a.lx ?? '-'} ly=${a.ly ?? '-'} f=${a.facing256 ?? '-'} fd=${a.desiredFacing256 ?? '-'} sf=${a.turretFacing256 ?? '-'} sfd=${a.desiredTurretFacing256 ?? '-'} mission=${a.mission} mq=${a.missionQueue} mt=${a.missionTimer} arm=${a.attackCooldown ?? '-'} ast=${a.aircraftAttackStatus ?? '-'} target=${a.targetId ?? a.targetStructureType ?? '-'} hasT=${a.hasTarget ?? '-'} hasS=${a.hasTargetStructure ?? '-'} land=${a.landedAtStructure ?? '-'} hint=${a.logicIndexHint ?? '-'} proc=${a.processedInBuildingPass ?? '-'} alive=${a.alive} inLimbo=${a.inLimbo} aircraftState=${a.aircraftState} alt=${a.flightAltitude} cargo=${a.cargo} moveTarget=${a.moveTarget ? `(${a.moveTarget.lx},${a.moveTarget.ly})` : '-'} team=${a.teamRef} tmi=${a.teamMissionIndex}/${a.teamMissions}`);
      }
      if (DUMP_TAGGED) {
        console.log(`  TS taggedLog (stack frames):`);
        for (let i = 0; i < (tsData as any).taggedLog.length; i++) {
          console.log(`    [${i}] ${(tsData as any).taggedLog[i]}`);
        }
      }
      if (DUMP_SPLASH) {
        console.log(`  TS splashTrace:`);
        for (const entry of (tsData as any).splashTrace ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS damageTrace:`);
        for (const entry of (tsData as any).damageTrace ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_PROJECTILES) {
        console.log(`  WASM bullets:`);
        for (const entry of (wasmData as any).bullets ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS projectiles:`);
        for (const entry of (tsData as any).projectiles ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS projectileTrace:`);
        for (const entry of (tsData as any).projectileTrace ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_FOOT) {
        const minLogic = Number(process.env.DUMP_FOOT_MIN_LOGIC ?? 0);
        console.log(`  TS foot entities:`);
        for (const entry of ((tsData as any).debugFoot ?? [])
          .filter((e: any) => (e.logicIndexHint ?? 0) >= minLogic)) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_ANIMS) {
        if (preAnimData) {
          console.log(`  WASM anims PRE tick ${preAnimData[0].tick} seed=${preAnimData[0].seed}:`);
          for (const entry of (preAnimData[0] as any).anims ?? []) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
          console.log(`  TS anim slots PRE tick ${(preAnimData[1] as any).tick} seed=${(preAnimData[1] as any).seed} cppSlotCount=${(preAnimData[1] as any).cppSlotCount}:`);
          for (const entry of (preAnimData[1] as any).logicAnims ?? []) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
          console.log(`  TS cpp effects PRE:`);
          for (const entry of ((preAnimData[1] as any).effects ?? []).filter((e: any) => e.cppLogicSlot === true)) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
          console.log(`  TS attached smokes PRE:`);
          for (const entry of (preAnimData[1] as any).attachedSmoke ?? []) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
          console.log(`  TS attached parachutes PRE:`);
          for (const entry of (preAnimData[1] as any).attachedParachutes ?? []) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
          console.log(`  TS corpses PRE (${((preAnimData[1] as any).corpses ?? []).length}):`);
          for (const entry of (preAnimData[1] as any).corpses ?? []) {
            console.log(`    ${JSON.stringify(entry)}`);
          }
        }
        console.log(`  WASM anims:`);
        for (const entry of (wasmData as any).anims ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS logicAnims:`);
        for (const entry of (tsData as any).anims ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS effects:`);
        for (const entry of (tsData as any).effects ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_VESSELS) {
        console.log(`  WASM vessels:`);
        for (const entry of (wasmData.logicLayer as any[]).filter(e => e[5] === 'V')) {
          console.log(`    ${JSON.stringify({
            logicIndex: entry[0],
            type: entry[1],
            house: entry[2],
            cx: entry[3],
            cy: entry[4],
            aid: entry[6],
            mission: entry[7],
            missionTimer: entry[8],
            missionQueue: entry[9],
            isDriving: entry[10],
            lx: entry[12],
            ly: entry[13],
            arm: entry[23],
            pulse: entry[24],
            technoMission: entry[25],
            technoMissionQueue: entry[26],
            status: entry[27],
            targetKind: entry[30],
            targetValue: entry[31],
            targetRtti: entry[32],
            targetIndex: entry[33],
            firex: entry[34],
            firey: entry[35],
            inRange0: entry[36],
            canFire0: entry[37],
            primaryCurrent: entry[28],
            primaryDesired: entry[29],
          })}`);
        }
        console.log(`  TS vessels:`);
        for (const entry of (tsData as any).vessels ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_AIRCRAFT) {
        console.log(`  WASM aircraft:`);
        for (const entry of (wasmData.logicLayer as any[]).filter(e => e[5] === 'A')) {
          console.log(`    ${JSON.stringify({
            logicIndex: entry[0],
            type: entry[1],
            house: entry[2],
            cx: entry[3],
            cy: entry[4],
            aid: entry[6],
            mission: entry[7],
            missionTimer: entry[8],
            missionQueue: entry[9],
            isDriving: entry[10],
            lx: entry[12],
            ly: entry[13],
            hp: entry[14],
            arm: entry[23],
            technoMission: entry[25],
            technoMissionQueue: entry[26],
            status: entry[27],
            primaryCurrent: entry[28],
            primaryDesired: entry[29],
            targetKind: entry[30],
            targetValue: entry[31],
            targetRtti: entry[32],
            targetIndex: entry[33],
            firex: entry[34],
            firey: entry[35],
            inRange0: entry[36],
            canFire0: entry[37],
            height: entry[38],
            landing: entry[39],
            takingOff: entry[40],
          })}`);
        }
      }
      if (DUMP_HOUSES) {
        console.log(`  WASM houses:`);
        for (const entry of (wasmData as any).houses ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS houses:`);
        for (const entry of (tsData as any).houses ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_STRUCTURES) {
        console.log(`  WASM structures:`);
        for (const entry of (wasmData as any).structures ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS structures:`);
        for (const entry of (tsData as any).structuresDebug ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_UNITS) {
        const minLogic = Number(process.env.DUMP_UNIT_MIN_LOGIC ?? 0);
        console.log(`  WASM foot units:`);
        for (const entry of (wasmData.logicLayer as any[]).filter(e => (e[5] === 'U' || e[5] === 'I') && e[0] >= minLogic)) {
          console.log(`    ${JSON.stringify({
            logicIndex: entry[0],
            type: entry[1],
            house: entry[2],
            cx: entry[3],
            cy: entry[4],
            kind: entry[5],
            aid: entry[6],
            mission: entry[7],
            missionTimer: entry[8],
            missionQueue: entry[9],
            isDriving: entry[10],
            doing: entry[11],
            lx: entry[12],
            ly: entry[13],
            hp: entry[14],
            arm: entry[23],
            technoMission: entry[25],
            technoMissionQueue: entry[26],
            status: entry[27],
            primaryCurrent: entry[28],
            primaryDesired: entry[29],
            targetKind: entry[30],
            targetValue: entry[31],
            targetRtti: entry[32],
            targetIndex: entry[33],
            firex: entry[34],
            firey: entry[35],
            inRange0: entry[36],
            canFire0: entry[37],
          })}`);
        }
        console.log(`  WASM foot state:`);
        for (const entry of [...((wasmData as any).units ?? []), ...((wasmData as any).enemies ?? [])]
          .filter((e: any) => (e.id ?? 0) >= minLogic)) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS foot units:`);
        for (const entry of [...((tsData as any).units ?? []), ...((tsData as any).enemies ?? [])]
          .filter((e: any) => (e.id ?? 0) >= minLogic)) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
        console.log(`  TS debug foot:`);
        for (const entry of ((tsData as any).debugFoot ?? [])
          .filter((e: any) => (e.logicIndexHint ?? 0) >= minLogic)) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      if (DUMP_WASM_DEBUG) {
        console.log(`  WASM debugMoves:`);
        for (const entry of (wasmData as any).debugMoves ?? []) {
          console.log(`    ${JSON.stringify(entry)}`);
        }
      }
      console.log('');
    }

    wasmScenarioSeed = wasmData.seed >>> 0;
  }

  console.log(`\n=== Summary: ${totalDivergences} divergent ticks out of ${endTick - startTick + 1} ===\n`);

  await wasmCtx.close();
  await tsCtx.close();
});
