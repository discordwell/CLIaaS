import { describe, it, expect } from 'vitest';
import type { PluginManifestV2 } from '../types';

function validateManifest(manifest: Partial<PluginManifestV2>): string[] {
  const errors: string[] = [];
  if (!manifest.id) errors.push('id is required');
  if (!manifest.name) errors.push('name is required');
  if (!manifest.version) errors.push('version is required');
  if (!manifest.runtime) errors.push('runtime is required');
  if (manifest.runtime && !['node', 'webhook'].includes(manifest.runtime)) {
    errors.push('runtime must be "node" or "webhook"');
  }
  if (manifest.runtime === 'webhook' && !manifest.webhookUrl) {
    errors.push('webhookUrl is required for webhook runtime');
  }
  if (manifest.hooks && !Array.isArray(manifest.hooks)) {
    errors.push('hooks must be an array');
  }
  if (manifest.permissions && !Array.isArray(manifest.permissions)) {
    errors.push('permissions must be an array');
  }
  return errors;
}

function validateConfig(schema: Record<string, unknown>, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const required = (schema.required as string[]) ?? [];
  for (const key of required) {
    if (config[key] === undefined) {
      errors.push(`Missing required config key: ${key}`);
    }
  }
  return errors;
}

describe('validateManifest', () => {
  it('passes valid manifest', () => {
    const errors = validateManifest({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      runtime: 'node',
    });
    expect(errors).toHaveLength(0);
  });

  it('fails missing id', () => {
    const errors = validateManifest({ name: 'Test', version: '1.0.0', runtime: 'node' });
    expect(errors).toContain('id is required');
  });

  it('fails missing name', () => {
    const errors = validateManifest({ id: 'test', version: '1.0.0', runtime: 'node' });
    expect(errors).toContain('name is required');
  });

  it('fails invalid runtime', () => {
    const errors = validateManifest({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      runtime: 'python' as 'node',
    });
    expect(errors).toContain('runtime must be "node" or "webhook"');
  });

  it('fails webhook without URL', () => {
    const errors = validateManifest({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      runtime: 'webhook',
    });
    expect(errors).toContain('webhookUrl is required for webhook runtime');
  });

  it('passes webhook with URL', () => {
    const errors = validateManifest({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      runtime: 'webhook',
      webhookUrl: 'https://example.com/hook',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validateConfig', () => {
  it('passes when all required keys present', () => {
    const errors = validateConfig(
      { required: ['apiKey'] },
      { apiKey: 'abc123' },
    );
    expect(errors).toHaveLength(0);
  });

  it('fails when required key missing', () => {
    const errors = validateConfig(
      { required: ['apiKey'] },
      {},
    );
    expect(errors).toContain('Missing required config key: apiKey');
  });

  it('passes with no required keys', () => {
    const errors = validateConfig({}, { anything: 'goes' });
    expect(errors).toHaveLength(0);
  });
});
