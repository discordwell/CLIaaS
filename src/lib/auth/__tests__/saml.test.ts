import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { SignedXml } from 'xml-crypto';
import {
  buildAuthnRequest,
  parseSamlResponse,
  generateSpMetadata,
  verifyXmlSignature,
  verifySignedContent,
} from '@/lib/auth/saml';
import type { SSOProvider } from '@/lib/auth/sso-config';

// ---- Test fixtures ----

const mockProvider: SSOProvider = {
  id: 'test-saml',
  name: 'Test IdP',
  protocol: 'saml',
  enabled: true,
  entityId: 'https://idp.test.com/metadata',
  ssoUrl: 'https://idp.test.com/sso',
  certificate: undefined, // No cert = verification cannot proceed (rejected)
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Provider with a certificate configured (requires signature verification)
let certProvider: SSOProvider;
let testPrivateKey: string;
let testCertPem: string;
let testCertBase64: string;
let wrongPrivateKey: string;

beforeAll(() => {
  // Generate a self-signed X.509 certificate for testing using openssl
  execSync(
    'openssl req -x509 -newkey rsa:2048 -keyout /tmp/saml_test_key.pem ' +
      '-out /tmp/saml_test_cert.pem -days 1 -nodes -subj "/CN=test-idp"',
    { stdio: 'pipe' }
  );

  testPrivateKey = fs.readFileSync('/tmp/saml_test_key.pem', 'utf8');
  testCertPem = fs.readFileSync('/tmp/saml_test_cert.pem', 'utf8');

  // Extract just the base64 body (no PEM headers)
  testCertBase64 = testCertPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  certProvider = {
    ...mockProvider,
    id: 'test-saml-cert',
    certificate: testCertBase64,
  };

  // A different key — used to forge signatures that won't match the cert.
  wrongPrivateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
});

/**
 * Build an *unsigned* SAML Response whose Assertion carries the given subject,
 * attributes, and (optional) Conditions window. Namespace-prefixed by default.
 */
function buildResponseXml(options: {
  nameId: string;
  attributes?: Array<{ name: string; value: string }>;
  statusCode?: string;
  notBefore?: string;
  notOnOrAfter?: string;
  prefixed?: boolean;
  assertionId?: string;
}): string {
  const {
    nameId,
    attributes = [],
    statusCode = 'urn:oasis:names:tc:SAML:2.0:status:Success',
    notBefore,
    notOnOrAfter,
    prefixed = true,
    assertionId = '_assertion1',
  } = options;

  const conditions =
    notBefore || notOnOrAfter
      ? `<saml:Conditions${notBefore ? ` NotBefore="${notBefore}"` : ''}${
          notOnOrAfter ? ` NotOnOrAfter="${notOnOrAfter}"` : ''
        }/>`
      : '';

  const attrXml =
    attributes.length > 0
      ? `<saml:AttributeStatement>${attributes
          .map(
            (a) =>
              `<saml:Attribute Name="${a.name}"><saml:AttributeValue>${a.value}</saml:AttributeValue></saml:Attribute>`
          )
          .join('')}</saml:AttributeStatement>`
      : '';

  const prefixedXml = [
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
    `<samlp:Status><samlp:StatusCode Value="${statusCode}"/></samlp:Status>`,
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="2024-01-01T00:00:00Z">`,
    '<saml:Issuer>https://idp.test.com/metadata</saml:Issuer>',
    conditions,
    `<saml:Subject><saml:NameID>${nameId}</saml:NameID></saml:Subject>`,
    attrXml,
    '</saml:Assertion>',
    '</samlp:Response>',
  ]
    .filter(Boolean)
    .join('');

  if (prefixed) return prefixedXml;

  // Default-namespace (unprefixed) variant.
  const attrXmlNp = attrXml
    .replace(/saml:/g, '')
    .replace(
      '<AttributeStatement>',
      '<AttributeStatement>'
    );
  return [
    '<Response xmlns="urn:oasis:names:tc:SAML:2.0:protocol">',
    `<Status><StatusCode Value="${statusCode}"/></Status>`,
    '<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion1" Version="2.0" IssueInstant="2024-01-01T00:00:00Z">',
    '<Issuer>https://idp.test.com/metadata</Issuer>',
    conditions.replace(/saml:/g, ''),
    `<Subject><NameID>${nameId}</NameID></Subject>`,
    attrXmlNp,
    '</Assertion>',
    '</Response>',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * Produce a SAML Response with a *real* enveloped XML-DSig signature over its
 * Assertion — exactly how a conformant IdP (Okta/Azure/etc.) signs assertions.
 */
function signResponse(
  responseXml: string,
  privateKey: string = testPrivateKey
): string {
  const sig = new SignedXml({ privateKey });
  sig.signatureAlgorithm =
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(responseXml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

function buildSignedSamlResponse(options: {
  nameId: string;
  attributes?: Array<{ name: string; value: string }>;
  notBefore?: string;
  notOnOrAfter?: string;
  prefixed?: boolean;
  privateKey?: string;
  assertionId?: string;
}): string {
  const { privateKey = testPrivateKey, ...rest } = options;
  return signResponse(buildResponseXml(rest), privateKey);
}

/**
 * Sign the whole <Response> (rather than the inner <Assertion>) — some IdPs
 * sign at the Response level. The Assertion must still be reachable from the
 * verified content.
 */
function signResponseRoot(
  responseXml: string,
  privateKey: string = testPrivateKey
): string {
  const withId = responseXml.replace(
    '<samlp:Response ',
    '<samlp:Response ID="_response1" '
  );
  const sig = new SignedXml({ privateKey });
  sig.signatureAlgorithm =
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.addReference({
    xpath: "//*[local-name(.)='Response']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(withId, {
    location: {
      reference: "//*[local-name(.)='Response']/*[local-name(.)='Status']",
      action: 'before',
    },
  });
  return sig.getSignedXml();
}

const b64 = (xml: string) => Buffer.from(xml).toString('base64');

// ---- Tests ----

describe('saml', () => {
  // -- buildAuthnRequest --

  it('buildAuthnRequest returns URL and relayState', () => {
    const result = buildAuthnRequest(
      mockProvider,
      'https://app.test.com/api/auth/sso/saml/callback'
    );
    expect(result.url).toContain('https://idp.test.com/sso');
    expect(result.url).toContain('SAMLRequest=');
    expect(result.url).toContain('RelayState=');
    expect(typeof result.relayState).toBe('string');
    expect(result.relayState.length).toBeGreaterThan(0);
  });

  it('buildAuthnRequest throws for provider missing ssoUrl', () => {
    const badProvider = { ...mockProvider, ssoUrl: undefined };
    expect(() =>
      buildAuthnRequest(badProvider, 'https://app.test.com/callback')
    ).toThrow('SAML provider missing ssoUrl or entityId');
  });

  // -- parseSamlResponse (happy paths) --

  it('parseSamlResponse extracts user from valid signed SAML XML', async () => {
    const xml = buildSignedSamlResponse({
      nameId: 'alice@test.com',
      attributes: [
        { name: 'firstName', value: 'Alice' },
        { name: 'lastName', value: 'Smith' },
      ],
    });
    const user = await parseSamlResponse(b64(xml), certProvider);
    expect(user.nameId).toBe('alice@test.com');
    expect(user.email).toBe('alice@test.com');
    expect(user.firstName).toBe('Alice');
    expect(user.lastName).toBe('Smith');
  });

  it('parseSamlResponse handles non-prefixed XML namespaces (with cert)', async () => {
    const xml = signResponse(
      buildResponseXml({ nameId: 'bob@test.com', prefixed: false })
    );
    const user = await parseSamlResponse(b64(xml), certProvider);
    expect(user.nameId).toBe('bob@test.com');
    expect(user.email).toBe('bob@test.com');
  });

  it('parseSamlResponse derives email from attributes when NameID is not email-like', async () => {
    const xml = buildSignedSamlResponse({
      nameId: 'user-12345',
      attributes: [{ name: 'email', value: 'charlie@test.com' }],
    });
    const user = await parseSamlResponse(b64(xml), certProvider);
    expect(user.nameId).toBe('user-12345');
    expect(user.email).toBe('charlie@test.com');
  });

  it('parseSamlResponse accepts a Response-level signature (assertion reached via descent)', async () => {
    const xml = signResponseRoot(
      buildResponseXml({
        nameId: 'erin@test.com',
        attributes: [{ name: 'firstName', value: 'Erin' }],
      })
    );
    const user = await parseSamlResponse(b64(xml), certProvider);
    expect(user.nameId).toBe('erin@test.com');
    expect(user.firstName).toBe('Erin');
  });

  it('parseSamlResponse accepts an assertion within its validity window', async () => {
    const xml = buildSignedSamlResponse({
      nameId: 'dave@test.com',
      notBefore: '2000-01-01T00:00:00Z',
      notOnOrAfter: '2999-01-01T00:00:00Z',
    });
    const user = await parseSamlResponse(b64(xml), certProvider);
    expect(user.email).toBe('dave@test.com');
  });

  // -- parseSamlResponse (structural rejections) --

  it('parseSamlResponse throws for missing NameID', async () => {
    const xml = signResponse(
      [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
        '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
        '<saml:Assertion ID="_assertion1"><saml:Issuer>https://idp.test.com/metadata</saml:Issuer>',
        '<saml:Subject></saml:Subject></saml:Assertion>',
        '</samlp:Response>',
      ].join('')
    );
    await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
      'missing NameID'
    );
  });

  it('parseSamlResponse throws for missing Response element', async () => {
    const xml = '<NotAResponse><Data>hello</Data></NotAResponse>';
    await expect(parseSamlResponse(b64(xml), mockProvider)).rejects.toThrow(
      'missing Response element'
    );
  });

  it('parseSamlResponse throws for failed status', async () => {
    const xml = buildResponseXml({
      nameId: 'alice@test.com',
      statusCode: 'urn:oasis:names:tc:SAML:2.0:status:Requester',
    });
    await expect(parseSamlResponse(b64(xml), mockProvider)).rejects.toThrow(
      'SAML authentication failed'
    );
  });

  it('parseSamlResponse rejects a DOCTYPE/DTD (XXE hardening)', async () => {
    const xml =
      '<!DOCTYPE foo [<!ENTITY x "y">]>' +
      buildResponseXml({ nameId: 'alice@test.com' });
    await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
      'DOCTYPE'
    );
  });

  // -- generateSpMetadata --

  it('generateSpMetadata includes entity ID and ACS URL', () => {
    const xml = generateSpMetadata('https://app.test.com');
    expect(xml).toContain('entityID="https://app.test.com"');
    expect(xml).toContain(
      'Location="https://app.test.com/api/auth/sso/saml/callback"'
    );
    expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:protocol');
    expect(xml).toContain(
      'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'
    );
  });

  // -- Signature verification (low-level) --

  describe('signature verification', () => {
    it('verifyXmlSignature returns true for a properly signed assertion', () => {
      const xml = buildSignedSamlResponse({ nameId: 'alice@test.com' });
      expect(verifyXmlSignature(xml, testCertBase64)).toBe(true);
    });

    it('verifyXmlSignature returns false for a wrong-key signature', () => {
      const xml = buildSignedSamlResponse({
        nameId: 'alice@test.com',
        privateKey: wrongPrivateKey,
      });
      expect(verifyXmlSignature(xml, testCertBase64)).toBe(false);
    });

    it('verifyXmlSignature returns false when there is no signature', () => {
      const xml = buildResponseXml({ nameId: 'alice@test.com' });
      expect(verifyXmlSignature(xml, testCertBase64)).toBe(false);
    });

    it('verifySignedContent returns only the signed assertion content', () => {
      const xml = buildSignedSamlResponse({ nameId: 'alice@test.com' });
      const verified = verifySignedContent(xml, testCertBase64);
      expect(verified.length).toBeGreaterThan(0);
      expect(verified.join('')).toContain('alice@test.com');
    });

    it('parseSamlResponse rejects response with invalid signature (wrong key)', async () => {
      const xml = buildSignedSamlResponse({
        nameId: 'eve@test.com',
        privateKey: wrongPrivateKey,
      });
      await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
        'SAML signature verification failed: invalid signature'
      );
    });

    it('parseSamlResponse rejects unsigned response when cert is configured', async () => {
      const xml = buildResponseXml({ nameId: 'frank@test.com' });
      await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
        'response is not signed but provider requires signature verification'
      );
    });

    it('parseSamlResponse rejects when no IdP certificate configured', async () => {
      const xml = buildResponseXml({ nameId: 'grace@test.com' });
      await expect(parseSamlResponse(b64(xml), mockProvider)).rejects.toThrow(
        'no IdP certificate configured'
      );
    });
  });

  // -- Attack regressions: these MUST fail closed --

  describe('forgery resistance', () => {
    it('rejects a tampered assertion body even when SignatureValue is intact (digest binding)', async () => {
      const signed = buildSignedSamlResponse({ nameId: 'alice@test.com' });
      // Swap the subject AFTER signing — the digest no longer matches.
      const tampered = signed.replace('alice@test.com', 'attacker@evil.com');
      expect(verifyXmlSignature(tampered, testCertBase64)).toBe(false);
      await expect(
        parseSamlResponse(b64(tampered), certProvider)
      ).rejects.toThrow('SAML signature verification failed');
    });

    it('defeats signature-wrapping: identity comes from the SIGNED assertion only', async () => {
      const signed = buildSignedSamlResponse({
        nameId: 'alice@test.com',
        attributes: [{ name: 'firstName', value: 'Alice' }],
      });
      // Inject a forged, unsigned assertion as a sibling of the real one.
      const forged =
        '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_evil">' +
        '<saml:Subject><saml:NameID>attacker@evil.com</saml:NameID></saml:Subject>' +
        '</saml:Assertion>';
      const wrapped = signed.replace(
        '</samlp:Response>',
        `${forged}</samlp:Response>`
      );
      const user = await parseSamlResponse(b64(wrapped), certProvider);
      // The signature still validates (real assertion untouched), but identity
      // must be the verified one, never the injected forgery.
      expect(user.nameId).toBe('alice@test.com');
      expect(user.email).not.toContain('attacker');
    });

    it('rejects the legacy attack: validly-signed SignedInfo but unverified DigestValue', async () => {
      // Reproduces the pre-fix vulnerability: an attacker keeps a real RSA
      // signature over <SignedInfo> (which carries only a placeholder digest)
      // and supplies a completely attacker-controlled assertion. The old code
      // checked only the SignedInfo signature and accepted this. It must now
      // be rejected because the DigestValue is never bound to the assertion.
      const signedInfo =
        '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        '<ds:Reference URI="">' +
        '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
        '<ds:DigestValue>placeholder</ds:DigestValue>' +
        '</ds:Reference></ds:SignedInfo>';
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signedInfo, 'utf-8');
      const sigValue = signer.sign(testPrivateKey, 'base64');
      const xml =
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">' +
        '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
        '<saml:Assertion><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        signedInfo +
        `<ds:SignatureValue>${sigValue}</ds:SignatureValue></ds:Signature>` +
        '<saml:Subject><saml:NameID>attacker@evil.com</saml:NameID></saml:Subject>' +
        '</saml:Assertion></samlp:Response>';
      expect(verifyXmlSignature(xml, testCertBase64)).toBe(false);
      await expect(
        parseSamlResponse(b64(xml), certProvider)
      ).rejects.toThrow('SAML signature verification failed');
    });

    it('rejects multiple distinct signed assertions (token substitution)', async () => {
      // Both assertions are validly signed by the IdP key, but for different
      // subjects — e.g. an attacker appended a provider-signed assertion they
      // captured for another user. Identity is ambiguous; fail closed.
      // Distinct assertion IDs (as two separate logins would have) — so each
      // signature validates independently and our own consistency check (not
      // xml-crypto's duplicate-ID guard) is what rejects the substitution.
      const signedAlice = buildSignedSamlResponse({
        nameId: 'alice@test.com',
        assertionId: '_assertion1',
      });
      const signedBob = buildSignedSamlResponse({
        nameId: 'bob@test.com',
        assertionId: '_assertion2',
      });
      const bobAssertion = signedBob.slice(
        signedBob.indexOf('<saml:Assertion'),
        signedBob.indexOf('</saml:Assertion>') + '</saml:Assertion>'.length
      );
      const combined = signedAlice.replace(
        '</samlp:Response>',
        `${bobAssertion}</samlp:Response>`
      );
      // Sanity: both signatures validate against the cert.
      expect(verifySignedContent(combined, testCertBase64).length).toBe(2);
      await expect(
        parseSamlResponse(b64(combined), certProvider)
      ).rejects.toThrow('conflicting signed assertions');
    });

    it('rejects an expired assertion (NotOnOrAfter in the past)', async () => {
      const xml = buildSignedSamlResponse({
        nameId: 'alice@test.com',
        notBefore: '2000-01-01T00:00:00Z',
        notOnOrAfter: '2001-01-01T00:00:00Z',
      });
      await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
        'expired'
      );
    });

    it('rejects an assertion that is not yet valid (NotBefore in the future)', async () => {
      const xml = buildSignedSamlResponse({
        nameId: 'alice@test.com',
        notBefore: '2999-01-01T00:00:00Z',
        notOnOrAfter: '2999-02-01T00:00:00Z',
      });
      await expect(parseSamlResponse(b64(xml), certProvider)).rejects.toThrow(
        'not yet valid'
      );
    });
  });
});
