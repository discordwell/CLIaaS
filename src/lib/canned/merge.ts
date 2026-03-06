/**
 * Merge variable resolution engine.
 * Resolves {{variable.path}} placeholders in template strings.
 */

export interface MergeContext {
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  ticket?: {
    id?: string;
    subject?: string;
    status?: string;
    priority?: string;
    externalId?: string;
    createdAt?: string;
  };
  agent?: {
    name?: string;
    email?: string;
  };
  workspace?: {
    name?: string;
  };
}

const MERGE_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;

/**
 * Resolve merge variables in a template string.
 * Unknown variables are replaced with empty string.
 */
export function resolveMergeVariables(template: string, context: MergeContext): string {
  return template.replace(MERGE_PATTERN, (_match, path: string) => {
    const value = resolvePathValue(context, path);
    return value ?? '';
  });
}

function resolvePathValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return undefined;
  return String(current);
}

/** Catalog of all supported merge variables with descriptions. */
export const MERGE_VARIABLE_CATALOG = [
  { variable: '{{customer.name}}', description: 'Customer full name' },
  { variable: '{{customer.email}}', description: 'Customer email address' },
  { variable: '{{customer.phone}}', description: 'Customer phone number' },
  { variable: '{{ticket.id}}', description: 'Ticket ID' },
  { variable: '{{ticket.subject}}', description: 'Ticket subject line' },
  { variable: '{{ticket.status}}', description: 'Current ticket status' },
  { variable: '{{ticket.priority}}', description: 'Current ticket priority' },
  { variable: '{{ticket.externalId}}', description: 'External platform ticket ID' },
  { variable: '{{ticket.createdAt}}', description: 'Ticket creation timestamp' },
  { variable: '{{agent.name}}', description: 'Agent name' },
  { variable: '{{agent.email}}', description: 'Agent email address' },
  { variable: '{{workspace.name}}', description: 'Workspace name' },
] as const;
