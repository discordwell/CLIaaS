import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression test for the auto-redaction PII leak.
 *
 * `scanEntity` used to call `applyRedaction` once per detected match, each time
 * masking the *original* field text with only that single match — so the stored
 * `bodyRedacted` reflected only the LAST match and every earlier PII item leaked
 * through. The fix batches all auto-redactable matches into one redaction pass.
 */
describe('scanEntity auto-redaction', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('redacts every auto-redactable match in a field, not just the last one', async () => {
    // Import schema after resetModules() so table identities match the copy
    // that pii-masking resolves through the (mocked) module registry.
    const schema = await import('@/db/schema');

    const body = 'SSN 123-45-6789 and card 4111111111111111 here';
    let capturedRedacted: string | undefined;

    const rulesRows = [
      { piiType: 'ssn', enabled: true, autoRedact: true, customPattern: null, maskingStyle: 'full' },
      { piiType: 'credit_card', enabled: true, autoRedact: true, customPattern: null, maskingStyle: 'full' },
    ];
    const msgRow = { id: 'msg-1', workspaceId: 'ws-1', body, bodyHtml: null };
    const detRow = {
      id: 'det-1', workspaceId: 'ws-1', entityType: 'message', entityId: 'msg-1',
      fieldName: 'body', piiType: 'ssn', charOffset: 0, charLength: 11,
      maskedValue: '[REDACTED-SSN]', confidence: 0.95, detectionMethod: 'regex',
      status: 'auto_redacted', reviewedBy: null, reviewedAt: null,
      redactedAt: new Date(), createdAt: new Date(),
    };

    const fakeDb = {
      select: () => {
        let result: unknown = [];
        const p: Record<string, unknown> = {
          from: (table: unknown) => {
            if (table === schema.piiSensitivityRules) result = rulesRows;
            else if (table === schema.messages) result = [msgRow];
            else result = [];
            return p;
          },
          where: () => p,
          limit: () => Promise.resolve(result),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej),
        };
        return p;
      },
      insert: () => {
        const p: Record<string, unknown> = {
          values: () => p,
          returning: () => Promise.resolve([detRow]),
        };
        return p;
      },
      update: () => {
        const p: Record<string, unknown> = {
          set: (s: Record<string, unknown>) => {
            if (s && 'bodyRedacted' in s) capturedRedacted = s.bodyRedacted as string;
            return p;
          },
          where: () => p,
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve([]).then(res, rej),
        };
        return p;
      },
    };

    vi.doMock('@/db', () => ({ getDb: () => fakeDb, db: fakeDb }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }));

    const { scanEntity } = await import('@/lib/compliance/pii-masking');
    const detections = await scanEntity('message', 'msg-1', 'ws-1');

    // Both PII items were detected.
    expect(detections.length).toBeGreaterThanOrEqual(2);

    // The stored redacted body masks BOTH — no raw PII survives.
    expect(capturedRedacted).toBeDefined();
    expect(capturedRedacted).not.toContain('123-45-6789');
    expect(capturedRedacted).not.toContain('4111111111111111');
    expect(capturedRedacted).toContain('[REDACTED-SSN]');
    expect(capturedRedacted).toContain('[REDACTED-CREDIT-CARD]');
  });
});
