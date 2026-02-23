import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import type { SSOProvider } from './sso-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('saml');

// ---- Types ----

export interface SamlUser {
  nameId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  attributes: Record<string, string>;
}

// ---- XML Parsing Helpers ----

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Resolve an element from the parsed XML tree, handling both
 * namespace-prefixed (e.g. "samlp:Response") and unprefixed ("Response") keys.
 */
function resolveElement(
  obj: Record<string, unknown> | undefined,
  localName: string,
  nsPrefixes: string[] = ['samlp', 'saml', 'ds', 'md']
): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  // Try unprefixed first
  if (localName in obj) return obj[localName];
  // Try each namespace prefix
  for (const ns of nsPrefixes) {
    const key = `${ns}:${localName}`;
    if (key in obj) return obj[key];
  }
  return undefined;
}

// ---- Signature Verification ----

/**
 * Verify an XML digital signature against an IdP X.509 certificate.
 *
 * This implements practical verification for the common SAML case:
 * enveloped signature with exclusive XML canonicalization and RSA-SHA256.
 *
 * NOTE: Full XML c14n (Canonical XML) is complex and has many edge cases
 * (namespace inheritance, attribute sorting, whitespace handling, etc.).
 * A production deployment handling many IdPs should use a dedicated library
 * like xml-crypto for complete c14n support. This implementation handles
 * the most common case: extracting the raw SignedInfo element from the XML
 * and verifying the RSA-SHA256 signature over it.
 */
export function verifyXmlSignature(
  xml: string,
  certificate: string
): boolean {
  // Extract the SignedInfo element (raw XML) for signature verification.
  // We need the canonical form of SignedInfo as it appeared in the document.
  const signedInfoMatch = xml.match(
    /<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/
  );
  if (!signedInfoMatch) {
    // Also try without namespace prefix
    const altMatch = xml.match(
      /<SignedInfo[\s\S]*?<\/SignedInfo>/
    );
    if (!altMatch) {
      log.warn('No SignedInfo element found in SAML response');
      return false;
    }
    return verifySignedInfo(altMatch[0], xml, certificate, '');
  }
  return verifySignedInfo(signedInfoMatch[0], xml, certificate, 'ds:');
}

function verifySignedInfo(
  signedInfoXml: string,
  fullXml: string,
  certificate: string,
  nsPrefix: string
): boolean {
  // Extract SignatureValue
  const sigValueTag = nsPrefix ? `${nsPrefix}SignatureValue` : 'SignatureValue';
  const sigValueRegex = new RegExp(
    `<${sigValueTag}[^>]*>([\\s\\S]*?)<\\/${sigValueTag}>`
  );
  const sigValueMatch = fullXml.match(sigValueRegex);
  if (!sigValueMatch) {
    log.warn('No SignatureValue element found in SAML response');
    return false;
  }
  const signatureValue = sigValueMatch[1].replace(/\s+/g, '');

  // Determine signature algorithm from SignatureMethod
  const sigMethodTag = nsPrefix ? `${nsPrefix}SignatureMethod` : 'SignatureMethod';
  const sigMethodRegex = new RegExp(`<${sigMethodTag}[^>]*Algorithm="([^"]+)"`);
  const sigMethodMatch = fullXml.match(sigMethodRegex);
  const algorithm = sigMethodMatch?.[1] || '';

  // Map XML signature algorithm URI to Node.js algorithm name
  let nodeAlgorithm: string;
  if (algorithm.includes('rsa-sha256') || algorithm.includes('rsa-sha2-256')) {
    nodeAlgorithm = 'RSA-SHA256';
  } else if (algorithm.includes('rsa-sha1')) {
    nodeAlgorithm = 'RSA-SHA1';
  } else if (algorithm.includes('rsa-sha384')) {
    nodeAlgorithm = 'RSA-SHA384';
  } else if (algorithm.includes('rsa-sha512')) {
    nodeAlgorithm = 'RSA-SHA512';
  } else {
    // Default to SHA256
    nodeAlgorithm = 'RSA-SHA256';
  }

  // Build PEM-formatted certificate
  const pem = formatCertificatePem(certificate);

  // Perform basic exclusive c14n on SignedInfo:
  // - Ensure the ds namespace is declared on the SignedInfo element if it was
  //   inherited from a parent in the original document.
  let canonicalSignedInfo = signedInfoXml;
  if (
    nsPrefix === 'ds:' &&
    !signedInfoXml.includes('xmlns:ds=')
  ) {
    canonicalSignedInfo = signedInfoXml.replace(
      '<ds:SignedInfo',
      '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"'
    );
  }

  try {
    const verifier = crypto.createVerify(nodeAlgorithm);
    verifier.update(canonicalSignedInfo, 'utf-8');
    return verifier.verify(pem, signatureValue, 'base64');
  } catch (err) {
    log.warn({ err }, 'Signature verification crypto error');
    return false;
  }
}

/**
 * Format a certificate string into PEM format.
 * Accepts raw base64, PEM with headers, or single-line base64.
 */
function formatCertificatePem(cert: string): string {
  // If already in PEM format, return as-is
  if (cert.includes('-----BEGIN CERTIFICATE-----')) {
    return cert;
  }
  // Strip any whitespace and line breaks, then wrap in PEM headers
  const cleaned = cert.replace(/\s+/g, '');
  const lines: string[] = [];
  lines.push('-----BEGIN CERTIFICATE-----');
  for (let i = 0; i < cleaned.length; i += 64) {
    lines.push(cleaned.slice(i, i + 64));
  }
  lines.push('-----END CERTIFICATE-----');
  return lines.join('\n');
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
 * Uses fast-xml-parser for proper XML parsing and performs cryptographic
 * signature verification when the provider has a certificate configured.
 * If no certificate is configured (demo mode), verification is skipped
 * with a warning.
 */
export async function parseSamlResponse(
  samlResponse: string,
  provider: SSOProvider
): Promise<SamlUser> {
  // Decode the base64 response
  const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');

  // Parse XML using fast-xml-parser
  const parsed = xmlParser.parse(xml);

  // Resolve the Response element (may be "samlp:Response" or "Response")
  const response = resolveElement(parsed, 'Response') as
    | Record<string, unknown>
    | undefined;
  if (!response) {
    throw new Error('Invalid SAML response: missing Response element');
  }

  // Validate StatusCode = Success
  const status = resolveElement(response, 'Status') as
    | Record<string, unknown>
    | undefined;
  const statusCode = status
    ? (resolveElement(status, 'StatusCode') as Record<string, unknown> | undefined)
    : undefined;
  if (statusCode) {
    const statusValue =
      (statusCode['@_Value'] as string) || '';
    if (!statusValue.includes('Success')) {
      throw new Error(`SAML authentication failed: ${statusValue}`);
    }
  }

  // Signature verification
  if (provider.certificate) {
    const hasSignature =
      xml.includes('<ds:Signature') || xml.includes('<Signature');
    if (hasSignature) {
      const valid = verifyXmlSignature(xml, provider.certificate);
      if (!valid) {
        throw new Error(
          'SAML signature verification failed: invalid signature'
        );
      }
      log.info('SAML response signature verified successfully');
    } else {
      // Provider has a certificate but response has no signature — reject
      throw new Error(
        'SAML signature verification failed: response is not signed but provider requires signature verification'
      );
    }
  } else {
    log.warn(
      'No IdP certificate configured — skipping SAML signature verification (demo mode)'
    );
  }

  // Extract Assertion
  const assertion = resolveElement(response, 'Assertion') as
    | Record<string, unknown>
    | undefined;
  if (!assertion) {
    throw new Error('Invalid SAML response: missing Assertion element');
  }

  // Extract NameID from Subject
  const subject = resolveElement(assertion, 'Subject') as
    | Record<string, unknown>
    | undefined;
  const nameIdValue = subject
    ? resolveElement(subject, 'NameID')
    : undefined;

  // NameID can be a string directly or an object with #text if it has attributes
  let nameId: string;
  if (typeof nameIdValue === 'string') {
    nameId = nameIdValue.trim();
  } else if (
    nameIdValue &&
    typeof nameIdValue === 'object' &&
    '#text' in (nameIdValue as Record<string, unknown>)
  ) {
    nameId = String(
      (nameIdValue as Record<string, unknown>)['#text']
    ).trim();
  } else {
    throw new Error('Invalid SAML response: missing NameID');
  }

  if (!nameId) {
    throw new Error('Invalid SAML response: missing NameID');
  }

  // Extract attributes from AttributeStatement
  const attributes: Record<string, string> = {};
  const attrStatement = resolveElement(assertion, 'AttributeStatement') as
    | Record<string, unknown>
    | undefined;

  if (attrStatement) {
    const attrElements = resolveElement(attrStatement, 'Attribute');
    const attrArray = Array.isArray(attrElements)
      ? attrElements
      : attrElements
        ? [attrElements]
        : [];

    for (const attr of attrArray) {
      if (typeof attr !== 'object' || attr === null) continue;
      const attrObj = attr as Record<string, unknown>;
      const name = (attrObj['@_Name'] as string) || '';
      if (!name) continue;
      // AttributeValue may be a string, number, or object with #text
      const rawValue = resolveElement(
        attrObj,
        'AttributeValue'
      );
      let value: string;
      if (typeof rawValue === 'string') {
        value = rawValue.trim();
      } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        value = String(rawValue);
      } else if (
        rawValue &&
        typeof rawValue === 'object' &&
        '#text' in (rawValue as Record<string, unknown>)
      ) {
        value = String(
          (rawValue as Record<string, unknown>)['#text']
        ).trim();
      } else {
        value = rawValue != null ? String(rawValue) : '';
      }
      attributes[name] = value;
    }
  }

  // Derive email -- prefer NameID if it looks like an email, else check attributes
  const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const email = emailLike.test(nameId)
    ? nameId
    : attributes['email'] ||
      attributes[
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      ] ||
      nameId;

  // Extract first/last name from attributes
  const firstName =
    attributes['firstName'] ||
    attributes[
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'
    ] ||
    attributes['givenName'] ||
    undefined;

  const lastName =
    attributes['lastName'] ||
    attributes[
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'
    ] ||
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
