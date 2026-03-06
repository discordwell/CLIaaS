/**
 * Custom Objects — JSONL fallback store for BYOC/demo mode.
 * Mirrors the DB schema: custom_object_types, custom_object_records, custom_object_relationships.
 */
import { readJsonlFile, writeJsonlFile } from './jsonl-store';

// ---- Types ----

export type CustomObjectFieldType =
  | 'text' | 'number' | 'boolean' | 'date'
  | 'select' | 'multiselect' | 'url' | 'email' | 'currency' | 'relation';

export interface CustomObjectFieldDef {
  key: string;
  name: string;
  type: CustomObjectFieldType;
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
}

export interface CustomObjectType {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  namePlural: string;
  description?: string;
  icon?: string;
  fields: CustomObjectFieldDef[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomObjectRecord {
  id: string;
  workspaceId: string;
  typeId: string;
  data: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomObjectRelationship {
  id: string;
  workspaceId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationshipType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---- JSONL persistence ----

const TYPES_FILE = 'custom-object-types.jsonl';
const RECORDS_FILE = 'custom-object-records.jsonl';
const RELS_FILE = 'custom-object-relationships.jsonl';

let types: CustomObjectType[] = [];
let records: CustomObjectRecord[] = [];
let relationships: CustomObjectRelationship[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  types = readJsonlFile<CustomObjectType>(TYPES_FILE);
  records = readJsonlFile<CustomObjectRecord>(RECORDS_FILE);
  relationships = readJsonlFile<CustomObjectRelationship>(RELS_FILE);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- Object Type CRUD ----

export function listObjectTypes(workspaceId?: string): CustomObjectType[] {
  ensureLoaded();
  return types.filter(t => !workspaceId || t.workspaceId === workspaceId);
}

export function getObjectType(id: string): CustomObjectType | undefined {
  ensureLoaded();
  return types.find(t => t.id === id);
}

export function getObjectTypeByKey(workspaceId: string, key: string): CustomObjectType | undefined {
  ensureLoaded();
  return types.find(t => t.workspaceId === workspaceId && t.key === key);
}

export function createObjectType(input: Omit<CustomObjectType, 'id' | 'createdAt' | 'updatedAt'>): CustomObjectType {
  ensureLoaded();
  const existing = types.find(t => t.workspaceId === input.workspaceId && t.key === input.key);
  if (existing) throw new Error(`Object type '${input.key}' already exists`);
  const now = new Date().toISOString();
  const type: CustomObjectType = { ...input, id: uid(), createdAt: now, updatedAt: now };
  types.push(type);
  writeJsonlFile(TYPES_FILE, types);
  return type;
}

export function updateObjectType(id: string, updates: Partial<Omit<CustomObjectType, 'id' | 'createdAt'>>): CustomObjectType | null {
  ensureLoaded();
  const idx = types.findIndex(t => t.id === id);
  if (idx === -1) return null;
  types[idx] = { ...types[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(TYPES_FILE, types);
  return types[idx];
}

export function deleteObjectType(id: string): boolean {
  ensureLoaded();
  const idx = types.findIndex(t => t.id === id);
  if (idx === -1) return false;
  types.splice(idx, 1);
  records = records.filter(r => r.typeId !== id);
  writeJsonlFile(TYPES_FILE, types);
  writeJsonlFile(RECORDS_FILE, records);
  return true;
}

// ---- Record CRUD ----

export function listRecords(typeId: string, workspaceId?: string): CustomObjectRecord[] {
  ensureLoaded();
  return records.filter(r =>
    r.typeId === typeId &&
    (!workspaceId || r.workspaceId === workspaceId),
  );
}

export function getRecord(id: string): CustomObjectRecord | undefined {
  ensureLoaded();
  return records.find(r => r.id === id);
}

export function createRecord(input: Omit<CustomObjectRecord, 'id' | 'createdAt' | 'updatedAt'>): CustomObjectRecord {
  ensureLoaded();
  const now = new Date().toISOString();
  const record: CustomObjectRecord = { ...input, id: uid(), createdAt: now, updatedAt: now };
  records.push(record);
  writeJsonlFile(RECORDS_FILE, records);
  return record;
}

export function updateRecord(id: string, updates: Partial<Omit<CustomObjectRecord, 'id' | 'createdAt'>>): CustomObjectRecord | null {
  ensureLoaded();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(RECORDS_FILE, records);
  return records[idx];
}

export function deleteRecord(id: string): boolean {
  ensureLoaded();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  relationships = relationships.filter(r =>
    !(r.sourceType === 'custom_object' && r.sourceId === id) &&
    !(r.targetType === 'custom_object' && r.targetId === id),
  );
  writeJsonlFile(RECORDS_FILE, records);
  writeJsonlFile(RELS_FILE, relationships);
  return true;
}

// ---- Relationship CRUD ----

export function listRelationships(opts: {
  sourceType?: string;
  sourceId?: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
}): CustomObjectRelationship[] {
  ensureLoaded();
  return relationships.filter(r =>
    (!opts.sourceType || r.sourceType === opts.sourceType) &&
    (!opts.sourceId || r.sourceId === opts.sourceId) &&
    (!opts.targetType || r.targetType === opts.targetType) &&
    (!opts.targetId || r.targetId === opts.targetId) &&
    (!opts.workspaceId || r.workspaceId === opts.workspaceId),
  );
}

export function createRelationship(
  input: Omit<CustomObjectRelationship, 'id' | 'createdAt'>,
): CustomObjectRelationship {
  ensureLoaded();
  const dup = relationships.find(r =>
    r.sourceType === input.sourceType &&
    r.sourceId === input.sourceId &&
    r.targetType === input.targetType &&
    r.targetId === input.targetId,
  );
  if (dup) throw new Error('Relationship already exists');
  const rel: CustomObjectRelationship = {
    ...input,
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  relationships.push(rel);
  writeJsonlFile(RELS_FILE, relationships);
  return rel;
}

export function deleteRelationship(id: string): boolean {
  ensureLoaded();
  const idx = relationships.findIndex(r => r.id === id);
  if (idx === -1) return false;
  relationships.splice(idx, 1);
  writeJsonlFile(RELS_FILE, relationships);
  return true;
}

// ---- Validation ----

export function validateRecordData(
  typeDef: CustomObjectType,
  data: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const field of typeDef.fields) {
    const value = data[field.key];
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field.name} is required`);
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    switch (field.type) {
      case 'text':
      case 'url':
      case 'email':
        if (typeof value !== 'string') errors.push(`${field.name} must be a string`);
        break;
      case 'number':
      case 'currency':
        if (typeof value !== 'number' || isNaN(value as number)) errors.push(`${field.name} must be a number`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`${field.name} must be a boolean`);
        break;
      case 'date':
        if (typeof value !== 'string' || isNaN(Date.parse(value as string))) errors.push(`${field.name} must be a valid date`);
        break;
      case 'select':
        if (typeof value !== 'string' || (field.options && !field.options.includes(value as string)))
          errors.push(`${field.name} must be one of: ${(field.options ?? []).join(', ')}`);
        break;
      case 'multiselect':
        if (!Array.isArray(value)) errors.push(`${field.name} must be an array`);
        break;
      case 'relation':
        if (typeof value !== 'string') errors.push(`${field.name} must be a record ID`);
        break;
    }
  }
  return { valid: errors.length === 0, errors };
}
