/**
 * Phase 2: Dual-Mode Data Layer Tests
 * Verifies that stores correctly implement the dual-mode pattern:
 * - DB path with withRls() for workspace-scoped queries
 * - JSONL/in-memory fallback when DB is unavailable
 * - CRUD operations work in JSONL mode without a database
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---- Source file reading helpers ----

function readSourceFile(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf-8');
}

// ============================================================
// Part A: Store pattern analysis (static code checks)
// ============================================================

describe('Phase 2: Dual-Mode Data Layer', () => {
  describe('Store pattern analysis', () => {
    const stores = [
      { name: 'AI Resolution Store', path: 'lib/ai/store.ts' },
      { name: 'Canned Response Store', path: 'lib/canned/canned-store.ts' },
      { name: 'Views Store', path: 'lib/views/store.ts' },
      { name: 'Tour Store', path: 'lib/tours/tour-store.ts' },
      { name: 'Message Store', path: 'lib/messages/message-store.ts' },
    ];

    for (const store of stores) {
      describe(store.name, () => {
        let source: string;

        beforeEach(() => {
          source = readSourceFile(store.path);
        });

        it('imports withRls from store-helpers', () => {
          expect(source).toMatch(/import\s+.*withRls.*from\s+['"].*store-helpers['"]/);
        });

        it('uses withRls() for DB operations', () => {
          // Every store should call withRls at least once for RLS-scoped queries
          expect(source).toMatch(/withRls\s*\(/);
        });

        it('has JSONL or in-memory fallback', () => {
          // Stores should have either readJsonlFile/writeJsonlFile imports or in-memory arrays/objects
          const hasJsonl = /readJsonlFile|writeJsonlFile/.test(source);
          const hasInMemory = /getInMemory|global\.__cliaas|(?:const|let)\s+\w+:\s+\w+(?:\[\])?\s*=\s*\[/.test(source);
          expect(
            hasJsonl || hasInMemory,
            `${store.name} should have JSONL or in-memory fallback`,
          ).toBe(true);
        });

        it('exports CRUD functions', () => {
          // Every store should export at least a getter function
          const hasGet = /export\s+(async\s+)?function\s+(get|list|save|create)/m.test(source);
          expect(hasGet, `${store.name} should export CRUD functions`).toBe(true);
        });
      });
    }
  });

  // ============================================================
  // Part B: store-helpers.ts module verification
  // ============================================================

  describe('store-helpers module', () => {
    let source: string;

    beforeEach(() => {
      source = readSourceFile('lib/store-helpers.ts');
    });

    it('exports withRls function', () => {
      expect(source).toMatch(/export\s+async\s+function\s+withRls/);
    });

    it('withRls sets SET LOCAL app.current_workspace_id', () => {
      expect(source).toContain('app.current_workspace_id');
      expect(source).toContain('SET LOCAL');
    });

    it('withRls optionally sets tenant_id', () => {
      expect(source).toContain('app.current_tenant_id');
    });

    it('withRls returns null on failure', () => {
      // The catch block should return null
      expect(source).toMatch(/catch\s*\{[^}]*return\s+null/s);
    });

    it('exports tryDb function', () => {
      expect(source).toMatch(/export\s+async\s+function\s+tryDb/);
    });

    it('tryDb checks for getDb', () => {
      expect(source).toContain('getDb');
    });

    it('tryDb returns null when DB is unavailable', () => {
      // The function should return null in the catch block
      const tryDbBlock = source.slice(source.indexOf('export async function tryDb'));
      expect(tryDbBlock).toMatch(/return\s+null/);
    });

    it('exports getDefaultWorkspaceId function', () => {
      expect(source).toMatch(/export\s+async\s+function\s+getDefaultWorkspaceId/);
    });
  });

  // ============================================================
  // Part C: AI Resolution Store — JSONL mode CRUD
  // ============================================================

  describe('AI Resolution Store (JSONL mode)', () => {
    // Reset global state before each test
    beforeEach(() => {
      global.__cliaasAIResolutions = undefined;
      global.__cliaasAIAgentConfig = undefined;
    });

    it('saveResolution stores to in-memory when DB is unavailable', { timeout: 15000 }, async () => {
      const { saveResolution } = await import('../lib/ai/store');
      // No DATABASE_URL set, so DB path fails and falls through to in-memory

      const record = {
        id: 'test-res-1',
        workspaceId: 'ws-test-001',
        ticketId: 'ticket-001',
        confidence: 0.85,
        suggestedReply: 'Test reply',
        kbArticlesUsed: ['kb-1'],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      const saved = await saveResolution(record);
      expect(saved.id).toBe('test-res-1');
      expect(saved.confidence).toBe(0.85);
      expect(saved.status).toBe('pending');
    });

    it('getResolution retrieves from in-memory', async () => {
      const { saveResolution, getResolution } = await import('../lib/ai/store');

      const record = {
        id: 'test-res-2',
        workspaceId: 'ws-test-001',
        ticketId: 'ticket-002',
        confidence: 0.90,
        suggestedReply: 'Another reply',
        kbArticlesUsed: [],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      await saveResolution(record);
      const found = await getResolution('test-res-2');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('test-res-2');
      expect(found!.suggestedReply).toBe('Another reply');
    });

    it('listResolutions filters by workspaceId', async () => {
      const { saveResolution, listResolutions } = await import('../lib/ai/store');

      await saveResolution({
        id: 'res-ws1',
        workspaceId: 'ws-001',
        ticketId: 't1',
        confidence: 0.8,
        suggestedReply: 'r1',
        kbArticlesUsed: [],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'res-ws2',
        workspaceId: 'ws-002',
        ticketId: 't2',
        confidence: 0.9,
        suggestedReply: 'r2',
        kbArticlesUsed: [],
        status: 'approved' as const,
        createdAt: new Date().toISOString(),
      });

      const result = await listResolutions({ workspaceId: 'ws-001' });
      expect(result.records.length).toBe(1);
      expect(result.records[0].workspaceId).toBe('ws-001');
      expect(result.total).toBe(1);
    });

    it('listResolutions filters by status', async () => {
      const { saveResolution, listResolutions } = await import('../lib/ai/store');

      await saveResolution({
        id: 'res-status1',
        workspaceId: 'ws-001',
        ticketId: 't1',
        confidence: 0.8,
        suggestedReply: 'r1',
        kbArticlesUsed: [],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'res-status2',
        workspaceId: 'ws-001',
        ticketId: 't2',
        confidence: 0.9,
        suggestedReply: 'r2',
        kbArticlesUsed: [],
        status: 'approved' as const,
        createdAt: new Date().toISOString(),
      });

      const result = await listResolutions({ status: 'approved' });
      expect(result.records.every(r => r.status === 'approved')).toBe(true);
    });

    it('updateResolutionStatus updates in-memory record', async () => {
      const { saveResolution, updateResolutionStatus } = await import('../lib/ai/store');

      await saveResolution({
        id: 'res-update',
        workspaceId: 'ws-001',
        ticketId: 't1',
        confidence: 0.8,
        suggestedReply: 'r1',
        kbArticlesUsed: [],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      });

      const updated = await updateResolutionStatus('res-update', 'approved', {
        finalReply: 'Approved reply',
        reviewedBy: 'agent-1',
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
      expect(updated!.finalReply).toBe('Approved reply');
    });

    it('getAgentConfig returns defaults when no config is saved', async () => {
      const { getAgentConfig } = await import('../lib/ai/store');

      const config = await getAgentConfig('ws-fresh');
      expect(config.workspaceId).toBe('ws-fresh');
      expect(config.enabled).toBe(false);
      expect(config.mode).toBe('suggest');
      expect(config.confidenceThreshold).toBe(0.7);
      expect(config.provider).toBe('claude');
    });

    it('saveAgentConfig persists and retrieves config', async () => {
      const { saveAgentConfig, getAgentConfig } = await import('../lib/ai/store');

      await saveAgentConfig({
        workspaceId: 'ws-cfg',
        enabled: true,
        mode: 'auto',
        confidenceThreshold: 0.9,
      });

      const config = await getAgentConfig('ws-cfg');
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('auto');
      expect(config.confidenceThreshold).toBe(0.9);
    });

    it('getResolutionStats computes in-memory stats correctly', async () => {
      const { saveResolution, getResolutionStats } = await import('../lib/ai/store');

      await saveResolution({
        id: 'stat1', workspaceId: 'ws-stats', ticketId: 't1', confidence: 0.8,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'auto_resolved' as const,
        createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'stat2', workspaceId: 'ws-stats', ticketId: 't2', confidence: 0.6,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'escalated' as const,
        createdAt: new Date().toISOString(),
      });
      await saveResolution({
        id: 'stat3', workspaceId: 'ws-stats', ticketId: 't3', confidence: 0.9,
        suggestedReply: 'r', kbArticlesUsed: [], status: 'approved' as const,
        createdAt: new Date().toISOString(),
      });

      const stats = await getResolutionStats('ws-stats');
      expect(stats.totalResolutions).toBe(3);
      expect(stats.aiResolved).toBe(2); // auto_resolved + approved
      expect(stats.escalated).toBe(1);
      expect(stats.resolutionRate).toBe(67); // Math.round(2/3 * 100)
      expect(stats.avgConfidence).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Part D: Canned Response Store — JSONL mode CRUD
  // ============================================================

  describe('Canned Response Store (JSONL mode)', () => {
    it('getCannedResponses returns default responses', async () => {
      const { getCannedResponses } = await import('../lib/canned/canned-store');
      const responses = await getCannedResponses();
      expect(responses.length).toBeGreaterThanOrEqual(1);
    });

    it('createCannedResponse creates a new response', async () => {
      const { createCannedResponse, getCannedResponse } = await import('../lib/canned/canned-store');

      const created = createCannedResponse({
        title: 'Test Response',
        body: 'This is a test response body',
        category: 'Testing',
        scope: 'shared',
        shortcut: '/test',
      });

      expect(created.id).toBeTruthy();
      expect(created.title).toBe('Test Response');
      expect(created.usageCount).toBe(0);
      expect(created.scope).toBe('shared');

      const found = getCannedResponse(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Test Response');
    });

    it('updateCannedResponse updates fields', async () => {
      const { createCannedResponse, updateCannedResponse } = await import('../lib/canned/canned-store');

      const created = createCannedResponse({
        title: 'Update Me',
        body: 'Original body',
      });

      const updated = updateCannedResponse(created.id, {
        title: 'Updated Title',
        body: 'Updated body',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.body).toBe('Updated body');
    });

    it('deleteCannedResponse removes a response', async () => {
      const { createCannedResponse, deleteCannedResponse, getCannedResponse } = await import('../lib/canned/canned-store');

      const created = createCannedResponse({
        title: 'Delete Me',
        body: 'To be deleted',
      });

      const deleted = deleteCannedResponse(created.id);
      expect(deleted).toBe(true);

      const found = getCannedResponse(created.id);
      expect(found).toBeUndefined();
    });

    it('getCannedResponses filters by category', async () => {
      const { createCannedResponse, getCannedResponses } = await import('../lib/canned/canned-store');

      createCannedResponse({ title: 'Cat A', body: 'body', category: 'Alpha' });
      createCannedResponse({ title: 'Cat B', body: 'body', category: 'Beta' });

      const filtered = await getCannedResponses({ category: 'Alpha' });
      expect(filtered.every(r => r.category === 'Alpha')).toBe(true);
    });

    it('getCannedResponses filters by search term', async () => {
      const { createCannedResponse, getCannedResponses } = await import('../lib/canned/canned-store');

      createCannedResponse({ title: 'Unique Banana Response', body: 'body' });

      const filtered = await getCannedResponses({ search: 'banana' });
      expect(filtered.some(r => r.title.includes('Banana'))).toBe(true);
    });

    it('incrementCannedUsage increments usage count', async () => {
      const { createCannedResponse, incrementCannedUsage, getCannedResponse } = await import('../lib/canned/canned-store');

      const created = createCannedResponse({ title: 'Use Me', body: 'body' });
      expect(created.usageCount).toBe(0);

      incrementCannedUsage(created.id);
      incrementCannedUsage(created.id);

      const found = getCannedResponse(created.id);
      expect(found!.usageCount).toBe(2);
    });
  });

  // ============================================================
  // Part E: Views Store — in-memory mode CRUD
  // ============================================================

  describe('Views Store (in-memory mode)', () => {
    it('listViews returns system views by default', async () => {
      const { listViews } = await import('../lib/views/store');
      const views = await listViews();
      expect(views.length).toBeGreaterThanOrEqual(4);
      expect(views.some(v => v.name === 'All Open')).toBe(true);
      expect(views.some(v => v.name === 'Pending')).toBe(true);
      expect(views.some(v => v.name === 'Urgent')).toBe(true);
    });

    it('createView creates a shared view', async () => {
      const { createView, getView } = await import('../lib/views/store');

      const view = createView({
        name: 'Test View',
        description: 'A test view',
        query: {
          conditions: [{ field: 'status', operator: 'is', value: 'open' }],
          combineMode: 'and',
          sort: { field: 'created_at', direction: 'desc' },
        },
      });

      expect(view.id).toBeTruthy();
      expect(view.name).toBe('Test View');
      expect(view.viewType).toBe('shared');
      expect(view.active).toBe(true);

      const found = getView(view.id);
      expect(found).toBeDefined();
    });

    it('updateView updates non-system views', async () => {
      const { createView, updateView } = await import('../lib/views/store');

      const view = createView({
        name: 'Update This',
        query: { conditions: [], combineMode: 'and', sort: { field: 'created_at', direction: 'desc' } },
      });

      const updated = updateView(view.id, { name: 'Updated Name' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
    });

    it('updateView rejects system view updates', async () => {
      const { updateView } = await import('../lib/views/store');

      // System view ID
      const result = updateView('system-all-open', { name: 'Hacked' });
      expect(result).toBeNull();
    });

    it('deleteView removes a non-system view', async () => {
      const { createView, deleteView, getView, listViews } = await import('../lib/views/store');

      // Add small delay to ensure unique Date.now()-based ID
      await new Promise(r => setTimeout(r, 5));
      const view = createView({
        name: 'Delete This Unique',
        query: { conditions: [], combineMode: 'and', sort: { field: 'created_at', direction: 'desc' } },
      });

      // Verify it was created
      const beforeDelete = getView(view.id);
      expect(beforeDelete, 'view should exist before delete').toBeDefined();
      expect(beforeDelete!.name).toBe('Delete This Unique');

      const deleted = deleteView(view.id);
      expect(deleted).toBe(true);

      const found = getView(view.id);
      expect(found).toBeUndefined();
    });

    it('deleteView rejects system view deletion', async () => {
      const { deleteView } = await import('../lib/views/store');

      const result = deleteView('system-all-open');
      expect(result).toBe(false);
    });

    it('listViews filters personal views by userId', async () => {
      const { createView, listViews } = await import('../lib/views/store');

      createView({
        name: 'My Personal View',
        query: { conditions: [], combineMode: 'and', sort: { field: 'created_at', direction: 'desc' } },
        viewType: 'personal',
        userId: 'user-abc',
      });

      const viewsForUser = await listViews('user-abc');
      expect(viewsForUser.some(v => v.name === 'My Personal View')).toBe(true);

      const viewsForOther = await listViews('user-xyz');
      expect(viewsForOther.some(v => v.name === 'My Personal View')).toBe(false);
    });
  });

  // ============================================================
  // Part F: Tour Store — JSONL mode CRUD
  // ============================================================

  describe('Tour Store (JSONL mode)', () => {
    it('getTours returns demo tours', async () => {
      const { getTours } = await import('../lib/tours/tour-store');
      const tours = await getTours();
      expect(tours.length).toBeGreaterThanOrEqual(1);
    });

    it('createTour creates a new tour', async () => {
      const { createTour, getTour } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Test Tour', targetUrlPattern: '/test*', priority: 5 });
      expect(tour.id).toBeTruthy();
      expect(tour.name).toBe('Test Tour');
      expect(tour.isActive).toBe(false);
      expect(tour.priority).toBe(5);

      const found = await getTour(tour.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Test Tour');
    });

    it('updateTour modifies fields', async () => {
      const { createTour, updateTour } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Modify Me' });
      const updated = updateTour(tour.id, { name: 'Modified', priority: 99 });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Modified');
      expect(updated!.priority).toBe(99);
    });

    it('deleteTour removes tour and its steps', async () => {
      const { createTour, deleteTour, getTour, addTourStep, getTourSteps } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Delete With Steps' });
      await addTourStep({ tourId: tour.id, targetSelector: '.btn', title: 'Click here' });

      const deleted = deleteTour(tour.id);
      expect(deleted).toBe(true);

      const found = await getTour(tour.id);
      expect(found).toBeUndefined();

      const steps = await getTourSteps(tour.id);
      expect(steps.length).toBe(0);
    });

    it('toggleTour flips isActive flag', async () => {
      const { createTour, toggleTour } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Toggle Me' });
      expect(tour.isActive).toBe(false);

      const toggled = await toggleTour(tour.id);
      expect(toggled!.isActive).toBe(true);

      const toggledBack = await toggleTour(tour.id);
      expect(toggledBack!.isActive).toBe(false);
    });

    it('addTourStep and getTourSteps work correctly', async () => {
      const { createTour, addTourStep, getTourSteps } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Steps Tour' });
      await addTourStep({ tourId: tour.id, targetSelector: '.step1', title: 'Step 1', body: 'First step' });
      await addTourStep({ tourId: tour.id, targetSelector: '.step2', title: 'Step 2', placement: 'top' });

      const steps = await getTourSteps(tour.id);
      expect(steps.length).toBe(2);
      expect(steps[0].title).toBe('Step 1');
      expect(steps[0].position).toBe(0);
      expect(steps[1].title).toBe('Step 2');
      expect(steps[1].position).toBe(1);
      expect(steps[1].placement).toBe('top');
    });

    it('upsertTourProgress creates and updates progress', async () => {
      const { createTour, upsertTourProgress, getTourProgress } = await import('../lib/tours/tour-store');

      const tour = createTour({ name: 'Progress Tour' });
      const progress = upsertTourProgress(tour.id, 'cust-1', { currentStep: 0 });
      expect(progress.status).toBe('in_progress');
      expect(progress.currentStep).toBe(0);

      const updated = upsertTourProgress(tour.id, 'cust-1', {
        currentStep: 2,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      expect(updated.currentStep).toBe(2);
      expect(updated.status).toBe('completed');

      const found = await getTourProgress(tour.id, 'cust-1');
      expect(found).toBeDefined();
      expect(found!.status).toBe('completed');
    });
  });

  // ============================================================
  // Part G: Message Store — JSONL mode CRUD
  // ============================================================

  describe('Message Store (JSONL mode)', () => {
    it('getMessages returns demo messages', async () => {
      const { getMessages } = await import('../lib/messages/message-store');
      const messages = await getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('createMessage creates a new message', async () => {
      const { createMessage, getMessage } = await import('../lib/messages/message-store');

      const msg = createMessage({
        name: 'Test Banner',
        messageType: 'banner',
        title: 'Test Title',
        body: 'Test body text',
        priority: 5,
      });

      expect(msg.id).toBeTruthy();
      expect(msg.name).toBe('Test Banner');
      expect(msg.messageType).toBe('banner');
      expect(msg.isActive).toBe(false);
      expect(msg.priority).toBe(5);

      const found = await getMessage(msg.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Test Banner');
    });

    it('updateMessage modifies fields', async () => {
      const { createMessage, updateMessage } = await import('../lib/messages/message-store');

      const msg = createMessage({ name: 'Update Me', messageType: 'modal', title: 'Old Title' });
      const updated = updateMessage(msg.id, { title: 'New Title', isActive: true });
      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('New Title');
      expect(updated!.isActive).toBe(true);
    });

    it('deleteMessage removes message and its impressions', async () => {
      const { createMessage, deleteMessage, getMessage, recordImpression } = await import('../lib/messages/message-store');

      const msg = createMessage({ name: 'Delete Me', messageType: 'tooltip', title: 'Temp' });
      recordImpression(msg.id, 'cust-1', 'displayed');

      const deleted = deleteMessage(msg.id);
      expect(deleted).toBe(true);

      const found = await getMessage(msg.id);
      expect(found).toBeUndefined();
    });

    it('toggleMessage flips isActive flag', async () => {
      const { createMessage, toggleMessage } = await import('../lib/messages/message-store');

      const msg = createMessage({ name: 'Toggle Me', messageType: 'banner', title: 'Toggle' });
      expect(msg.isActive).toBe(false);

      const toggled = await toggleMessage(msg.id);
      expect(toggled!.isActive).toBe(true);
    });

    it('recordImpression and getImpressionCount work correctly', async () => {
      const { createMessage, recordImpression, getImpressionCount } = await import('../lib/messages/message-store');

      const msg = createMessage({ name: 'Impression Test', messageType: 'banner', title: 'Imp' });

      recordImpression(msg.id, 'cust-x', 'displayed');
      recordImpression(msg.id, 'cust-x', 'displayed');
      recordImpression(msg.id, 'cust-x', 'clicked'); // not counted as display

      const count = await getImpressionCount(msg.id, 'cust-x');
      expect(count).toBe(2);
    });

    it('getMessageAnalytics returns correct counts', async () => {
      const { createMessage, recordImpression, getMessageAnalytics } = await import('../lib/messages/message-store');

      const msg = createMessage({ name: 'Analytics Test', messageType: 'modal', title: 'Analytics' });

      recordImpression(msg.id, 'c1', 'displayed');
      recordImpression(msg.id, 'c2', 'displayed');
      recordImpression(msg.id, 'c1', 'dismissed');
      recordImpression(msg.id, 'c1', 'cta_clicked');

      const analytics = await getMessageAnalytics(msg.id);
      expect(analytics.messageId).toBe(msg.id);
      expect(analytics.displayed).toBe(2);
      expect(analytics.dismissed).toBe(1);
      expect(analytics.ctaClicked).toBe(1);
      expect(analytics.clicked).toBe(0);
    });
  });

  // ============================================================
  // Part H: withRls behavior verification (unit level)
  // ============================================================

  describe('withRls fallback behavior', () => {
    it('withRls returns null when DB module is unavailable', async () => {
      // In test environment, no DATABASE_URL is set, so getRlsDb() should fail
      // and withRls should return null
      const { withRls } = await import('../lib/store-helpers');

      const result = await withRls('ws-test', async ({ db, schema }) => {
        // This should never execute
        return 'should-not-reach';
      });

      expect(result).toBeNull();
    });

    it('tryDb returns null when DB module is unavailable', async () => {
      const { tryDb } = await import('../lib/store-helpers');

      const result = await tryDb();
      // In test environment without DATABASE_URL, should be null
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // Part I: Macro Store pattern (additional dual-mode store)
  // ============================================================

  describe('Macro Store pattern verification', () => {
    let source: string;

    beforeEach(() => {
      source = readSourceFile('lib/canned/macro-store.ts');
    });

    it('imports withRls', () => {
      expect(source).toMatch(/withRls/);
    });

    it('uses JSONL persistence', () => {
      expect(source).toMatch(/readJsonlFile|writeJsonlFile/);
    });

    it('has in-memory array fallback', () => {
      expect(source).toMatch(/const\s+macros:\s+Macro\[\]\s*=\s*\[\]/);
    });
  });
});
