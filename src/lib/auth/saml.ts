import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { SignedXml } from 'xml-crypto';
import type { SSOProvider } from './sso-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('saml');

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

/**
 * Tolerance applied to assertion validity-window checks to absorb clock drift
 * between the IdP and this SP. SAML deployments commonly allow a few minutes.
 */
const CLOCK_SKEW_MS = 3 * 60 * 1000;

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
 * Cryptographically verify the enveloped XML-DSig signature(s) of a SAML
 * document against the configured IdP X.509 certificate and return the
 * canonicalized XML of every element that was actually signed.
 *
 * Security properties (why this matters):
 *  - The signature is validated with a *real* XML canonicalization + digest
 *    implementation (xml-crypto), so the `<DigestValue>` in `<SignedInfo>` is
 *    recomputed over the referenced content and compared. A signature is only
 *    accepted when both the digest matches the signed element AND the RSA
 *    signature over `<SignedInfo>` matches. This closes the classic SAML
 *    signature-forgery hole where only `<SignedInfo>` was checked and the
 *    assertion body could be swapped freely.
 *  - The verifying key is hard-pinned to the provider's configured certificate.
 *    The document's own `<KeyInfo>` (attacker-controlled) is never trusted.
 *  - Only the *verified* content is returned. Callers MUST read identity from
 *    this content and never from the raw response, which defeats XML
 *    signature-wrapping attacks (a forged assertion injected alongside a valid
 *    one is simply not part of the returned, signed content).
 *
 * @returns the canonical XML of each validly-signed reference; empty when the
 *          document is not validly signed by `certificate`.
 */
export function verifySignedContent(xml: string, certificate: string): string[] {
  const pem = formatCertificatePem(certificate);

  let doc: Document;
  try {
    doc = new DOMParser({ errorHandler: () => undefined }).parseFromString(
      xml,
      'text/xml'
    ) as unknown as Document;
  } catch (err) {
    log.warn({ err }, 'SAML response is not well-formed XML');
    return [];
  }

  const selected = xpath.select(
    `//*[local-name(.)='Signature' and namespace-uri(.)='${DSIG_NS}']`,
    doc as unknown as Node
  );
  const signatureNodes = (
    Array.isArray(selected) ? selected : selected ? [selected] : []
  ) as Node[];
  if (signatureNodes.length === 0) {
    return [];
  }

  const verified: string[] = [];
  for (const node of signatureNodes) {
    if (!node || typeof node !== 'object') continue;
    try {
      const sig = new SignedXml({
        publicCert: pem,
        // Defense in depth: never derive the verifying key from the document's
        // own <KeyInfo>; always use the pinned provider certificate.
        getCertFromKeyInfo: () => pem,
      });
      sig.loadSignature(node as unknown as Parameters<typeof sig.loadSignature>[0]);
      if (sig.checkSignature(xml)) {
        verified.push(...sig.getSignedReferences());
      }
    } catch (err) {
      // A single invalid/forged signature node should not abort verification of
      // any other (legitimately signed) signature present in the document.
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'SAML signature node failed verification'
      );
    }
  }
  return verified;
}

/**
 * Backwards-compatible boolean wrapper around {@link verifySignedContent}.
 * Returns true when the document carries at least one signature that validates
 * against the certificate. Prefer {@link verifySignedContent} when you need to
 * act on the signed content (to avoid signature-wrapping pitfalls).
 */
export function verifyXmlSignature(xml: string, certificate: string): boolean {
  return verifySignedContent(xml, certificate).length > 0;
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
 * Parse and validate a SAML Response (base64-encoded XML from the IdP).
 *
 * Verification is mandatory: the provider must have an IdP certificate, the
 * response must carry a signature that validates against it, and identity is
 * extracted *only* from the cryptographically-verified assertion. The
 * assertion validity window (`<Conditions>` NotBefore/NotOnOrAfter) is enforced
 * against verified content with a small clock-skew tolerance.
 */
export async function parseSamlResponse(
  samlResponse: string,
  provider: SSOProvider
): Promise<SamlUser> {
  // Decode the base64 response
  const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');

  // Reject DTDs outright. SAML responses must not contain a DOCTYPE; allowing
  // one opens the door to XXE / entity-expansion attacks against the parsers.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error(
      'Invalid SAML response: DOCTYPE declarations are not permitted'
    );
  }

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

  // Signature verification is mandatory.
  if (!provider.certificate) {
    throw new Error(
      'SAML signature verification failed: no IdP certificate configured. ' +
      'Configure the IdP X.509 certificate on this SSO provider before enabling SAML authentication.'
    );
  }

  const verifiedContents = verifySignedContent(xml, provider.certificate);
  if (verifiedContents.length === 0) {
    const hasSignature =
      xml.includes('<ds:Signature') || xml.includes('<Signature');
    throw new Error(
      hasSignature
        ? 'SAML signature verification failed: invalid signature'
        : 'SAML signature verification failed: response is not signed but provider requires signature verification'
    );
  }
  log.info('SAML response signature verified successfully');

  // Gather every Assertion *within the verified content only*. Reading identity
  // from anywhere else would reopen signature-wrapping attacks.
  const assertions = collectVerifiedAssertions(verifiedContents);
  if (assertions.length === 0) {
    throw new Error(
      'SAML signature verification failed: signature does not cover an Assertion'
    );
  }

  // A login Response carries exactly one subject. If multiple distinct signed
  // assertions are present (e.g. an attacker appended a second provider-signed
  // assertion captured elsewhere), the identity is ambiguous — fail closed
  // rather than silently picking one. An identical assertion signed twice
  // (Response-level + Assertion-level, a legitimate IdP option) collapses to one.
  const users = assertions.map(extractUserFromAssertion);
  const distinctSubjects = new Set(users.map((u) => u.nameId));
  if (distinctSubjects.size > 1) {
    throw new Error(
      'SAML signature verification failed: conflicting signed assertions'
    );
  }

  // Enforce the assertion validity window from verified content.
  validateConditions(assertions[0]);

  return users[0];
}

/**
 * Parse each verified reference and collect every SAML Assertion found, whether
 * the signed reference was the Assertion itself or the enclosing Response.
 */
function collectVerifiedAssertions(
  verifiedContents: string[]
): Record<string, unknown>[] {
  const assertions: Record<string, unknown>[] = [];
  for (const content of verifiedContents) {
    let tree: Record<string, unknown>;
    try {
      tree = xmlParser.parse(content);
    } catch {
      continue;
    }
    const assertion = locateAssertion(tree);
    if (assertion) assertions.push(assertion);
  }
  return assertions;
}

function locateAssertion(
  tree: Record<string, unknown>
): Record<string, unknown> | undefined {
  const asObject = (value: unknown): Record<string, unknown> | undefined => {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : undefined;
  };

  // Signed reference was the Assertion directly.
  const direct = asObject(resolveElement(tree, 'Assertion'));
  if (direct) return direct;

  // Signed reference was the whole Response; descend into it.
  const response = asObject(resolveElement(tree, 'Response'));
  if (response) {
    const nested = asObject(resolveElement(response, 'Assertion'));
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Enforce `<Conditions>` NotBefore / NotOnOrAfter on the (verified) assertion.
 * Missing timestamps are tolerated (some minimal IdPs omit them); present-but-
 * violated timestamps are rejected, with a small clock-skew allowance.
 */
function validateConditions(assertion: Record<string, unknown>): void {
  const raw = resolveElement(assertion, 'Conditions');
  const conditionsList = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const now = Date.now();

  for (const entry of conditionsList) {
    if (!entry || typeof entry !== 'object') continue;
    const cond = entry as Record<string, unknown>;

    const notBefore = cond['@_NotBefore'];
    if (typeof notBefore === 'string') {
      const t = Date.parse(notBefore);
      if (!Number.isNaN(t) && now + CLOCK_SKEW_MS < t) {
        throw new Error(
          'SAML assertion is not yet valid (NotBefore condition not met)'
        );
      }
    }

    const notOnOrAfter = cond['@_NotOnOrAfter'];
    if (typeof notOnOrAfter === 'string') {
      const t = Date.parse(notOnOrAfter);
      if (!Number.isNaN(t) && now - CLOCK_SKEW_MS >= t) {
        throw new Error(
          'SAML assertion has expired (NotOnOrAfter condition exceeded)'
        );
      }
    }
  }
}

/**
 * Extract the {@link SamlUser} from a (verified) Assertion subtree.
 */
function extractUserFromAssertion(
  assertion: Record<string, unknown>
): SamlUser {
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
  } else if (typeof nameIdValue === 'number' || typeof nameIdValue === 'boolean') {
    nameId = String(nameIdValue).trim();
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
      // Multi-valued attributes parse as arrays; take the first value.
      const firstValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
      let value: string;
      if (typeof firstValue === 'string') {
        value = firstValue.trim();
      } else if (typeof firstValue === 'number' || typeof firstValue === 'boolean') {
        value = String(firstValue);
      } else if (
        firstValue &&
        typeof firstValue === 'object' &&
        '#text' in (firstValue as Record<string, unknown>)
      ) {
        value = String(
          (firstValue as Record<string, unknown>)['#text']
        ).trim();
      } else {
        value = firstValue != null ? String(firstValue) : '';
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
