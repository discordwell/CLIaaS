import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'test-*.ts',
  timeout: 10 * 60 * 1000, // 10 minutes
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 640, height: 400 },
    launchOptions: {
      args: [
        '--mute-audio',
        '--use-gl=swiftshader',    // Software WebGL for headless
        '--enable-webgl',
        '--autoplay-policy=no-user-gesture-required',  // Allow audio without gesture
      ],
    },
  },
  webServer: {
    command: 'pnpm next dev --port 3001',
    port: 3001,
    timeout: 120 * 1000,
    reuseExistingServer: true,
  },
});
