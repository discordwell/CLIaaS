import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'test-qa.ts',
  timeout: 5 * 60 * 1000, // 5 minutes — QA runs all 4 missions in turbo
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 640, height: 400 },
  },
  webServer: {
    command: 'pnpm next start --port 3001',
    port: 3001,
    timeout: 60 * 1000,
    reuseExistingServer: true,
  },
});
