/**
 * Plugin installation store: CRUD operations with DB + JSONL fallback.
 * Same dual-path pattern used by chatbot/store.ts.
 */

import { randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, getDefaultWorkspaceId } from '../store-helpers';
import type { PluginInstallation } from './types';

const INSTALLATIONS_FILE = 'plugin-installations.jsonl';

// ---- JSONL helpers ----

function readAllInstallations(): PluginInstallation[] {
  return readJsonlFile<PluginInstallation>(INSTALLATIONS_FILE);
}

function writeAllInstallations(items: PluginInstallation[]): void {
  writeJsonlFile(INSTALLATIONS_FILE, items);
}

// ---- Public API ----

export async function getInstallations(workspaceId?: string): Promise<PluginInstallation[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const wsId = workspaceId ?? await getDefaultWorkspaceId(db, schema);
    const rows = await db.select().from(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.workspaceId, wsId))
      .orderBy(schema.pluginInstallations.createdAt);
    return rows.map(rowToInstallation);
  }
  return readAllInstallations();
}

export async function getInstallation(id: string): Promise<PluginInstallation | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.id, id));
    return row ? rowToInstallation(row) : null;
  }
  return readAllInstallations().find(i => i.id === id) ?? null;
}

export async function getInstallationByPluginId(
  pluginId: string,
  workspaceId?: string,
): Promise<PluginInstallation | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const wsId = workspaceId ?? await getDefaultWorkspaceId(db, schema);
    const [row] = await db.select().from(schema.pluginInstallations)
      .where(and(
        eq(schema.pluginInstallations.workspaceId, wsId),
        eq(schema.pluginInstallations.pluginId, pluginId),
      ));
    return row ? rowToInstallation(row) : null;
  }
  return readAllInstallations().find(i => i.pluginId === pluginId) ?? null;
}

export async function getEnabledInstallationsForHook(
  hookName: string,
  workspaceId?: string,
): Promise<PluginInstallation[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const wsId = workspaceId ?? await getDefaultWorkspaceId(db, schema);
    const rows = await db.select({
      id: schema.pluginInstallations.id,
      workspaceId: schema.pluginInstallations.workspaceId,
      pluginId: schema.pluginInstallations.pluginId,
      version: schema.pluginInstallations.version,
      enabled: schema.pluginInstallations.enabled,
      config: schema.pluginInstallations.config,
      installedBy: schema.pluginInstallations.installedBy,
      createdAt: schema.pluginInstallations.createdAt,
      updatedAt: schema.pluginInstallations.updatedAt,
    })
      .from(schema.pluginInstallations)
      .innerJoin(
        schema.pluginHookRegistrations,
        eq(schema.pluginHookRegistrations.installationId, schema.pluginInstallations.id),
      )
      .where(and(
        eq(schema.pluginInstallations.workspaceId, wsId),
        eq(schema.pluginInstallations.enabled, true),
        eq(schema.pluginHookRegistrations.hookName, hookName),
      ))
      .orderBy(schema.pluginHookRegistrations.priority);
    return rows.map(rowToInstallation);
  }

  // JSONL path: read listings once, then filter installations
  const all = readAllInstallations().filter(i => i.enabled);
  const listings = readJsonlFile<{ pluginId: string; manifest: { hooks?: string[] } }>('marketplace-listings.jsonl');
  return all.filter(i => {
    const listing = listings.find(l => l.pluginId === i.pluginId);
    return listing?.manifest?.hooks?.includes(hookName);
  });
}

export async function installPlugin(data: {
  pluginId: string;
  version: string;
  config?: Record<string, unknown>;
  installedBy?: string;
  workspaceId?: string;
  hooks?: string[];
}): Promise<PluginInstallation> {
  const now = new Date().toISOString();
  const id = randomUUID();

  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const wsId = data.workspaceId ?? await getDefaultWorkspaceId(db, schema);

    await db.insert(schema.pluginInstallations).values({
      id,
      workspaceId: wsId,
      pluginId: data.pluginId,
      version: data.version,
      enabled: false,
      config: data.config ?? {},
      installedBy: data.installedBy ?? null,
    });

    // Register hooks
    if (data.hooks?.length) {
      await db.insert(schema.pluginHookRegistrations).values(
        data.hooks.map(hookName => ({
          installationId: id,
          workspaceId: wsId,
          hookName,
        })),
      );
    }

    return {
      id,
      workspaceId: wsId,
      pluginId: data.pluginId,
      version: data.version,
      enabled: false,
      config: data.config ?? {},
      installedBy: data.installedBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  // JSONL path
  const installation: PluginInstallation = {
    id,
    workspaceId: data.workspaceId ?? 'default',
    pluginId: data.pluginId,
    version: data.version,
    enabled: false,
    config: data.config ?? {},
    installedBy: data.installedBy,
    createdAt: now,
    updatedAt: now,
  };

  const all = readAllInstallations();
  all.push(installation);
  writeAllInstallations(all);
  return installation;
}

export async function updateInstallation(
  id: string,
  updates: Partial<Pick<PluginInstallation, 'enabled' | 'config'>>,
): Promise<PluginInstallation | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');

    const [existing] = await db.select().from(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.id, id));
    if (!existing) return null;

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.enabled !== undefined) values.enabled = updates.enabled;
    if (updates.config !== undefined) values.config = updates.config;

    await db.update(schema.pluginInstallations).set(values)
      .where(eq(schema.pluginInstallations.id, id));

    const [updated] = await db.select().from(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.id, id));
    return updated ? rowToInstallation(updated) : null;
  }

  // JSONL path
  const all = readAllInstallations();
  const idx = all.findIndex(i => i.id === id);
  if (idx < 0) return null;

  if (updates.enabled !== undefined) all[idx].enabled = updates.enabled;
  if (updates.config !== undefined) all[idx].config = updates.config;
  all[idx].updatedAt = new Date().toISOString();

  writeAllInstallations(all);
  return all[idx];
}

export async function uninstallPlugin(id: string): Promise<boolean> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    // Cascading delete removes hook_registrations and execution_logs
    const result = await db.delete(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  const all = readAllInstallations();
  const filtered = all.filter(i => i.id !== id);
  if (filtered.length === all.length) return false;
  writeAllInstallations(filtered);
  return true;
}

export async function togglePlugin(
  id: string,
  enabled: boolean,
): Promise<PluginInstallation | null> {
  return updateInstallation(id, { enabled });
}

// ---- Helpers ----

function rowToInstallation(row: {
  id: string;
  workspaceId: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  config: unknown;
  installedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PluginInstallation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    pluginId: row.pluginId,
    version: row.version,
    enabled: row.enabled,
    config: (row.config ?? {}) as Record<string, unknown>,
    installedBy: row.installedBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
