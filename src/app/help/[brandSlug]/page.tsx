import Link from "next/link";
import { getBrandBySubdomain } from "@/lib/brands";

export const dynamic = "force-dynamic";

interface CategoryRow {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  locale: string | null;
}

interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  locale: string | null;
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

async function getCollections(brandId: string) {
  try {
    const { tryDb } = await import("@/lib/store-helpers");
    const conn = await tryDb();
    if (!conn) return [];

    const { eq } = await import("drizzle-orm");
    const rows = await conn.db
      .select({
        id: conn.schema.kbCollections.id,
        name: conn.schema.kbCollections.name,
        description: conn.schema.kbCollections.description,
        locale: conn.schema.kbCollections.locale,
      })
      .from(conn.schema.kbCollections)
      .where(eq(conn.schema.kbCollections.brandId, brandId));

    return rows as CollectionRow[];
  } catch {
    return [];
  }
}

async function getCategories(brandId: string) {
  try {
    const { tryDb } = await import("@/lib/store-helpers");
    const conn = await tryDb();
    if (!conn) return [];

    const { eq } = await import("drizzle-orm");
    const rows = await conn.db
      .select({
        id: conn.schema.kbCategories.id,
        name: conn.schema.kbCategories.name,
        slug: conn.schema.kbCategories.slug,
        description: conn.schema.kbCategories.description,
        locale: conn.schema.kbCategories.locale,
      })
      .from(conn.schema.kbCategories)
      .where(eq(conn.schema.kbCategories.brandId, brandId));

    return rows as CategoryRow[];
  } catch {
    return [];
  }
}

export default async function BrandHelpCenterPage({
  params,
}: {
  params: Promise<{ brandSlug: string }>;
}) {
  const { brandSlug } = await params;

  // Try DB first, then JSONL fallback
  let brand = await getDbBrand(brandSlug);
  let brandName = brand?.name ?? "";
  let brandTitle = (brand as Record<string, unknown>)?.help_center_title as string | undefined;
  let defaultLocale = ((brand as Record<string, unknown>)?.default_locale as string) ?? "en";
  let supportedLocales = ((brand as Record<string, unknown>)?.supported_locales as string[]) ?? ["en"];
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
    defaultLocale = jsonlBrand.defaultLocale ?? "en";
    supportedLocales = jsonlBrand.supportedLocales ?? ["en"];
    brandId = jsonlBrand.id;
  }

  const collections = brandId ? await getCollections(brandId) : [];
  const categories = brandId ? await getCategories(brandId) : [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">{brandTitle || brandName}</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Browse articles and resources
        </p>
        {supportedLocales.length > 1 && (
          <nav className="mt-4 flex gap-2">
            {supportedLocales.map((loc) => (
              <Link
                key={loc}
                href={`/help/${brandSlug}/${loc}`}
                className={`border-2 px-3 py-1 font-mono text-xs font-bold uppercase ${
                  loc === defaultLocale
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 text-zinc-500 hover:border-zinc-950"
                }`}
              >
                {loc}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Collections */}
      {collections.length > 0 && (
        <section className="mt-8">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Collections
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {collections.map((col) => (
              <Link
                key={col.id}
                href={`/help/${brandSlug}/${col.locale ?? defaultLocale}`}
                className="border-2 border-zinc-950 bg-white p-6 hover:bg-zinc-50"
              >
                <h3 className="font-bold">{col.name}</h3>
                {col.description && (
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {col.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section className="mt-8">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Categories
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/help/${brandSlug}/${cat.locale ?? defaultLocale}`}
                className="border-2 border-zinc-950 bg-white p-6 hover:bg-zinc-50"
              >
                <h3 className="font-bold">{cat.name}</h3>
                {cat.description && (
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {cat.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {collections.length === 0 && categories.length === 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-12 text-center">
          <p className="font-mono text-sm text-zinc-500">
            No articles published yet. Check back soon.
          </p>
        </section>
      )}
    </main>
  );
}
