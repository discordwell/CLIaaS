import { describe, it, expect } from 'vitest';
import { createLogger, createRequestLogger } from '@/lib/logger';

describe('Logger', () => {
  it('createLogger returns a child logger with module', () => {
    const log = createLogger('test-module');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('createRequestLogger returns a child logger with module and requestId', () => {
    const log = createRequestLogger('test-module', 'req-abc-123');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
  });

  it('child loggers are distinct instances', () => {
    const log1 = createLogger('module-a');
    const log2 = createLogger('module-b');
    expect(log1).not.toBe(log2);
  });
});
