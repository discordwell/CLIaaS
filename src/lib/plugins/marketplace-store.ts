/**
 * Marketplace listing & review store: DB + JSONL fallback.
 */

import { randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb } from '../store-helpers';
import type { MarketplaceListing, PluginReview, PluginManifestV2 } from './types';

const LISTINGS_FILE = 'marketplace-listings.jsonl';
const REVIEWS_FILE = 'plugin-reviews.jsonl';

// ---- JSONL helpers ----

function readAllListings(): MarketplaceListing[] {
  return readJsonlFile<MarketplaceListing>(LISTINGS_FILE);
}

function writeAllListings(items: MarketplaceListing[]): void {
  writeJsonlFile(LISTINGS_FILE, items);
}

function readAllReviews(): PluginReview[] {
  return readJsonlFile<PluginReview>(REVIEWS_FILE);
}

function writeAllReviews(items: PluginReview[]): void {
  writeJsonlFile(REVIEWS_FILE, items);
}

// ---- Public API ----

export async function getListings(opts?: {
  category?: string;
  status?: string;
  search?: string;
  featured?: boolean;
}): Promise<MarketplaceListing[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and, ilike, sql } = await import('drizzle-orm');
    const conditions = [];

    if (opts?.status) {
      conditions.push(eq(schema.marketplaceListings.status, opts.status as 'published'));
    } else {
      conditions.push(eq(schema.marketplaceListings.status, 'published'));
    }

    if (opts?.featured !== undefined) {
      conditions.push(eq(schema.marketplaceListings.featured, opts.featured));
    }

    let query = db.select().from(schema.marketplaceListings)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(schema.marketplaceListings.installCount);

    const rows = await query;
    let results = rows.map(rowToListing);

    if (opts?.search) {
      const term = opts.search.toLowerCase();
      results = results.filter(l =>
        l.manifest.name.toLowerCase().includes(term) ||
        l.manifest.description.toLowerCase().includes(term)
      );
    }

    if (opts?.category) {
      results = results.filter(l => l.manifest.category === opts.category);
    }

    return results;
  }

  // JSONL path
  let all = readAllListings();

  if (!opts?.status) {
    all = all.filter(l => l.status === 'published');
  } else {
    all = all.filter(l => l.status === opts.status);
  }

  if (opts?.featured !== undefined) {
    all = all.filter(l => l.featured === opts.featured);
  }

  if (opts?.search) {
    const term = opts.search.toLowerCase();
    all = all.filter(l =>
      l.manifest.name.toLowerCase().includes(term) ||
      l.manifest.description.toLowerCase().includes(term)
    );
  }

  if (opts?.category) {
    all = all.filter(l => l.manifest.category === opts.category);
  }

  return all;
}

export async function getListing(pluginId: string): Promise<MarketplaceListing | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.marketplaceListings)
      .where(eq(schema.marketplaceListings.pluginId, pluginId));
    return row ? rowToListing(row) : null;
  }
  return readAllListings().find(l => l.pluginId === pluginId) ?? null;
}

export async function upsertListing(listing: {
  pluginId: string;
  manifest: PluginManifestV2;
  status?: MarketplaceListing['status'];
  publishedBy?: string;
  featured?: boolean;
}): Promise<MarketplaceListing> {
  const now = new Date().toISOString();
  const ctx = await tryDb();

  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');

    const [existing] = await db.select({ id: schema.marketplaceListings.id })
      .from(schema.marketplaceListings)
      .where(eq(schema.marketplaceListings.pluginId, listing.pluginId));

    if (existing) {
      await db.update(schema.marketplaceListings).set({
        manifest: listing.manifest,
        status: listing.status ?? 'published',
        publishedBy: listing.publishedBy ?? null,
        featured: listing.featured ?? false,
        updatedAt: new Date(),
      }).where(eq(schema.marketplaceListings.pluginId, listing.pluginId));
    } else {
      await db.insert(schema.marketplaceListings).values({
        pluginId: listing.pluginId,
        manifest: listing.manifest,
        status: listing.status ?? 'published',
        publishedBy: listing.publishedBy ?? null,
        featured: listing.featured ?? false,
      });
    }

    const [row] = await db.select().from(schema.marketplaceListings)
      .where(eq(schema.marketplaceListings.pluginId, listing.pluginId));
    return rowToListing(row);
  }

  // JSONL path
  const all = readAllListings();
  const idx = all.findIndex(l => l.pluginId === listing.pluginId);

  const entry: MarketplaceListing = {
    id: idx >= 0 ? all[idx].id : randomUUID(),
    pluginId: listing.pluginId,
    manifest: listing.manifest,
    status: listing.status ?? 'published',
    publishedBy: listing.publishedBy,
    installCount: idx >= 0 ? all[idx].installCount : 0,
    averageRating: idx >= 0 ? all[idx].averageRating : null,
    reviewCount: idx >= 0 ? all[idx].reviewCount : 0,
    featured: listing.featured ?? false,
    createdAt: idx >= 0 ? all[idx].createdAt : now,
    updatedAt: now,
  };

  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }
  writeAllListings(all);
  return entry;
}

export async function getReviews(listingId: string): Promise<PluginReview[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(schema.pluginReviews)
      .where(eq(schema.pluginReviews.listingId, listingId))
      .orderBy(schema.pluginReviews.createdAt);
    return rows.map(rowToReview);
  }
  return readAllReviews().filter(r => r.listingId === listingId);
}

export async function upsertReview(review: {
  listingId: string;
  workspaceId: string;
  userId: string;
  rating: number;
  title?: string;
  body?: string;
}): Promise<PluginReview> {
  const now = new Date().toISOString();
  const ctx = await tryDb();

  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');

    const [existing] = await db.select({ id: schema.pluginReviews.id })
      .from(schema.pluginReviews)
      .where(and(
        eq(schema.pluginReviews.listingId, review.listingId),
        eq(schema.pluginReviews.workspaceId, review.workspaceId),
      ));

    if (existing) {
      await db.update(schema.pluginReviews).set({
        rating: review.rating,
        title: review.title ?? '',
        body: review.body ?? '',
        updatedAt: new Date(),
      }).where(eq(schema.pluginReviews.id, existing.id));
    } else {
      await db.insert(schema.pluginReviews).values({
        listingId: review.listingId,
        workspaceId: review.workspaceId,
        userId: review.userId,
        rating: review.rating,
        title: review.title ?? '',
        body: review.body ?? '',
      });
    }

    await recalculateRating(review.listingId);

    const [row] = await db.select().from(schema.pluginReviews)
      .where(and(
        eq(schema.pluginReviews.listingId, review.listingId),
        eq(schema.pluginReviews.workspaceId, review.workspaceId),
      ));
    return rowToReview(row);
  }

  // JSONL path
  const allReviews = readAllReviews();
  const idx = allReviews.findIndex(r =>
    r.listingId === review.listingId && r.workspaceId === review.workspaceId
  );

  const entry: PluginReview = {
    id: idx >= 0 ? allReviews[idx].id : randomUUID(),
    listingId: review.listingId,
    workspaceId: review.workspaceId,
    userId: review.userId,
    rating: review.rating,
    title: review.title ?? '',
    body: review.body ?? '',
    createdAt: idx >= 0 ? allReviews[idx].createdAt : now,
    updatedAt: now,
  };

  if (idx >= 0) {
    allReviews[idx] = entry;
  } else {
    allReviews.push(entry);
  }
  writeAllReviews(allReviews);
  await recalculateRating(review.listingId);
  return entry;
}

export async function incrementInstallCount(pluginId: string): Promise<void> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, sql } = await import('drizzle-orm');
    await db.update(schema.marketplaceListings).set({
      installCount: sql`${schema.marketplaceListings.installCount} + 1`,
    }).where(eq(schema.marketplaceListings.pluginId, pluginId));
    return;
  }

  const all = readAllListings();
  const idx = all.findIndex(l => l.pluginId === pluginId);
  if (idx >= 0) {
    all[idx].installCount += 1;
    writeAllListings(all);
  }
}

export async function recalculateRating(listingId: string): Promise<void> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, avg, count } = await import('drizzle-orm');
    const [stats] = await db.select({
      avgRating: avg(schema.pluginReviews.rating),
      cnt: count(schema.pluginReviews.id),
    }).from(schema.pluginReviews)
      .where(eq(schema.pluginReviews.listingId, listingId));

    await db.update(schema.marketplaceListings).set({
      averageRating: stats.avgRating ?? null,
      reviewCount: Number(stats.cnt) || 0,
    }).where(eq(schema.marketplaceListings.id, listingId));
    return;
  }

  // JSONL path
  const reviews = readAllReviews().filter(r => r.listingId === listingId);
  const all = readAllListings();
  const idx = all.findIndex(l => l.id === listingId);
  if (idx >= 0) {
    all[idx].reviewCount = reviews.length;
    all[idx].averageRating = reviews.length > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 100) / 100
      : null;
    writeAllListings(all);
  }
}

// ---- Row mappers ----

function rowToListing(row: {
  id: string;
  pluginId: string;
  manifest: unknown;
  status: string;
  publishedBy: string | null;
  installCount: number;
  averageRating: string | null;
  reviewCount: number;
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MarketplaceListing {
  return {
    id: row.id,
    pluginId: row.pluginId,
    manifest: row.manifest as PluginManifestV2,
    status: row.status as MarketplaceListing['status'],
    publishedBy: row.publishedBy ?? undefined,
    installCount: row.installCount,
    averageRating: row.averageRating ? parseFloat(row.averageRating) : null,
    reviewCount: row.reviewCount,
    featured: row.featured,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToReview(row: {
  id: string;
  listingId: string;
  workspaceId: string;
  userId: string;
  rating: number;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): PluginReview {
  return {
    id: row.id,
    listingId: row.listingId,
    workspaceId: row.workspaceId,
    userId: row.userId,
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
