import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluateHipaaReadiness, getHipaaScore } from '../hipaa';

describe('HIPAA Readiness Checker', () => {
  beforeEach(() => {
    // Set up env for some controls to pass
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test?sslmode=require';
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.cliaas.com';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.SSO_ISSUER;
  });

  it('returns 10 controls', async () => {
    const controls = await evaluateHipaaReadiness('test-workspace');
    expect(controls).toHaveLength(10);
  });

  it('passes encryption at rest when SSL and PII key configured', async () => {
    const controls = await evaluateHipaaReadiness('test-workspace');
    const encAtRest = controls.find(c => c.id === 'hipaa-01');
    expect(encAtRest).toBeDefined();
    expect(encAtRest!.status).toBe('pass');
  });

  it('passes encryption in transit when HTTPS configured', async () => {
    const controls = await evaluateHipaaReadiness('test-workspace');
    const encTransit = controls.find(c => c.id === 'hipaa-02');
    expect(encTransit).toBeDefined();
    expect(encTransit!.status).toBe('pass');
  });

  it('fails encryption at rest when key missing', async () => {
    delete process.env.PII_ENCRYPTION_KEY;
    const controls = await evaluateHipaaReadiness('test-workspace');
    const encAtRest = controls.find(c => c.id === 'hipaa-01');
    expect(encAtRest!.status).toBe('partial');
  });

  it('partially passes MFA when SSO configured', async () => {
    process.env.SSO_ISSUER = 'https://sso.example.com';
    const controls = await evaluateHipaaReadiness('test-workspace');
    const mfa = controls.find(c => c.id === 'hipaa-04');
    expect(mfa!.status).toBe('partial');
  });

  it('fails MFA when no SSO', async () => {
    const controls = await evaluateHipaaReadiness('test-workspace');
    const mfa = controls.find(c => c.id === 'hipaa-04');
    expect(mfa!.status).toBe('fail');
  });

  it('breach notification is always partial', async () => {
    const controls = await evaluateHipaaReadiness('test-workspace');
    const breach = controls.find(c => c.id === 'hipaa-10');
    expect(breach!.status).toBe('partial');
  });

  describe('getHipaaScore', () => {
    it('calculates score correctly', () => {
      const controls = [
        { id: '1', category: '', name: '', description: '', status: 'pass' as const, evidence: [] },
        { id: '2', category: '', name: '', description: '', status: 'pass' as const, evidence: [] },
        { id: '3', category: '', name: '', description: '', status: 'fail' as const, evidence: [] },
        { id: '4', category: '', name: '', description: '', status: 'partial' as const, evidence: [] },
        { id: '5', category: '', name: '', description: '', status: 'na' as const, evidence: [] },
      ];
      const score = getHipaaScore(controls);
      expect(score.total).toBe(4); // 5 - 1 na
      expect(score.score).toBe(2.5); // 2 pass + 0.5 partial
      expect(score.percentage).toBe(63); // 2.5/4 = 62.5 -> 63
    });
  });
});
