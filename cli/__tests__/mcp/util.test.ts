import { describe, it, expect } from 'vitest';
import { textResult, errorResult, findTicket, maskConfig } from '../../mcp/util.js';
import type { Ticket } from '../../schema/types.js';

describe('MCP util', () => {
  describe('textResult', () => {
    it('wraps string data', () => {
      const result = textResult('hello');
      expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    });

    it('serializes object data as pretty JSON', () => {
      const result = textResult({ key: 'value' });
      expect(result.content[0].text).toBe('{\n  "key": "value"\n}');
    });
  });

  describe('errorResult', () => {
    it('returns isError: true', () => {
      const result = errorResult('something broke');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('something broke');
    });
  });

  describe('findTicket', () => {
    const tickets: Ticket[] = [
      { id: 'tk-1', externalId: 'ext-100', subject: 'Test', status: 'open', priority: 'normal', requester: 'user', assignee: undefined, tags: [], source: 'zendesk', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'tk-2', externalId: 'ext-200', subject: 'Test 2', status: 'open', priority: 'high', requester: 'user', assignee: undefined, tags: [], source: 'zendesk', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ];

    it('finds by internal ID', () => {
      expect(findTicket(tickets, 'tk-1')?.id).toBe('tk-1');
    });

    it('finds by external ID', () => {
      expect(findTicket(tickets, 'ext-200')?.id).toBe('tk-2');
    });

    it('returns undefined for missing ticket', () => {
      expect(findTicket(tickets, 'nonexistent')).toBeUndefined();
    });

    it('returns undefined for empty array', () => {
      expect(findTicket([], 'tk-1')).toBeUndefined();
    });
  });

  describe('maskConfig', () => {
    it('masks claude API key', () => {
      const config = { provider: 'claude', claude: { apiKey: 'sk-ant-1234567890abcdef', model: 'claude-3' } };
      const masked = maskConfig(config);
      expect((masked.claude as { apiKey: string }).apiKey).toBe('sk-ant-1...');
      expect((masked.claude as { model: string }).model).toBe('claude-3');
    });

    it('masks openai API key', () => {
      const config = { provider: 'openai', openai: { apiKey: 'sk-proj-abcdefghijklmnop', model: 'gpt-4o' } };
      const masked = maskConfig(config);
      expect((masked.openai as { apiKey: string }).apiKey).toBe('sk-proj-...');
    });

    it('masks openclaw API key', () => {
      const config = { provider: 'openclaw', openclaw: { apiKey: 'oc-key-1234567890', baseUrl: 'http://localhost', model: 'llama' } };
      const masked = maskConfig(config);
      expect((masked.openclaw as { apiKey: string }).apiKey).toBe('oc-key-1...');
    });

    it('handles missing API keys gracefully', () => {
      const config = { provider: 'claude', claude: { model: 'claude-3' } };
      const masked = maskConfig(config);
      expect(masked.claude).toEqual({ model: 'claude-3' });
    });

    it('preserves non-provider fields', () => {
      const config = { provider: 'claude', exportDir: './exports' };
      const masked = maskConfig(config);
      expect(masked.exportDir).toBe('./exports');
    });
  });
});
