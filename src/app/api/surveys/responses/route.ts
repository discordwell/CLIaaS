import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { SurveyType } from '@/lib/data-provider/types';
import { getDataProvider } from '@/lib/data-provider/index';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/surveys/responses?type=nps|ces|csat — raw survey responses (for RemoteProvider)
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  try {
    const typeParam = request.nextUrl.searchParams.get('type') as SurveyType | null;
    const validTypes: SurveyType[] = ['csat', 'nps', 'ces'];

    if (typeParam && !validTypes.includes(typeParam)) {
      return NextResponse.json(
        { error: 'type must be one of: csat, nps, ces' },
        { status: 400 },
      );
    }

    const provider = await getDataProvider();
    const responses = await provider.loadSurveyResponses(typeParam ?? undefined);

    return NextResponse.json({ responses });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load survey responses') },
      { status: 500 },
    );
  }
}
