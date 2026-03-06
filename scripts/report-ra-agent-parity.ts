#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { chromium, type Browser, type Page } from '@playwright/test';

import { compareStates, type AgentLikeState } from './ra-parity/stateDiff';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';
const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'agent-parity.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'agent-parity.md');
const SERVER_LOG = path.join(REPORT_DIR, 'agent-parity-server.log');
const strict = process.argv.includes('--strict');

type AgentCommand =
  | { cmd: 'move'; unitIds: number[]; cx: number; cy: number }
  | { cmd: 'stop'; unitIds: number[] };

interface CheckpointReport {
  name: string;
  note: string;
  tsTickDelta: number;
  wasmTickDelta: number;
  diffCount: number;
  diffs: ReturnType<typeof compareStates>['diffs'];
}

interface AgentParityReport {
  timestamp: string;
  baseUrl: string;
  serverStartedByScript: boolean;
  status: 'ok' | 'blocked';
  blockers: string[];
  checkpoints: CheckpointReport[];
  totals: {
    diffCount: number;
    checkpointsWithDiffs: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      // Server not ready yet.
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startDevServer(): ChildProcessWithoutNullStreams {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const logStream = fs.createWriteStream(SERVER_LOG, { flags: 'w' });
  const server = spawn('pnpm', ['next', 'dev', '--port', '3001'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  return server;
}

async function ensureServer(): Promise<{ server?: ChildProcessWithoutNullStreams; startedByScript: boolean }> {
  const port = Number.parseInt(new URL(BASE_URL).port || '80', 10);
  if (await isPortOpen(port)) {
    await waitForHttp(BASE_URL, 10_000);
    return { startedByScript: false };
  }

  const server = startDevServer();
  await waitForHttp(BASE_URL, 120_000);
  return { server, startedByScript: true };
}

async function stopServer(server: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!server || server.killed) return;
  server.kill('SIGTERM');
  await sleep(1000);
  if (!server.killed) {
    server.kill('SIGKILL');
  }
}

async function tryEval<T>(page: Page, body: () => T, timeoutMs = 5_000): Promise<T | null> {
  try {
    return await Promise.race([
      page.evaluate(body),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

async function waitForResponsive(page: Page, maxWaitMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const renderCount = await tryEval(page, () => {
      return (window as unknown as { __wasmRenderCount?: number }).__wasmRenderCount ?? 0;
    }, 5_000);
    if (renderCount !== null) {
      return true;
    }
    await sleep(3_000);
  }
  return false;
}

async function loadTsAgent(page: Page): Promise<AgentLikeState> {
  console.log('TS: opening agent page');
  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCA01EA`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => (window as { __agentReady?: boolean }).__agentReady === true, { timeout: 120_000 });
  const state = await page.evaluate(() => (window as unknown as { __agentState: () => AgentLikeState }).__agentState());
  console.log(`TS: agent ready at tick ${state.tick}`);
  return state;
}

async function loadWasmAgent(page: Page): Promise<AgentLikeState> {
  console.log('WASM: opening original build');
  await page.goto(`${BASE_URL}/ra/original.html?autoplay=ants`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.bringToFront();
  await page.locator('canvas').focus();

  const readyStart = Date.now();
  while (Date.now() - readyStart < 120_000) {
    const ready = await tryEval(page, () => {
      const w = window as unknown as {
        __agentState?: () => unknown;
        __setAutoplay?: (mode: boolean) => void;
      };
      return typeof w.__agentState === 'function' && typeof w.__setAutoplay === 'function';
    });
    if (ready) {
      console.log('WASM: agent bridge ready');
      break;
    }
    await sleep(1_000);
  }

  await page.evaluate(() => {
    const w = window as unknown as { __setAutoplay?: (mode: boolean) => void };
    w.__setAutoplay?.(true);
  });
  console.log('WASM: autoplay enabled');

  try {
    await page.waitForFunction(
      () => {
        const status = document.getElementById('status');
        return Boolean(status) && (status!.style.display === 'none' || status!.textContent === 'All downloads complete.');
      },
      { timeout: 120_000, polling: 2_000 },
    );
    console.log('WASM: status reports load complete');
  } catch {
    console.log('WASM: load completion timeout, continuing');
  }

  await sleep(5_000);

  const responsive = await waitForResponsive(page, 60_000);
  if (!responsive) {
    throw new Error('WASM page never became responsive');
  }
  console.log('WASM: page responsive at menu');

  const hashBefore = await tryEval(page, () => {
    return (window as unknown as { __getScreenHash?: () => string }).__getScreenHash?.() ?? '';
  }, 5_000);
  const rendersBefore = await tryEval(page, () => {
    return (window as unknown as { __wasmRenderCount?: number }).__wasmRenderCount ?? 0;
  }, 5_000);

  let enterRetries = 0;
  const start = Date.now();
  let gameplayReady = false;

  while (Date.now() - start < 360_000) {
    const state = await tryEval(page, () => {
      const w = window as unknown as { __agentState?: () => AgentLikeState };
      return w.__agentState?.() ?? null;
    }, 5_000);

    const elapsed = Math.round((Date.now() - start) / 1000);
    const renders = await tryEval(page, () => {
      return (window as unknown as { __wasmRenderCount?: number }).__wasmRenderCount ?? 0;
    }, 5_000);

    if (renders !== null && renders > (rendersBefore ?? 0) + 5) {
      const hashNow = await tryEval(page, () => {
        return (window as unknown as { __getScreenHash?: () => string }).__getScreenHash?.() ?? '';
      }, 5_000);
      if (hashNow !== null && hashNow !== hashBefore) {
        gameplayReady = true;
      }
    }

    if (gameplayReady && state && !state.error && Array.isArray(state.units) && state.units.length > 0) {
      await page.evaluate(() => {
        const w = window as unknown as { __wasmSetPaused?: (paused: boolean) => void };
        w.__wasmSetPaused?.(true);
      });
      const pausedState = await page.evaluate(() => (window as unknown as { __agentState: () => AgentLikeState }).__agentState());
      console.log(`WASM: gameplay ready at tick ${pausedState.tick}`);
      return pausedState;
    }

    if (renders !== null && elapsed > 10 && enterRetries < 8) {
      enterRetries++;
      console.log(`WASM: Enter retry ${enterRetries}`);
      try {
        await Promise.race([
          page.keyboard.press('Enter'),
          sleep(2_000),
        ]);
      } catch {
        // The page may be blocked during scenario load.
      }
      await sleep(3_000);
      continue;
    }

    if (elapsed > 0 && elapsed % 20 === 0) {
      const diag = await tryEval(page, () => {
        const w = window as unknown as {
          __autoplayState?: string;
          __wasmRenderCount?: number;
        };
        return {
          title: document.title,
          autoplayState: w.__autoplayState ?? null,
          renderCount: w.__wasmRenderCount ?? 0,
        };
      }, 2_000);
      if (diag) {
        console.log(`WASM: waiting title=${diag.title} autoplay=${diag.autoplayState} renders=${diag.renderCount}`);
      }
    }

    await sleep(5_000);
  }

  throw new Error('Timed out waiting for WASM gameplay state');
}

async function stepPage(page: Page, ticks: number, commands?: AgentCommand[]): Promise<AgentLikeState> {
  return page.evaluate(async ([n, cmds]) => {
    const w = window as unknown as {
      __agentStep: (ticks: number, commands?: AgentCommand[]) => Promise<{ state: AgentLikeState }> | { state: AgentLikeState };
    };
    const result = await w.__agentStep(n, cmds);
    return result.state;
  }, [ticks, commands] as [number, AgentCommand[] | undefined]);
}

function pickUnitId(state: AgentLikeState, type: string): number | null {
  const matches = state.units.filter(unit => unit.t === type);
  return matches.length === 1 ? matches[0].id : null;
}

function addCheckpoint(
  checkpoints: CheckpointReport[],
  name: string,
  note: string,
  tsState: AgentLikeState,
  wasmState: AgentLikeState,
  tsStartTick: number,
  wasmStartTick: number,
): void {
  const comparison = compareStates(tsState, wasmState);
  checkpoints.push({
    name,
    note,
    tsTickDelta: tsState.tick - tsStartTick,
    wasmTickDelta: wasmState.tick - wasmStartTick,
    diffCount: comparison.diffCount,
    diffs: comparison.diffs,
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const { server, startedByScript } = await ensureServer();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--mute-audio',
        '--use-gl=swiftshader',
        '--enable-webgl',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const tsPage = await context.newPage();
    const wasmPage = await context.newPage();
    const checkpoints: CheckpointReport[] = [];
    const blockers: string[] = [];

    try {
      let tsState = await loadTsAgent(tsPage);
      let wasmState = await loadWasmAgent(wasmPage);
      const tsStartTick = tsState.tick;
      const wasmStartTick = wasmState.tick;

      addCheckpoint(checkpoints, 'initial', 'Paused initial gameplay snapshot after load', tsState, wasmState, tsStartTick, wasmStartTick);

      tsState = await stepPage(tsPage, 60);
      wasmState = await stepPage(wasmPage, 60);
      addCheckpoint(checkpoints, 'idle-60', 'No commands, both engines advanced 60 ticks', tsState, wasmState, tsStartTick, wasmStartTick);

      const tsJeepId = pickUnitId(tsState, 'JEEP');
      const wasmJeepId = pickUnitId(wasmState, 'JEEP');
      if (tsJeepId !== null && wasmJeepId !== null) {
        tsState = await stepPage(tsPage, 120, [{ cmd: 'move', unitIds: [tsJeepId], cx: 45, cy: 84 }]);
        wasmState = await stepPage(wasmPage, 120, [{ cmd: 'move', unitIds: [wasmJeepId], cx: 45, cy: 84 }]);
        addCheckpoint(checkpoints, 'jeep-move-120', 'Unique allied JEEP ordered to move toward cell (45,84)', tsState, wasmState, tsStartTick, wasmStartTick);

        const tsJeepId2 = pickUnitId(tsState, 'JEEP');
        const wasmJeepId2 = pickUnitId(wasmState, 'JEEP');
        if (tsJeepId2 !== null && wasmJeepId2 !== null) {
          tsState = await stepPage(tsPage, 45, [{ cmd: 'stop', unitIds: [tsJeepId2] }]);
          wasmState = await stepPage(wasmPage, 45, [{ cmd: 'stop', unitIds: [wasmJeepId2] }]);
          addCheckpoint(checkpoints, 'jeep-stop-45', 'Moved JEEP receives a stop command', tsState, wasmState, tsStartTick, wasmStartTick);
        }
      }
    } catch (err) {
      blockers.push(err instanceof Error ? err.message : String(err));
    }

    const totals = {
      diffCount: checkpoints.reduce((sum, checkpoint) => sum + checkpoint.diffCount, 0),
      checkpointsWithDiffs: checkpoints.filter(checkpoint => checkpoint.diffCount > 0).length,
    };

    const report: AgentParityReport = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      serverStartedByScript: startedByScript,
      status: blockers.length > 0 ? 'blocked' : 'ok',
      blockers,
      checkpoints,
      totals,
    };

    fs.writeFileSync(JSON_OUTPUT, JSON.stringify(report, null, 2));

    const markdown = [
      '# Red Alert Agent Parity Report',
      '',
      `Generated: ${report.timestamp}`,
      `Base URL: ${report.baseUrl}`,
      `Server started by script: ${report.serverStartedByScript ? 'yes' : 'no'}`,
      `Status: ${report.status}`,
      '',
      ...(report.blockers.length > 0 ? ['Blockers:', ...report.blockers.map(blocker => `- ${blocker}`), ''] : []),
      `Total diffs: ${report.totals.diffCount}`,
      `Checkpoints with diffs: ${report.totals.checkpointsWithDiffs}`,
      '',
      'Checkpoints:',
      ...report.checkpoints.map(checkpoint => `- ${checkpoint.name}: diffs=${checkpoint.diffCount}, tsDelta=${checkpoint.tsTickDelta}, wasmDelta=${checkpoint.wasmTickDelta} (${checkpoint.note})`),
      '',
      'Top diffs:',
      ...report.checkpoints.flatMap(checkpoint =>
        checkpoint.diffs.slice(0, 5).map(diff => `- ${checkpoint.name} :: ${diff.kind} :: ${diff.key} :: TS=${JSON.stringify(diff.ts)} :: WASM=${JSON.stringify(diff.wasm)}`),
      ),
      '',
      `Full JSON: ${JSON_OUTPUT}`,
    ].join('\n');
    fs.writeFileSync(MD_OUTPUT, markdown);

    console.log(`Agent parity report written to ${JSON_OUTPUT}`);
    for (const blocker of report.blockers) {
      console.log(`  blocker: ${blocker}`);
    }
    for (const checkpoint of checkpoints) {
      console.log(`  ${checkpoint.name}: ${checkpoint.diffCount} diffs (tsDelta=${checkpoint.tsTickDelta}, wasmDelta=${checkpoint.wasmTickDelta})`);
      for (const diff of checkpoint.diffs.slice(0, 5)) {
        console.log(`    ${diff.kind} ${diff.key}: TS=${JSON.stringify(diff.ts)} WASM=${JSON.stringify(diff.wasm)}`);
      }
    }

    if (strict && (totals.diffCount > 0 || report.blockers.length > 0)) {
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
