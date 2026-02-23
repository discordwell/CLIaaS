import { describe, it, expect } from 'vitest';
import {
  buildAuthnRequest,
  parseSamlResponse,
  generateSpMetadata,
} from '@/lib/auth/saml';
import type { SSOProvider } from '@/lib/auth/sso-config';

const mockProvider: SSOProvider = {
  id: 'test-saml',
  name: 'Test IdP',
  protocol: 'saml',
  enabled: true,
  entityId: 'https://idp.test.com/metadata',
  ssoUrl: 'https://idp.test.com/sso',
  certificate: 'test-cert',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('saml', () => {
  it('buildAuthnRequest returns URL and relayState', () => {
    const result = buildAuthnRequest(mockProvider, 'https://app.test.com/api/auth/sso/saml/callback');
    expect(result.url).toContain('https://idp.test.com/sso');
    expect(result.url).toContain('SAMLRequest=');
    expect(result.url).toContain('RelayState=');
    expect(typeof result.relayState).toBe('string');
    expect(result.relayState.length).toBeGreaterThan(0);
  });

  it('buildAuthnRequest throws for provider missing ssoUrl', () => {
    const badProvider = { ...mockProvider, ssoUrl: undefined };
    expect(() =>
      buildAuthnRequest(badProvider, 'https://app.test.com/callback'),
    ).toThrow('SAML provider missing ssoUrl or entityId');
  });

  it('parseSamlResponse extracts user from valid SAML XML', async () => {
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
    const xml = '<samlp:Response><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status></samlp:Response>';
    const b64 = Buffer.from(xml).toString('base64');
    await expect(parseSamlResponse(b64, mockProvider)).rejects.toThrow('missing NameID');
  });

  it('generateSpMetadata includes entity ID and ACS URL', () => {
    const xml = generateSpMetadata('https://app.test.com');
    expect(xml).toContain('entityID="https://app.test.com"');
    expect(xml).toContain('Location="https://app.test.com/api/auth/sso/saml/callback"');
    expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:protocol');
    expect(xml).toContain('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress');
  });
});
