import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'test-*.ts',
  timeout: 15 * 60 * 1000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 640, height: 400 },
    launchOptions: {
      args: [
        '--mute-audio',
        '--use-gl=swiftshader',
        '--enable-webgl',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
});
