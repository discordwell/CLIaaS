import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildAuthnRequest,
  parseSamlResponse,
  generateSpMetadata,
  verifyXmlSignature,
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
  certificate: undefined, // No cert = demo mode (skip sig verification)
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Provider with a certificate configured (requires signature verification)
let certProvider: SSOProvider;
let testPrivateKey: string;
let testCertPem: string;
let testCertBase64: string;

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
});

/**
 * Helper: build a signed SAML response XML for testing.
 * Signs the SignedInfo element with the test private key.
 */
function buildSignedSamlResponse(options: {
  nameId: string;
  attributes?: Array<{ name: string; value: string }>;
  statusCode?: string;
  privateKey: string;
}): string {
  const {
    nameId,
    attributes = [],
    statusCode = 'urn:oasis:names:tc:SAML:2.0:status:Success',
    privateKey,
  } = options;

  // Build the AttributeStatement if there are attributes
  let attrStatement = '';
  if (attributes.length > 0) {
    const attrXml = attributes
      .map(
        (a) =>
          `      <saml:Attribute Name="${a.name}"><saml:AttributeValue>${a.value}</saml:AttributeValue></saml:Attribute>`
      )
      .join('\n');
    attrStatement = `    <saml:AttributeStatement>\n${attrXml}\n    </saml:AttributeStatement>`;
  }

  // Build SignedInfo (this is what gets signed)
  const signedInfo =
    '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI="">' +
    '<ds:Transforms>' +
    '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
    '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '</ds:Transforms>' +
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
    '<ds:DigestValue>placeholder</ds:DigestValue>' +
    '</ds:Reference>' +
    '</ds:SignedInfo>';

  // Sign the SignedInfo
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedInfo, 'utf-8');
  const signatureValue = signer.sign(privateKey, 'base64');

  // Build the full response
  const xml = [
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
    `  <samlp:Status><samlp:StatusCode Value="${statusCode}"/></samlp:Status>`,
    '  <saml:Assertion>',
    '    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    `      ${signedInfo}`,
    `      <ds:SignatureValue>${signatureValue}</ds:SignatureValue>`,
    '    </ds:Signature>',
    `    <saml:Subject><saml:NameID>${nameId}</saml:NameID></saml:Subject>`,
    attrStatement,
    '  </saml:Assertion>',
    '</samlp:Response>',
  ]
    .filter(Boolean)
    .join('\n');

  return xml;
}

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

  // -- parseSamlResponse (XML parsing, no signature) --

  it('parseSamlResponse extracts user from valid SAML XML (demo mode, no cert)', async () => {
    const xml = [
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
      '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
      '  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
      '    <saml:Subject><saml:NameID>alice@test.com</saml:NameID></saml:Subject>',
      '    <saml:AttributeStatement>',
      '      <saml:Attribute Name="firstName"><saml:AttributeValue>Alice</saml:AttributeValue></saml:Attribute>',
      '      <saml:Attribute Name="lastName"><saml:AttributeValue>Smith</saml:AttributeValue></saml:Attribute>',
      '    </saml:AttributeStatement>',
      '  </saml:Assertion>',
      '</samlp:Response>',
    ].join('\n');
    const b64 = Buffer.from(xml).toString('base64');
    const user = await parseSamlResponse(b64, mockProvider);
    expect(user.nameId).toBe('alice@test.com');
    expect(user.email).toBe('alice@test.com');
    expect(user.firstName).toBe('Alice');
    expect(user.lastName).toBe('Smith');
  });

  it('parseSamlResponse throws for missing NameID', async () => {
    const xml =
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">' +
      '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
      '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">' +
      '<saml:Subject></saml:Subject>' +
      '</saml:Assertion>' +
      '</samlp:Response>';
    const b64 = Buffer.from(xml).toString('base64');
    await expect(parseSamlResponse(b64, mockProvider)).rejects.toThrow(
      'missing NameID'
    );
  });

  it('parseSamlResponse throws for missing Response element', async () => {
    const xml = '<NotAResponse><Data>hello</Data></NotAResponse>';
    const b64 = Buffer.from(xml).toString('base64');
    await expect(parseSamlResponse(b64, mockProvider)).rejects.toThrow(
      'missing Response element'
    );
  });

  it('parseSamlResponse throws for failed status', async () => {
    const xml = [
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
      '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Requester"/></samlp:Status>',
      '  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
      '    <saml:Subject><saml:NameID>alice@test.com</saml:NameID></saml:Subject>',
      '  </saml:Assertion>',
      '</samlp:Response>',
    ].join('\n');
    const b64 = Buffer.from(xml).toString('base64');
    await expect(parseSamlResponse(b64, mockProvider)).rejects.toThrow(
      'SAML authentication failed'
    );
  });

  it('parseSamlResponse handles non-prefixed XML namespaces', async () => {
    const xml = [
      '<Response xmlns="urn:oasis:names:tc:SAML:2.0:protocol">',
      '  <Status><StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></Status>',
      '  <Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion">',
      '    <Subject><NameID>bob@test.com</NameID></Subject>',
      '  </Assertion>',
      '</Response>',
    ].join('\n');
    const b64 = Buffer.from(xml).toString('base64');
    const user = await parseSamlResponse(b64, mockProvider);
    expect(user.nameId).toBe('bob@test.com');
    expect(user.email).toBe('bob@test.com');
  });

  it('parseSamlResponse derives email from attributes when NameID is not email-like', async () => {
    const xml = [
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
      '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
      '  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
      '    <saml:Subject><saml:NameID>user-12345</saml:NameID></saml:Subject>',
      '    <saml:AttributeStatement>',
      '      <saml:Attribute Name="email"><saml:AttributeValue>charlie@test.com</saml:AttributeValue></saml:Attribute>',
      '    </saml:AttributeStatement>',
      '  </saml:Assertion>',
      '</samlp:Response>',
    ].join('\n');
    const b64 = Buffer.from(xml).toString('base64');
    const user = await parseSamlResponse(b64, mockProvider);
    expect(user.nameId).toBe('user-12345');
    expect(user.email).toBe('charlie@test.com');
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

  // -- Signature verification --

  describe('signature verification', () => {
    it('verifyXmlSignature returns true for valid signature', () => {
      const signedInfo =
        '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        '<ds:Reference URI="">' +
        '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
        '<ds:DigestValue>test</ds:DigestValue>' +
        '</ds:Reference>' +
        '</ds:SignedInfo>';

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signedInfo, 'utf-8');
      const signatureValue = signer.sign(testPrivateKey, 'base64');

      const xml = [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
        '  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
        `    ${signedInfo}`,
        `    <ds:SignatureValue>${signatureValue}</ds:SignatureValue>`,
        '  </ds:Signature>',
        '</samlp:Response>',
      ].join('\n');

      expect(verifyXmlSignature(xml, testCertBase64)).toBe(true);
    });

    it('verifyXmlSignature returns false for tampered signature', () => {
      const signedInfo =
        '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
        '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        '<ds:Reference URI="">' +
        '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
        '<ds:DigestValue>test</ds:DigestValue>' +
        '</ds:Reference>' +
        '</ds:SignedInfo>';

      // Sign with real key but tamper with the base64 output
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signedInfo, 'utf-8');
      const realSig = signer.sign(testPrivateKey, 'base64');
      const tamperedSig = 'AAAA' + realSig.slice(4); // corrupt first bytes

      const xml = [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
        '  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
        `    ${signedInfo}`,
        `    <ds:SignatureValue>${tamperedSig}</ds:SignatureValue>`,
        '  </ds:Signature>',
        '</samlp:Response>',
      ].join('\n');

      expect(verifyXmlSignature(xml, testCertBase64)).toBe(false);
    });

    it('verifyXmlSignature returns false when no SignedInfo element', () => {
      const xml =
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">' +
        '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
        '<ds:SignatureValue>abc123</ds:SignatureValue>' +
        '</ds:Signature>' +
        '</samlp:Response>';

      expect(verifyXmlSignature(xml, testCertBase64)).toBe(false);
    });

    it('parseSamlResponse verifies valid signature when cert is configured', async () => {
      const xml = buildSignedSamlResponse({
        nameId: 'dave@test.com',
        attributes: [
          { name: 'firstName', value: 'Dave' },
          { name: 'lastName', value: 'Jones' },
        ],
        privateKey: testPrivateKey,
      });
      const b64 = Buffer.from(xml).toString('base64');
      const user = await parseSamlResponse(b64, certProvider);
      expect(user.nameId).toBe('dave@test.com');
      expect(user.email).toBe('dave@test.com');
      expect(user.firstName).toBe('Dave');
      expect(user.lastName).toBe('Jones');
    });

    it('parseSamlResponse rejects response with invalid signature when cert is configured', async () => {
      // Generate a DIFFERENT key to sign with — cert won't match
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const xml = buildSignedSamlResponse({
        nameId: 'eve@test.com',
        privateKey: wrongKey,
      });
      const b64 = Buffer.from(xml).toString('base64');

      await expect(parseSamlResponse(b64, certProvider)).rejects.toThrow(
        'SAML signature verification failed: invalid signature'
      );
    });

    it('parseSamlResponse rejects unsigned response when cert is configured', async () => {
      // Response without any ds:Signature
      const xml = [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
        '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
        '  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
        '    <saml:Subject><saml:NameID>frank@test.com</saml:NameID></saml:Subject>',
        '  </saml:Assertion>',
        '</samlp:Response>',
      ].join('\n');
      const b64 = Buffer.from(xml).toString('base64');

      await expect(parseSamlResponse(b64, certProvider)).rejects.toThrow(
        'response is not signed but provider requires signature verification'
      );
    });

    it('parseSamlResponse skips verification in demo mode (no cert)', async () => {
      // Same unsigned response, but with mockProvider (no cert) — should succeed
      const xml = [
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">',
        '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
        '  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">',
        '    <saml:Subject><saml:NameID>grace@test.com</saml:NameID></saml:Subject>',
        '  </saml:Assertion>',
        '</samlp:Response>',
      ].join('\n');
      const b64 = Buffer.from(xml).toString('base64');
      const user = await parseSamlResponse(b64, mockProvider);
      expect(user.nameId).toBe('grace@test.com');
    });
  });
});
