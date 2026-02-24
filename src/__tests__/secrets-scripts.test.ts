import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const SCRIPTS_DIR = resolve(__dirname, '../../scripts');

describe('secrets management scripts', () => {
  const scripts = [
    'secrets-encrypt.sh',
    'secrets-decrypt.sh',
    'secrets-rotate.sh',
  ];

  for (const script of scripts) {
    it(`${script} exists`, () => {
      const path = resolve(SCRIPTS_DIR, script);
      expect(existsSync(path)).toBe(true);
    });

    it(`${script} is executable`, () => {
      const path = resolve(SCRIPTS_DIR, script);
      const stats = statSync(path);
      // Check owner execute bit (0o100)
      const isExecutable = (stats.mode & 0o100) !== 0;
      expect(isExecutable).toBe(true);
    });
  }

  it('security-audit.sh exists and is executable', () => {
    const path = resolve(SCRIPTS_DIR, 'security-audit.sh');
    expect(existsSync(path)).toBe(true);
    const stats = statSync(path);
    expect((stats.mode & 0o100) !== 0).toBe(true);
  });

  it('.sops.yaml exists at project root', () => {
    const path = resolve(SCRIPTS_DIR, '../.sops.yaml');
    expect(existsSync(path)).toBe(true);
  });
});
