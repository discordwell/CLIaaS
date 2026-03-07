import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PAGE_PATH = resolve(__dirname, '../procedures/page.tsx');
const source = readFileSync(PAGE_PATH, 'utf-8');

describe('AI Procedures Page', () => {
  it('exports a default component', () => {
    expect(source).toContain('export default function AIProceduresPage');
  });

  it('is a client component', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('fetches from /api/ai/procedures', () => {
    expect(source).toContain("fetch('/api/ai/procedures')");
  });

  it('has a Create New button', () => {
    expect(source).toContain('Create New');
  });

  it('renders procedure cards with status badges', () => {
    expect(source).toContain('deriveStatus');
    expect(source).toContain("'active'");
    expect(source).toContain("'draft'");
    expect(source).toContain("'disabled'");
  });

  it('includes toggle switch for enable/disable', () => {
    expect(source).toContain('handleToggle');
    expect(source).toContain("role=\"switch\"");
  });

  it('has Edit, Test, and Delete buttons on each card', () => {
    // Edit button uses ternary: {isExpanded ? 'Close' : 'Edit'}
    expect(source).toContain("'Edit'");
    // Test and Delete are direct text children
    expect(source).toMatch(/>\s*Test\s*</);
    expect(source).toMatch(/>\s*Delete\s*</);
  });

  it('has an inline editor with name, description, body, and triggers', () => {
    expect(source).toContain('formName');
    expect(source).toContain('formDescription');
    expect(source).toContain('formBody');
    expect(source).toContain('formTriggers');
  });

  it('has a test section with input and Run Test button', () => {
    expect(source).toContain('testInput');
    expect(source).toContain('Run Test');
    expect(source).toContain('testResult');
  });

  it('supports create and update via API', () => {
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("method: 'PUT'");
    expect(source).toContain("method: 'DELETE'");
  });

  it('follows the brutalist design system', () => {
    expect(source).toContain('border-2 border-line bg-panel');
    expect(source).toContain("font-mono text-xs font-bold uppercase tracking-[0.2em]");
    expect(source).toContain('text-foreground');
    expect(source).toContain('text-muted');
    expect(source).toContain('hover:bg-accent-soft');
  });
});
