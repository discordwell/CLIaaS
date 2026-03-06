import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';

export function registerCustomObjectTools(server: McpServer): void {
  server.tool(
    'custom_object_types',
    'List all custom object type definitions',
    {},
    async () => {
      try {
        const { listObjectTypes } = await import('@/lib/custom-objects.js');
        const types = listObjectTypes();
        if (!types.length) return textResult({ message: 'No custom object types defined' });
        return textResult({
          types: types.map(t => ({
            id: t.id, key: t.key, name: t.name, namePlural: t.namePlural,
            fieldCount: t.fields.length, fields: t.fields.map(f => ({ key: f.key, name: f.name, type: f.type, required: f.required })),
          })),
        });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_create_type',
    'Define a new custom object type with field schema',
    {
      key: z.string().describe('Machine-readable key (e.g. subscription)'),
      name: z.string().describe('Human-readable name (e.g. Subscription)'),
      namePlural: z.string().optional().describe('Plural name'),
      description: z.string().optional().describe('Description'),
      fields: z.array(z.object({
        key: z.string(),
        name: z.string(),
        type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'multiselect', 'url', 'email', 'currency', 'relation']),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
      })).describe('Field definitions'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ key, name, namePlural, description, fields, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to create type' });
      try {
        const { createObjectType } = await import('@/lib/custom-objects.js');
        const type = createObjectType({
          workspaceId: 'default',
          key, name,
          namePlural: namePlural ?? `${name}s`,
          description,
          fields,
        });
        return textResult({ created: type.key, id: type.id, fieldCount: type.fields.length });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_create',
    'Create a custom object record',
    {
      typeKey: z.string().describe('Object type key (e.g. subscription)'),
      data: z.record(z.string(), z.unknown()).describe('Record field values'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ typeKey, data, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to create record' });
      try {
        const { getObjectTypeByKey, createRecord, validateRecordData } = await import('@/lib/custom-objects.js');
        const typeDef = getObjectTypeByKey('default', typeKey);
        if (!typeDef) return errorResult(`Type '${typeKey}' not found`);
        const validation = validateRecordData(typeDef, data);
        if (!validation.valid) return errorResult(`Validation: ${validation.errors.join(', ')}`);
        const record = createRecord({ workspaceId: 'default', typeId: typeDef.id, data });
        return textResult({ created: record.id, data: record.data });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_search',
    'Search custom object records',
    {
      typeKey: z.string().describe('Object type key'),
      filter: z.record(z.string(), z.unknown()).optional().describe('Filter criteria (field=value pairs)'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ typeKey, filter, limit }) => {
      try {
        const { getObjectTypeByKey, listRecords } = await import('@/lib/custom-objects.js');
        const typeDef = getObjectTypeByKey('default', typeKey);
        if (!typeDef) return errorResult(`Type '${typeKey}' not found`);
        let records = listRecords(typeDef.id);
        if (filter) {
          records = records.filter(r => {
            return Object.entries(filter).every(([k, v]) => r.data[k] === v);
          });
        }
        if (limit) records = records.slice(0, limit);
        return textResult({ type: typeKey, count: records.length, records: records.map(r => ({ id: r.id, data: r.data })) });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_show',
    'Get a specific custom object record',
    {
      typeKey: z.string().describe('Object type key'),
      recordId: z.string().describe('Record ID'),
    },
    async ({ typeKey, recordId }) => {
      try {
        const { getRecord } = await import('@/lib/custom-objects.js');
        const record = getRecord(recordId);
        if (!record) return errorResult('Record not found');
        return textResult({ id: record.id, data: record.data, createdAt: record.createdAt });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_update',
    'Update a custom object record',
    {
      typeKey: z.string().describe('Object type key'),
      recordId: z.string().describe('Record ID'),
      data: z.record(z.string(), z.unknown()).describe('Fields to update'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ typeKey, recordId, data, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to update' });
      try {
        const { getRecord, updateRecord, getObjectTypeByKey, validateRecordData } = await import('@/lib/custom-objects.js');
        const existing = getRecord(recordId);
        if (!existing) return errorResult('Record not found');
        const typeDef = getObjectTypeByKey('default', typeKey);
        if (typeDef) {
          const merged = { ...existing.data, ...data };
          const validation = validateRecordData(typeDef, merged as Record<string, unknown>);
          if (!validation.valid) return errorResult(`Validation: ${validation.errors.join(', ')}`);
        }
        const updated = updateRecord(recordId, { data: { ...existing.data, ...data } });
        return textResult({ updated: updated?.id, data: updated?.data });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_link',
    'Create a relationship between entities (tickets, customers, custom objects)',
    {
      sourceType: z.string().describe('Source entity type (ticket, customer, organization, custom_object)'),
      sourceId: z.string().describe('Source entity ID'),
      targetType: z.string().describe('Target entity type'),
      targetId: z.string().describe('Target entity ID'),
      relationshipType: z.string().optional().describe('Relationship type (default: related)'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ sourceType, sourceId, targetType, targetId, relationshipType, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to create relationship' });
      try {
        const { createRelationship } = await import('@/lib/custom-objects.js');
        const rel = createRelationship({
          workspaceId: 'default',
          sourceType, sourceId, targetType, targetId,
          relationshipType: relationshipType ?? 'related',
          metadata: {},
        });
        return textResult({ created: rel.id, from: `${sourceType}:${sourceId}`, to: `${targetType}:${targetId}` });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'custom_object_relationships',
    'List relationships for an entity',
    {
      entityType: z.string().describe('Entity type (ticket, customer, custom_object)'),
      entityId: z.string().describe('Entity ID'),
    },
    async ({ entityType, entityId }) => {
      try {
        const { listRelationships } = await import('@/lib/custom-objects.js');
        // Search as both source and target
        const asSource = listRelationships({ sourceType: entityType, sourceId: entityId });
        const asTarget = listRelationships({ targetType: entityType, targetId: entityId });
        const all = [...asSource, ...asTarget];
        if (!all.length) return textResult({ message: 'No relationships found' });
        return textResult({
          relationships: all.map(r => ({
            id: r.id,
            from: `${r.sourceType}:${r.sourceId}`,
            to: `${r.targetType}:${r.targetId}`,
            type: r.relationshipType,
          })),
        });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}
