import * as net from 'node:net';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';
import {
  WasmAdapter,
  type AgentStepResult,
  type RAGameState,
} from '../oracle/WasmAdapter.js';
import type {
  AgentCommand,
  AgentState,
  StepResult,
} from '../engine/agentHarness.js';

export const RA_PARITY_BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Synchronously check whether the dev server is reachable.
 * Uses a quick `curl --max-time 2` probe so it can be used at module scope
 * for `describe.skipIf(!devServerAvailable)` guards.
 */
export function isDevServerAvailable(): boolean {
  const port = Number.parseInt(new URL(RA_PARITY_BASE_URL).port || '80', 10);
  try {
    // Check for the game-specific /ra/original.html path, not just any HTTP server.
    // Port 3001 may be occupied by another project (e.g. Catena), which would
    // pass a bare "/" probe but cannot serve the RA game canvas.
    const body = execFileSync('curl', ['-s', '--max-time', '2', `http://127.0.0.1:${port}/ra/original.html`], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return body.includes('canvas') || body.includes('redalert') || body.includes('ra-game');
  } catch {
    return false;
  }
}

export interface ParityServerHandle {
  startedByTest: boolean;
  process?: ChildProcessWithoutNullStreams;
}

export interface DualRuntimeHandle {
  ts: TsAgentAdapter;
  wasm: WasmAdapter;
  tsState: AgentState;
  wasmState: RAGameState;
}

export interface DualStepResult {
  ts: StepResult;
  wasm: AgentStepResult;
}

export interface DualScenarioOptions {
  wasmSeed?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;

      const children = childrenByParent.get(parentPid) ?? [];
      children.push(pid);
      childrenByParent.set(parentPid, children);
    }

    const descendants: number[] = [];
    const stack = [...(childrenByParent.get(rootPid) ?? [])];
    while (stack.length > 0) {
      const pid = stack.pop();
      if (pid === undefined) continue;
      descendants.push(pid);
      stack.push(...(childrenByParent.get(pid) ?? []));
    }
    return descendants;
  } catch {
    return [];
  }
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
  for (const childPid of listDescendantPids(pid).reverse()) {
    try {
      process.kill(childPid, signal);
    } catch {
      // Child already exited.
    }
  }

  try {
    process.kill(pid, signal);
  } catch {
    // Root already exited.
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function ensureParityServer(): Promise<ParityServerHandle> {
  const port = Number.parseInt(new URL(RA_PARITY_BASE_URL).port || '80', 10);
  if (await isPortOpen(port)) {
    await waitForHttp(RA_PARITY_BASE_URL, 10_000);
    return { startedByTest: false };
  }

  const processHandle = spawn('pnpm', ['next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupOutput = '';
  processHandle.stdout.on('data', (chunk: Buffer | string) => {
    startupOutput += chunk.toString();
  });
  processHandle.stderr.on('data', (chunk: Buffer | string) => {
    startupOutput += chunk.toString();
  });

  try {
    await waitForHttp(RA_PARITY_BASE_URL, DEFAULT_TIMEOUT_MS);
  } catch (error) {
    const pid = processHandle.pid;
    if (pid) {
      signalProcessTree(pid, 'SIGTERM');
      await waitForProcessExit(pid, 2_000);
    }
    throw new Error(`Failed to start parity server: ${startupOutput || String(error)}`);
  }

  return { startedByTest: true, process: processHandle };
}

export async function stopParityServer(handle: ParityServerHandle | undefined): Promise<void> {
  if (!handle?.startedByTest || !handle.process?.pid) {
    return;
  }

  const pid = handle.process.pid;
  if (!isProcessAlive(pid)) {
    return;
  }

  signalProcessTree(pid, 'SIGTERM');
  const exited = await waitForProcessExit(pid, 2_000);
  if (!exited) {
    signalProcessTree(pid, 'SIGKILL');
    await waitForProcessExit(pid, 1_000);
  }
}

export async function withDualScenario<T>(
  scenario: string,
  fn: (handle: DualRuntimeHandle) => Promise<T>,
  options: DualScenarioOptions = {},
): Promise<T> {
  const ts = new TsAgentAdapter({ url: RA_PARITY_BASE_URL, headless: true });
  const wasm = new WasmAdapter({
    scenario,
    headless: true,
    autoplay: true,
    url: new URL('/ra/original.html', RA_PARITY_BASE_URL).toString(),
    seed: options.wasmSeed,
  });

  await ts.connect();
  try {
    const tsState = await ts.loadScenario(scenario);
    await wasm.connect();
    try {
      const wasmState = await wasm.observe();
      return await fn({ ts, wasm, tsState, wasmState });
    } finally {
      await wasm.disconnect();
    }
  } finally {
    await ts.disconnect();
  }
}

export async function stepBoth(
  handle: Pick<DualRuntimeHandle, 'ts' | 'wasm'>,
  ticks: number,
  tsCommands?: AgentCommand[],
  wasmCommands?: Array<Record<string, unknown>>,
): Promise<DualStepResult> {
  const tsPromise = handle.ts.step(ticks, tsCommands);
  const wasmPromise = handle.wasm.step(
    ticks,
    wasmCommands && wasmCommands.length > 0 ? JSON.stringify(wasmCommands) : undefined,
  );
  const [ts, wasm] = await Promise.all([tsPromise, wasmPromise]);
  return { ts, wasm };
}
