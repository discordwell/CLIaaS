import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PAGE_PATH = resolve(__dirname, '../safety/page.tsx');
const ACTIONS_PATH = resolve(__dirname, '../safety/_actions.tsx');
const source = readFileSync(PAGE_PATH, 'utf-8');
const actionsSource = readFileSync(ACTIONS_PATH, 'utf-8');

describe('AI Safety Page', () => {
  it('exports a default async server component', () => {
    expect(source).toContain('export default async function AISafetyPage');
  });

  it('is NOT a client component', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(false);
  });

  it('imports from admin-controls lib', () => {
    expect(source).toContain("from '@/lib/ai/admin-controls'");
  });

  it('renders the header "AI Safety & Controls"', () => {
    expect(source).toContain('AI Safety &amp; Controls');
  });

  it('displays circuit breaker states: closed, open, half_open', () => {
    expect(source).toContain('closed');
    expect(source).toContain('open');
    expect(source).toContain('half_open');
  });

  it('shows circuit breaker metrics (failure count, last failure, opened at)', () => {
    expect(source).toContain('Failure Count');
    expect(source).toContain('Half-Open Tries');
    expect(source).toContain('Last Failure');
    expect(source).toContain('Opened At');
  });

  it('includes PII configuration section with toggles', () => {
    expect(source).toContain('PII Protection');
    expect(source).toContain('Auto-Redaction');
    expect(source).toContain('Email Addresses');
    expect(source).toContain('Phone Numbers');
    expect(source).toContain('Social Security Numbers');
    expect(source).toContain('Credit Card Numbers');
  });

  it('renders usage quota progress bars', () => {
    expect(source).toContain('Usage Quotas');
    expect(source).toContain('AI Calls');
    expect(source).toContain('Tokens');
    expect(source).toContain('Cost');
    expect(source).toContain('barColor');
  });

  it('displays audit trail table with correct columns', () => {
    expect(source).toContain('Audit Trail');
    expect(source).toContain('Timestamp');
    expect(source).toContain('Action');
    expect(source).toContain('User');
    expect(source).toContain('Details');
  });

  it('follows the brutalist design system', () => {
    expect(source).toContain('border-2 border-line bg-panel');
    expect(source).toContain("font-mono text-xs font-bold uppercase tracking-[0.2em]");
    expect(source).toContain('text-foreground');
    expect(source).toContain('text-muted');
    expect(source).toContain('hover:bg-accent-soft');
    expect(source).toContain('max-w-6xl');
  });
});

describe('Safety Actions (client component)', () => {
  it('exists alongside the safety page', () => {
    expect(existsSync(ACTIONS_PATH)).toBe(true);
  });

  it('is a client component', () => {
    expect(actionsSource.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('has Trip and Reset buttons', () => {
    // Button text uses ternary: {loading ? '...' : 'Trip'}
    expect(actionsSource).toContain("'Trip'");
    expect(actionsSource).toContain("'Reset'");
  });

  it('calls the admin API for reset', () => {
    expect(actionsSource).toContain("'reset_circuit_breaker'");
    expect(actionsSource).toContain('/api/ai/admin');
  });

  it('disables Trip when circuit is already open', () => {
    expect(actionsSource).toContain("currentState === 'open'");
  });

  it('disables Reset when circuit is already closed', () => {
    expect(actionsSource).toContain("currentState === 'closed'");
  });
});
