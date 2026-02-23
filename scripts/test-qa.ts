/**
 * Playwright E2E test for the QA pipeline.
 *
 * Launches the app with ?anttest=qa, waits for window.__qaComplete,
 * extracts the report, saves screenshots, and asserts zero critical anomalies.
 *
 * Run: pnpm test:qa
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const QA_URL = 'http://localhost:3001?anttest=qa';
const REPORT_DIR = path.join(process.cwd(), 'test-results');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'qa-screenshots');

test('QA pipeline: runs all missions with zero critical anomalies', async ({ page }) => {
  // Ensure output directories exist
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Collect console messages for debugging
  const consoleLogs: string[] = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

  // Navigate to QA mode
  await page.goto(QA_URL, { waitUntil: 'load' });

  // Wait for canvas to appear (game component mounted)
  try {
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('Canvas found');
  } catch {
    console.log('Canvas NOT found after 30s');
    console.log('Console logs:', consoleLogs.slice(0, 20).join('\n'));
    await page.screenshot({ path: path.join(REPORT_DIR, 'qa-debug-no-canvas.png') });
    throw new Error('AntGame component did not mount — canvas not found');
  }

  // Wait for QA pipeline to complete (polls window.__qaComplete)
  try {
    await page.waitForFunction(
      () => (window as unknown as { __qaComplete?: boolean }).__qaComplete === true,
      { timeout: 5 * 60 * 1000, polling: 2000 },
    );
  } finally {
    // Save console logs regardless of outcome
    fs.writeFileSync(path.join(REPORT_DIR, 'qa-console.log'), consoleLogs.join('\n'));
  }

  // Extract the QA report
  const report = await page.evaluate(() => {
    return (window as unknown as { __qaReport?: unknown }).__qaReport;
  });

  expect(report).toBeDefined();

  // Save report JSON
  const reportPath = path.join(REPORT_DIR, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Extract and save screenshots from report
  const screenshots = (report as { screenshots?: Array<{ key: string; dataUrl: string }> })?.screenshots ?? [];
  for (const ss of screenshots) {
    if (!ss.dataUrl.startsWith('data:image/png;base64,')) continue;
    const base64 = ss.dataUrl.replace('data:image/png;base64,', '');
    const filePath = path.join(SCREENSHOT_DIR, ss.key.replace(/[^a-zA-Z0-9._-]/g, '_'));
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  }

  // Assertions
  const summary = (report as { summary: {
    totalAnomalies: number;
    bySeverity: { critical: number; warning: number; info: number };
    allMissionsCompleted: boolean;
    zeroCritical: boolean;
    passed: boolean;
  } }).summary;

  const missions = (report as { missions: Array<{
    id: string; title: string; outcome: string; ticks: number;
    anomalies: Array<{ id: string; severity: string; message: string }>;
    stats: { unitsRemaining: number; killCount: number; lossCount: number; credits: number };
  }> }).missions;

  console.log(`\nQA Report Summary:`);
  console.log(`  Critical: ${summary.bySeverity.critical}`);
  console.log(`  Warnings: ${summary.bySeverity.warning}`);
  console.log(`  Info: ${summary.bySeverity.info}`);
  console.log(`  Passed: ${summary.passed}`);
  console.log(`  Screenshots: ${screenshots.length}`);
  console.log(`  Report: ${reportPath}`);
  for (const m of missions) {
    console.log(`  ${m.id}: ${m.outcome} at ${m.ticks} ticks (${m.anomalies.length} anomalies, ${m.stats.killCount} kills, ${m.stats.lossCount} losses)`);
  }

  // Core assertion: no engine-level critical anomalies (physics bugs, stuck states)
  // Note: mission outcomes depend on AutoPlayer AI quality, not engine correctness.
  // The pipeline itself running to completion proves the game loop is stable.
  expect(summary.bySeverity.critical).toBe(0);

  // All 4 missions must run (not crash/hang)
  expect(missions.length).toBe(4);
  for (const m of missions) {
    expect(['won', 'lost', 'timeout']).toContain(m.outcome);
  }
});
