import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';

const mockRunZendeskIngest = vi.fn().mockResolvedValue(undefined);

vi.mock('../../db/ingest-zendesk.js', () => ({
  runZendeskIngest: mockRunZendeskIngest,
}));

const { registerDbCommands } = await import('../../commands/db.js');

describe('db ingest-zendesk', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerDbCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls runZendeskIngest with default options', async () => {
    await program.parseAsync(['node', 'cliaas', 'db', 'ingest-zendesk']);

    expect(mockRunZendeskIngest).toHaveBeenCalledWith({
      dir: './exports/zendesk',
      tenant: 'default',
      workspace: 'default',
    });
  });

  it('passes custom dir, tenant, workspace', async () => {
    await program.parseAsync([
      'node', 'cliaas', 'db', 'ingest-zendesk',
      '--dir', '/tmp/my-export',
      '--tenant', 'acme',
      '--workspace', 'production',
    ]);

    expect(mockRunZendeskIngest).toHaveBeenCalledWith({
      dir: '/tmp/my-export',
      tenant: 'acme',
      workspace: 'production',
    });
  });

  it('handles ingest errors', async () => {
    mockRunZendeskIngest.mockRejectedValueOnce(new Error('Missing manifest.json'));

    await expect(
      program.parseAsync(['node', 'cliaas', 'db', 'ingest-zendesk']),
    ).rejects.toThrow('process.exit');

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('db ingest (generic)', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerDbCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls runZendeskIngest with provider for generic ingest', async () => {
    await program.parseAsync([
      'node', 'cliaas', 'db', 'ingest',
      '--dir', '/tmp/groove-export',
      '--provider', 'groove',
    ]);

    expect(mockRunZendeskIngest).toHaveBeenCalledWith({
      dir: '/tmp/groove-export',
      tenant: 'demo',
      workspace: 'demo',
      provider: 'groove',
    });
  });

  it('accepts all valid providers', async () => {
    const validProviders = ['zendesk', 'kayako', 'freshdesk', 'groove', 'intercom', 'helpscout', 'zoho-desk', 'hubspot'];

    for (const provider of validProviders) {
      mockRunZendeskIngest.mockClear();

      await program.parseAsync([
        'node', 'cliaas', 'db', 'ingest',
        '--dir', `/tmp/${provider}`,
        '--provider', provider,
      ]);

      expect(mockRunZendeskIngest).toHaveBeenCalledTimes(1);
      expect(mockRunZendeskIngest.mock.calls[0][0].provider).toBe(provider);
    }
  });

  it('rejects invalid provider', async () => {
    await expect(
      program.parseAsync([
        'node', 'cliaas', 'db', 'ingest',
        '--dir', '/tmp/test',
        '--provider', 'invalid-provider',
      ]),
    ).rejects.toThrow('process.exit');

    expect(errorSpy).toHaveBeenCalled();
  });

  it('requires --dir flag', async () => {
    await expect(
      program.parseAsync(['node', 'cliaas', 'db', 'ingest', '--provider', 'groove']),
    ).rejects.toThrow();
  });

  it('requires --provider flag', async () => {
    await expect(
      program.parseAsync(['node', 'cliaas', 'db', 'ingest', '--dir', '/tmp/test']),
    ).rejects.toThrow();
  });

  it('passes custom tenant and workspace', async () => {
    await program.parseAsync([
      'node', 'cliaas', 'db', 'ingest',
      '--dir', '/tmp/test',
      '--provider', 'freshdesk',
      '--tenant', 'mycompany',
      '--workspace', 'staging',
    ]);

    expect(mockRunZendeskIngest).toHaveBeenCalledWith({
      dir: '/tmp/test',
      tenant: 'mycompany',
      workspace: 'staging',
      provider: 'freshdesk',
    });
  });
});
