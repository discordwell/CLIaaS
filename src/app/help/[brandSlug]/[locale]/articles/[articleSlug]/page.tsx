import type { Metadata } from "next";
import Link from "next/link";
import { getBrandBySubdomain } from "@/lib/brands";

export const dynamic = "force-dynamic";

interface ArticleDetail {
  id: string;
  title: string;
  body: string;
  slug: string | null;
  locale: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  seoKeywords: string[] | null;
  categoryName: string | null;
  helpfulCount: number | null;
  notHelpfulCount: number | null;
  viewCount: number | null;
  updatedAt: Date;
}

async function getDbBrand(slug: string) {
  try {
    const { tryDb, getDefaultWorkspaceId } = await import("@/lib/store-helpers");
    const conn = await tryDb();
    if (!conn) return null;

    const { eq, and } = await import("drizzle-orm");
    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

    const [row] = await conn.db
      .select()
      .from(conn.schema.brands)
      .where(and(eq(conn.schema.brands.subdomain, slug), eq(conn.schema.brands.workspaceId, wsId)))
      .limit(1);

    return row ?? null;
  } catch {
    return null;
  }
}

async function getArticle(
  brandId: string,
  locale: string,
  articleSlug: string,
): Promise<ArticleDetail | null> {
  try {
    const { tryDb } = await import("@/lib/store-helpers");
    const conn = await tryDb();
    if (!conn) return null;

    const { eq, and, or, sql } = await import("drizzle-orm");

    // Match by slug or by ID
    const [row] = await conn.db
      .select({
        id: conn.schema.kbArticles.id,
        title: conn.schema.kbArticles.title,
        body: conn.schema.kbArticles.body,
        slug: conn.schema.kbArticles.slug,
        locale: conn.schema.kbArticles.locale,
        metaTitle: conn.schema.kbArticles.metaTitle,
        metaDescription: conn.schema.kbArticles.metaDescription,
        seoKeywords: conn.schema.kbArticles.seoKeywords,
        categoryName: sql<string | null>`(SELECT name FROM kb_categories WHERE id = ${conn.schema.kbArticles.categoryId})`,
        helpfulCount: conn.schema.kbArticles.helpfulCount,
        notHelpfulCount: conn.schema.kbArticles.notHelpfulCount,
        viewCount: conn.schema.kbArticles.viewCount,
        updatedAt: conn.schema.kbArticles.updatedAt,
      })
      .from(conn.schema.kbArticles)
      .where(
        and(
          eq(conn.schema.kbArticles.brandId, brandId),
          eq(conn.schema.kbArticles.locale, locale),
          or(
            eq(conn.schema.kbArticles.slug, articleSlug),
            eq(conn.schema.kbArticles.id, articleSlug),
          ),
        ),
      )
      .limit(1);

    return (row as ArticleDetail) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brandSlug: string; locale: string; articleSlug: string }>;
}): Promise<Metadata> {
  const { brandSlug, locale, articleSlug } = await params;

  const brand = await getDbBrand(brandSlug);
  const jsonlBrand = !brand ? getBrandBySubdomain(brandSlug) : null;
  const brandId = brand?.id ?? jsonlBrand?.id;
  const brandTitle =
    (brand as Record<string, unknown>)?.help_center_title as string | undefined ??
    jsonlBrand?.helpCenterTitle ??
    jsonlBrand?.portalTitle ??
    "Help Center";

  if (!brandId) {
    return { title: "Article Not Found" };
  }

  const article = await getArticle(brandId, locale, articleSlug);
  if (!article) {
    return { title: `Article Not Found | ${brandTitle}` };
  }

  return {
    title: article.metaTitle ?? `${article.title} | ${brandTitle}`,
    description: article.metaDescription ?? article.body.slice(0, 160),
    keywords: article.seoKeywords ?? undefined,
    openGraph: {
      title: article.metaTitle ?? article.title,
      description: article.metaDescription ?? article.body.slice(0, 160),
      locale,
      type: "article",
    },
  };
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ brandSlug: string; locale: string; articleSlug: string }>;
}) {
  const { brandSlug, locale, articleSlug } = await params;

  let brand = await getDbBrand(brandSlug);
  let brandName = brand?.name ?? "";
  let brandTitle =
    ((brand as Record<string, unknown>)?.help_center_title as string) ?? "";
  let brandId = brand?.id;

  if (!brand) {
    const jsonlBrand = getBrandBySubdomain(brandSlug);
    if (!jsonlBrand) {
      return (
        <main className="flex min-h-screen items-center justify-center">
          <div className="border-2 border-zinc-950 bg-white p-12 text-center">
            <h1 className="text-2xl font-bold">Help Center Not Found</h1>
          </div>
        </main>
      );
    }
    brandName = jsonlBrand.name;
    brandTitle = jsonlBrand.helpCenterTitle ?? jsonlBrand.portalTitle ?? "";
    brandId = jsonlBrand.id;
  }

  const article = brandId ? await getArticle(brandId, locale, articleSlug) : null;

  if (!article) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href={`/help/${brandSlug}`} className="hover:underline">
            {brandTitle || brandName}
          </Link>
          <span>/</span>
          <Link href={`/help/${brandSlug}/${locale}`} className="hover:underline">
            {locale.toUpperCase()}
          </Link>
        </nav>
        <div className="border-2 border-zinc-950 bg-white p-12 text-center">
          <h1 className="text-2xl font-bold">Article Not Found</h1>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            This article may have been moved or removed.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href={`/help/${brandSlug}`} className="hover:underline">
          {brandTitle || brandName}
        </Link>
        <span>/</span>
        <Link href={`/help/${brandSlug}/${locale}`} className="hover:underline">
          {locale.toUpperCase()}
        </Link>
        {article.categoryName && (
          <>
            <span>/</span>
            <span>{article.categoryName}</span>
          </>
        )}
        <span>/</span>
        <span className="font-bold text-zinc-950 truncate max-w-[200px]">
          {article.title}
        </span>
      </nav>

      <article className="border-2 border-zinc-950 bg-white p-8">
        <header>
          <h1 className="text-2xl font-bold">{article.title}</h1>
          <div className="mt-2 flex items-center gap-4 font-mono text-xs text-zinc-400">
            <span>
              Updated {new Date(article.updatedAt).toLocaleDateString()}
            </span>
            {article.viewCount != null && article.viewCount > 0 && (
              <span>{article.viewCount} view{article.viewCount !== 1 ? "s" : ""}</span>
            )}
          </div>
        </header>

        <div
          className="prose prose-zinc mt-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: article.body }}
        />
      </article>

      {/* Feedback section */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Was this article helpful?
        </h3>
        <div className="mt-3 flex items-center gap-4">
          <span className="font-mono text-sm">
            {article.helpfulCount ?? 0} found helpful
          </span>
          <span className="font-mono text-xs text-zinc-400">
            {article.notHelpfulCount ?? 0} not helpful
          </span>
        </div>
      </section>
    </main>
  );
}
