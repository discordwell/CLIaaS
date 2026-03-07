/**
 * Plugin installation store: CRUD operations with DB + JSONL fallback.
 * Same dual-path pattern used by chatbot/store.ts.
 */

import { randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, getDefaultWorkspaceId, withRls } from '../store-helpers';
import type { PluginInstallation, PluginManifestV2 } from './types';

const INSTALLATIONS_FILE = 'plugin-installations.jsonl';
const LISTINGS_FILE = 'marketplace-listings.jsonl';

// ---- Result types ----

export interface UninstallResult {
  deleted: boolean;
  dependents: string[]; // plugin IDs that depend on the one being removed
}

// ---- JSONL helpers ----

function readAllInstallations(): PluginInstallation[] {
  return readJsonlFile<PluginInstallation>(INSTALLATIONS_FILE);
}

function writeAllInstallations(items: PluginInstallation[]): void {
  writeJsonlFile(INSTALLATIONS_FILE, items);
}

// ---- Public API ----

export async function getInstallations(workspaceId?: string): Promise<PluginInstallation[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.pluginInstallations)
        .orderBy(schema.pluginInstallations.createdAt);
      return rows.map(rowToInstallation);
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
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

export async function getInstallation(id: string, workspaceId?: string): Promise<PluginInstallation | null> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [row] = await db.select().from(schema.pluginInstallations)
        .where(eq(schema.pluginInstallations.id, id));
      return row ? rowToInstallation(row) : null;
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
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

export async function getHookRegistrations(installationId: string, workspaceId?: string): Promise<{ id: string; installationId: string; hookName: string; priority: number }[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.pluginHookRegistrations)
        .where(eq(schema.pluginHookRegistrations.installationId, installationId));
      return rows.map(r => ({
        id: r.id,
        installationId: r.installationId,
        hookName: r.hookName,
        priority: r.priority,
      }));
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(schema.pluginHookRegistrations)
      .where(eq(schema.pluginHookRegistrations.installationId, installationId));
    return rows.map(r => ({
      id: r.id,
      installationId: r.installationId,
      hookName: r.hookName,
      priority: r.priority,
    }));
  }
  // No JSONL fallback for hook registrations
  return [];
}

// ---- Dependency helpers ----

/**
 * Resolve the manifest for a plugin ID by checking marketplace listings.
 * Returns null if no listing exists.
 */
async function resolveManifest(pluginId: string): Promise<PluginManifestV2 | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ manifest: schema.marketplaceListings.manifest })
      .from(schema.marketplaceListings)
      .where(eq(schema.marketplaceListings.pluginId, pluginId));
    return row ? (row.manifest as PluginManifestV2) : null;
  }
  const listings = readJsonlFile<{ pluginId: string; manifest: PluginManifestV2 }>(LISTINGS_FILE);
  const listing = listings.find(l => l.pluginId === pluginId);
  return listing?.manifest ?? null;
}

/**
 * Check that all dependencies of a manifest are already installed.
 * Returns an array of missing plugin IDs (empty if all satisfied).
 */
export async function checkDependencies(
  dependencies: string[],
  workspaceId?: string,
): Promise<string[]> {
  if (!dependencies.length) return [];
  const installations = await getInstallations(workspaceId);
  const installedIds = new Set(installations.map(i => i.pluginId));
  return dependencies.filter(dep => !installedIds.has(dep));
}

/**
 * Find all installed plugins that declare a dependency on the given plugin ID.
 * Checks marketplace listing manifests for each installed plugin.
 */
export async function findDependents(
  pluginId: string,
  workspaceId?: string,
): Promise<string[]> {
  const installations = await getInstallations(workspaceId);
  const dependents: string[] = [];

  for (const inst of installations) {
    if (inst.pluginId === pluginId) continue;
    const manifest = await resolveManifest(inst.pluginId);
    if (manifest?.dependencies?.includes(pluginId)) {
      dependents.push(inst.pluginId);
    }
  }
  return dependents;
}

export async function installPlugin(data: {
  pluginId: string;
  version: string;
  config?: Record<string, unknown>;
  installedBy?: string;
  workspaceId?: string;
  hooks?: string[];
  dependencies?: string[];
}): Promise<PluginInstallation> {
  // ---- Dependency check ----
  const deps = data.dependencies ?? [];
  if (deps.length) {
    const missing = await checkDependencies(deps, data.workspaceId);
    if (missing.length) {
      throw new Error(
        `Missing dependencies: ${missing.join(', ')}. Install them before installing "${data.pluginId}".`,
      );
    }
  }

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

export async function uninstallPlugin(id: string, workspaceId?: string): Promise<UninstallResult> {
  // Look up the installation to find its pluginId for dependent checking
  const installation = await getInstallation(id, workspaceId);
  let dependents: string[] = [];
  if (installation) {
    dependents = await findDependents(installation.pluginId, workspaceId);
  }

  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    // Cascading delete removes hook_registrations and execution_logs
    const result = await db.delete(schema.pluginInstallations)
      .where(eq(schema.pluginInstallations.id, id));
    return { deleted: (result.rowCount ?? 0) > 0, dependents };
  }

  const all = readAllInstallations();
  const filtered = all.filter(i => i.id !== id);
  if (filtered.length === all.length) return { deleted: false, dependents };
  writeAllInstallations(filtered);
  return { deleted: true, dependents };
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
