import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx', 'cli/**/__tests__/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/components/__tests__/**', 'jsdom'],
      ['src/app/__tests__/**', 'jsdom'],
    ],
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cli': path.resolve(__dirname, './cli'),
    },
  },
});
