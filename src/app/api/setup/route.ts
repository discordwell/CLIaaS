import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

interface SetupPayload {
  databaseUrl: string;
  llmProvider: 'claude' | 'openai' | 'openclaw';
  llmApiKey?: string;
  openclawBaseUrl?: string;
  openclawModel?: string;
  connector?: string;
}

/**
 * POST /api/setup — BYOC setup endpoint.
 *
 * Receives setup configuration, tests the database connection,
 * and returns the resulting config for the client to display.
 *
 * NOTE: This route does NOT write files to disk (env, config) because
 * Next.js API routes run in a sandboxed server context. File writes
 * are handled by the CLI install script. This route validates the
 * setup parameters and tests database connectivity.
 */
export async function POST(request: NextRequest) {
  let body: SetupPayload;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // ── Validate required fields ──────────────────────────────────────────

  if (!body.databaseUrl) {
    return NextResponse.json(
      { error: 'databaseUrl is required' },
      { status: 400 },
    );
  }

  const validProviders = ['claude', 'openai', 'openclaw'];
  if (!body.llmProvider || !validProviders.includes(body.llmProvider)) {
    return NextResponse.json(
      { error: `llmProvider must be one of: ${validProviders.join(', ')}` },
      { status: 400 },
    );
  }

  // Validate URL format (basic check)
  if (!body.databaseUrl.startsWith('postgresql://') && !body.databaseUrl.startsWith('postgres://')) {
    return NextResponse.json(
      { error: 'databaseUrl must start with postgresql:// or postgres://' },
      { status: 400 },
    );
  }

  // ── Test database connection ──────────────────────────────────────────

  let dbConnected = false;
  let dbError: string | null = null;

  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: body.databaseUrl });
    await client.connect();
    const result = await client.query('SELECT 1 AS ok');
    dbConnected = result.rows?.[0]?.ok === 1;
    await client.end();
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Database connection failed';
  }

  if (!dbConnected) {
    return NextResponse.json(
      {
        error: 'Database connection failed',
        details: dbError,
        step: 'database',
      },
      { status: 422 },
    );
  }

  // ── Validate LLM key format (basic sanity check) ─────────────────────

  let llmKeyValid = true;
  let llmKeyWarning: string | null = null;

  if (body.llmProvider === 'claude') {
    if (body.llmApiKey && !body.llmApiKey.startsWith('sk-ant-')) {
      llmKeyWarning = 'Anthropic API keys typically start with sk-ant-';
      llmKeyValid = false;
    }
  } else if (body.llmProvider === 'openai') {
    if (body.llmApiKey && !body.llmApiKey.startsWith('sk-')) {
      llmKeyWarning = 'OpenAI API keys typically start with sk-';
      llmKeyValid = false;
    }
  }
  // openclaw doesn't require key validation

  // ── Build response ────────────────────────────────────────────────────

  const validConnectors = [
    'zendesk', 'kayako', 'kayako-classic', 'freshdesk', 'helpcrunch',
    'groove', 'intercom', 'helpscout', 'zoho-desk', 'hubspot',
  ];

  const connectorValid = !body.connector || validConnectors.includes(body.connector);

  return NextResponse.json({
    ok: true,
    database: {
      connected: true,
      url: maskDatabaseUrl(body.databaseUrl),
    },
    llm: {
      provider: body.llmProvider,
      keyProvided: !!body.llmApiKey,
      keyValid: llmKeyValid,
      warning: llmKeyWarning,
    },
    connector: body.connector
      ? {
          name: body.connector,
          valid: connectorValid,
        }
      : null,
    nextSteps: [
      'Run database migrations: pnpm drizzle-kit push',
      'Generate demo data: pnpm cliaas demo',
      'Start the dashboard: pnpm dev',
      'Set up MCP: pnpm cliaas mcp install',
    ],
  });
}

/**
 * GET /api/setup — Check current setup status.
 */
export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  const mode = process.env.CLIAAS_MODE || 'auto';

  let dbConnected = false;

  if (databaseUrl) {
    try {
      const { default: pg } = await import('pg');
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      await client.query('SELECT 1');
      dbConnected = true;
      await client.end();
    } catch {
      // Connection failed
    }
  }

  return NextResponse.json({
    configured: !!databaseUrl,
    mode,
    database: {
      connected: dbConnected,
      url: databaseUrl ? maskDatabaseUrl(databaseUrl) : null,
    },
    llm: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
  });
}

/** Mask password in a PostgreSQL connection URL for safe display. */
function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, do basic masking
    return url.replace(/:([^@]+)@/, ':****@');
  }
}
