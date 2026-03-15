#!/usr/bin/env tsx

import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { TsAgentAdapter } from '../src/EasterEgg/oracle/TsAgentAdapter.js';
import { WasmAdapter, type RAGameState } from '../src/EasterEgg/oracle/WasmAdapter.js';
import { OracleStrategy, type OracleResult } from '../src/EasterEgg/oracle/OracleStrategy.js';
import { SharedTsOracleStrategy } from '../src/EasterEgg/oracle/SharedOracleBridge.js';

type ClosureCheckpoint = {
  iteration: number;
  tick: number;
  result: OracleResult | 'timeout';
  units: number;
  enemies: number;
  structures: number;
  globals: number[];
  missionTimer?: number;
  civEvacuated: boolean;
  truckCount: number;
  reason: string;
};

type EngineRunReport = {
  engine: 'original' | 'ts';
  outcome: OracleResult | 'timeout';
  iterations: number;
  elapsedTicks: number;
  checkpoints: ClosureCheckpoint[];
  warnings: string[];
};

type ClosureDiff = {
  iteration: number;
  originalTick: number;
  tsTick: number;
  issues: string[];
  original: ClosureCheckpoint;
  ts: ClosureCheckpoint;
};

type ClosureReport = {
  timestamp: string;
  scenario: string;
  maxTicks: number;
  stepTicks: number;
  reportInterval: number;
  tsBaseUrl: string;
  startedServer: boolean;
  original: EngineRunReport;
  ts: EngineRunReport;
  diffs: ClosureDiff[];
  summary: {
    pass: boolean;
    criticalIssueCount: number;
    diffCount: number;
  };
};

type RuntimeClosureBatchScenario = {
  scenario: string;
  trials: Array<{
    trial: number;
    pass: boolean;
    criticalIssueCount: number;
    diffCount: number;
    originalOutcome: EngineRunReport['outcome'];
    tsOutcome: EngineRunReport['outcome'];
    reportDir: string;
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>;
  summary: {
    passCount: number;
    failCount: number;
    unstable: boolean;
  };
};

type RuntimeClosureBatchReport = {
  timestamp: string;
  scenarios: RuntimeClosureBatchScenario[];
  tsBaseUrl: string;
  startedServer: boolean;
  summary: {
    scenarioCount: number;
    trialCount: number;
    stablePassCount: number;
    unstableCount: number;
    failCount: number;
  };
};

const { values } = parseArgs({
  options: {
    'scenario': { type: 'string', default: 'SCG01EA' },
    'scenarios': { type: 'string' },
    'trials': { type: 'string', default: '1' },
    'max-ticks': { type: 'string', default: '5000' },
    'step-ticks': { type: 'string', default: '30' },
    'report-interval': { type: 'string', default: '10' },
    'base-url': { type: 'string', default: 'http://localhost:3001' },
    'headed': { type: 'boolean', default: false },
    'ts-difficulty': { type: 'string', default: 'normal' },
  },
  strict: true,
});

function runId(prefix: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${prefix}`;
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

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(100);
  }
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

function snapshotFromState(
  state: RAGameState,
  iteration: number,
  result: OracleResult | 'timeout',
  reason: string,
): ClosureCheckpoint {
  return {
    iteration,
    tick: state.tick,
    result,
    units: state.units.length,
    enemies: state.enemies.length,
    structures: state.structures.filter((structure) => !structure.ally).length,
    globals: [...(state.globals ?? [])],
    missionTimer: state.missionTimer,
    civEvacuated: Boolean(state.civEvacuated),
    truckCount: state.units.filter((unit) => unit.t === 'TRUK').length,
    reason,
  };
}

function writeCheckpoint(filePath: string, checkpoint: ClosureCheckpoint): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function collectCommandWarnings(
  engine: 'original' | 'ts',
  iteration: number,
  tick: number,
  results: Array<{ cmd: string; ok: boolean; error?: string }>,
): string[] {
  return results
    .filter((result) => !result.ok)
    .map((result) => `${engine} iteration ${iteration} tick ${tick}: ${result.cmd} failed${result.error ? ` (${result.error})` : ''}`);
}

async function runOriginal(
  scenario: string,
  outputDir: string,
  maxTicks: number,
  stepTicks: number,
  reportInterval: number,
  headless: boolean,
): Promise<EngineRunReport> {
  fs.mkdirSync(outputDir, { recursive: true });
  const adapter = new WasmAdapter({ scenario, headless, autoplay: true });
  const strategy = new OracleStrategy(scenario);
  const checkpoints: ClosureCheckpoint[] = [];
  const warnings: string[] = [];
  let outcome: OracleResult | 'timeout' = 'playing';
  let iterations = 0;
  let elapsedTicks = 0;

  await adapter.connect();
  try {
    while (elapsedTicks < maxTicks) {
      const state = await adapter.observe();
      const result = strategy.checkResult(state);
      const decision = strategy.decide(state);
      if (iterations % reportInterval === 0) {
        const checkpoint = snapshotFromState(state, iterations, result, decision.reason);
        checkpoints.push(checkpoint);
        writeCheckpoint(path.join(outputDir, `original-${String(iterations).padStart(4, '0')}.json`), checkpoint);
      }
      if (result !== 'playing') {
        outcome = result;
        break;
      }

      if (decision.commands.length > 0) {
        const commandResults = await adapter.command(decision.commands);
        warnings.push(...collectCommandWarnings('original', iterations, state.tick, commandResults));
      }
      const stepResult = await adapter.step(stepTicks);
      warnings.push(...collectCommandWarnings('original', iterations, state.tick, stepResult.results));
      elapsedTicks += stepTicks;
      iterations++;
    }

    if (outcome === 'playing') {
      outcome = 'timeout';
    }

    const finalState = await adapter.observe();
    checkpoints.push(snapshotFromState(finalState, iterations, outcome, 'final'));
    writeCheckpoint(path.join(outputDir, 'original-final.json'), checkpoints[checkpoints.length - 1]);
    return { engine: 'original', outcome, iterations, elapsedTicks, checkpoints, warnings };
  } finally {
    warnings.push(...(await adapter.getErrors()).map((error) => `browser: ${error}`));
    await adapter.disconnect();
  }
}

async function runTs(
  scenario: string,
  outputDir: string,
  baseUrl: string,
  difficulty: string,
  maxTicks: number,
  stepTicks: number,
  reportInterval: number,
  headless: boolean,
): Promise<EngineRunReport> {
  fs.mkdirSync(outputDir, { recursive: true });
  const adapter = new TsAgentAdapter({ url: baseUrl, headless });
  const strategy = new SharedTsOracleStrategy(scenario);
  const checkpoints: ClosureCheckpoint[] = [];
  const warnings: string[] = [];
  let outcome: OracleResult | 'timeout' = 'playing';
  let iterations = 0;
  let elapsedTicks = 0;

  await adapter.connect();
  try {
    while (elapsedTicks < maxTicks) {
      const tsState = iterations === 0
        ? await adapter.loadScenario(scenario, difficulty)
        : await adapter.observe();
      const result = strategy.checkResult(tsState);
      const decision = strategy.decide(tsState);
      warnings.push(...decision.warnings);

      if (iterations % reportInterval === 0) {
        const checkpoint = snapshotFromState(
          decision.normalizedState,
          iterations,
          result,
          decision.oracleDecision.reason,
        );
        checkpoints.push(checkpoint);
        writeCheckpoint(path.join(outputDir, `ts-${String(iterations).padStart(4, '0')}.json`), checkpoint);
      }
      if (result !== 'playing') {
        outcome = result;
        break;
      }

      const stepResult = await adapter.step(stepTicks, decision.commands);
      warnings.push(...collectCommandWarnings('ts', iterations, tsState.tick, stepResult.results));
      elapsedTicks += stepTicks;
      iterations++;
    }

    if (outcome === 'playing') {
      outcome = 'timeout';
    }

    const finalState = await adapter.observe();
    const finalDecision = strategy.decide(finalState);
    warnings.push(...finalDecision.warnings);
    checkpoints.push(snapshotFromState(finalDecision.normalizedState, iterations, outcome, 'final'));
    writeCheckpoint(path.join(outputDir, 'ts-final.json'), checkpoints[checkpoints.length - 1]);
    return { engine: 'ts', outcome, iterations, elapsedTicks, checkpoints, warnings };
  } finally {
    warnings.push(...adapter.getErrors().map((error) => `browser: ${error}`));
    await adapter.disconnect();
  }
}

function compareRuns(original: EngineRunReport, ts: EngineRunReport): ClosureDiff[] {
  const diffs: ClosureDiff[] = [];
  const length = Math.min(original.checkpoints.length, ts.checkpoints.length);

  for (let index = 0; index < length; index++) {
    const left = original.checkpoints[index];
    const right = ts.checkpoints[index];
    const issues: string[] = [];

    if (left.result !== right.result) {
      issues.push(`result mismatch (${left.result} vs ${right.result})`);
    }
    if (left.civEvacuated !== right.civEvacuated) {
      issues.push(`civilian evac mismatch (${left.civEvacuated} vs ${right.civEvacuated})`);
    }
    if (left.truckCount !== right.truckCount) {
      issues.push(`truck mismatch (${left.truckCount} vs ${right.truckCount})`);
    }
    if (left.globals.join(',') !== right.globals.join(',')) {
      issues.push(`globals mismatch (${left.globals.join(',')} vs ${right.globals.join(',')})`);
    }
    if (Math.abs(left.units - right.units) > 4) {
      issues.push(`unit delta ${left.units - right.units}`);
    }
    if (Math.abs(left.enemies - right.enemies) > 4) {
      issues.push(`enemy delta ${left.enemies - right.enemies}`);
    }
    if (
      left.missionTimer !== undefined &&
      right.missionTimer !== undefined &&
      Math.abs(left.missionTimer - right.missionTimer) > 300
    ) {
      issues.push(`timer delta ${left.missionTimer - right.missionTimer}`);
    }

    if (issues.length > 0) {
      diffs.push({
        iteration: left.iteration,
        originalTick: left.tick,
        tsTick: right.tick,
        issues,
        original: left,
        ts: right,
      });
    }
  }

  return diffs;
}

function renderMarkdown(report: ClosureReport): string {
  const lines: string[] = [];
  lines.push('# Runtime Closure Report');
  lines.push('');
  lines.push(`- Scenario: ${report.scenario}`);
  lines.push(`- Max ticks: ${report.maxTicks}`);
  lines.push(`- Step ticks: ${report.stepTicks}`);
  lines.push(`- Report interval: ${report.reportInterval}`);
  lines.push(`- Started TS server: ${report.startedServer ? 'yes' : 'no'}`);
  lines.push(`- Closure pass: ${report.summary.pass ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Original');
  lines.push(`- Outcome: ${report.original.outcome}`);
  lines.push(`- Iterations: ${report.original.iterations}`);
  lines.push(`- Elapsed ticks: ${report.original.elapsedTicks}`);
  lines.push(`- Final checkpoint: tick=${report.original.checkpoints.at(-1)?.tick ?? 0}, units=${report.original.checkpoints.at(-1)?.units ?? 0}, enemies=${report.original.checkpoints.at(-1)?.enemies ?? 0}, trucks=${report.original.checkpoints.at(-1)?.truckCount ?? 0}`);
  lines.push(`- Warnings: ${report.original.warnings.length}`);
  lines.push('');
  lines.push('## TS');
  lines.push(`- Outcome: ${report.ts.outcome}`);
  lines.push(`- Iterations: ${report.ts.iterations}`);
  lines.push(`- Elapsed ticks: ${report.ts.elapsedTicks}`);
  lines.push(`- Final checkpoint: tick=${report.ts.checkpoints.at(-1)?.tick ?? 0}, units=${report.ts.checkpoints.at(-1)?.units ?? 0}, enemies=${report.ts.checkpoints.at(-1)?.enemies ?? 0}, trucks=${report.ts.checkpoints.at(-1)?.truckCount ?? 0}`);
  lines.push(`- Warnings: ${report.ts.warnings.length}`);
  lines.push('');
  lines.push('## Diffs');
  if (report.diffs.length === 0) {
    lines.push('- none');
  } else {
    for (const diff of report.diffs.slice(0, 20)) {
      lines.push(`- Iteration ${diff.iteration} (original tick ${diff.originalTick}, ts tick ${diff.tsTick}): ${diff.issues.join('; ')}`);
    }
    if (report.diffs.length > 20) {
      lines.push(`- ... ${report.diffs.length - 20} more diffs`);
    }
  }
  if (report.original.warnings.length > 0 || report.ts.warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    for (const warning of [...report.original.warnings, ...report.ts.warnings].slice(0, 20)) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderBatchMarkdown(report: RuntimeClosureBatchReport): string {
  const lines: string[] = [];
  lines.push('# Runtime Closure Batch Report');
  lines.push('');
  lines.push(`- Scenario count: ${report.summary.scenarioCount}`);
  lines.push(`- Trials per scenario: ${report.summary.trialCount}`);
  lines.push(`- Stable passes: ${report.summary.stablePassCount}`);
  lines.push(`- Unstable scenarios: ${report.summary.unstableCount}`);
  lines.push(`- Failures: ${report.summary.failCount}`);
  lines.push(`- Started TS server: ${report.startedServer ? 'yes' : 'no'}`);
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.scenario}`);
    lines.push(`- Passes: ${scenario.summary.passCount}`);
    lines.push(`- Failures: ${scenario.summary.failCount}`);
    lines.push(`- Unstable: ${scenario.summary.unstable ? 'yes' : 'no'}`);
    for (const trial of scenario.trials) {
      lines.push(`- Trial ${trial.trial}: pass=${trial.pass ? 'yes' : 'no'}, original=${trial.originalOutcome}, ts=${trial.tsOutcome}, critical=${trial.criticalIssueCount}, diffs=${trial.diffCount}`);
      lines.push(`  report: ${path.relative(process.cwd(), trial.reportMarkdownPath)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function runScenarioClosure(
  scenario: string,
  runDir: string,
  baseUrl: string,
  difficulty: string,
  maxTicks: number,
  stepTicks: number,
  reportInterval: number,
  headless: boolean,
  startedServer: boolean,
): Promise<ClosureReport> {
  fs.mkdirSync(runDir, { recursive: true });

  const original = await runOriginal(
    scenario,
    path.join(runDir, 'original'),
    maxTicks,
    stepTicks,
    reportInterval,
    headless,
  );
  const ts = await runTs(
    scenario,
    path.join(runDir, 'ts'),
    baseUrl,
    difficulty,
    maxTicks,
    stepTicks,
    reportInterval,
    headless,
  );

  const diffs = compareRuns(original, ts);
  const criticalIssueCount = diffs.filter((diff) => diff.issues.some((issue) => (
    issue.startsWith('result mismatch')
    || issue.startsWith('civilian evac mismatch')
    || issue.startsWith('truck mismatch')
    || issue.startsWith('globals mismatch')
    || issue.startsWith('timer delta')
  ))).length;

  const report: ClosureReport = {
    timestamp: new Date().toISOString(),
    scenario,
    maxTicks,
    stepTicks,
    reportInterval,
    tsBaseUrl: baseUrl,
    startedServer,
    original,
    ts,
    diffs,
    summary: {
      pass: criticalIssueCount === 0,
      criticalIssueCount,
      diffCount: diffs.length,
    },
  };

  const jsonPath = path.join(runDir, 'report.json');
  const mdPath = path.join(runDir, 'report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Original outcome: ${original.outcome}`);
  console.log(`TS outcome: ${ts.outcome}`);
  console.log(`Diffs: ${diffs.length}`);
  console.log(`Critical issues: ${criticalIssueCount}`);
  return report;
}

async function main(): Promise<void> {
  const scenarios = values.scenarios
    ? values.scenarios
        .split(',')
        .map((scenario) => scenario.trim().toUpperCase())
        .filter(Boolean)
    : [values.scenario!.toUpperCase()];
  const maxTicks = Number.parseInt(values['max-ticks']!, 10);
  const stepTicks = Number.parseInt(values['step-ticks']!, 10);
  const reportInterval = Number.parseInt(values['report-interval']!, 10);
  const trials = Math.max(1, Number.parseInt(values.trials!, 10));
  const baseUrl = values['base-url']!;
  const difficulty = values['ts-difficulty']!;
  const headless = !values.headed;

  const batchRunDir = path.join(
    process.cwd(),
    'test-results',
    'runtime-closure',
    runId(scenarios.length === 1 ? scenarios[0] : 'batch'),
  );
  fs.mkdirSync(batchRunDir, { recursive: true });

  const { server, startedServer } = await ensureServer(baseUrl, batchRunDir);
  try {
    if (scenarios.length === 1 && trials === 1) {
      await runScenarioClosure(
        scenarios[0],
        batchRunDir,
        baseUrl,
        difficulty,
        maxTicks,
        stepTicks,
        reportInterval,
        headless,
        startedServer,
      );
      return;
    }

    const scenarioReports: RuntimeClosureBatchScenario[] = [];
    for (const scenario of scenarios) {
      const trialReports: RuntimeClosureBatchScenario['trials'] = [];
      for (let trial = 1; trial <= trials; trial++) {
        const scenarioDir = trials === 1
          ? path.join(batchRunDir, scenario)
          : path.join(batchRunDir, scenario, `trial-${String(trial).padStart(2, '0')}`);
        const report = await runScenarioClosure(
          scenario,
          scenarioDir,
          baseUrl,
          difficulty,
          maxTicks,
          stepTicks,
          reportInterval,
          headless,
          startedServer,
        );
        trialReports.push({
          trial,
          pass: report.summary.pass,
          criticalIssueCount: report.summary.criticalIssueCount,
          diffCount: report.summary.diffCount,
          originalOutcome: report.original.outcome,
          tsOutcome: report.ts.outcome,
          reportDir: scenarioDir,
          reportJsonPath: path.join(scenarioDir, 'report.json'),
          reportMarkdownPath: path.join(scenarioDir, 'report.md'),
        });
      }
      scenarioReports.push({
        scenario,
        trials: trialReports,
        summary: {
          passCount: trialReports.filter((report) => report.pass).length,
          failCount: trialReports.filter((report) => !report.pass).length,
          unstable: trialReports.some((report) => report.pass) && trialReports.some((report) => !report.pass),
        },
      });
    }

    const batchReport: RuntimeClosureBatchReport = {
      timestamp: new Date().toISOString(),
      scenarios: scenarioReports,
      tsBaseUrl: baseUrl,
      startedServer,
      summary: {
        scenarioCount: scenarioReports.length,
        trialCount: trials,
        stablePassCount: scenarioReports.filter((report) => report.summary.failCount === 0).length,
        unstableCount: scenarioReports.filter((report) => report.summary.unstable).length,
        failCount: scenarioReports.filter((report) => report.summary.passCount === 0).length,
      },
    };

    const batchJsonPath = path.join(batchRunDir, 'index.json');
    const batchMarkdownPath = path.join(batchRunDir, 'index.md');
    fs.writeFileSync(batchJsonPath, `${JSON.stringify(batchReport, null, 2)}\n`);
    fs.writeFileSync(batchMarkdownPath, renderBatchMarkdown(batchReport));
    console.log(`Wrote ${batchJsonPath}`);
    console.log(`Wrote ${batchMarkdownPath}`);
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
