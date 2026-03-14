#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseScenarioINI, loadScenario } from '../src/EasterEgg/engine/scenario';
import { House, UNIT_STATS, cellIndexToPos, worldToCell } from '../src/EasterEgg/engine/types';
import { getCampaignMissionAgents } from '../src/EasterEgg/oracle/raMainCampaignMissionAgents';

type Severity = 'error' | 'warn';

interface StartStateIssue {
  severity: Severity;
  code: string;
  message: string;
}

interface StartStateReport {
  scenarioId: string;
  issues: StartStateIssue[];
  counts: {
    expectedEntities: number;
    actualEntities: number;
    expectedStructures: number;
    actualStructures: number;
    unsupportedPlacedUnits: number;
  };
}

interface EntityPlacement {
  type: string;
  house: House;
  cx: number;
  cy: number;
  facing: number;
  subCell: number;
  trigger: string;
}

interface StructurePlacement {
  type: string;
  house: House;
  cx: number;
  cy: number;
  trigger: string;
  alive: boolean;
}

interface StartStateOutput {
  timestamp: string;
  summary: {
    missionCount: number;
    errorCount: number;
    warnCount: number;
  };
  reports: StartStateReport[];
}

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'ra-campaign-start-state.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'ra-campaign-start-state.md');
const strict = process.argv.includes('--strict');
const ASSETS_DIR = path.join(process.cwd(), 'public', 'ra', 'assets');
const CARRYOVER_KEY = 'antmissions_carryover';

function normalizeTrigger(value: string | undefined): string {
  return value && value !== 'None' ? value : '';
}

function normalizeHouse(name: string): House {
  switch (name.toLowerCase()) {
    case 'spain': return House.Spain;
    case 'greece': return House.Greece;
    case 'england': return House.England;
    case 'france': return House.France;
    case 'ussr': return House.USSR;
    case 'ukraine': return House.Ukraine;
    case 'germany': return House.Germany;
    case 'turkey': return House.Turkey;
    case 'goodguy': return House.GoodGuy;
    case 'badguy': return House.BadGuy;
    case 'neutral':
    case 'special':
    default:
      return House.Neutral;
  }
}

function entityPlacementKey(placement: EntityPlacement): string {
  return JSON.stringify(placement);
}

function structurePlacementKey(placement: StructurePlacement): string {
  return JSON.stringify(placement);
}

function diffPlacements(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  const actualCounts = new Map<string, number>();
  for (const key of actual) {
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (const key of expected) {
    const count = actualCounts.get(key) ?? 0;
    if (count > 0) {
      actualCounts.set(key, count - 1);
    } else {
      missing.push(key);
    }
  }

  const extra: string[] = [];
  for (const [key, count] of actualCounts) {
    for (let i = 0; i < count; i++) {
      extra.push(key);
    }
  }

  return { missing, extra };
}

function preview(keys: string[]): string {
  return keys.slice(0, 5).join('; ');
}

function installLocalStorage(): Storage {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  } satisfies Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  });

  return localStorage;
}

function createAssetFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(raw, 'https://cliaas.local');
    const filePath = path.join(ASSETS_DIR, path.basename(url.pathname));
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
      } as Response;
    }

    const text = fs.readFileSync(filePath, 'utf8');
    return {
      ok: true,
      status: 200,
      text: async () => text,
    } as Response;
  }) as typeof fetch;
}

async function loadScenarioFromDisk(scenarioId: string) {
  const previousFetch = globalThis.fetch;
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = installLocalStorage();
  localStorage.removeItem(CARRYOVER_KEY);
  globalThis.fetch = createAssetFetch();

  try {
    return await loadScenario(scenarioId);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
      writable: true,
    });
  }
}

function buildExpectedEntityPlacements(scenarioId: string): {
  supported: EntityPlacement[];
  unsupportedTypes: string[];
} {
  const text = fs.readFileSync(path.join(ASSETS_DIR, `${scenarioId}.ini`), 'utf8');
  const data = parseScenarioINI(text);
  const supported: EntityPlacement[] = [];
  const unsupportedTypes = new Set<string>();

  for (const unit of data.units) {
    if (!UNIT_STATS[unit.type]) {
      unsupportedTypes.add(unit.type);
      continue;
    }
    const pos = cellIndexToPos(unit.cell);
    supported.push({
      type: unit.type,
      house: normalizeHouse(unit.house),
      cx: pos.cx,
      cy: pos.cy,
      facing: Math.floor(unit.facing / 32) % 8,
      subCell: -1,
      trigger: normalizeTrigger(unit.trigger),
    });
  }

  for (const infantry of data.infantry) {
    if (!UNIT_STATS[infantry.type]) {
      unsupportedTypes.add(infantry.type);
      continue;
    }
    const pos = cellIndexToPos(infantry.cell);
    supported.push({
      type: infantry.type,
      house: normalizeHouse(infantry.house),
      cx: pos.cx,
      cy: pos.cy,
      facing: Math.floor(infantry.facing / 32) % 8,
      subCell: infantry.subCell,
      trigger: normalizeTrigger(infantry.trigger),
    });
  }

  return {
    supported,
    unsupportedTypes: [...unsupportedTypes].sort(),
  };
}

function buildExpectedStructurePlacements(scenarioId: string): StructurePlacement[] {
  const text = fs.readFileSync(path.join(ASSETS_DIR, `${scenarioId}.ini`), 'utf8');
  const data = parseScenarioINI(text);
  const expected: StructurePlacement[] = [];

  for (const structure of data.structures) {
    const pos = cellIndexToPos(structure.cell);
    expected.push({
      type: structure.type,
      house: normalizeHouse(structure.house),
      cx: pos.cx,
      cy: pos.cy,
      trigger: normalizeTrigger(structure.trigger),
      alive: structure.hp > 0,
    });
  }

  for (const baseStructure of data.baseStructures) {
    const pos = cellIndexToPos(baseStructure.cell);
    expected.push({
      type: baseStructure.type,
      house: normalizeHouse(baseStructure.house),
      cx: pos.cx,
      cy: pos.cy,
      trigger: '',
      alive: true,
    });
  }

  return expected;
}

async function auditScenarioStartState(scenarioId: string): Promise<StartStateReport> {
  const issues: StartStateIssue[] = [];
  const expectedEntities = buildExpectedEntityPlacements(scenarioId);
  const expectedStructures = buildExpectedStructurePlacements(scenarioId);
  const scenario = await loadScenarioFromDisk(scenarioId);

  if (expectedEntities.unsupportedTypes.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unsupported-placed-unit-type',
      message: `${scenarioId}: placed unit types are not spawnable at mission start: ${expectedEntities.unsupportedTypes.join(', ')}`,
    });
  }

  const actualEntities: EntityPlacement[] = scenario.entities.map((entity) => {
    const cell = worldToCell(entity.pos.x, entity.pos.y);
    return {
      type: entity.type,
      house: entity.house,
      cx: cell.cx,
      cy: cell.cy,
      facing: entity.facing,
      subCell: entity.stats.isInfantry ? entity.subCell : -1,
      trigger: normalizeTrigger(entity.triggerName),
    };
  });

  const actualStructures: StructurePlacement[] = scenario.structures.map((structure) => ({
    type: structure.type,
    house: structure.house,
    cx: structure.cx,
    cy: structure.cy,
    trigger: normalizeTrigger(structure.triggerName),
    alive: structure.alive,
  }));

  const entityDiff = diffPlacements(
    expectedEntities.supported.map(entityPlacementKey),
    actualEntities.map(entityPlacementKey),
  );
  const structureDiff = diffPlacements(
    expectedStructures.map(structurePlacementKey),
    actualStructures.map(structurePlacementKey),
  );

  if (entityDiff.missing.length > 0) {
    issues.push({
      severity: 'error',
      code: 'missing-entity-placement',
      message: `${scenarioId}: missing ${entityDiff.missing.length} entity placements at mission start: ${preview(entityDiff.missing)}`,
    });
  }
  if (entityDiff.extra.length > 0) {
    issues.push({
      severity: 'error',
      code: 'extra-entity-placement',
      message: `${scenarioId}: found ${entityDiff.extra.length} unexpected entity placements at mission start: ${preview(entityDiff.extra)}`,
    });
  }
  if (structureDiff.missing.length > 0) {
    issues.push({
      severity: 'error',
      code: 'missing-structure-placement',
      message: `${scenarioId}: missing ${structureDiff.missing.length} structure placements at mission start: ${preview(structureDiff.missing)}`,
    });
  }
  if (structureDiff.extra.length > 0) {
    issues.push({
      severity: 'error',
      code: 'extra-structure-placement',
      message: `${scenarioId}: found ${structureDiff.extra.length} unexpected structure placements at mission start: ${preview(structureDiff.extra)}`,
    });
  }

  return {
    scenarioId,
    issues,
    counts: {
      expectedEntities: expectedEntities.supported.length,
      actualEntities: actualEntities.length,
      expectedStructures: expectedStructures.length,
      actualStructures: actualStructures.length,
      unsupportedPlacedUnits: expectedEntities.unsupportedTypes.length,
    },
  };
}

function formatMarkdown(reports: StartStateReport[]): string {
  const lines: string[] = [
    '# Campaign Start-State Parity',
    '',
  ];

  for (const report of reports) {
    lines.push(`## ${report.scenarioId}`);
    lines.push('');
    lines.push(`- Expected entities: ${report.counts.expectedEntities}`);
    lines.push(`- Actual entities: ${report.counts.actualEntities}`);
    lines.push(`- Expected structures: ${report.counts.expectedStructures}`);
    lines.push(`- Actual structures: ${report.counts.actualStructures}`);
    lines.push(`- Unsupported placed units: ${report.counts.unsupportedPlacedUnits}`);
    if (report.issues.length === 0) {
      lines.push('- Issues: none');
    } else {
      for (const issue of report.issues) {
        lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const scenarioIds = [...new Set(getCampaignMissionAgents().map((agent) => agent.scenarioId))];
  const reports = [];
  for (const scenarioId of scenarioIds) {
    reports.push(await auditScenarioStartState(scenarioId));
  }

  const output: StartStateOutput = {
    timestamp: new Date().toISOString(),
    summary: {
      missionCount: reports.length,
      errorCount: reports.reduce((sum, report) => sum + report.issues.filter((issue) => issue.severity === 'error').length, 0),
      warnCount: reports.reduce((sum, report) => sum + report.issues.filter((issue) => issue.severity === 'warn').length, 0),
    },
    reports,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(MD_OUTPUT, `${formatMarkdown(reports)}\n`);

  console.log(`Wrote ${JSON_OUTPUT}`);
  console.log(`Wrote ${MD_OUTPUT}`);
  console.log(`Audited ${output.summary.missionCount} campaign scenarios`);
  console.log(`Errors: ${output.summary.errorCount}`);
  console.log(`Warnings: ${output.summary.warnCount}`);

  if (strict && output.summary.errorCount > 0) {
    process.exitCode = 1;
  }
}

void main();
