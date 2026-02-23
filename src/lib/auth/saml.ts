import type { SSOProvider } from './sso-config';

// ---- Types ----

export interface SamlUser {
  nameId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  attributes: Record<string, string>;
}

// ---- AuthnRequest ----

/**
 * Build a SAML 2.0 AuthnRequest and return the IdP redirect URL.
 * Uses HTTP-Redirect binding (SAMLRequest as a query parameter).
 */
export function buildAuthnRequest(
  provider: SSOProvider,
  callbackUrl: string
): { url: string; relayState: string } {
  if (!provider.ssoUrl || !provider.entityId) {
    throw new Error('SAML provider missing ssoUrl or entityId');
  }

  const id = `_${crypto.randomUUID()}`;
  const issueInstant = new Date().toISOString();
  const relayState = crypto.randomUUID();

  const authnRequest = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<samlp:AuthnRequest',
    '  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    `  ID="${id}"`,
    '  Version="2.0"',
    `  IssueInstant="${issueInstant}"`,
    `  AssertionConsumerServiceURL="${callbackUrl}"`,
    '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
    `  <saml:Issuer>${callbackUrl.replace('/api/auth/sso/saml/callback', '')}</saml:Issuer>`,
    '  <samlp:NameIDPolicy',
    '    Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"',
    '    AllowCreate="true"/>',
    '</samlp:AuthnRequest>',
  ].join('\n');

  // Base64-encode the AuthnRequest
  const encoded = Buffer.from(authnRequest, 'utf-8').toString('base64');

  // Build the redirect URL
  const redirectUrl = new URL(provider.ssoUrl);
  redirectUrl.searchParams.set('SAMLRequest', encoded);
  redirectUrl.searchParams.set('RelayState', relayState);

  return { url: redirectUrl.toString(), relayState };
}

// ---- Response parsing ----

/**
 * Parse a SAML Response (base64-encoded XML from the IdP).
 *
 * NOTE: This is an MVP/demo implementation using regex-based XML extraction.
 * It checks basic structural validity but does NOT perform full XML
 * canonicalization or cryptographic signature verification.
 * Production deployments should use a battle-tested SAML library.
 */
export async function parseSamlResponse(
  samlResponse: string,
  _provider: SSOProvider
): Promise<SamlUser> {
  // Decode the base64 response
  const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');

  // Verify basic SAML response structure
  if (!xml.includes('samlp:Response') && !xml.includes('Response')) {
    throw new Error('Invalid SAML response: missing Response element');
  }

  // Check for successful status
  const statusMatch = xml.match(
    /<samlp:StatusCode[^>]*Value="([^"]+)"/
  );
  if (statusMatch) {
    const statusValue = statusMatch[1];
    if (!statusValue.includes('Success')) {
      throw new Error(`SAML authentication failed: ${statusValue}`);
    }
  }

  // Extract NameID
  const nameIdMatch = xml.match(
    /<(?:saml:)?NameID[^>]*>([^<]+)<\/(?:saml:)?NameID>/
  );
  if (!nameIdMatch) {
    throw new Error('Invalid SAML response: missing NameID');
  }
  const nameId = nameIdMatch[1].trim();

  // Extract attributes from AttributeStatement
  const attributes: Record<string, string> = {};

  const attrRegex =
    /<(?:saml:)?Attribute\s+Name="([^"]+)"[^>]*>\s*<(?:saml:)?AttributeValue[^>]*>([^<]*)<\/(?:saml:)?AttributeValue>/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(xml)) !== null) {
    attributes[attrMatch[1]] = attrMatch[2].trim();
  }

  // Derive email — prefer NameID if it looks like an email, else check attributes
  const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const email = emailLike.test(nameId)
    ? nameId
    : attributes['email'] ||
      attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
      nameId;

  // Extract first/last name from attributes
  const firstName =
    attributes['firstName'] ||
    attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] ||
    attributes['givenName'] ||
    undefined;

  const lastName =
    attributes['lastName'] ||
    attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'] ||
    attributes['sn'] ||
    undefined;

  return { nameId, email, firstName, lastName, attributes };
}

// ---- SP Metadata ----

/**
 * Generate SAML SP metadata XML.
 */
export function generateSpMetadata(baseUrl: string): string {
  const entityId = baseUrl;
  const acsUrl = `${baseUrl}/api/auth/sso/saml/callback`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<md:EntityDescriptor',
    '  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
    `  entityID="${entityId}">`,
    '  <md:SPSSODescriptor',
    '    AuthnRequestsSigned="false"',
    '    WantAssertionsSigned="true"',
    '    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    '    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>',
    '    <md:AssertionConsumerService',
    '      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    `      Location="${acsUrl}"`,
    '      index="0"',
    '      isDefault="true"/>',
    '  </md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ].join('\n');
}
