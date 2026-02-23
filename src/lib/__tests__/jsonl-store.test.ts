import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readJsonlFile, writeJsonlFile } from '@/lib/jsonl-store';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/cliaas-test-jsonl-' + process.pid;

describe('jsonl-store', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
  });

  it('returns empty array when file does not exist', () => {
    const items = readJsonlFile('nonexistent.jsonl');
    expect(items).toEqual([]);
  });

  it('writes and reads items round-trip', () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    writeJsonlFile('test.jsonl', data);
    const loaded = readJsonlFile<{ id: number; name: string }>('test.jsonl');
    expect(loaded).toEqual(data);
  });

  it('creates the directory if it does not exist', () => {
    expect(existsSync(TEST_DIR)).toBe(false);
    writeJsonlFile('auto-create.jsonl', [{ x: 1 }]);
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('handles empty items array', () => {
    writeJsonlFile('empty.jsonl', []);
    const loaded = readJsonlFile('empty.jsonl');
    expect(loaded).toEqual([]);
  });

  it('skips malformed JSON lines', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const filePath = join(TEST_DIR, 'malformed.jsonl');
    const content = '{"ok":true}\nnot-json\n{"also":"ok"}\n';
    require('fs').writeFileSync(filePath, content, 'utf-8');
    const loaded = readJsonlFile<{ ok?: boolean; also?: string }>(filePath.replace(TEST_DIR + '/', ''));
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({ ok: true });
    expect(loaded[1]).toEqual({ also: 'ok' });
  });

  it('respects CLIAAS_DATA_DIR override', () => {
    const customDir = '/tmp/cliaas-custom-dir-' + process.pid;
    process.env.CLIAAS_DATA_DIR = customDir;
    try {
      writeJsonlFile('custom.jsonl', [{ data: true }]);
      expect(existsSync(join(customDir, 'custom.jsonl'))).toBe(true);
      const content = readFileSync(join(customDir, 'custom.jsonl'), 'utf-8');
      expect(content).toContain('"data":true');
    } finally {
      if (existsSync(customDir)) rmSync(customDir, { recursive: true });
    }
  });
});
