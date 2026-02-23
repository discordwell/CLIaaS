import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface SSOProvider {
  id: string;
  name: string;
  protocol: 'saml' | 'oidc';
  enabled: boolean;
  // SAML fields
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  // OIDC fields
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  // Common
  domainHint?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- JSONL persistence ----

const SSO_FILE = 'sso-providers.jsonl';

function persistProviders(): void {
  writeJsonlFile(SSO_FILE, providers);
}

// ---- In-memory store ----

const g = globalThis as unknown as {
  __cliaasSSO?: SSOProvider[];
  __cliaasSSO_loaded?: boolean;
};

const providers: SSOProvider[] = g.__cliaasSSO ?? [];
if (!g.__cliaasSSO) g.__cliaasSSO = providers;

function ensureDefaults(): void {
  if (g.__cliaasSSO_loaded) return;
  g.__cliaasSSO_loaded = true;

  // Try loading from persisted JSONL file
  const saved = readJsonlFile<SSOProvider>(SSO_FILE);
  if (saved.length > 0) {
    providers.push(...saved);
    return;
  }

  // Seed demo providers
  const now = new Date().toISOString();

  providers.push(
    {
      id: 'sso-saml-demo',
      name: 'Acme Corp SAML',
      protocol: 'saml',
      enabled: true,
      entityId: 'https://idp.acme-corp.example/saml/metadata',
      ssoUrl: 'https://idp.acme-corp.example/saml/sso',
      certificate: 'MIIDpDCCAoygAwIBAgIGAXk...demo-certificate...base64==',
      domainHint: 'acme-corp.example',
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      updatedAt: now,
    },
    {
      id: 'sso-oidc-demo',
      name: 'Globex OIDC',
      protocol: 'oidc',
      enabled: true,
      clientId: 'cliaas-globex-demo',
      clientSecret: 'demo-secret-change-in-production',
      issuer: 'https://auth.globex.example',
      authorizationUrl: 'https://auth.globex.example/authorize',
      tokenUrl: 'https://auth.globex.example/oauth/token',
      userInfoUrl: 'https://auth.globex.example/userinfo',
      domainHint: 'globex.example',
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      updatedAt: now,
    }
  );

  persistProviders();
}

// ---- Public API ----

export function getProviders(): SSOProvider[] {
  ensureDefaults();
  return [...providers];
}

export function getProvider(id: string): SSOProvider | undefined {
  ensureDefaults();
  return providers.find((p) => p.id === id);
}

export function createProvider(
  input: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>
): SSOProvider {
  ensureDefaults();
  const now = new Date().toISOString();
  const provider: SSOProvider = {
    ...input,
    id: `sso-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  providers.push(provider);
  persistProviders();
  return provider;
}

export function updateProvider(
  id: string,
  updates: Partial<Omit<SSOProvider, 'id' | 'createdAt'>>
): SSOProvider | null {
  ensureDefaults();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  providers[idx] = {
    ...providers[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persistProviders();
  return providers[idx];
}

export function deleteProvider(id: string): boolean {
  ensureDefaults();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  providers.splice(idx, 1);
  persistProviders();
  return true;
}

export function findByDomain(emailDomain: string): SSOProvider | undefined {
  ensureDefaults();
  return providers.find(
    (p) => p.enabled && p.domainHint === emailDomain
  );
}
