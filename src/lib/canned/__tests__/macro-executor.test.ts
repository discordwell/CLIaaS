import { describe, it, expect } from 'vitest';
import { executeMacroActions, type MacroTicketContext } from '../macro-executor';
import type { MacroAction } from '../macro-store';
import type { MergeContext } from '../merge';

function makeTicket(overrides?: Partial<MacroTicketContext>): MacroTicketContext {
  return {
    id: 'TK-1',
    status: 'open',
    priority: 'normal',
    assignee: null,
    tags: ['billing'],
    ...overrides,
  };
}

const mergeCtx: MergeContext = {
  customer: { name: 'Alice' },
  agent: { name: 'Bob' },
};

describe('executeMacroActions', () => {
  it('sets status', () => {
    const ticket = makeTicket();
    const result = executeMacroActions([{ type: 'set_status', value: 'solved' }], ticket);
    expect(ticket.status).toBe('solved');
    expect(result.changes.status).toBe('solved');
    expect(result.actionsExecuted).toBe(1);
  });

  it('sets priority', () => {
    const ticket = makeTicket();
    const result = executeMacroActions([{ type: 'set_priority', value: 'urgent' }], ticket);
    expect(ticket.priority).toBe('urgent');
    expect(result.changes.priority).toBe('urgent');
  });

  it('adds and removes tags', () => {
    const ticket = makeTicket({ tags: ['billing', 'vip'] });
    const actions: MacroAction[] = [
      { type: 'add_tag', value: 'resolved' },
      { type: 'remove_tag', value: 'billing' },
    ];
    const result = executeMacroActions(actions, ticket);
    expect(ticket.tags).toEqual(['vip', 'resolved']);
    expect(result.actionsExecuted).toBe(2);
  });

  it('assigns agent', () => {
    const ticket = makeTicket();
    const result = executeMacroActions([{ type: 'assign', value: 'agent-1' }], ticket);
    expect(ticket.assignee).toBe('agent-1');
    expect(result.changes.assignee).toBe('agent-1');
  });

  it('unassigns when value is empty', () => {
    const ticket = makeTicket({ assignee: 'agent-1' });
    const result = executeMacroActions([{ type: 'assign', value: '' }], ticket);
    expect(ticket.assignee).toBeNull();
    expect(result.changes.assignee).toBeNull();
  });

  it('adds reply with merge variables resolved', () => {
    const ticket = makeTicket();
    const actions: MacroAction[] = [
      { type: 'add_reply', value: 'Hi {{customer.name}}, this is {{agent.name}}.' },
    ];
    const result = executeMacroActions(actions, ticket, mergeCtx);
    expect(result.replies).toEqual(['Hi Alice, this is Bob.']);
  });

  it('adds internal note with merge variables', () => {
    const ticket = makeTicket();
    const actions: MacroAction[] = [
      { type: 'add_note', value: 'Escalated for {{customer.name}}' },
    ];
    const result = executeMacroActions(actions, ticket, mergeCtx);
    expect(result.notes).toEqual(['Escalated for Alice']);
  });

  it('executes multiple actions sequentially', () => {
    const ticket = makeTicket();
    const actions: MacroAction[] = [
      { type: 'set_status', value: 'solved' },
      { type: 'set_priority', value: 'high' },
      { type: 'add_tag', value: 'resolved' },
      { type: 'add_reply', value: 'Resolved!' },
    ];
    const result = executeMacroActions(actions, ticket);
    expect(result.actionsExecuted).toBe(4);
    expect(ticket.status).toBe('solved');
    expect(ticket.priority).toBe('high');
    expect(ticket.tags).toContain('resolved');
    expect(result.replies).toEqual(['Resolved!']);
  });

  it('records errors for invalid actions without stopping', () => {
    const ticket = makeTicket();
    const actions: MacroAction[] = [
      { type: 'set_status', value: 'invalid_status' },
      { type: 'set_priority', value: 'normal' },
    ];
    const result = executeMacroActions(actions, ticket);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Invalid status');
    expect(result.actionsExecuted).toBe(1);
    expect(ticket.priority).toBe('normal');
  });

  it('handles set_custom_field', () => {
    const ticket = makeTicket();
    const actions: MacroAction[] = [
      { type: 'set_custom_field', field: 'region', value: 'US-West' },
    ];
    const result = executeMacroActions(actions, ticket);
    expect(result.changes.customFields).toEqual({ region: 'US-West' });
  });

  it('errors on set_custom_field without field name', () => {
    const ticket = makeTicket();
    const result = executeMacroActions([{ type: 'set_custom_field', value: 'x' }], ticket);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Custom field name required');
  });
});
