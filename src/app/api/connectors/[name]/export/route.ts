import { NextResponse } from 'next/server';
import { type ConnectorName, getAuth } from '@/lib/connector-auth';
import { exportZendesk } from '@cli/connectors/zendesk';
import { exportHelpcrunch } from '@cli/connectors/helpcrunch';
import { exportFreshdesk } from '@cli/connectors/freshdesk';
import { exportGroove } from '@cli/connectors/groove';

const VALID_CONNECTORS = ['zendesk', 'helpcrunch', 'freshdesk', 'groove'];

const EXPORT_DIRS: Record<string, string> = {
  zendesk: './exports/zendesk',
  helpcrunch: './exports/helpcrunch',
  freshdesk: './exports/freshdesk',
  groove: './exports/groove',
};

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

  const outDir = EXPORT_DIRS[name];

  try {
    let manifest;

    switch (name) {
      case 'zendesk':
        manifest = await exportZendesk(auth as Parameters<typeof exportZendesk>[0], outDir);
        break;
      case 'helpcrunch':
        manifest = await exportHelpcrunch(auth as Parameters<typeof exportHelpcrunch>[0], outDir);
        break;
      case 'freshdesk':
        manifest = await exportFreshdesk(auth as Parameters<typeof exportFreshdesk>[0], outDir);
        break;
      case 'groove':
        manifest = await exportGroove(auth as Parameters<typeof exportGroove>[0], outDir);
        break;
      default:
        return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
    }

    return NextResponse.json({ status: 'ok', manifest });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Export failed' },
      { status: 500 },
    );
  }
}
