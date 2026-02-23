import { describe, it, expect, beforeEach } from 'vitest';
import { withConfirmation, recordMCPAction, getMCPAuditLog } from '../../mcp/tools/confirm';

beforeEach(() => {
  global.__cliaasAuditMCP = [];
});

describe('withConfirmation', () => {
  it('returns preview when confirm is false', () => {
    const result = withConfirmation(false, {
      description: 'Test action',
      preview: { key: 'value' },
      execute: () => 'done',
    });

    expect(result.needsConfirmation).toBe(true);
    if (result.needsConfirmation) {
      const text = result.result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.confirmation_required).toBe(true);
      expect(parsed.preview.key).toBe('value');
    }
  });

  it('returns preview when confirm is undefined', () => {
    const result = withConfirmation(undefined, {
      description: 'Test',
      preview: {},
      execute: () => 'done',
    });
    expect(result.needsConfirmation).toBe(true);
  });

  it('executes when confirm is true', () => {
    const result = withConfirmation(true, {
      description: 'Test action',
      preview: {},
      execute: () => ({ success: true }),
    });

    expect(result.needsConfirmation).toBe(false);
    if (!result.needsConfirmation) {
      expect(result.value).toEqual({ success: true });
    }
  });
});

describe('MCP audit log', () => {
  it('records and retrieves actions', () => {
    recordMCPAction({
      tool: 'ticket_update',
      action: 'update',
      params: { ticketId: 't-1' },
      timestamp: new Date().toISOString(),
      result: 'success',
    });

    const log = getMCPAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].tool).toBe('ticket_update');
  });
});
