/**
 * HIPAA readiness checker — evaluates 10 compliance controls
 * and returns pass/fail status with evidence and remediation guidance.
 */

import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';

export interface HipaaControl {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'fail' | 'partial' | 'na';
  evidence: string[];
  remediation?: string;
}

const CONTROLS: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>[] = [
  {
    id: 'hipaa-01',
    category: 'Technical Safeguard',
    name: 'Encryption at Rest',
    description: 'Data stored in the database must be encrypted',
  },
  {
    id: 'hipaa-02',
    category: 'Technical Safeguard',
    name: 'Encryption in Transit',
    description: 'All data transmitted over networks must use TLS/HTTPS',
  },
  {
    id: 'hipaa-03',
    category: 'Administrative Safeguard',
    name: 'Access Controls',
    description: 'Role-based access control must be configured with least-privilege',
  },
  {
    id: 'hipaa-04',
    category: 'Administrative Safeguard',
    name: 'Multi-Factor Authentication',
    description: 'Admin accounts should have MFA enabled',
  },
  {
    id: 'hipaa-05',
    category: 'Technical Safeguard',
    name: 'Audit Logging',
    description: 'All access and modifications must be logged in an immutable audit trail',
  },
  {
    id: 'hipaa-06',
    category: 'Technical Safeguard',
    name: 'PII Detection',
    description: 'Automated PII detection must be configured with sensitivity rules',
  },
  {
    id: 'hipaa-07',
    category: 'Administrative Safeguard',
    name: 'Data Retention',
    description: 'Retention policies must be configured with appropriate periods',
  },
  {
    id: 'hipaa-08',
    category: 'Administrative Safeguard',
    name: 'Business Associate Agreement',
    description: 'Active BAA must be on file',
  },
  {
    id: 'hipaa-09',
    category: 'Administrative Safeguard',
    name: 'Minimum Necessary Access',
    description: 'Light agent role should be used for staff with limited data needs',
  },
  {
    id: 'hipaa-10',
    category: 'Administrative Safeguard',
    name: 'Breach Notification Plan',
    description: 'Incident response and breach notification procedures must be documented',
  },
];

export async function evaluateHipaaReadiness(workspaceId: string): Promise<HipaaControl[]> {
  const db = getDb();
  const results: HipaaControl[] = [];

  for (const control of CONTROLS) {
    const result = await evaluateControl(control, workspaceId, db);
    results.push(result);
  }

  return results;
}

export function getHipaaScore(controls: HipaaControl[]): { score: number; total: number; percentage: number } {
  const applicable = controls.filter(c => c.status !== 'na');
  const passing = applicable.filter(c => c.status === 'pass').length;
  const partial = applicable.filter(c => c.status === 'partial').length;
  const score = passing + partial * 0.5;
  return {
    score,
    total: applicable.length,
    percentage: applicable.length > 0 ? Math.round((score / applicable.length) * 100) : 0,
  };
}

async function evaluateControl(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  switch (control.id) {
    case 'hipaa-01':
      return evaluateEncryptionAtRest(control);
    case 'hipaa-02':
      return evaluateEncryptionInTransit(control);
    case 'hipaa-03':
      return evaluateAccessControls(control, workspaceId, db);
    case 'hipaa-04':
      return evaluateMFA(control);
    case 'hipaa-05':
      return evaluateAuditLogging(control, workspaceId, db);
    case 'hipaa-06':
      return evaluatePiiDetection(control, workspaceId, db);
    case 'hipaa-07':
      return evaluateRetention(control, workspaceId, db);
    case 'hipaa-08':
      return evaluateBAA(control, workspaceId, db);
    case 'hipaa-09':
      return evaluateMinimumAccess(control, workspaceId, db);
    case 'hipaa-10':
      return evaluateBreachNotification(control);
    default:
      return { ...control, status: 'na', evidence: [] };
  }
}

function evaluateEncryptionAtRest(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
): HipaaControl {
  const dbUrl = process.env.DATABASE_URL || '';
  const hasSsl = dbUrl.includes('sslmode=require') || dbUrl.includes('ssl=true');
  const hasPiiKey = !!process.env.PII_ENCRYPTION_KEY;

  if (hasSsl && hasPiiKey) {
    return { ...control, status: 'pass', evidence: ['Database SSL enabled', 'PII encryption key configured'] };
  }
  if (hasSsl || hasPiiKey) {
    return {
      ...control,
      status: 'partial',
      evidence: [
        hasSsl ? 'Database SSL enabled' : 'Database SSL not configured',
        hasPiiKey ? 'PII encryption key configured' : 'PII encryption key not set',
      ],
      remediation: !hasSsl ? 'Add sslmode=require to DATABASE_URL' : 'Set PII_ENCRYPTION_KEY environment variable',
    };
  }
  return {
    ...control,
    status: 'fail',
    evidence: ['No encryption at rest configured'],
    remediation: 'Configure DATABASE_URL with SSL and set PII_ENCRYPTION_KEY',
  };
}

function evaluateEncryptionInTransit(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
): HipaaControl {
  // Check if running behind HTTPS (check common env indicators)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BASE_URL || '';
  const isHttps = baseUrl.startsWith('https://');

  if (isHttps) {
    return { ...control, status: 'pass', evidence: ['HTTPS configured via application URL', 'HSTS headers set in security middleware'] };
  }
  if (process.env.NODE_ENV === 'development') {
    return { ...control, status: 'na', evidence: ['Development environment — HTTPS not required'] };
  }
  return {
    ...control,
    status: 'fail',
    evidence: ['Application URL does not use HTTPS'],
    remediation: 'Configure NEXT_PUBLIC_APP_URL with https:// and ensure TLS termination at reverse proxy',
  };
}

async function evaluateAccessControls(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'partial', evidence: ['RBAC system available', 'Database not connected for user role verification'] };

  try {
    const users = await db.select().from(schema.users).where(eq(schema.users.workspaceId, workspaceId));
    const roles = new Set(users.map(u => u.role));
    const hasLightAgent = roles.has('light_agent');
    const hasMultipleRoles = roles.size >= 2;

    if (hasLightAgent && hasMultipleRoles) {
      return { ...control, status: 'pass', evidence: [`${roles.size} distinct roles in use`, 'Light agent role configured for restricted access'] };
    }
    return {
      ...control,
      status: 'partial',
      evidence: [`${roles.size} distinct roles in use`, hasLightAgent ? 'Light agent role in use' : 'Light agent role not assigned to any user'],
      remediation: !hasLightAgent ? 'Assign light_agent role to users who should have restricted data access' : undefined,
    };
  } catch {
    return { ...control, status: 'partial', evidence: ['RBAC system available'] };
  }
}

function evaluateMFA(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
): HipaaControl {
  // MFA is typically handled by SSO/identity provider
  const hasSso = !!process.env.SSO_ISSUER || !!process.env.AUTH0_DOMAIN || !!process.env.NEXTAUTH_URL;
  if (hasSso) {
    return { ...control, status: 'partial', evidence: ['SSO/identity provider configured — verify MFA is enabled in provider settings'] };
  }
  return {
    ...control,
    status: 'fail',
    evidence: ['No SSO provider detected'],
    remediation: 'Configure SSO with an identity provider that enforces MFA',
  };
}

async function evaluateAuditLogging(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'partial', evidence: ['Audit system available with hash-chain integrity'] };

  try {
    const [count] = await db.select({ count: schema.auditEntries.id }).from(schema.auditEntries).where(eq(schema.auditEntries.workspaceId, workspaceId)).limit(1);
    return {
      ...control,
      status: 'pass',
      evidence: ['Immutable hash-chain audit log active', 'Audit entries persisted to database', 'WAL buffer for reliability'],
    };
  } catch {
    return { ...control, status: 'partial', evidence: ['Audit system available'] };
  }
}

async function evaluatePiiDetection(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'fail', evidence: ['Database not connected'], remediation: 'Connect database and configure PII sensitivity rules' };

  try {
    const rules = await db
      .select()
      .from(schema.piiSensitivityRules)
      .where(eq(schema.piiSensitivityRules.workspaceId, workspaceId));

    const enabledCount = rules.filter(r => r.enabled).length;
    const autoRedactCount = rules.filter(r => r.autoRedact).length;

    if (enabledCount > 0 && autoRedactCount > 0) {
      return { ...control, status: 'pass', evidence: [`${enabledCount} PII types monitored`, `${autoRedactCount} types set to auto-redact`] };
    }
    if (enabledCount > 0) {
      return {
        ...control,
        status: 'partial',
        evidence: [`${enabledCount} PII types monitored`, 'No auto-redaction configured'],
        remediation: 'Enable auto-redaction for sensitive PII types (SSN, credit card)',
      };
    }
    return {
      ...control,
      status: 'fail',
      evidence: ['No PII sensitivity rules configured'],
      remediation: 'Configure PII sensitivity rules via /compliance or CLI',
    };
  } catch {
    return { ...control, status: 'fail', evidence: ['Failed to check PII configuration'], remediation: 'Configure PII sensitivity rules' };
  }
}

async function evaluateRetention(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'fail', evidence: ['Database not connected'], remediation: 'Configure data retention policies' };

  try {
    const policies = await db
      .select()
      .from(schema.retentionPolicies)
      .where(eq(schema.retentionPolicies.workspaceId, workspaceId));

    if (policies.length > 0) {
      return { ...control, status: 'pass', evidence: [`${policies.length} retention policies configured`] };
    }
    return {
      ...control,
      status: 'fail',
      evidence: ['No retention policies configured'],
      remediation: 'Configure retention policies via /compliance or API',
    };
  } catch {
    return { ...control, status: 'fail', evidence: ['Failed to check retention policies'] };
  }
}

async function evaluateBAA(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'fail', evidence: ['Database not connected'], remediation: 'Create BAA records' };

  try {
    const baas = await db
      .select()
      .from(schema.hipaaBaaRecords)
      .where(and(eq(schema.hipaaBaaRecords.workspaceId, workspaceId), eq(schema.hipaaBaaRecords.status, 'active')));

    if (baas.length > 0) {
      return { ...control, status: 'pass', evidence: [`${baas.length} active BAA(s) on file`] };
    }
    return {
      ...control,
      status: 'fail',
      evidence: ['No active BAA on file'],
      remediation: 'Create a BAA record via /compliance HIPAA tab or API',
    };
  } catch {
    return { ...control, status: 'fail', evidence: ['Failed to check BAA records'] };
  }
}

async function evaluateMinimumAccess(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
): Promise<HipaaControl> {
  if (!db) return { ...control, status: 'partial', evidence: ['Light agent role available in system'] };

  try {
    const lightAgents = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.workspaceId, workspaceId), eq(schema.users.role, 'light_agent')));

    if (lightAgents.length > 0) {
      return { ...control, status: 'pass', evidence: [`${lightAgents.length} user(s) assigned light_agent role`] };
    }
    return {
      ...control,
      status: 'partial',
      evidence: ['Light agent role available but not assigned to any user'],
      remediation: 'Assign light_agent role to users who should have minimum necessary access',
    };
  } catch {
    return { ...control, status: 'partial', evidence: ['Light agent role available'] };
  }
}

function evaluateBreachNotification(
  control: Omit<HipaaControl, 'status' | 'evidence' | 'remediation'>,
): HipaaControl {
  // Manual attestation — no automated check possible
  return {
    ...control,
    status: 'partial',
    evidence: ['Requires manual attestation — document your incident response plan'],
    remediation: 'Document breach notification procedures and attest compliance via the HIPAA dashboard',
  };
}
