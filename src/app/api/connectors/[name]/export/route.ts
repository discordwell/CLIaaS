import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { type ConnectorName, getAuth } from '@/lib/connector-auth';
import { requireRole } from '@/lib/api-auth';
import { exportZendesk } from '@cli/connectors/zendesk';
import { exportHelpcrunch } from '@cli/connectors/helpcrunch';
import { exportFreshdesk } from '@cli/connectors/freshdesk';
import { exportGroove } from '@cli/connectors/groove';
import { exportIntercom } from '@cli/connectors/intercom';
import { exportHelpScout } from '@cli/connectors/helpscout';
import { exportHubSpot } from '@cli/connectors/hubspot';
import { exportZohoDesk } from '@cli/connectors/zoho-desk';
import { exportKayako } from '@cli/connectors/kayako';
import { exportKayakoClassic } from '@cli/connectors/kayako-classic';

const VALID_CONNECTORS: ConnectorName[] = [
  'zendesk', 'helpcrunch', 'freshdesk', 'groove',
  'intercom', 'helpscout', 'hubspot', 'zoho-desk',
  'kayako', 'kayako-classic',
];

const EXPORT_DIRS: Record<ConnectorName, string> = {
  zendesk: './exports/zendesk',
  helpcrunch: './exports/helpcrunch',
  freshdesk: './exports/freshdesk',
  groove: './exports/groove',
  intercom: './exports/intercom',
  helpscout: './exports/helpscout',
  hubspot: './exports/hubspot',
  'zoho-desk': './exports/zoho-desk',
  kayako: './exports/kayako',
  'kayako-classic': './exports/kayako-classic',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const roleCheck = await requireRole(request, 'admin');
  if ('error' in roleCheck) return roleCheck.error;

  const { name } = await params;
  if (!VALID_CONNECTORS.includes(name as ConnectorName)) {
    return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
  }

  const connectorName = name as ConnectorName;
  const auth = getAuth(connectorName);
  if (!auth) {
    return NextResponse.json(
      { error: 'Connector not configured — missing environment variables' },
      { status: 400 },
    );
  }

  const outDir = EXPORT_DIRS[connectorName];

  try {
    let manifest;

    switch (connectorName) {
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
      case 'intercom':
        manifest = await exportIntercom(auth as Parameters<typeof exportIntercom>[0], outDir);
        break;
      case 'helpscout':
        manifest = await exportHelpScout(auth as Parameters<typeof exportHelpScout>[0], outDir);
        break;
      case 'hubspot':
        manifest = await exportHubSpot(auth as Parameters<typeof exportHubSpot>[0], outDir);
        break;
      case 'zoho-desk':
        manifest = await exportZohoDesk(auth as Parameters<typeof exportZohoDesk>[0], outDir);
        break;
      case 'kayako':
        manifest = await exportKayako(auth as Parameters<typeof exportKayako>[0], outDir);
        break;
      case 'kayako-classic':
        manifest = await exportKayakoClassic(auth as Parameters<typeof exportKayakoClassic>[0], outDir);
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
