import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the config module to use a temp directory
const TEST_DIR = join(tmpdir(), 'cliaas-config-test');
const TEST_CONFIG_PATH = join(TEST_DIR, 'config.json');

vi.mock('../../config.js', async () => {
  const { mkdirSync: mkd, readFileSync: rfs, writeFileSync: wfs, existsSync: ex, chmodSync } = await import('fs');
  const { join: j } = await import('path');
  const { tmpdir: td } = await import('os');

  const CONFIG_DIR = j(td(), 'cliaas-config-test');
  const CONFIG_PATH = j(CONFIG_DIR, 'config.json');

  const DEFAULT_CONFIG = { provider: 'claude' };

  return {
    getConfigDir: () => CONFIG_DIR,
    getConfigPath: () => CONFIG_PATH,
    loadConfig: () => {
      if (!ex(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
      try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(rfs(CONFIG_PATH, 'utf-8')) };
      } catch {
        return { ...DEFAULT_CONFIG };
      }
    },
    saveConfig: (config: Record<string, unknown>) => {
      mkd(CONFIG_DIR, { recursive: true, mode: 0o700 });
      wfs(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
      chmodSync(CONFIG_PATH, 0o600);
    },
  };
});

// Dynamically import after mocking
const { registerConfigCommand } = await import('../../commands/config.js');

describe('cliaas config set-mode', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });

    program = new Command();
    program.exitOverride(); // Prevent process.exit
    registerConfigCommand(program);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Override process.cwd so the .mcp.json update targets TEST_DIR, not the real project
    originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('sets mode to local', async () => {
    await program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'local']);

    const cfg = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(cfg.mode).toBe('local');
  });

  it('sets mode to db', async () => {
    await program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'db']);

    const cfg = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(cfg.mode).toBe('db');
  });

  it('sets mode to remote with --url and --api-key', async () => {
    await program.parseAsync([
      'node', 'cliaas', 'config', 'set-mode', 'remote',
      '--url', 'https://api.cliaas.com',
      '--api-key', 'sk-test-123',
    ]);

    const cfg = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(cfg.mode).toBe('remote');
    expect(cfg.hostedApiUrl).toBe('https://api.cliaas.com');
    expect(cfg.hostedApiKey).toBe('sk-test-123');
  });

  it('sets mode to hybrid', async () => {
    await program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'hybrid']);

    const cfg = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(cfg.mode).toBe('hybrid');
  });

  it('rejects invalid mode', async () => {
    // exitOverride turns process.exit into a thrown CommanderError
    await expect(
      program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'invalid']),
    ).rejects.toThrow();
  });

  it('rejects remote mode without --url when no existing config', async () => {
    vi.stubEnv('CLIAAS_HOSTED_URL', '');

    await expect(
      program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'remote']),
    ).rejects.toThrow();

    vi.unstubAllEnvs();
  });

  it('preserves existing config fields when setting mode', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      provider: 'openai',
      openai: { apiKey: 'existing-key' },
    }));

    await program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'db']);

    const cfg = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(cfg.mode).toBe('db');
    expect(cfg.provider).toBe('openai');
    expect(cfg.openai.apiKey).toBe('existing-key');
  });

  it('updates .mcp.json when it exists in cwd', async () => {
    // Write a test .mcp.json in TEST_DIR (which is our mocked cwd)
    const mcpPath = join(TEST_DIR, '.mcp.json');
    const testMcp = {
      mcpServers: {
        cliaas: {
          type: 'stdio',
          command: 'npx',
          args: ['tsx', 'cli/mcp/server.ts'],
          env: { CLIAAS_DATA_DIR: '/tmp/test' },
        },
      },
    };
    writeFileSync(mcpPath, JSON.stringify(testMcp, null, 2) + '\n');

    await program.parseAsync(['node', 'cliaas', 'config', 'set-mode', 'db']);

    const updatedMcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(updatedMcp.mcpServers.cliaas.env.CLIAAS_MODE).toBe('db');
  });
});
