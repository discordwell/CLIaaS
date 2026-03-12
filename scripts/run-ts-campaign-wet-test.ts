#!/usr/bin/env tsx

import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { CAMPAIGNS, getCampaign, type CampaignId, type CampaignMission } from '../src/EasterEgg/engine/scenario';
import { TsAgentAdapter } from '../src/EasterEgg/oracle/TsAgentAdapter';
import { TsCampaignStrategy, type TsOracleResult } from '../src/EasterEgg/oracle/TsCampaignStrategy';

type MissionRunReport = {
  id: string;
  title: string;
  outcome: 'won' | 'lost' | 'timeout';
  elapsedTicks: number;
  finalTick: number;
  iterations: number;
  screenshots: string[];
  snapshots: string[];
  consoleLogFile: string;
  pageErrorFile: string;
};

type WetRunReport = {
  timestamp: string;
  baseUrl: string;
  startedServer: boolean;
  campaign?: string;
  maxTicks: number;
  stepTicks: number;
  screenshotInterval: number;
  missions: MissionRunReport[];
};

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://localhost:3001' },
    'campaign': { type: 'string', default: '' },
    'scenario': { type: 'string', default: '' },
    'limit': { type: 'string', default: '' },
    'difficulty': { type: 'string', default: 'normal' },
    'max-ticks': { type: 'string', default: '5000' },
    'step-ticks': { type: 'string', default: '30' },
    'screenshot-interval': { type: 'string', default: '300' },
    'headed': { type: 'boolean', default: false },
  },
  strict: true,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runId(prefix: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${prefix}`;
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
      // Process already exited.
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(100);
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
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

function startDevServer(port: number, outputDir: string): ChildProcessWithoutNullStreams {
  fs.mkdirSync(outputDir, { recursive: true });
  const logPath = path.join(outputDir, 'next-dev.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const server = spawn('pnpm', ['next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  return server;
}

async function ensureServer(baseUrl: string, outputDir: string): Promise<{ server?: ChildProcessWithoutNullStreams; startedServer: boolean }> {
  const port = Number.parseInt(new URL(baseUrl).port || '80', 10);
  if (await isPortOpen(port)) {
    await waitForHttp(baseUrl, 10_000);
    return { startedServer: false };
  }

  const server = startDevServer(port, outputDir);
  await waitForHttp(baseUrl, 120_000);
  return { server, startedServer: true };
}

async function stopServer(server?: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = server?.pid;
  if (!pid) return;
  signalProcessTree(pid, 'SIGTERM');
  await waitForProcessExit(pid, 2_000);
  if (isProcessAlive(pid)) {
    signalProcessTree(pid, 'SIGKILL');
    await waitForProcessExit(pid, 1_000);
  }
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) return null;
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

async function saveScreenshot(adapter: TsAgentAdapter, filePath: string): Promise<void> {
  const dataUrl = await adapter.gameScreenshot();
  const buffer = decodeDataUrl(dataUrl) ?? await adapter.screenshot();
  fs.writeFileSync(filePath, buffer);
}

function allCampaignMissions(): CampaignMission[] {
  return CAMPAIGNS.flatMap((campaign) => campaign.missions);
}

function resolveMissionList(campaignId: string, scenarioId: string, limitText: string): { campaign?: string; missions: CampaignMission[] } {
  const limit = limitText ? Number.parseInt(limitText, 10) : undefined;
  if (scenarioId) {
    const mission = allCampaignMissions().find((entry) => entry.id === scenarioId.toUpperCase());
    return {
      missions: [mission ?? { id: scenarioId.toUpperCase(), title: scenarioId.toUpperCase(), briefing: '', objective: '' }],
    };
  }

  const campaign = getCampaign((campaignId || 'allied') as CampaignId);
  if (!campaign) {
    throw new Error(`Unknown campaign: ${campaignId}`);
  }

  const missions = typeof limit === 'number' && limit > 0
    ? campaign.missions.slice(0, limit)
    : campaign.missions;
  return { campaign: campaign.id, missions };
}

async function runMission(
  adapter: TsAgentAdapter,
  mission: CampaignMission,
  outputDir: string,
  difficulty: string,
  maxTicks: number,
  stepTicks: number,
  screenshotInterval: number,
): Promise<MissionRunReport> {
  const missionDir = path.join(outputDir, mission.id);
  fs.mkdirSync(missionDir, { recursive: true });

  const strategy = new TsCampaignStrategy(mission.id);
  let state = await adapter.loadScenario(mission.id, difficulty);
  let previousResults: Array<{ cmd: string; ok: boolean; error?: string }> = [];
  let outcome: TsOracleResult = strategy.checkResult(state);
  let iteration = 0;
  let nextScreenshotTick = state.tick;
  const screenshots: string[] = [];
  const snapshots: string[] = [];
  const startTick = state.tick;

  const saveCheckpoint = async (tag: string, snapshotState: typeof state) => {
    const prefix = `${String(snapshotState.tick).padStart(5, '0')}-${tag}`;
    const pngPath = path.join(missionDir, `${prefix}.png`);
    const jsonPath = path.join(missionDir, `${prefix}.json`);
    await saveScreenshot(adapter, pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(snapshotState, null, 2));
    screenshots.push(path.relative(process.cwd(), pngPath));
    snapshots.push(path.relative(process.cwd(), jsonPath));
  };

  console.log(`[WetTest] ${mission.id} — ${mission.title}`);
  await saveCheckpoint('start', state);
  nextScreenshotTick += screenshotInterval;

  while (outcome === 'playing' && state.tick - startTick < maxTicks) {
    const decision = strategy.decide(state, previousResults);
    const step = await adapter.step(stepTicks, decision.commands.length > 0 ? decision.commands : undefined);
    previousResults = step.results;
    state = step.state;
    outcome = strategy.checkResult(state);

    if (iteration % 5 === 0) {
      console.log(strategy.summarize(state, iteration, decision));
      if (previousResults.some((result) => !result.ok)) {
        console.log(`[WetTest] ${mission.id} command errors: ${JSON.stringify(previousResults)}`);
      }
    }

    while (state.tick >= nextScreenshotTick) {
      await saveCheckpoint('periodic', state);
      nextScreenshotTick += screenshotInterval;
    }

    iteration++;
  }

  const finalOutcome: MissionRunReport['outcome'] = outcome === 'won' || outcome === 'lost'
    ? outcome
    : 'timeout';
  await saveCheckpoint(finalOutcome, state);

  const consoleLogFile = path.join(missionDir, 'console.log');
  const pageErrorFile = path.join(missionDir, 'page-errors.log');
  fs.writeFileSync(consoleLogFile, `${adapter.getLogs().join('\n')}\n`);
  fs.writeFileSync(pageErrorFile, `${adapter.getErrors().join('\n')}\n`);

  return {
    id: mission.id,
    title: mission.title,
    outcome: finalOutcome,
    elapsedTicks: state.tick - startTick,
    finalTick: state.tick,
    iterations: iteration,
    screenshots,
    snapshots,
    consoleLogFile: path.relative(process.cwd(), consoleLogFile),
    pageErrorFile: path.relative(process.cwd(), pageErrorFile),
  };
}

async function main(): Promise<void> {
  const baseUrl = values['base-url']!;
  const difficulty = values.difficulty!;
  const maxTicks = Number.parseInt(values['max-ticks']!, 10);
  const stepTicks = Number.parseInt(values['step-ticks']!, 10);
  const screenshotInterval = Number.parseInt(values['screenshot-interval']!, 10);
  const headless = !values.headed;
  const selection = resolveMissionList(values.campaign!, values.scenario!, values.limit!);

  const outputDir = path.join(process.cwd(), 'test-results', 'campaign-wet', runId(selection.campaign ?? selection.missions[0]?.id ?? 'scenario'));
  fs.mkdirSync(outputDir, { recursive: true });

  const { server, startedServer } = await ensureServer(baseUrl, outputDir);
  const adapter = new TsAgentAdapter({ url: baseUrl, headless });
  const missions: MissionRunReport[] = [];

  try {
    await adapter.connect();
    for (const mission of selection.missions) {
      const result = await runMission(
        adapter,
        mission,
        outputDir,
        difficulty,
        maxTicks,
        stepTicks,
        screenshotInterval,
      );
      missions.push(result);
      if (result.outcome !== 'won') {
        console.log(`[WetTest] Stopping after ${mission.id} (${result.outcome})`);
        break;
      }
    }
  } finally {
    await adapter.disconnect();
    await stopServer(server);
  }

  const report: WetRunReport = {
    timestamp: new Date().toISOString(),
    baseUrl,
    startedServer,
    campaign: selection.campaign,
    maxTicks,
    stepTicks,
    screenshotInterval,
    missions,
  };

  const reportPath = path.join(outputDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n[WetTest] Report: ${reportPath}`);
  for (const mission of missions) {
    console.log(`[WetTest] ${mission.id}: ${mission.outcome} after ${mission.elapsedTicks} ticks (${mission.screenshots.length} screenshots)`);
  }
}

main().catch((error) => {
  console.error('[WetTest] Fatal error:', error);
  process.exit(1);
});
