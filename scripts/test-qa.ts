/**
 * Playwright E2E test for the QA pipeline.
 *
 * Launches the app with ?anttest=qa, waits for window.__qaComplete,
 * extracts the report, saves screenshots, and asserts zero critical anomalies.
 *
 * Run: pnpm test:qa
 * Requires: next build before running (handled by playwright.config.ts webServer)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const QA_URL = 'http://localhost:3001?anttest=qa';
const REPORT_DIR = path.join(process.cwd(), 'test-results');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'qa-screenshots');

test('QA pipeline: all missions complete with zero critical anomalies', async ({ page }) => {
  // Ensure output directories exist
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Navigate to QA mode
  await page.goto(QA_URL);

  // Wait for QA pipeline to complete (polls window.__qaComplete)
  await page.waitForFunction(
    () => (window as unknown as { __qaComplete?: boolean }).__qaComplete === true,
    { timeout: 5 * 60 * 1000, polling: 2000 },
  );

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
    allMissionsCompleted: boolean;
    zeroCritical: boolean;
    passed: boolean;
    bySeverity: { critical: number; warning: number; info: number };
  } }).summary;

  console.log(`QA Report Summary:`);
  console.log(`  Missions completed: ${summary.allMissionsCompleted}`);
  console.log(`  Critical: ${summary.bySeverity.critical}`);
  console.log(`  Warnings: ${summary.bySeverity.warning}`);
  console.log(`  Info: ${summary.bySeverity.info}`);
  console.log(`  Passed: ${summary.passed}`);
  console.log(`  Screenshots saved: ${screenshots.length}`);
  console.log(`  Report: ${reportPath}`);

  expect(summary.allMissionsCompleted).toBe(true);
  expect(summary.bySeverity.critical).toBe(0);
  expect(summary.passed).toBe(true);
});
