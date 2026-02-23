import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { SSOProvider } from './sso-config';

// ---- Types ----

export interface OidcTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
}

export interface OidcUser {
  sub: string;
  email: string;
  name?: string;
}

// ---- Authorization URL ----

/**
 * Build an OIDC authorization URL for the given provider.
 */
export function buildAuthorizationUrl(
  provider: SSOProvider,
  callbackUrl: string,
  state: string
): string {
  if (!provider.authorizationUrl || !provider.clientId) {
    throw new Error('OIDC provider missing authorizationUrl or clientId');
  }

  const url = new URL(provider.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);

  return url.toString();
}

// ---- Token Exchange ----

/**
 * Exchange an authorization code for tokens via the provider's token endpoint.
 */
export async function exchangeCode(
  provider: SSOProvider,
  code: string,
  callbackUrl: string
): Promise<OidcTokens> {
  if (!provider.tokenUrl || !provider.clientId || !provider.clientSecret) {
    throw new Error('OIDC provider missing tokenUrl, clientId, or clientSecret');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token ?? undefined,
  };
}

// ---- ID Token Verification ----

/**
 * Verify an OIDC ID token JWT.
 * Uses the provider's issuer to discover the JWKS endpoint,
 * or falls back to the issuer + /.well-known/jwks.json.
 */
export async function verifyIdToken(
  idToken: string,
  provider: SSOProvider
): Promise<OidcUser> {
  if (!provider.issuer || !provider.clientId) {
    throw new Error('OIDC provider missing issuer or clientId');
  }

  const jwksUrl = new URL('/.well-known/jwks.json', provider.issuer);
  const JWKS = createRemoteJWKSet(jwksUrl);

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: provider.issuer,
    audience: provider.clientId,
  });

  return {
    sub: payload.sub ?? '',
    email: (payload.email as string) ?? '',
    name: (payload.name as string) ?? undefined,
  };
}

// ---- UserInfo ----

/**
 * Fetch user information from the provider's userinfo endpoint.
 */
export async function fetchUserInfo(
  accessToken: string,
  provider: SSOProvider
): Promise<OidcUser> {
  if (!provider.userInfoUrl) {
    throw new Error('OIDC provider missing userInfoUrl');
  }

  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`UserInfo request failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  return {
    sub: data.sub ?? '',
    email: data.email ?? '',
    name: data.name ?? undefined,
  };
}
