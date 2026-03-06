import { describe, it, expect, beforeEach } from 'vitest';
import { matchProcedures, formatProcedurePrompt } from '../procedure-engine';
import { createProcedure, type AIProcedure } from '../procedures';

beforeEach(() => {
  (globalThis as Record<string, unknown>).__cliaasAIProcedures = undefined;
});

const wsId = 'ws-engine-test';

describe('matchProcedures', () => {
  it('returns empty array when no topics provided', async () => {
    await createProcedure(wsId, {
      name: 'Proc 1',
      steps: ['step'],
      triggerTopics: ['billing'],
    });

    const matches = await matchProcedures(wsId, []);
    expect(matches).toHaveLength(0);
  });

  it('matches procedure by exact topic', async () => {
    await createProcedure(wsId, {
      name: 'Password Reset',
      steps: ['Ask email', 'Send link'],
      triggerTopics: ['password', 'reset'],
    });
    await createProcedure(wsId, {
      name: 'Billing Help',
      steps: ['Check account'],
      triggerTopics: ['billing', 'invoice'],
    });

    const matches = await matchProcedures(wsId, ['password']);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Password Reset');
  });

  it('matches case-insensitively', async () => {
    await createProcedure(wsId, {
      name: 'Refund',
      steps: ['Process refund'],
      triggerTopics: ['REFUND'],
    });

    const matches = await matchProcedures(wsId, ['refund']);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Refund');
  });

  it('matches substring topics', async () => {
    await createProcedure(wsId, {
      name: 'Billing Dispute',
      steps: ['Review charge'],
      triggerTopics: ['billing'],
    });

    const matches = await matchProcedures(wsId, ['billing-dispute']);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Billing Dispute');
  });

  it('excludes disabled procedures', async () => {
    await createProcedure(wsId, {
      name: 'Disabled Proc',
      steps: ['step'],
      triggerTopics: ['test'],
      enabled: false,
    });

    const matches = await matchProcedures(wsId, ['test']);
    expect(matches).toHaveLength(0);
  });

  it('matches multiple procedures', async () => {
    await createProcedure(wsId, {
      name: 'Proc A',
      steps: ['a'],
      triggerTopics: ['login'],
    });
    await createProcedure(wsId, {
      name: 'Proc B',
      steps: ['b'],
      triggerTopics: ['login', 'auth'],
    });

    const matches = await matchProcedures(wsId, ['login']);
    expect(matches).toHaveLength(2);
  });
});

describe('formatProcedurePrompt', () => {
  it('returns empty string for no procedures', () => {
    expect(formatProcedurePrompt([])).toBe('');
  });

  it('formats a procedure with string steps', () => {
    const proc: AIProcedure = {
      id: 'p1',
      workspaceId: wsId,
      name: 'Password Reset',
      description: 'Help user reset password',
      steps: ['Ask for email', 'Send reset link'],
      triggerTopics: ['password'],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = formatProcedurePrompt([proc]);
    expect(result).toContain('ACTIVE PROCEDURES');
    expect(result).toContain('Password Reset');
    expect(result).toContain('Help user reset password');
    expect(result).toContain('1. Ask for email');
    expect(result).toContain('2. Send reset link');
    expect(result).toContain('password');
  });

  it('formats procedures with object steps using label field', () => {
    const proc: AIProcedure = {
      id: 'p2',
      workspaceId: wsId,
      name: 'Escalation',
      description: null,
      steps: [
        { label: 'Verify identity', action: 'verify' },
        { label: 'Transfer to supervisor', action: 'transfer' },
      ],
      triggerTopics: ['escalate'],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = formatProcedurePrompt([proc]);
    expect(result).toContain('1. Verify identity');
    expect(result).toContain('2. Transfer to supervisor');
  });

  it('formats multiple procedures separated by dividers', () => {
    const procs: AIProcedure[] = [
      {
        id: 'p1',
        workspaceId: wsId,
        name: 'Proc A',
        description: null,
        steps: ['step A'],
        triggerTopics: ['a'],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'p2',
        workspaceId: wsId,
        name: 'Proc B',
        description: null,
        steps: ['step B'],
        triggerTopics: ['b'],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const result = formatProcedurePrompt(procs);
    expect(result).toContain('Proc A');
    expect(result).toContain('Proc B');
    expect(result).toContain('---');
  });
});
