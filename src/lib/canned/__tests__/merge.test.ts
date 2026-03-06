import { describe, it, expect } from 'vitest';
import { resolveMergeVariables, type MergeContext } from '../merge';

describe('resolveMergeVariables', () => {
  const fullContext: MergeContext = {
    customer: { name: 'Alice Smith', email: 'alice@example.com', phone: '+1234567890' },
    ticket: { id: 'TK-001', subject: 'Login issue', status: 'open', priority: 'high', externalId: 'ZD-99', createdAt: '2026-03-01T00:00:00Z' },
    agent: { name: 'Bob Agent', email: 'bob@cliaas.com' },
    workspace: { name: 'Acme Corp' },
  };

  it('resolves customer variables', () => {
    expect(resolveMergeVariables('Hi {{customer.name}}!', fullContext)).toBe('Hi Alice Smith!');
    expect(resolveMergeVariables('Email: {{customer.email}}', fullContext)).toBe('Email: alice@example.com');
    expect(resolveMergeVariables('Phone: {{customer.phone}}', fullContext)).toBe('Phone: +1234567890');
  });

  it('resolves ticket variables', () => {
    expect(resolveMergeVariables('Ticket #{{ticket.id}}', fullContext)).toBe('Ticket #TK-001');
    expect(resolveMergeVariables('Re: {{ticket.subject}}', fullContext)).toBe('Re: Login issue');
    expect(resolveMergeVariables('Status: {{ticket.status}}', fullContext)).toBe('Status: open');
    expect(resolveMergeVariables('Priority: {{ticket.priority}}', fullContext)).toBe('Priority: high');
  });

  it('resolves agent variables', () => {
    expect(resolveMergeVariables('From {{agent.name}}', fullContext)).toBe('From Bob Agent');
    expect(resolveMergeVariables('{{agent.email}}', fullContext)).toBe('bob@cliaas.com');
  });

  it('resolves workspace variables', () => {
    expect(resolveMergeVariables('Workspace: {{workspace.name}}', fullContext)).toBe('Workspace: Acme Corp');
  });

  it('resolves multiple variables in one template', () => {
    const template = 'Hi {{customer.name}}, your ticket {{ticket.id}} ({{ticket.status}}) is assigned to {{agent.name}}.';
    expect(resolveMergeVariables(template, fullContext)).toBe(
      'Hi Alice Smith, your ticket TK-001 (open) is assigned to Bob Agent.',
    );
  });

  it('replaces unknown variables with empty string', () => {
    expect(resolveMergeVariables('Hi {{customer.name}}', {})).toBe('Hi ');
    expect(resolveMergeVariables('{{unknown.var}}', fullContext)).toBe('');
    expect(resolveMergeVariables('{{deeply.nested.path}}', fullContext)).toBe('');
  });

  it('handles missing optional fields gracefully', () => {
    const partial: MergeContext = { customer: { name: 'Test' } };
    expect(resolveMergeVariables('{{customer.name}} / {{customer.email}}', partial)).toBe('Test / ');
  });

  it('leaves non-variable text unchanged', () => {
    expect(resolveMergeVariables('Hello world!', fullContext)).toBe('Hello world!');
    expect(resolveMergeVariables('{ not a variable }', fullContext)).toBe('{ not a variable }');
    expect(resolveMergeVariables('{single}', fullContext)).toBe('{single}');
  });

  it('handles empty template', () => {
    expect(resolveMergeVariables('', fullContext)).toBe('');
  });

  it('handles template with only variables', () => {
    expect(resolveMergeVariables('{{customer.name}}', fullContext)).toBe('Alice Smith');
  });

  it('blocks prototype-chain property access', () => {
    expect(resolveMergeVariables('{{constructor.name}}', fullContext)).toBe('');
    expect(resolveMergeVariables('{{__proto__}}', fullContext)).toBe('');
    expect(resolveMergeVariables('{{prototype}}', fullContext)).toBe('');
    expect(resolveMergeVariables('{{toString}}', fullContext)).toBe('');
  });
});
