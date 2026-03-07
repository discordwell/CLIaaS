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

type SequenceCheckpoints = Partial<Record<'initial' | 'idle-60' | 'jeep-move-120' | 'jeep-stop-45', AgentLikeState>>;

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

async function loadTsAgent(page: Page): Promise<AgentLikeState> {
  console.log('TS: opening agent page');
  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCA01EA`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => (window as { __agentReady?: boolean }).__agentReady === true, { timeout: 120_000 });
  const state = await page.evaluate(() => (window as unknown as { __agentState: () => AgentLikeState }).__agentState());
  console.log(`TS: agent ready at tick ${state.tick}`);
  return state;
}

async function loadWasmSequence(page: Page): Promise<SequenceCheckpoints> {
  console.log('WASM: opening original build');
  const sequencePromise = new Promise<SequenceCheckpoints>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onConsole = (msg: { text: () => string }) => {
      const text = msg.text();
      if (text.startsWith('[AGENTSEQ_RESULT] ')) {
        settle(() => resolve(JSON.parse(text.slice('[AGENTSEQ_RESULT] '.length)) as SequenceCheckpoints));
      } else if (text.startsWith('[AGENTSEQ_ERROR] ')) {
        const payload = JSON.parse(text.slice('[AGENTSEQ_ERROR] '.length)) as { message?: string };
        settle(() => reject(new Error(payload.message ?? 'Unknown WASM agent sequence error')));
      }
    };

    const onPageError = (err: Error) => {
      settle(() => reject(err));
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
  });

  await page.goto(`${BASE_URL}/ra/original.html?autoplay=ants&agentseq=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  const checkpoints = await Promise.race([
    sequencePromise,
    (async () => {
      await sleep(180_000);
      throw new Error('Timed out waiting for WASM agent sequence');
    })(),
  ]);

  if (checkpoints.initial) {
    console.log(`WASM: gameplay ready at tick ${checkpoints.initial.tick}`);
  }

  return checkpoints;
}

async function runSequence(page: Page): Promise<SequenceCheckpoints> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __agentState: () => AgentLikeState;
      __agentStep: (ticks: number, commands?: AgentCommand[]) => Promise<{ state: AgentLikeState }> | { state: AgentLikeState };
    };

    const checkpoints: SequenceCheckpoints = {};

    let state = w.__agentState();
    checkpoints.initial = state;

    state = (await w.__agentStep(60)).state;
    checkpoints['idle-60'] = state;

    const jeepMatches = state.units.filter(unit => unit.t === 'JEEP');
    const jeepId = jeepMatches.length === 1 ? jeepMatches[0].id : null;
    if (jeepId !== null) {
      state = (await w.__agentStep(120, [{ cmd: 'move', unitIds: [jeepId], cx: 45, cy: 84 }])).state;
      checkpoints['jeep-move-120'] = state;

      const jeepMatches2 = state.units.filter(unit => unit.t === 'JEEP');
      const jeepId2 = jeepMatches2.length === 1 ? jeepMatches2[0].id : null;
      if (jeepId2 !== null) {
        state = (await w.__agentStep(45, [{ cmd: 'stop', unitIds: [jeepId2] }])).state;
        checkpoints['jeep-stop-45'] = state;
      }
    }

    return checkpoints;
  });
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

  const launchBrowser = () => chromium.launch({
    headless: true,
    args: [
      '--mute-audio',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const checkpoints: CheckpointReport[] = [];
    const blockers: string[] = [];

    try {
      browser = await launchBrowser();
      const tsContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
      const tsPage = await tsContext.newPage();
      await loadTsAgent(tsPage);
      const tsSequence = await runSequence(tsPage);
      await tsContext.close();
      await browser.close();
      browser = undefined;

      browser = await launchBrowser();
      const wasmContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
      const wasmPage = await wasmContext.newPage();
      const wasmSequence = await loadWasmSequence(wasmPage);
      await wasmContext.close();
      await browser.close();
      browser = undefined;

      if (!tsSequence.initial || !wasmSequence.initial || !tsSequence['idle-60'] || !wasmSequence['idle-60']) {
        throw new Error('Agent sequence did not produce required initial checkpoints');
      }

      const tsStartTick = tsSequence.initial.tick;
      const wasmStartTick = wasmSequence.initial.tick;

      addCheckpoint(checkpoints, 'initial', 'Initial gameplay snapshot after load', tsSequence.initial, wasmSequence.initial, tsStartTick, wasmStartTick);
      addCheckpoint(checkpoints, 'idle-60', 'No commands, both engines advanced 60 ticks', tsSequence['idle-60'], wasmSequence['idle-60'], tsStartTick, wasmStartTick);

      if (tsSequence['jeep-move-120'] && wasmSequence['jeep-move-120']) {
        addCheckpoint(checkpoints, 'jeep-move-120', 'Unique allied JEEP ordered to move toward cell (45,84)', tsSequence['jeep-move-120'], wasmSequence['jeep-move-120'], tsStartTick, wasmStartTick);
      }

      if (tsSequence['jeep-stop-45'] && wasmSequence['jeep-stop-45']) {
        addCheckpoint(checkpoints, 'jeep-stop-45', 'Moved JEEP receives a stop command', tsSequence['jeep-stop-45'], wasmSequence['jeep-stop-45'], tsStartTick, wasmStartTick);
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
