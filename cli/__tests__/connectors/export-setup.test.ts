import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { setupExport, appendJsonl, writeManifest } from '../../connectors/base/export-setup.js';

const TEST_DIR = join(process.cwd(), 'tmp-test-export');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('setupExport', () => {
  it('creates output directory and standard JSONL files', () => {
    const paths = setupExport(TEST_DIR);

    expect(existsSync(TEST_DIR)).toBe(true);
    expect(existsSync(paths.tickets)).toBe(true);
    expect(existsSync(paths.messages)).toBe(true);
    expect(existsSync(paths.customers)).toBe(true);
    expect(existsSync(paths.organizations)).toBe(true);
    expect(existsSync(paths.kb_articles)).toBe(true);
    expect(existsSync(paths.rules)).toBe(true);
  });

  it('creates extra files when specified', () => {
    const paths = setupExport(TEST_DIR, ['groups.jsonl', 'brands.jsonl']);

    expect(existsSync(paths.groups)).toBe(true);
    expect(existsSync(paths.brands)).toBe(true);
  });

  it('files are empty after creation', () => {
    const paths = setupExport(TEST_DIR);

    expect(readFileSync(paths.tickets, 'utf-8')).toBe('');
  });
});

describe('appendJsonl', () => {
  it('appends a JSONL record correctly', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const filePath = join(TEST_DIR, 'test.jsonl');
    const record1 = { id: 1, name: 'first' };
    const record2 = { id: 2, name: 'second' };

    // Initialize the file
    require('fs').writeFileSync(filePath, '');

    appendJsonl(filePath, record1);
    appendJsonl(filePath, record2);

    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(record1);
    expect(JSON.parse(lines[1])).toEqual(record2);
  });
});

describe('writeManifest', () => {
  it('writes valid manifest.json', () => {
    mkdirSync(TEST_DIR, { recursive: true });

    const counts = { tickets: 10, messages: 25, customers: 5, organizations: 2, kbArticles: 3, rules: 1 };
    const manifest = writeManifest(TEST_DIR, 'freshdesk', counts);

    const written = JSON.parse(readFileSync(join(TEST_DIR, 'manifest.json'), 'utf-8'));
    expect(written.source).toBe('freshdesk');
    expect(written.counts).toEqual(counts);
    expect(written.exportedAt).toBeDefined();
    expect(manifest.source).toBe('freshdesk');
  });

  it('includes extra fields', () => {
    mkdirSync(TEST_DIR, { recursive: true });

    writeManifest(TEST_DIR, 'zendesk', { tickets: 5, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 }, { cursorState: { tc: 'abc' } });

    const written = JSON.parse(readFileSync(join(TEST_DIR, 'manifest.json'), 'utf-8'));
    expect(written.cursorState).toEqual({ tc: 'abc' });
  });
});
