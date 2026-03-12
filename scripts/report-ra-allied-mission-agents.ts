#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  formatAuditMarkdown,
  runAlliedMissionAgents,
} from '../src/EasterEgg/oracle/raAlliedMissionAgents';

interface AlliedMissionAuditOutput {
  timestamp: string;
  summary: {
    missionCount: number;
    errorCount: number;
    warnCount: number;
  };
  reports: ReturnType<typeof runAlliedMissionAgents>;
}

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'ra-allied-mission-audit.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'ra-allied-mission-audit.md');
const strict = process.argv.includes('--strict');

const reports = runAlliedMissionAgents();
const output: AlliedMissionAuditOutput = {
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
fs.writeFileSync(MD_OUTPUT, `${formatAuditMarkdown(reports)}\n`);

console.log(`Wrote ${JSON_OUTPUT}`);
console.log(`Wrote ${MD_OUTPUT}`);
console.log(`Audited ${output.summary.missionCount} early Allied missions`);
console.log(`Errors: ${output.summary.errorCount}`);
console.log(`Warnings: ${output.summary.warnCount}`);

if (strict && output.summary.errorCount > 0) {
  process.exitCode = 1;
}
