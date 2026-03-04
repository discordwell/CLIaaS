import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We test the real output module, not a mock
const { setJsonMode, isJsonMode, output, outputError, info } = await import('../../output.js');

describe('output utility', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Reset to non-JSON mode
    setJsonMode(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    setJsonMode(false);
  });

  describe('setJsonMode / isJsonMode', () => {
    it('defaults to false', () => {
      expect(isJsonMode()).toBe(false);
    });

    it('can be set to true', () => {
      setJsonMode(true);
      expect(isJsonMode()).toBe(true);
    });

    it('can be toggled back to false', () => {
      setJsonMode(true);
      setJsonMode(false);
      expect(isJsonMode()).toBe(false);
    });
  });

  describe('output()', () => {
    it('calls humanFn in normal mode', () => {
      const humanFn = vi.fn();
      const data = { foo: 'bar' };

      output(data, humanFn);

      expect(humanFn).toHaveBeenCalledWith(data);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('writes JSON to stdout in JSON mode', () => {
      setJsonMode(true);
      const humanFn = vi.fn();
      const data = { tickets: [{ id: '1' }], total: 1 };

      output(data, humanFn);

      expect(humanFn).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(data) + '\n');
    });

    it('outputs valid JSON that can be parsed back', () => {
      setJsonMode(true);
      const data = { nested: { key: 'value' }, arr: [1, 2, 3] };

      output(data, () => {});

      const written = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual(data);
    });
  });

  describe('outputError()', () => {
    it('writes to console.error in normal mode', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      outputError('something went wrong');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('writes JSON error to stderr in JSON mode', () => {
      setJsonMode(true);
      outputError('something went wrong');
      expect(stderrSpy).toHaveBeenCalledWith(JSON.stringify({ error: 'something went wrong' }) + '\n');
    });
  });

  describe('info()', () => {
    it('prints in normal mode', () => {
      info('hello');
      expect(logSpy).toHaveBeenCalledWith('hello');
    });

    it('is suppressed in JSON mode', () => {
      setJsonMode(true);
      info('hello');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
