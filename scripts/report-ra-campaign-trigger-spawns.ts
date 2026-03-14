#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  formatCampaignTriggerSpawnMarkdown,
  runCampaignTriggerSpawnAudit,
} from '../src/EasterEgg/oracle/raCampaignTriggerSpawnAudit';

interface TriggerSpawnOutput {
  timestamp: string;
  summary: {
    missionCount: number;
    errorCount: number;
    warnCount: number;
  };
  reports: ReturnType<typeof runCampaignTriggerSpawnAudit>;
}

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'ra-campaign-trigger-spawns.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'ra-campaign-trigger-spawns.md');
const strict = process.argv.includes('--strict');

function main(): void {
  const reports = runCampaignTriggerSpawnAudit();
  const output: TriggerSpawnOutput = {
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
  fs.writeFileSync(MD_OUTPUT, `${formatCampaignTriggerSpawnMarkdown(reports)}\n`);

  console.log(`Wrote ${JSON_OUTPUT}`);
  console.log(`Wrote ${MD_OUTPUT}`);
  console.log(`Audited ${output.summary.missionCount} campaign scenarios`);
  console.log(`Errors: ${output.summary.errorCount}`);
  console.log(`Warnings: ${output.summary.warnCount}`);

  if (strict && output.summary.errorCount > 0) {
    process.exitCode = 1;
  }
}

main();
