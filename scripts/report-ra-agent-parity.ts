#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { compareStates, type AgentLikeState } from './ra-parity/stateDiff';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';
const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'agent-parity.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'agent-parity.md');
const SERVER_LOG = path.join(REPORT_DIR, 'agent-parity-server.log');
const SERVER_PID = path.join(REPORT_DIR, 'agent-parity-server.pid');
const HARD_TIMEOUT_MS = 12 * 60_000;
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

function readManagedServerPid(): number | undefined {
  try {
    const raw = fs.readFileSync(SERVER_PID, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function writeManagedServerPid(pid: number): void {
  fs.writeFileSync(SERVER_PID, `${pid}\n`);
}

function clearManagedServerPid(expectedPid?: number): void {
  try {
    if (expectedPid !== undefined) {
      const currentPid = readManagedServerPid();
      if (currentPid !== expectedPid) {
        return;
      }
    }
    fs.unlinkSync(SERVER_PID);
  } catch {
    // Ignore stale or missing pid files during cleanup.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listDescendantPids(rootPid: number): number[] {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
    const childrenByParent = new Map<number, number[]>();

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [pidText, parentText] = trimmed.split(/\s+/, 2);
      const pid = Number.parseInt(pidText, 10);
      const parentPid = Number.parseInt(parentText, 10);
      if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) {
        continue;
      }

      const siblings = childrenByParent.get(parentPid) ?? [];
      siblings.push(pid);
      childrenByParent.set(parentPid, siblings);
    }

    const descendants: number[] = [];
    const stack = [...(childrenByParent.get(rootPid) ?? [])];
    while (stack.length > 0) {
      const pid = stack.pop();
      if (pid === undefined) {
        continue;
      }
      descendants.push(pid);
      stack.push(...(childrenByParent.get(pid) ?? []));
    }
    return descendants;
  } catch {
    return [];
  }
}

function signalManagedProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  let signaled = false;
  for (const childPid of listDescendantPids(pid).reverse()) {
    try {
      process.kill(childPid, signal);
      signaled = true;
    } catch {
      // Descendant may already be gone.
    }
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return signaled;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function reapPreviousManagedServer(): Promise<void> {
  const pid = readManagedServerPid();
  if (!pid) {
    return;
  }

  if (!isProcessAlive(pid)) {
    clearManagedServerPid(pid);
    return;
  }

  console.log(`Reaping leftover parity dev server pid ${pid}`);
  signalManagedProcessTree(pid, 'SIGTERM');
  const exitedOnTerm = await waitForProcessExit(pid, 2_000);
  if (!exitedOnTerm) {
    signalManagedProcessTree(pid, 'SIGKILL');
    await waitForProcessExit(pid, 1_000);
  }
  clearManagedServerPid(pid);
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
  if (server.pid) {
    writeManagedServerPid(server.pid);
  }
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  server.once('close', () => {
    clearManagedServerPid(server.pid);
    logStream.end();
  });
  server.once('error', () => {
    clearManagedServerPid(server.pid);
    logStream.end();
  });
  return server;
}

async function ensureServer(): Promise<{ server?: ChildProcessWithoutNullStreams; startedByScript: boolean }> {
  await reapPreviousManagedServer();
  const port = Number.parseInt(new URL(BASE_URL).port || '80', 10);
  if (await isPortOpen(port)) {
    await waitForHttp(BASE_URL, 10_000);
    return { startedByScript: false };
  }

  const server = startDevServer();
  try {
    await waitForHttp(BASE_URL, 120_000);
  } catch (err) {
    await stopServer(server);
    throw err;
  }
  return { server, startedByScript: true };
}

async function stopServerPid(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    clearManagedServerPid(pid);
    return;
  }

  signalManagedProcessTree(pid, 'SIGTERM');
  const exitedOnTerm = await Promise.race([
    waitForProcessExit(pid, 1_000),
    sleep(1_000).then(() => false),
  ]);

  if (!exitedOnTerm && isProcessAlive(pid)) {
    signalManagedProcessTree(pid, 'SIGKILL');
    await waitForProcessExit(pid, 1_000);
  }

  clearManagedServerPid(pid);
}

async function stopServer(server: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  const pid = server?.pid ?? readManagedServerPid();
  if (!pid) {
    return;
  }
  await stopServerPid(pid);
}

async function loadTsAgent(page: Page): Promise<AgentLikeState> {
  console.log('TS: opening agent page');
  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCA01EA`, { waitUntil: 'load', timeout: 120_000 });
  console.log('TS: waiting for canvas');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  console.log('TS: waiting for __agentReady');
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

  await page.goto(`${BASE_URL}/ra/original.html?agentautoplay=ants&agentseq=1&agentwait=1&scenario=SCA01EA.INI`, { waitUntil: 'load', timeout: 120_000 });
  console.log('WASM: waiting for canvas');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  console.log('WASM: waiting for agent bridge');
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __agentReady?: boolean;
      __startAgentSequence?: () => void;
    };
    return typeof w.__startAgentSequence === 'function'
      && w.__agentReady === true;
  }, { timeout: 120_000 });

  console.log('WASM: starting in-page agent sequence');
  await page.evaluate(() => {
    const w = window as unknown as {
      __startAgentSequence: () => void;
    };
    w.__startAgentSequence();
  });

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

  let server: ChildProcessWithoutNullStreams | undefined;
  let startedByScript = false;
  let browser: Browser | undefined;
  const openContexts = new Set<BrowserContext>();
  let cleanedUp = false;
  const handleExit = () => {
    const pid = server?.pid ?? readManagedServerPid();
    if (!pid) {
      return;
    }
    if (isProcessAlive(pid)) {
      signalManagedProcessTree(pid, 'SIGKILL');
    }
    clearManagedServerPid(pid);
  };

  const launchBrowser = () => chromium.launch({
    headless: true,
    args: [
      '--mute-audio',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    for (const context of Array.from(openContexts)) {
      try {
        await context.close();
      } catch {
        // Best-effort teardown for interrupted Playwright sessions.
      }
      openContexts.delete(context);
    }

    try {
      await browser?.close();
    } catch {
      // Ignore browser teardown failures during shutdown.
    }
    browser = undefined;

    await stopServer(server);
  };

  const handleSignal = () => {
    void cleanup().finally(() => {
      process.exitCode = 1;
      process.exit();
    });
  };

  const hardStop = setTimeout(() => {
    console.error(`Agent parity run exceeded ${HARD_TIMEOUT_MS}ms; forcing cleanup.`);
    handleSignal();
  }, HARD_TIMEOUT_MS);
  hardStop.unref();

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  process.once('SIGHUP', handleSignal);
  process.once('exit', handleExit);

  try {
    ({ server, startedByScript } = await ensureServer());

    const checkpoints: CheckpointReport[] = [];
    const blockers: string[] = [];

    try {
      browser = await launchBrowser();
      const tsContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
      openContexts.add(tsContext);
      const tsPage = await tsContext.newPage();
      tsPage.setDefaultTimeout(120_000);
      tsPage.setDefaultNavigationTimeout(120_000);
      await loadTsAgent(tsPage);
      const tsSequence = await runSequence(tsPage);
      await tsContext.close();
      openContexts.delete(tsContext);
      await browser.close();
      browser = undefined;

      browser = await launchBrowser();
      const wasmContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
      openContexts.add(wasmContext);
      const wasmPage = await wasmContext.newPage();
      wasmPage.setDefaultTimeout(120_000);
      wasmPage.setDefaultNavigationTimeout(120_000);
      const wasmSequence = await loadWasmSequence(wasmPage);
      await wasmContext.close();
      openContexts.delete(wasmContext);
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

    if (report.blockers.length > 0) {
      process.exitCode = 1;
    } else if (strict && totals.diffCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(hardStop);
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    process.off('SIGHUP', handleSignal);
    await cleanup();
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
