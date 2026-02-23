import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeLoadTickets, safeLoadMessages, safeLoadKBArticles, getTicketMessages, findTicket, maskConfig } from '../util.js';
import { loadConfig, getConfigPath } from '../../config.js';

export function registerResources(server: McpServer): void {
  // Full ticket list
  server.resource(
    'tickets',
    'cliaas://tickets',
    { description: 'Full ticket list from exported data', mimeType: 'application/json' },
    async () => {
      const tickets = safeLoadTickets();
      return {
        contents: [{
          uri: 'cliaas://tickets',
          mimeType: 'application/json',
          text: JSON.stringify(tickets.map(t => ({
            id: t.id,
            externalId: t.externalId,
            subject: t.subject,
            status: t.status,
            priority: t.priority,
            assignee: t.assignee ?? null,
            requester: t.requester,
            tags: t.tags,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })), null, 2),
        }],
      };
    },
  );

  // Single ticket with thread (URI template)
  server.resource(
    'ticket-detail',
    new ResourceTemplate('cliaas://tickets/{id}', { list: undefined }),
    { description: 'Single ticket with conversation thread', mimeType: 'application/json' },
    async (uri, variables) => {
      const id = variables.id as string;
      const tickets = safeLoadTickets();
      const messages = safeLoadMessages();
      const ticket = findTicket(tickets, id);

      if (!ticket) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: `Ticket not found: ${id}` }),
          }],
        };
      }

      const thread = getTicketMessages(ticket.id, messages)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            ticket,
            messages: thread.map(m => ({
              id: m.id,
              author: m.author,
              type: m.type,
              body: m.body,
              createdAt: m.createdAt,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // All KB articles
  server.resource(
    'kb-articles',
    'cliaas://kb-articles',
    { description: 'All knowledge base articles', mimeType: 'application/json' },
    async () => {
      const articles = safeLoadKBArticles();
      return {
        contents: [{
          uri: 'cliaas://kb-articles',
          mimeType: 'application/json',
          text: JSON.stringify(articles.map(a => ({
            id: a.id,
            externalId: a.externalId,
            title: a.title,
            categoryPath: a.categoryPath,
            bodyLength: a.body.length,
          })), null, 2),
        }],
      };
    },
  );

  // Queue statistics
  server.resource(
    'stats',
    'cliaas://stats',
    { description: 'Queue statistics snapshot', mimeType: 'application/json' },
    async () => {
      const tickets = safeLoadTickets();
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      for (const t of tickets) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
      }

      return {
        contents: [{
          uri: 'cliaas://stats',
          mimeType: 'application/json',
          text: JSON.stringify({
            totalTickets: tickets.length,
            byStatus,
            byPriority,
          }, null, 2),
        }],
      };
    },
  );

  // RAG status
  server.resource(
    'rag-status',
    'cliaas://rag/status',
    { description: 'RAG store chunk counts by source type', mimeType: 'application/json' },
    async () => {
      try {
        const { getRagPool } = await import('../../rag/db.js');
        const pool = getRagPool();
        if (!pool) {
          return {
            contents: [{
              uri: 'cliaas://rag/status',
              mimeType: 'application/json',
              text: JSON.stringify({ available: false, message: 'No RAG database configured' }),
            }],
          };
        }

        const counts = await pool.query(`
          SELECT source_type, COUNT(*) AS total, COUNT(embedding) AS with_embedding
          FROM rag_chunks GROUP BY source_type ORDER BY source_type
        `);

        return {
          contents: [{
            uri: 'cliaas://rag/status',
            mimeType: 'application/json',
            text: JSON.stringify({
              available: true,
              sources: counts.rows,
            }, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: 'cliaas://rag/status',
            mimeType: 'application/json',
            text: JSON.stringify({ available: false, message: 'RAG database unavailable' }),
          }],
        };
      }
    },
  );

  // Config
  server.resource(
    'config',
    'cliaas://config',
    { description: 'Current CLIaaS configuration (keys masked)', mimeType: 'application/json' },
    async () => {
      const config = loadConfig();
      const masked = maskConfig(config as unknown as Record<string, unknown>);

      return {
        contents: [{
          uri: 'cliaas://config',
          mimeType: 'application/json',
          text: JSON.stringify({ configPath: getConfigPath(), config: masked }, null, 2),
        }],
      };
    },
  );
}
