import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '../timing-safe';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('secret-token-123', 'secret-token-123')).toBe(true);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('secret-a', 'secret-b')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeStringEqual('secret', 'secret-longer')).toBe(false);
    expect(timingSafeStringEqual('secret-longer', 'secret')).toBe(false);
  });

  it('returns false when either side is a prefix of the other', () => {
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeStringEqual('abcd', 'abc')).toBe(false);
  });

  it('returns false for null or undefined inputs', () => {
    expect(timingSafeStringEqual(null, 'secret')).toBe(false);
    expect(timingSafeStringEqual('secret', null)).toBe(false);
    expect(timingSafeStringEqual(undefined, 'secret')).toBe(false);
    expect(timingSafeStringEqual('secret', undefined)).toBe(false);
    expect(timingSafeStringEqual(null, null)).toBe(false);
    expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
  });

  it('does not treat null as equal to the string "null"', () => {
    expect(timingSafeStringEqual(null, 'null')).toBe(false);
  });

  it('compares unicode strings correctly', () => {
    expect(timingSafeStringEqual('tøken-ü', 'tøken-ü')).toBe(true);
    expect(timingSafeStringEqual('tøken-ü', 'tøken-u')).toBe(false);
  });

  it('compares hex HMAC digests correctly', () => {
    const digest = 'a3f5b2c8d9e1047626f3a8b9c0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293';
    expect(timingSafeStringEqual(digest, digest)).toBe(true);
    expect(timingSafeStringEqual(digest, digest.slice(0, -1) + '4')).toBe(false);
  });

  it('handles embedded NUL characters', () => {
    expect(timingSafeStringEqual('a\0b', 'a\0b')).toBe(true);
    expect(timingSafeStringEqual('a\0b', 'a\0c')).toBe(false);
    expect(timingSafeStringEqual('a\0', 'a')).toBe(false);
  });

  it('compares long strings correctly', () => {
    const long = 'x'.repeat(10_000);
    expect(timingSafeStringEqual(long, long)).toBe(true);
    expect(timingSafeStringEqual(long, long.slice(0, -1) + 'y')).toBe(false);
    expect(timingSafeStringEqual(long, long + 'x')).toBe(false);
  });
});
