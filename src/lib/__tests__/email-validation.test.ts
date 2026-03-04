import { describe, it, expect } from 'vitest';
import { validateEmail } from '../email-validation';

describe('validateEmail', () => {
  // --- Valid emails ---
  it('accepts a standard email', () => {
    expect(validateEmail('user@example.com')).toEqual({ valid: true });
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toEqual({ valid: true });
  });

  it('accepts email with plus addressing', () => {
    expect(validateEmail('user+tag@example.com')).toEqual({ valid: true });
  });

  it('accepts email with dots in local part', () => {
    expect(validateEmail('first.last@example.com')).toEqual({ valid: true });
  });

  it('trims whitespace from email', () => {
    expect(validateEmail('  user@example.com  ')).toEqual({ valid: true });
  });

  // --- Missing / empty ---
  it('rejects empty string', () => {
    const result = validateEmail('');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Email is required');
  });

  it('rejects undefined cast to string', () => {
    const result = validateEmail(undefined as unknown as string);
    expect(result.valid).toBe(false);
  });

  it('rejects null cast to string', () => {
    const result = validateEmail(null as unknown as string);
    expect(result.valid).toBe(false);
  });

  // --- Missing @ ---
  it('rejects email without @', () => {
    const result = validateEmail('userexample.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Empty local part ---
  it('rejects email with empty local part', () => {
    const result = validateEmail('@example.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Multiple @ ---
  it('rejects email with multiple @ signs', () => {
    const result = validateEmail('user@@example.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  it('rejects email with @ in domain', () => {
    const result = validateEmail('user@ex@mple.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Domain without dot ---
  it('rejects email with domain lacking a dot', () => {
    const result = validateEmail('user@localhost');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Cyrillic homoglyph attacks ---
  it('rejects Cyrillic "a" (U+0430) in domain', () => {
    // "cliaas\u0430.com" — the last 'a' before .com is Cyrillic
    const result = validateEmail('admin@cliaas\u0430.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  it('rejects Cyrillic "e" (U+0435) in domain', () => {
    const result = validateEmail('user@\u0435xample.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  it('rejects Cyrillic "o" (U+043E) in domain', () => {
    const result = validateEmail('user@g\u043E\u043Egle.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  it('rejects full Cyrillic domain', () => {
    const result = validateEmail('user@\u043F\u0440\u0438\u043C\u0435\u0440.\u0440\u0444');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Other non-ASCII in domain ---
  it('rejects Chinese characters in domain', () => {
    const result = validateEmail('user@\u4F8B\u5B50.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  it('rejects emoji in domain', () => {
    const result = validateEmail('user@exam\u{1F600}ple.com');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Invalid email address');
  });

  // --- Non-ASCII in local part is allowed (RFC 6531 permits it) ---
  // We only block non-ASCII in the domain part
  it('allows non-ASCII in local part (internationalized local part)', () => {
    // This is intentional: we only enforce ASCII on the domain
    expect(validateEmail('\u00FC ser@example.com')).toEqual({ valid: true });
  });
});
