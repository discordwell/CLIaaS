import { NextResponse } from 'next/server';
import { type ConnectorName, getAuth } from '@/lib/connector-auth';
import { zendeskVerifyConnection } from '@cli/connectors/zendesk';
import { helpcrunchVerifyConnection } from '@cli/connectors/helpcrunch';
import { freshdeskVerifyConnection } from '@cli/connectors/freshdesk';
import { grooveVerifyConnection } from '@cli/connectors/groove';

const VALID_CONNECTORS = ['zendesk', 'helpcrunch', 'freshdesk', 'groove'];

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!VALID_CONNECTORS.includes(name)) {
    return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
  }

  const auth = getAuth(name as ConnectorName);
  if (!auth) {
    return NextResponse.json(
      { error: 'Connector not configured — missing environment variables' },
      { status: 400 },
    );
  }

  try {
    let result: { success: boolean; error?: string; [key: string]: unknown };

    switch (name) {
      case 'zendesk':
        result = await zendeskVerifyConnection(auth as Parameters<typeof zendeskVerifyConnection>[0]);
        break;
      case 'helpcrunch':
        result = await helpcrunchVerifyConnection(auth as Parameters<typeof helpcrunchVerifyConnection>[0]);
        break;
      case 'freshdesk':
        result = await freshdeskVerifyConnection(auth as Parameters<typeof freshdeskVerifyConnection>[0]);
        break;
      case 'groove':
        result = await grooveVerifyConnection(auth as Parameters<typeof grooveVerifyConnection>[0]);
        break;
      default:
        return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Verification failed' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Verification failed' },
      { status: 500 },
    );
  }
}
