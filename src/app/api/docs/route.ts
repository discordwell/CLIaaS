import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'CLIaaS API',
      version: '1.0.0',
      description:
        'CLI-as-a-Service helpdesk platform API. Supports tickets, automation rules, analytics, SLA policies, AI routing, webhooks, plugins, live chat, and customer portal.',
    },
    servers: [
      { url: 'https://cliaas.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Development' },
    ],
    paths: {
      '/api/tickets': {
        get: {
          summary: 'List tickets',
          tags: ['Tickets'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'priority', in: 'query', schema: { type: 'string' } },
            { name: 'assignee', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'List of tickets',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tickets: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                      stats: { $ref: '#/components/schemas/TicketStats' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/tickets/create': {
        post: {
          summary: 'Create a ticket',
          tags: ['Tickets'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['subject', 'requester'],
                  properties: {
                    subject: { type: 'string' },
                    body: { type: 'string' },
                    requester: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Ticket created' },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/api/tickets/{id}': {
        get: {
          summary: 'Get ticket by ID',
          tags: ['Tickets'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Ticket details' }, '404': { description: 'Not found' } },
        },
        patch: {
          summary: 'Update a ticket',
          tags: ['Tickets'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Ticket updated' }, '404': { description: 'Not found' } },
        },
      },
      '/api/tickets/{id}/reply': {
        post: {
          summary: 'Reply to a ticket',
          tags: ['Tickets'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['body'],
                  properties: {
                    body: { type: 'string' },
                    type: { type: 'string', enum: ['reply', 'note'] },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Reply created' } },
        },
      },
      '/api/tickets/stats': {
        get: {
          summary: 'Get ticket statistics',
          tags: ['Tickets'],
          responses: { '200': { description: 'Ticket statistics' } },
        },
      },
      '/api/rules': {
        get: {
          summary: 'List automation rules',
          tags: ['Automation'],
          parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['trigger', 'macro', 'automation', 'sla'] } }],
          responses: { '200': { description: 'List of rules' } },
        },
        post: {
          summary: 'Create a rule',
          tags: ['Automation'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'type'],
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['trigger', 'macro', 'automation', 'sla'] },
                    conditions: { type: 'object' },
                    actions: { type: 'array', items: { type: 'object' } },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Rule created' }, '400': { description: 'Validation error' } },
        },
      },
      '/api/rules/{id}': {
        get: {
          summary: 'Get rule by ID',
          tags: ['Automation'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Rule details' }, '404': { description: 'Not found' } },
        },
        patch: {
          summary: 'Update a rule',
          tags: ['Automation'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Rule updated' } },
        },
        delete: {
          summary: 'Delete a rule',
          tags: ['Automation'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Rule deleted' } },
        },
      },
      '/api/analytics': {
        get: {
          summary: 'Get analytics data',
          tags: ['Analytics'],
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { '200': { description: 'Analytics data' } },
        },
      },
      '/api/analytics/export': {
        get: {
          summary: 'Export analytics',
          tags: ['Analytics'],
          parameters: [
            { name: 'format', in: 'query', required: true, schema: { type: 'string', enum: ['csv', 'json'] } },
          ],
          responses: { '200': { description: 'Exported data' } },
        },
      },
      '/api/sla': {
        get: {
          summary: 'List SLA policies',
          tags: ['SLA'],
          responses: { '200': { description: 'List of SLA policies' } },
        },
        post: {
          summary: 'Create an SLA policy',
          tags: ['SLA'],
          responses: { '201': { description: 'Policy created' }, '400': { description: 'Validation error' } },
        },
      },
      '/api/sla/check': {
        get: {
          summary: 'Check SLA compliance for tickets',
          tags: ['SLA'],
          responses: { '200': { description: 'SLA check results' } },
        },
      },
      '/api/ai/route': {
        post: {
          summary: 'AI ticket routing',
          tags: ['AI'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { ticketId: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'Routing result' } },
        },
      },
      '/api/ai/agent': {
        post: {
          summary: 'AI agent assist',
          tags: ['AI'],
          responses: { '200': { description: 'AI suggestion' } },
        },
      },
      '/api/ai/insights': {
        get: {
          summary: 'AI-powered insights',
          tags: ['AI'],
          responses: { '200': { description: 'Insights data' } },
        },
      },
      '/api/ai/qa': {
        post: {
          summary: 'AI quality assurance check',
          tags: ['AI'],
          responses: { '200': { description: 'QA result' } },
        },
      },
      '/api/webhooks': {
        get: {
          summary: 'List webhooks',
          tags: ['Webhooks'],
          responses: {
            '200': {
              description: 'List of configured webhooks',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      webhooks: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create a webhook',
          tags: ['Webhooks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url', 'events'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    events: { type: 'array', items: { type: 'string' } },
                    secret: { type: 'string' },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Webhook created' }, '400': { description: 'Validation error' } },
        },
      },
      '/api/webhooks/{id}': {
        get: {
          summary: 'Get webhook by ID',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Webhook details' }, '404': { description: 'Not found' } },
        },
        patch: {
          summary: 'Update a webhook',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Webhook updated' } },
        },
        delete: {
          summary: 'Delete a webhook',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Webhook deleted' } },
        },
      },
      '/api/webhooks/{id}/logs': {
        get: {
          summary: 'Get webhook delivery logs',
          tags: ['Webhooks'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Delivery logs' } },
        },
      },
      '/api/webhooks/test': {
        post: {
          summary: 'Send test event to a webhook URL',
          tags: ['Webhooks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    secret: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Test result' } },
        },
      },
      '/api/plugins': {
        get: {
          summary: 'List installed plugins',
          tags: ['Plugins'],
          responses: {
            '200': {
              description: 'List of plugins',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      plugins: { type: 'array', items: { $ref: '#/components/schemas/Plugin' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Register a plugin',
          tags: ['Plugins'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    version: { type: 'string' },
                    description: { type: 'string' },
                    author: { type: 'string' },
                    hooks: { type: 'array', items: { type: 'string' } },
                    actions: { type: 'array', items: { type: 'object' } },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Plugin registered' }, '409': { description: 'Already exists' } },
        },
      },
      '/api/plugins/{id}': {
        get: {
          summary: 'Get plugin details',
          tags: ['Plugins'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Plugin details' }, '404': { description: 'Not found' } },
        },
        delete: {
          summary: 'Unregister a plugin',
          tags: ['Plugins'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Plugin unregistered' }, '404': { description: 'Not found' } },
        },
      },
      '/api/integrations/slack': {
        get: {
          summary: 'Get Slack integration status',
          tags: ['Integrations'],
          responses: { '200': { description: 'Slack connection status' } },
        },
        post: {
          summary: 'Handle Slack events and commands',
          tags: ['Integrations'],
          responses: { '200': { description: 'Event processed' } },
        },
      },
      '/api/integrations/teams': {
        get: {
          summary: 'Get Teams integration status',
          tags: ['Integrations'],
          responses: { '200': { description: 'Teams connection status' } },
        },
        post: {
          summary: 'Handle Teams activities',
          tags: ['Integrations'],
          responses: { '200': { description: 'Activity processed' } },
        },
      },
      '/api/chat': {
        post: {
          summary: 'Send a chat message',
          tags: ['Chat'],
          responses: { '200': { description: 'Message sent' } },
        },
      },
      '/api/chat/sessions': {
        get: {
          summary: 'List chat sessions',
          tags: ['Chat'],
          responses: { '200': { description: 'Chat sessions' } },
        },
      },
      '/api/portal/tickets': {
        get: {
          summary: 'List customer portal tickets',
          tags: ['Portal'],
          responses: { '200': { description: 'Customer tickets' } },
        },
        post: {
          summary: 'Submit a portal ticket',
          tags: ['Portal'],
          responses: { '201': { description: 'Ticket created' } },
        },
      },
      '/api/portal/kb': {
        get: {
          summary: 'Search knowledge base',
          tags: ['Portal'],
          responses: { '200': { description: 'KB articles' } },
        },
      },
      '/api/kb': {
        get: {
          summary: 'List knowledge base articles',
          tags: ['Knowledge Base'],
          responses: { '200': { description: 'KB articles' } },
        },
      },
      '/api/csat': {
        post: {
          summary: 'Submit CSAT survey',
          tags: ['CSAT'],
          responses: { '200': { description: 'Survey submitted' } },
        },
      },
      '/api/health': {
        get: {
          summary: 'Health check',
          tags: ['System'],
          responses: { '200': { description: 'Service healthy' } },
        },
      },
      '/api/auth/signup': {
        post: {
          summary: 'Create account',
          tags: ['Auth'],
          responses: { '201': { description: 'Account created' } },
        },
      },
      '/api/auth/signin': {
        post: {
          summary: 'Sign in',
          tags: ['Auth'],
          responses: { '200': { description: 'Signed in' } },
        },
      },
      '/api/auth/signout': {
        post: {
          summary: 'Sign out',
          tags: ['Auth'],
          responses: { '200': { description: 'Signed out' } },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Get current user',
          tags: ['Auth'],
          responses: { '200': { description: 'Current user' }, '401': { description: 'Not authenticated' } },
        },
      },
    },
    components: {
      schemas: {
        Ticket: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            externalId: { type: 'string' },
            source: { type: 'string' },
            subject: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            assignee: { type: 'string', nullable: true },
            requester: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TicketStats: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
            byPriority: { type: 'object', additionalProperties: { type: 'integer' } },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } },
            secret: { type: 'string' },
            enabled: { type: 'boolean' },
            retryPolicy: {
              type: 'object',
              properties: {
                maxAttempts: { type: 'integer' },
                delaysMs: { type: 'array', items: { type: 'integer' } },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Plugin: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
            description: { type: 'string' },
            author: { type: 'string' },
            hooks: { type: 'array', items: { type: 'string' } },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            enabled: { type: 'boolean' },
            installedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    tags: [
      { name: 'Tickets', description: 'Ticket management' },
      { name: 'Automation', description: 'Rules and automation' },
      { name: 'Analytics', description: 'Reporting and analytics' },
      { name: 'SLA', description: 'Service level agreements' },
      { name: 'AI', description: 'AI-powered features' },
      { name: 'Webhooks', description: 'Webhook management' },
      { name: 'Plugins', description: 'Plugin system' },
      { name: 'Integrations', description: 'Third-party integrations' },
      { name: 'Chat', description: 'Live chat' },
      { name: 'Portal', description: 'Customer portal' },
      { name: 'Knowledge Base', description: 'KB articles' },
      { name: 'CSAT', description: 'Customer satisfaction' },
      { name: 'Auth', description: 'Authentication' },
      { name: 'System', description: 'System endpoints' },
    ],
  };

  return NextResponse.json(spec);
}
