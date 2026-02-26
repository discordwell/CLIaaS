import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../format-time';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for very recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:30Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:05:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-18T12:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('3d ago');
  });

  it('returns absolute date for >30 days ago (same year)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    const result = formatRelativeTime('2026-01-01T12:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('1');
    // Should not include year for same year
    expect(result).not.toContain('2026');
  });

  it('returns absolute date with year for different year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    const result = formatRelativeTime('2025-06-01T12:00:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('2025');
  });

  it('returns "just now" for future timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatRelativeTime('2026-01-15T13:00:00Z')).toBe('just now');
  });

  it('handles exactly 1 minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:01:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('1m ago');
  });

  it('handles exactly 1 hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T13:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('1h ago');
  });

  it('handles exactly 1 day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-16T12:00:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('1d ago');
  });

  it('boundary: 59 minutes shows as minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:59:00Z'));
    expect(formatRelativeTime('2026-01-15T12:00:00Z')).toBe('59m ago');
  });

  it('boundary: 23 hours shows as hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T11:00:00Z'));
    expect(formatRelativeTime('2026-01-14T12:00:00Z')).toBe('23h ago');
  });

  it('boundary: 29 days shows as days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-30T12:00:00Z'));
    expect(formatRelativeTime('2026-01-01T12:00:00Z')).toBe('29d ago');
  });
});
