import Link from "next/link";
import { getBrandBySubdomain } from "@/lib/brands";

export const dynamic = "force-dynamic";

interface ArticleRow {
  id: string;
  title: string;
  slug: string | null;
  locale: string | null;
  status: string;
  categoryName: string | null;
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

async function getArticles(brandId: string, locale: string): Promise<ArticleRow[]> {
  try {
    const { tryDb } = await import("@/lib/store-helpers");
    const conn = await tryDb();
    if (!conn) return [];

    const { eq, and, sql } = await import("drizzle-orm");

    const rows = await conn.db
      .select({
        id: conn.schema.kbArticles.id,
        title: conn.schema.kbArticles.title,
        slug: conn.schema.kbArticles.slug,
        locale: conn.schema.kbArticles.locale,
        status: conn.schema.kbArticles.status,
        categoryName: sql<string | null>`(SELECT name FROM kb_categories WHERE id = ${conn.schema.kbArticles.categoryId})`,
        updatedAt: conn.schema.kbArticles.updatedAt,
      })
      .from(conn.schema.kbArticles)
      .where(
        and(
          eq(conn.schema.kbArticles.brandId, brandId),
          eq(conn.schema.kbArticles.locale, locale),
          eq(conn.schema.kbArticles.status, "published"),
          eq(conn.schema.kbArticles.visibility, "public"),
        ),
      )
      .orderBy(conn.schema.kbArticles.updatedAt);

    return rows as ArticleRow[];
  } catch {
    return [];
  }
}

export default async function LocaleArticleListPage({
  params,
}: {
  params: Promise<{ brandSlug: string; locale: string }>;
}) {
  const { brandSlug, locale } = await params;

  let brand = await getDbBrand(brandSlug);
  let brandName = brand?.name ?? "";
  let brandTitle = (brand as Record<string, unknown>)?.help_center_title as string | undefined;
  let brandId = brand?.id;

  if (!brand) {
    const jsonlBrand = getBrandBySubdomain(brandSlug);
    if (!jsonlBrand) {
      return (
        <main className="flex min-h-screen items-center justify-center">
          <div className="border-2 border-zinc-950 bg-white p-12 text-center">
            <h1 className="text-2xl font-bold">Help Center Not Found</h1>
            <p className="mt-2 font-mono text-xs text-zinc-500">
              No help center exists for &quot;{brandSlug}&quot;.
            </p>
          </div>
        </main>
      );
    }
    brandName = jsonlBrand.name;
    brandTitle = jsonlBrand.helpCenterTitle ?? jsonlBrand.portalTitle;
    brandId = jsonlBrand.id;
  }

  const articles = brandId ? await getArticles(brandId, locale) : [];

  // Group by category
  const grouped = new Map<string, ArticleRow[]>();
  for (const article of articles) {
    const cat = article.categoryName ?? "Uncategorized";
    const list = grouped.get(cat) ?? [];
    list.push(article);
    grouped.set(cat, list);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href={`/help/${brandSlug}`} className="hover:underline">
          {brandTitle || brandName}
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">{locale.toUpperCase()}</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">
          {brandTitle || brandName} &mdash; {locale.toUpperCase()}
        </h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          {articles.length} article{articles.length !== 1 ? "s" : ""} published
        </p>
      </header>

      {articles.length === 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-12 text-center">
          <p className="font-mono text-sm text-zinc-500">
            No articles available in this locale yet.
          </p>
        </section>
      ) : (
        Array.from(grouped.entries()).map(([category, items]) => (
          <section key={category} className="mt-8">
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              {category}
            </h2>
            <div className="mt-3 border-2 border-zinc-950 bg-white divide-y divide-zinc-200">
              {items.map((article) => (
                <Link
                  key={article.id}
                  href={`/help/${brandSlug}/${locale}/articles/${article.slug ?? article.id}`}
                  className="block px-6 py-4 hover:bg-zinc-50"
                >
                  <h3 className="font-bold">{article.title}</h3>
                  <p className="mt-1 font-mono text-xs text-zinc-400">
                    Updated {new Date(article.updatedAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
