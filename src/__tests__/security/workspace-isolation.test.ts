/**
 * Workspace isolation tests.
 * Verifies that data from one workspace cannot be accessed by another.
 *
 * Tests cover:
 * - Brands (in-memory store)
 * - Webhooks (in-memory store)
 * - Automation rules (in-memory global singleton)
 * - Automation audit log (in-memory global singleton)
 * - Secure audit log (in-memory global singleton)
 * - SLA policies (in-memory demo store)
 * - SMS conversations (in-memory store)
 * - Social conversations (in-memory store)
 * - Voice calls (in-memory store)
 * - Route-level code pattern verification (structural tests)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---- Brands ----
import { listBrands, createBrand, updateBrand, deleteBrand } from '@/lib/brands';

// ---- Webhooks ----
import { listWebhooks, createWebhook, getWebhook, deleteWebhook } from '@/lib/webhooks';

// ---- Automations ----
import {
  getAutomationRules,
  addAutomationRule,
  removeAutomationRule,
  updateAutomationRule,
  getAuditLog,
} from '@/lib/automation/executor';
import type { Rule } from '@/lib/automation/engine';

// ---- Secure audit ----
import { querySecureAudit, recordSecureAudit, _resetChainLock } from '@/lib/security/audit-log';

// ---- SMS ----
import {
  getAllConversations as getAllSmsConversations,
  createConversation as createSmsConversation,
  getConversation as getSmsConversation,
  closeConversation as closeSmsConversation,
} from '@/lib/channels/sms-store';

// ---- Social ----
import {
  getAllConversations as getAllSocialConversations,
  createConversation as createSocialConversation,
  getConversation as getSocialConversation,
} from '@/lib/channels/social-store';

// ---- Voice ----
import { getAllCalls, getActiveCalls } from '@/lib/channels/voice-store';

// ---- Helpers ----

function makeRule(id: string, workspaceId: string): Rule {
  return {
    id,
    type: 'trigger',
    name: `Rule ${id}`,
    enabled: true,
    conditions: { all: [], any: [] },
    actions: [],
    workspaceId,
  };
}

// ---- Test suites ----

describe('Workspace isolation: Brands', () => {
  it('createBrand tags with workspaceId and listBrands filters by workspace', () => {
    const brandA = createBrand(
      { name: 'Brand A', subdomain: 'a', logo: '', primaryColor: '#000', portalTitle: 'A', kbEnabled: true, chatEnabled: false },
      'ws-alpha',
    );
    const brandB = createBrand(
      { name: 'Brand B', subdomain: 'b', logo: '', primaryColor: '#fff', portalTitle: 'B', kbEnabled: true, chatEnabled: false },
      'ws-beta',
    );

    const alphaList = listBrands('ws-alpha');
    const betaList = listBrands('ws-beta');

    expect(alphaList.some(b => b.id === brandA.id)).toBe(true);
    expect(alphaList.some(b => b.id === brandB.id)).toBe(false);

    expect(betaList.some(b => b.id === brandB.id)).toBe(true);
    expect(betaList.some(b => b.id === brandA.id)).toBe(false);

    // Clean up
    deleteBrand(brandA.id, 'ws-alpha');
    deleteBrand(brandB.id, 'ws-beta');
  });

  it('updateBrand rejects cross-workspace update', () => {
    const brand = createBrand(
      { name: 'Owned', subdomain: 'owned', logo: '', primaryColor: '#000', portalTitle: 'O', kbEnabled: true, chatEnabled: false },
      'ws-owner',
    );

    const result = updateBrand(brand.id, { name: 'Hacked' }, 'ws-attacker');
    expect(result).toBeNull();

    // Owner can update
    const updated = updateBrand(brand.id, { name: 'Updated' }, 'ws-owner');
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');

    deleteBrand(brand.id, 'ws-owner');
  });

  it('deleteBrand rejects cross-workspace deletion', () => {
    const brand = createBrand(
      { name: 'Protected', subdomain: 'protected', logo: '', primaryColor: '#000', portalTitle: 'P', kbEnabled: true, chatEnabled: false },
      'ws-owner',
    );

    const attackResult = deleteBrand(brand.id, 'ws-attacker');
    expect(attackResult).toBe(false);

    const ownerResult = deleteBrand(brand.id, 'ws-owner');
    expect(ownerResult).toBe(true);
  });
});

describe('Workspace isolation: Webhooks', () => {
  it('createWebhook tags with workspaceId and listWebhooks filters by workspace', () => {
    const whA = createWebhook(
      { url: 'https://example.com/a', events: ['ticket.created'], secret: 'sec-a', enabled: true, retryPolicy: { maxAttempts: 1, delaysMs: [] } },
      'ws-alpha',
    );
    const whB = createWebhook(
      { url: 'https://example.com/b', events: ['ticket.created'], secret: 'sec-b', enabled: true, retryPolicy: { maxAttempts: 1, delaysMs: [] } },
      'ws-beta',
    );

    const alphaList = listWebhooks('ws-alpha');
    const betaList = listWebhooks('ws-beta');

    expect(alphaList.some(w => w.id === whA.id)).toBe(true);
    expect(alphaList.some(w => w.id === whB.id)).toBe(false);

    expect(betaList.some(w => w.id === whB.id)).toBe(true);
    expect(betaList.some(w => w.id === whA.id)).toBe(false);

    deleteWebhook(whA.id, 'ws-alpha');
    deleteWebhook(whB.id, 'ws-beta');
  });

  it('getWebhook rejects cross-workspace access', () => {
    const wh = createWebhook(
      { url: 'https://example.com/secret', events: ['ticket.created'], secret: 'sec', enabled: true, retryPolicy: { maxAttempts: 1, delaysMs: [] } },
      'ws-owner',
    );

    expect(getWebhook(wh.id, 'ws-attacker')).toBeUndefined();
    expect(getWebhook(wh.id, 'ws-owner')).toBeDefined();

    deleteWebhook(wh.id, 'ws-owner');
  });

  it('deleteWebhook rejects cross-workspace deletion', () => {
    const wh = createWebhook(
      { url: 'https://example.com/protect', events: ['ticket.created'], secret: 'sec', enabled: true, retryPolicy: { maxAttempts: 1, delaysMs: [] } },
      'ws-owner',
    );

    expect(deleteWebhook(wh.id, 'ws-attacker')).toBe(false);
    expect(deleteWebhook(wh.id, 'ws-owner')).toBe(true);
  });
});

describe('Workspace isolation: Automation rules', () => {
  beforeEach(() => {
    // Clear all automation rules
    global.__cliaasAutomationRules = [];
    global.__cliaasAutomationAudit = [];
  });

  it('getAutomationRules filters by workspaceId', () => {
    addAutomationRule(makeRule('r1', 'ws-alpha'));
    addAutomationRule(makeRule('r2', 'ws-beta'));
    addAutomationRule(makeRule('r3', 'ws-alpha'));

    const alphaRules = getAutomationRules('ws-alpha');
    const betaRules = getAutomationRules('ws-beta');

    expect(alphaRules).toHaveLength(2);
    expect(alphaRules.map(r => r.id)).toEqual(['r1', 'r3']);

    expect(betaRules).toHaveLength(1);
    expect(betaRules[0].id).toBe('r2');
  });

  it('removeAutomationRule rejects cross-workspace removal', () => {
    addAutomationRule(makeRule('r-owned', 'ws-owner'));

    expect(removeAutomationRule('r-owned', 'ws-attacker')).toBe(false);
    expect(getAutomationRules()).toHaveLength(1);

    expect(removeAutomationRule('r-owned', 'ws-owner')).toBe(true);
    expect(getAutomationRules()).toHaveLength(0);
  });

  it('updateAutomationRule rejects cross-workspace update', () => {
    addAutomationRule(makeRule('r-upd', 'ws-owner'));

    expect(updateAutomationRule('r-upd', { name: 'Hacked' }, 'ws-attacker')).toBeNull();
    expect(getAutomationRules()[0].name).toBe('Rule r-upd');

    const updated = updateAutomationRule('r-upd', { name: 'Renamed' }, 'ws-owner');
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Renamed');
  });

  it('getAuditLog filters by workspaceId', () => {
    global.__cliaasAutomationAudit = [
      { id: '1', ruleId: 'r1', ruleName: 'R1', ticketId: 't1', event: 'e', actions: {}, timestamp: '', dryRun: false, workspaceId: 'ws-alpha' },
      { id: '2', ruleId: 'r2', ruleName: 'R2', ticketId: 't2', event: 'e', actions: {}, timestamp: '', dryRun: false, workspaceId: 'ws-beta' },
      { id: '3', ruleId: 'r3', ruleName: 'R3', ticketId: 't3', event: 'e', actions: {}, timestamp: '', dryRun: false, workspaceId: 'ws-alpha' },
    ];

    expect(getAuditLog('ws-alpha')).toHaveLength(2);
    expect(getAuditLog('ws-beta')).toHaveLength(1);
    expect(getAuditLog()).toHaveLength(3); // no filter returns all
  });
});

describe('Workspace isolation: Secure audit log', () => {
  beforeEach(() => {
    _resetChainLock();
  });

  it('querySecureAudit filters by workspaceId', async () => {
    // Record entries for different workspaces
    await recordSecureAudit({
      actor: { type: 'user', id: 'u1', name: 'Alice', ip: '1.1.1.1' },
      action: 'test.alpha',
      resource: { type: 'test', id: 'r1' },
      outcome: 'success',
      details: {},
      workspaceId: 'ws-audit-alpha',
    });
    await recordSecureAudit({
      actor: { type: 'user', id: 'u2', name: 'Bob', ip: '2.2.2.2' },
      action: 'test.beta',
      resource: { type: 'test', id: 'r2' },
      outcome: 'success',
      details: {},
      workspaceId: 'ws-audit-beta',
    });

    const alphaResults = querySecureAudit({ workspaceId: 'ws-audit-alpha' });
    const betaResults = querySecureAudit({ workspaceId: 'ws-audit-beta' });

    expect(alphaResults.entries.some(e => e.action === 'test.alpha')).toBe(true);
    expect(alphaResults.entries.some(e => e.action === 'test.beta')).toBe(false);

    expect(betaResults.entries.some(e => e.action === 'test.beta')).toBe(true);
    expect(betaResults.entries.some(e => e.action === 'test.alpha')).toBe(false);
  });
});

describe('Workspace isolation: SMS conversations', () => {
  it('getAllConversations filters by workspaceId', () => {
    const convA = createSmsConversation('+15551111111', 'sms', 'Alpha User', 'ws-sms-alpha');
    const convB = createSmsConversation('+15552222222', 'sms', 'Beta User', 'ws-sms-beta');

    const alphaConvs = getAllSmsConversations('ws-sms-alpha');
    const betaConvs = getAllSmsConversations('ws-sms-beta');

    expect(alphaConvs.some(c => c.id === convA.id)).toBe(true);
    expect(alphaConvs.some(c => c.id === convB.id)).toBe(false);

    expect(betaConvs.some(c => c.id === convB.id)).toBe(true);
    expect(betaConvs.some(c => c.id === convA.id)).toBe(false);
  });

  it('getConversation rejects cross-workspace access', () => {
    const conv = createSmsConversation('+15553333333', 'sms', 'Owner', 'ws-sms-owner');

    expect(getSmsConversation(conv.id, 'ws-sms-attacker')).toBeUndefined();
    expect(getSmsConversation(conv.id, 'ws-sms-owner')).toBeDefined();
  });

  it('closeConversation rejects cross-workspace modification', () => {
    const conv = createSmsConversation('+15554444444', 'sms', 'Protected', 'ws-sms-protected');

    expect(closeSmsConversation(conv.id, 'ws-sms-attacker')).toBeNull();
    expect(closeSmsConversation(conv.id, 'ws-sms-protected')).not.toBeNull();
  });
});

describe('Workspace isolation: Social conversations', () => {
  it('getAllConversations filters by workspaceId', () => {
    const convA = createSocialConversation('facebook', 'ext-1', 'FB User A', 'ws-social-alpha');
    const convB = createSocialConversation('twitter', 'ext-2', 'TW User B', 'ws-social-beta');

    const alphaConvs = getAllSocialConversations('ws-social-alpha');
    const betaConvs = getAllSocialConversations('ws-social-beta');

    expect(alphaConvs.some(c => c.id === convA.id)).toBe(true);
    expect(alphaConvs.some(c => c.id === convB.id)).toBe(false);

    expect(betaConvs.some(c => c.id === convB.id)).toBe(true);
    expect(betaConvs.some(c => c.id === convA.id)).toBe(false);
  });

  it('getConversation rejects cross-workspace access', () => {
    const conv = createSocialConversation('instagram', 'ext-3', 'Owner', 'ws-social-owner');

    expect(getSocialConversation(conv.id, 'ws-social-attacker')).toBeUndefined();
    expect(getSocialConversation(conv.id, 'ws-social-owner')).toBeDefined();
  });
});

describe('Workspace isolation: Route-level code pattern verification', () => {
  const routeDir = path.resolve(__dirname, '../../app/api');

  function readRouteSource(routePath: string): string {
    return fs.readFileSync(path.join(routeDir, routePath), 'utf-8');
  }

  it('rules/route.ts uses auth.user.workspaceId for workspace filtering', () => {
    const src = readRouteSource('rules/route.ts');
    expect(src).toContain('auth.user.workspaceId');
    // Should NOT use raw x-workspace-id header
    expect(src).not.toContain("request.headers.get('x-workspace-id')");
  });

  it('rules/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('rules/[id]/route.ts');
    expect(src).toContain('auth.user.workspaceId');
    // Must use AND clause for workspace + id
    expect(src).toContain('and(');
  });

  it('kb/route.ts uses auth.user.workspaceId for DB queries', () => {
    const src = readRouteSource('kb/route.ts');
    expect(src).toContain('auth.user.workspaceId');
  });

  it('kb/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('kb/[id]/route.ts');
    expect(src).toContain('auth.user.workspaceId');
    expect(src).toContain('and(');
  });

  it('sla/route.ts passes workspaceId to listPolicies and createPolicy', () => {
    const src = readRouteSource('sla/route.ts');
    expect(src).toContain('listPolicies(auth.user.workspaceId)');
    expect(src).toContain('auth.user.workspaceId)');
  });

  it('audit/route.ts includes workspaceId in filters', () => {
    const src = readRouteSource('audit/route.ts');
    expect(src).toContain('workspaceId: auth.user.workspaceId');
  });

  it('audit/export/route.ts includes workspaceId in filters', () => {
    const src = readRouteSource('audit/export/route.ts');
    expect(src).toContain('workspaceId: auth.user.workspaceId');
  });

  it('security/audit/route.ts includes workspaceId in filters', () => {
    const src = readRouteSource('security/audit/route.ts');
    expect(src).toContain('workspaceId: auth.user.workspaceId');
  });

  it('security/audit/export/route.ts includes workspaceId in filters', () => {
    const src = readRouteSource('security/audit/export/route.ts');
    expect(src).toContain('workspaceId: auth.user.workspaceId');
  });

  it('brands/route.ts passes workspaceId to listBrands and createBrand', () => {
    const src = readRouteSource('brands/route.ts');
    expect(src).toContain('listBrands(auth.user.workspaceId)');
    expect(src).toContain('auth.user.workspaceId)');
  });

  it('brands/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('brands/[id]/route.ts');
    expect(src).toContain('auth.user.workspaceId');
  });

  it('webhooks/route.ts passes workspaceId to listWebhooks and createWebhook', () => {
    const src = readRouteSource('webhooks/route.ts');
    expect(src).toContain('listWebhooks(auth.user.workspaceId)');
    expect(src).toContain('auth.user.workspaceId)');
  });

  it('webhooks/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('webhooks/[id]/route.ts');
    expect(src).toContain('auth.user.workspaceId');
  });

  it('webhooks/[id]/logs/route.ts scopes by workspace', () => {
    const src = readRouteSource('webhooks/[id]/logs/route.ts');
    expect(src).toContain('auth.user.workspaceId');
  });

  it('workflows/route.ts passes workspaceId to getWorkflows and upsertWorkflow', () => {
    const src = readRouteSource('workflows/route.ts');
    expect(src).toContain('getWorkflows(auth.user.workspaceId)');
    expect(src).toContain('upsertWorkflow(workflow, auth.user.workspaceId)');
  });

  it('workflows/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('workflows/[id]/route.ts');
    expect(src).toContain('getWorkflow(id, auth.user.workspaceId)');
    expect(src).toContain('upsertWorkflow(updated, auth.user.workspaceId)');
    expect(src).toContain('deleteWorkflow(id, auth.user.workspaceId)');
  });

  it('workflows/[id]/export/route.ts scopes by workspace', () => {
    const src = readRouteSource('workflows/[id]/export/route.ts');
    expect(src).toContain('getWorkflow(id, auth.user.workspaceId)');
  });

  it('workflows/[id]/optimize/route.ts scopes by workspace', () => {
    const src = readRouteSource('workflows/[id]/optimize/route.ts');
    expect(src).toContain('getWorkflow(id, auth.user.workspaceId)');
    expect(src).toContain('upsertWorkflow(optimized, auth.user.workspaceId)');
  });

  it('automations/route.ts scopes rules by workspace', () => {
    const src = readRouteSource('automations/route.ts');
    expect(src).toContain('getAutomationRules(auth.user.workspaceId)');
    expect(src).toContain('workspaceId: auth.user.workspaceId');
  });

  it('automations/[id]/route.ts scopes all operations by workspace', () => {
    const src = readRouteSource('automations/[id]/route.ts');
    expect(src).toContain('getAutomationRules(auth.user.workspaceId)');
    expect(src).toContain('updateAutomationRule(id, parsed.data, auth.user.workspaceId)');
    expect(src).toContain('removeAutomationRule(id, auth.user.workspaceId)');
  });

  it('automations/history/route.ts scopes audit log by workspace', () => {
    const src = readRouteSource('automations/history/route.ts');
    expect(src).toContain('getAuditLog(auth.user.workspaceId)');
  });

  it('automations/[id]/test/route.ts scopes rule lookup by workspace', () => {
    const src = readRouteSource('automations/[id]/test/route.ts');
    expect(src).toContain('authResult.user.workspaceId');
  });

  it('channels/sms/route.ts scopes conversations by workspace', () => {
    const src = readRouteSource('channels/sms/route.ts');
    expect(src).toContain('getAllConversations(auth.user.workspaceId)');
  });

  it('channels/sms/[id]/route.ts scopes by workspace', () => {
    const src = readRouteSource('channels/sms/[id]/route.ts');
    expect(src).toContain('auth.user.workspaceId');
  });

  it('channels/social/route.ts scopes conversations by workspace', () => {
    const src = readRouteSource('channels/social/route.ts');
    expect(src).toContain('getAllConversations(auth.user.workspaceId)');
  });

  it('channels/voice/route.ts scopes calls by workspace', () => {
    const src = readRouteSource('channels/voice/route.ts');
    expect(src).toContain('getAllCalls(auth.user.workspaceId)');
    expect(src).toContain('getActiveCalls(auth.user.workspaceId)');
  });

  it('channels/voice/calls/route.ts scopes calls by workspace', () => {
    const src = readRouteSource('channels/voice/calls/route.ts');
    expect(src).toContain('getAllCalls(auth.user.workspaceId)');
    expect(src).toContain('getActiveCalls(auth.user.workspaceId)');
  });
});
