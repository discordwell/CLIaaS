import { describe, it, expect } from 'vitest';
import type { IngestOptions } from '../ingest';

describe('IngestOptions provider field', () => {
  it('accepts all valid provider names', () => {
    const providers = [
      'zendesk', 'kayako', 'kayako-classic', 'helpcrunch',
      'freshdesk', 'groove', 'intercom', 'helpscout', 'zoho-desk', 'hubspot',
    ] as const;

    for (const provider of providers) {
      const opts: IngestOptions = {
        dir: '/tmp/test',
        tenant: 'demo',
        workspace: 'demo',
        provider,
      };
      expect(opts.provider).toBe(provider);
    }
  });

  it('provider is optional and defaults to undefined', () => {
    const opts: IngestOptions = {
      dir: '/tmp/test',
      tenant: 'demo',
      workspace: 'demo',
    };
    expect(opts.provider).toBeUndefined();
  });
});
