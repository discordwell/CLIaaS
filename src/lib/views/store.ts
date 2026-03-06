/**
 * In-memory view store with default system views.
 * Used for JSONL/demo mode when DB is not available.
 */

import type { View, ViewQuery } from './types';
import { withRls } from '../store-helpers';

const SYSTEM_VIEWS: View[] = [
  {
    id: 'system-all-open',
    name: 'All Open',
    description: 'All tickets with open status',
    query: {
      conditions: [{ field: 'status', operator: 'is', value: 'open' }],
      combineMode: 'and',
      sort: { field: 'updated_at', direction: 'desc' },
    },
    viewType: 'system',
    active: true,
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'system-pending',
    name: 'Pending',
    description: 'Tickets awaiting customer response',
    query: {
      conditions: [{ field: 'status', operator: 'is', value: 'pending' }],
      combineMode: 'and',
      sort: { field: 'updated_at', direction: 'desc' },
    },
    viewType: 'system',
    active: true,
    position: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'system-urgent',
    name: 'Urgent',
    description: 'High and urgent priority tickets',
    query: {
      conditions: [
        { field: 'priority', operator: 'is', value: 'urgent' },
        { field: 'status', operator: 'is_not', value: 'closed' },
      ],
      combineMode: 'and',
      sort: { field: 'created_at', direction: 'asc' },
    },
    viewType: 'system',
    active: true,
    position: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'system-recently-updated',
    name: 'Recently Updated',
    description: 'All tickets sorted by last update',
    query: {
      conditions: [],
      combineMode: 'and',
      sort: { field: 'updated_at', direction: 'desc' },
    },
    viewType: 'system',
    active: true,
    position: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let views: View[] = [...SYSTEM_VIEWS];

export async function listViews(userId?: string, workspaceId?: string): Promise<View[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.views);
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        query: r.query as ViewQuery,
        viewType: r.viewType as View['viewType'],
        userId: r.userId ?? undefined,
        active: r.active,
        position: r.position,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
    if (result !== null) {
      return result.filter(
        (v) => v.active && (v.viewType !== 'personal' || v.userId === userId),
      );
    }
  }
  return views.filter(
    (v) => v.active && (v.viewType !== 'personal' || v.userId === userId),
  );
}

export function getView(id: string): View | undefined {
  return views.find((v) => v.id === id);
}

export function createView(data: {
  name: string;
  description?: string;
  query: ViewQuery;
  viewType?: 'shared' | 'personal';
  userId?: string;
}): View {
  const view: View = {
    id: `view-${Date.now()}`,
    name: data.name,
    description: data.description,
    query: data.query,
    viewType: data.viewType ?? 'shared',
    userId: data.userId,
    active: true,
    position: views.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  views.push(view);
  return view;
}

export function updateView(id: string, data: Partial<Pick<View, 'name' | 'description' | 'query' | 'active' | 'position'>>): View | null {
  const view = views.find((v) => v.id === id);
  if (!view || view.viewType === 'system') return null;
  Object.assign(view, data, { updatedAt: new Date().toISOString() });
  return view;
}

export function deleteView(id: string): boolean {
  const idx = views.findIndex((v) => v.id === id && v.viewType !== 'system');
  if (idx === -1) return false;
  views.splice(idx, 1);
  return true;
}
