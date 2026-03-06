import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** Default supported locales when no brand-specific configuration exists. */
const DEFAULT_LOCALES = ['en'];

/**
 * GET /api/portal/detect-locale — Parse Accept-Language header, match against
 * the brand's supported_locales, and return the best match.
 * No auth required (public portal).
 *
 * Query params:
 *   brandId — optional brand UUID to look up supported_locales from DB
 */
export async function GET(request: NextRequest) {
  try {
    const acceptLanguage = request.headers.get('accept-language') || 'en';
    const brandId = request.nextUrl.searchParams.get('brandId');

    let supportedLocales = DEFAULT_LOCALES;

    // If a brandId is provided and DB is available, look up the brand's supported locales
    if (brandId && process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const [brand] = await db
          .select({
            defaultLocale: schema.brands.defaultLocale,
            supportedLocales: schema.brands.supportedLocales,
          })
          .from(schema.brands)
          .where(eq(schema.brands.id, brandId))
          .limit(1);

        if (brand?.supportedLocales && brand.supportedLocales.length > 0) {
          supportedLocales = brand.supportedLocales.filter(Boolean) as string[];
        } else if (brand?.defaultLocale) {
          supportedLocales = [brand.defaultLocale];
        }
      } catch {
        // DB unavailable, use defaults
      }
    }

    // Parse Accept-Language header into ranked locales
    // Format: en-US,en;q=0.9,fr;q=0.8
    const parsed = acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, ...rest] = part.trim().split(';');
        const qPart = rest.find((r) => r.trim().startsWith('q='));
        const q = qPart ? parseFloat(qPart.trim().slice(2)) : 1.0;
        return { lang: lang.trim().toLowerCase(), q: isNaN(q) ? 0 : q };
      })
      .sort((a, b) => b.q - a.q);

    // Match against supported locales
    const supportedLower = supportedLocales.map((l) => l.toLowerCase());

    let bestMatch = supportedLocales[0] || 'en';

    for (const { lang } of parsed) {
      // Exact match
      const exactIdx = supportedLower.indexOf(lang);
      if (exactIdx >= 0) {
        bestMatch = supportedLocales[exactIdx];
        break;
      }

      // Prefix match: "en-US" matches "en", "fr-CA" matches "fr"
      const prefix = lang.split('-')[0];
      const prefixIdx = supportedLower.findIndex(
        (s) => s === prefix || s.startsWith(prefix + '-'),
      );
      if (prefixIdx >= 0) {
        bestMatch = supportedLocales[prefixIdx];
        break;
      }
    }

    return NextResponse.json({
      locale: bestMatch,
      supportedLocales,
      acceptLanguage,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to detect locale' },
      { status: 500 },
    );
  }
}
