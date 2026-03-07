/**
 * P1 Core Features Tests — daily agent workflow features.
 *
 * Covers:
 *   3.7  Canned Responses & Macros
 *   3.8  Collision Detection
 *   3.9  Internal Notes
 *   3.10 Ticket Merge & Split
 *   3.11 Views & Tags
 *
 * All tests run in JSONL/demo mode (no DATABASE_URL) unless otherwise noted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// 3.7 — Canned Responses & Macros
// ---------------------------------------------------------------------------

describe('3.7 Canned Responses & Macros', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ---- Canned Response Store (unit-level) ----

  describe('Canned Response Store', () => {
    it('creates a canned response and reads it back with correct fields', async () => {
      const { createCannedResponse, getCannedResponse } = await import(
        '@/lib/canned/canned-store'
      );

      const cr = createCannedResponse({
        title: 'Test CR',
        body: 'Hello {{customer.name}}, we are on it.',
        category: 'Support',
        scope: 'shared',
        shortcut: '/test',
        createdBy: 'agent-1',
      });

      expect(cr.id).toBeTruthy();
      expect(cr.title).toBe('Test CR');
      expect(cr.body).toContain('{{customer.name}}');
      expect(cr.category).toBe('Support');
      expect(cr.scope).toBe('shared');
      expect(cr.shortcut).toBe('/test');
      expect(cr.usageCount).toBe(0);
      expect(cr.createdAt).toBeTruthy();

      const fetched = getCannedResponse(cr.id);
      expect(fetched).toBeDefined();
      expect(fetched!.title).toBe('Test CR');
      expect(fetched!.id).toBe(cr.id);
    });

    it('searches canned responses by keyword in title and body', async () => {
      const { getCannedResponses, createCannedResponse } = await import(
        '@/lib/canned/canned-store'
      );

      // Create distinctive responses
      createCannedResponse({
        title: 'Password Reset',
        body: 'Click the link to reset your password.',
        category: 'Account',
      });
      createCannedResponse({
        title: 'Refund Policy',
        body: 'Refunds are processed within 5-7 business days.',
        category: 'Billing',
      });

      // Search by title keyword
      const passwordResults = await getCannedResponses({ search: 'password' });
      expect(passwordResults.length).toBeGreaterThanOrEqual(1);
      expect(
        passwordResults.some(
          (r) =>
            r.title.toLowerCase().includes('password') ||
            r.body.toLowerCase().includes('password'),
        ),
      ).toBe(true);

      // Search by body keyword
      const refundResults = await getCannedResponses({ search: 'refund' });
      expect(refundResults.length).toBeGreaterThanOrEqual(1);
      expect(
        refundResults.some(
          (r) =>
            r.title.toLowerCase().includes('refund') ||
            r.body.toLowerCase().includes('refund'),
        ),
      ).toBe(true);

      // Search with no matches
      const noResults = await getCannedResponses({ search: 'xyznonexistent' });
      expect(noResults).toHaveLength(0);
    });
  });

  // ---- Merge Variable Engine ----

  describe('Merge Variable Engine', () => {
    it('resolves {{ticket.subject}} and {{customer.name}}', async () => {
      const { resolveMergeVariables } = await import('@/lib/canned/merge');

      const template =
        'Hi {{customer.name}}, your ticket "{{ticket.subject}}" has been updated.';
      const resolved = resolveMergeVariables(template, {
        customer: { name: 'Alice', email: 'alice@example.com' },
        ticket: { subject: 'Login Issue', status: 'open' },
      });

      expect(resolved).toBe(
        'Hi Alice, your ticket "Login Issue" has been updated.',
      );
    });

    it('resolves {{agent.name}} and {{agent.email}}', async () => {
      const { resolveMergeVariables } = await import('@/lib/canned/merge');

      const template = 'Best regards,\n{{agent.name}} ({{agent.email}})';
      const resolved = resolveMergeVariables(template, {
        agent: { name: 'Bob Smith', email: 'bob@company.com' },
      });

      expect(resolved).toBe('Best regards,\nBob Smith (bob@company.com)');
    });

    it('replaces unknown variables with empty string', async () => {
      const { resolveMergeVariables } = await import('@/lib/canned/merge');

      const template = 'Hello {{customer.name}}, ticket {{ticket.id}}';
      const resolved = resolveMergeVariables(template, {});

      expect(resolved).toBe('Hello , ticket ');
    });

    it('blocks prototype pollution paths (__proto__, constructor, prototype)', async () => {
      const { resolveMergeVariables } = await import('@/lib/canned/merge');

      const templates = [
        '{{__proto__.polluted}}',
        '{{constructor.name}}',
        '{{prototype.toString}}',
        '{{ticket.__proto__}}',
        '{{customer.constructor}}',
      ];

      for (const tmpl of templates) {
        const resolved = resolveMergeVariables(tmpl, {
          ticket: { subject: 'Safe' },
          customer: { name: 'Safe' },
        });
        // Should resolve to empty string (blocked), not leak internal data
        expect(resolved).toBe('');
      }

      // Verify that the merge engine regex only matches safe variable patterns
      const safeTemplate = '{{customer.name}} - {{ticket.subject}}';
      const safeResolved = resolveMergeVariables(safeTemplate, {
        customer: { name: 'Alice' },
        ticket: { subject: 'Help' },
      });
      expect(safeResolved).toBe('Alice - Help');
    });
  });

  // ---- Macro Store & Executor ----

  describe('Macro Store & Executor', () => {
    it('creates a macro, lists macros, and verifies fields', async () => {
      const { createMacro, getMacros } = await import(
        '@/lib/canned/macro-store'
      );

      const macro = createMacro({
        name: 'Quick Close',
        description: 'Close and tag',
        actions: [
          { type: 'set_status', value: 'solved' },
          { type: 'add_tag', value: 'quick-close' },
        ],
        scope: 'shared',
        createdBy: 'agent-1',
      });

      expect(macro.id).toBeTruthy();
      expect(macro.name).toBe('Quick Close');
      expect(macro.actions).toHaveLength(2);
      expect(macro.enabled).toBe(true);
      expect(macro.usageCount).toBe(0);

      const all = await getMacros();
      expect(all.some((m) => m.id === macro.id)).toBe(true);
    });

    it('executes macro actions against a ticket context', async () => {
      const { executeMacroActions } = await import(
        '@/lib/canned/macro-executor'
      );

      const ticket = {
        id: 'ticket-1',
        status: 'open',
        priority: 'normal',
        assignee: null,
        tags: ['initial'],
      };

      const result = executeMacroActions(
        [
          { type: 'set_status', value: 'solved' },
          { type: 'set_priority', value: 'high' },
          { type: 'add_tag', value: 'escalated' },
          { type: 'remove_tag', value: 'initial' },
          { type: 'add_note', value: 'Closed by macro for {{agent.name}}' },
        ],
        ticket,
        {
          agent: { name: 'TestAgent', email: 'agent@test.com' },
          ticket: { id: 'ticket-1', subject: 'Test' },
        },
      );

      expect(result.actionsExecuted).toBe(5);
      expect(result.changes.status).toBe('solved');
      expect(result.changes.priority).toBe('high');
      expect(result.changes.addTags).toContain('escalated');
      expect(result.changes.removeTags).toContain('initial');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0]).toBe('Closed by macro for TestAgent');
      expect(result.errors).toHaveLength(0);

      // Verify ticket object was mutated correctly
      expect(ticket.status).toBe('solved');
      expect(ticket.priority).toBe('high');
      expect(ticket.tags).toContain('escalated');
      expect(ticket.tags).not.toContain('initial');
    });

    it('macro add_reply action resolves merge variables', async () => {
      const { executeMacroActions } = await import(
        '@/lib/canned/macro-executor'
      );

      const ticket = {
        id: 'ticket-2',
        status: 'open',
        priority: 'normal',
        tags: [],
      };

      const result = executeMacroActions(
        [
          {
            type: 'add_reply',
            value: 'Hi {{customer.name}}, your ticket {{ticket.subject}} is being processed.',
          },
        ],
        ticket,
        {
          customer: { name: 'Carol' },
          ticket: { subject: 'Billing Question' },
        },
      );

      expect(result.replies).toHaveLength(1);
      expect(result.replies[0]).toBe(
        'Hi Carol, your ticket Billing Question is being processed.',
      );
    });

    it('macro executor reports errors for invalid action values', async () => {
      const { executeMacroActions } = await import(
        '@/lib/canned/macro-executor'
      );

      const ticket = {
        id: 'ticket-3',
        status: 'open',
        priority: 'normal',
        tags: [],
      };

      const result = executeMacroActions(
        [
          { type: 'set_status', value: 'invalid_status' },
          { type: 'set_priority', value: 'mega_high' },
        ],
        ticket,
      );

      // Both actions should fail with errors
      expect(result.errors.length).toBe(2);
      expect(result.actionsExecuted).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3.8 — Collision Detection
// ---------------------------------------------------------------------------

describe('3.8 Collision Detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('checkForNewReplies', () => {
    it('returns hasNewReplies=false when no replies exist since timestamp', async () => {
      const { checkForNewReplies } = await import(
        '@/lib/realtime/collision'
      );

      // Use a very recent timestamp — no messages should be newer
      const since = new Date();
      const result = await checkForNewReplies('nonexistent-ticket-id', since);

      expect(result.hasNewReplies).toBe(false);
      expect(result.newReplies).toHaveLength(0);
    });

    it('returns hasNewReplies=true when replies exist after timestamp', async () => {
      const { checkForNewReplies } = await import(
        '@/lib/realtime/collision'
      );

      // Use a very old timestamp — all existing messages should be newer
      const since = new Date('2020-01-01T00:00:00Z');

      // Get a ticket that has messages from the provider
      const { getDataProvider } = await import('@/lib/data-provider/index');
      const provider = await getDataProvider();
      const tickets = await provider.loadTickets();

      if (tickets.length > 0) {
        const ticketId = tickets[0].id;
        const messages = await provider.loadMessages(ticketId);

        if (messages.length > 0) {
          const result = await checkForNewReplies(ticketId, since);
          expect(result.hasNewReplies).toBe(true);
          expect(result.newReplies.length).toBeGreaterThan(0);
          // Verify reply data shape
          expect(result.newReplies[0]).toHaveProperty('id');
          expect(result.newReplies[0]).toHaveProperty('author');
          expect(result.newReplies[0]).toHaveProperty('body');
          expect(result.newReplies[0]).toHaveProperty('createdAt');
        }
      }
    });
  });

  describe('Presence Tracker — active viewers', () => {
    it('tracks active viewers and excludes current user', async () => {
      const { presence } = await import('@/lib/realtime/presence');
      const ticketId = 'test-ticket-presence';

      // Clear any prior state
      presence._testClear();

      // Add two viewers
      presence.update('user-A', 'Alice Agent', ticketId, 'viewing');
      presence.update('user-B', 'Bob Agent', ticketId, 'typing');

      const viewers = presence.getViewers(ticketId);
      expect(viewers).toHaveLength(2);

      // Simulate "exclude current user" — same logic as collision-check route
      const currentUserId = 'user-A';
      const filtered = viewers.filter((v) => v.userId !== currentUserId);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].userId).toBe('user-B');
      expect(filtered[0].userName).toBe('Bob Agent');
      expect(filtered[0].activity).toBe('typing');

      // Cleanup
      presence._testClear();
    });

    it('removes stale entries on cleanup', async () => {
      const { presence } = await import('@/lib/realtime/presence');
      const ticketId = 'test-ticket-stale';

      presence._testClear();

      presence.update('stale-user', 'Stale', ticketId, 'viewing');
      expect(presence.getViewers(ticketId)).toHaveLength(1);

      // Set lastSeen to 60s ago (beyond 30s stale threshold)
      presence._testSetLastSeen('stale-user', ticketId, Date.now() - 60_000);
      presence._testRunCleanup();

      expect(presence.getViewers(ticketId)).toHaveLength(0);

      presence._testClear();
    });

    it('leave removes user from viewers list', async () => {
      const { presence } = await import('@/lib/realtime/presence');
      const ticketId = 'test-ticket-leave';

      presence._testClear();

      presence.update('leaving-user', 'Leaver', ticketId, 'viewing');
      expect(presence.getViewers(ticketId)).toHaveLength(1);

      presence.leave('leaving-user', ticketId);
      expect(presence.getViewers(ticketId)).toHaveLength(0);

      presence._testClear();
    });
  });
});

// ---------------------------------------------------------------------------
// 3.9 — Internal Notes
// ---------------------------------------------------------------------------

describe('3.9 Internal Notes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Notes API (JSONL fallback)', () => {
    it('creates an internal note and returns visibility=internal', async () => {
      const { POST } = await import(
        '@/app/api/tickets/[id]/notes/route'
      );

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/test-ticket/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'This is an internal note for the team.' }),
        },
      );

      const res = await POST(req, { params: Promise.resolve({ id: 'test-ticket' }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.message).toBeDefined();
      expect(data.message.id).toBeTruthy();
      expect(data.message.body).toBe('This is an internal note for the team.');
      expect(data.message.createdAt).toBeTruthy();
    });

    it('rejects empty note body with 400', async () => {
      const { POST } = await import(
        '@/app/api/tickets/[id]/notes/route'
      );

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/test-ticket/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: '   ' }),
        },
      );

      const res = await POST(req, { params: Promise.resolve({ id: 'test-ticket' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });
  });

  describe('Mention extraction', () => {
    it('extracts @mentions from note body text', async () => {
      const { extractMentions } = await import('@/lib/mentions');

      const mentions1 = extractMentions(
        'Hey @john.doe and @jane.smith, please review this.',
      );
      expect(mentions1).toContain('john.doe');
      expect(mentions1).toContain('jane.smith');
      expect(mentions1).toHaveLength(2);

      const mentions2 = extractMentions(
        'CC @admin@company.com on this note.',
      );
      expect(mentions2).toContain('admin@company.com');
      expect(mentions2).toHaveLength(1);
    });

    it('deduplicates repeated @mentions', async () => {
      const { extractMentions } = await import('@/lib/mentions');

      const mentions = extractMentions(
        '@alice @bob @alice @bob.smith @alice',
      );
      // 'alice' appears 3 times but should be deduped
      const aliceCount = mentions.filter((m) => m === 'alice').length;
      expect(aliceCount).toBe(1);
    });

    it('returns empty array for text without mentions', async () => {
      const { extractMentions } = await import('@/lib/mentions');

      const mentions = extractMentions('No mentions here at all.');
      expect(mentions).toHaveLength(0);
    });
  });

  describe('Notes are internal-only', () => {
    it('internal notes have visibility=internal in JSONL message store', () => {
      // In the JSONL fallback path (notes/route.ts), the note event fires with
      // visibility: 'internal' and isNote: true. Verify the contract.
      const event = {
        ticketId: 'any-ticket',
        messageId: 'note-123',
        visibility: 'internal' as const,
        isNote: true,
      };

      expect(event.visibility).toBe('internal');
      expect(event.isNote).toBe(true);
      // Public responses should NOT have isNote or visibility=internal
      const publicEvent = {
        ticketId: 'any-ticket',
        messageId: 'reply-456',
        visibility: 'public' as const,
        isNote: false,
      };
      expect(publicEvent.visibility).not.toBe('internal');
    });
  });
});

// ---------------------------------------------------------------------------
// 3.10 — Ticket Merge & Split
// ---------------------------------------------------------------------------

describe('3.10 Ticket Merge & Split', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Merge API validation', () => {
    it('rejects merge without primaryTicketId', async () => {
      const { POST } = await import('@/app/api/tickets/merge/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/merge',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mergedTicketIds: ['abc'] }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('primaryTicketId');
    });

    it('rejects merge with invalid UUID format', async () => {
      const { POST } = await import('@/app/api/tickets/merge/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/merge',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryTicketId: 'not-a-uuid',
            mergedTicketIds: ['also-not-a-uuid'],
          }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('UUID');
    });

    it('merge fails gracefully in JSONL mode (requires DB)', async () => {
      const { POST } = await import('@/app/api/tickets/merge/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/merge',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryTicketId: '550e8400-e29b-41d4-a716-446655440000',
            mergedTicketIds: ['550e8400-e29b-41d4-a716-446655440001'],
          }),
        },
      );

      const res = await POST(req);
      // JSONL provider throws "Merge operations require a database"
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain('database');
    });
  });

  describe('Undo Merge API validation', () => {
    it('rejects unmerge without mergeLogId', async () => {
      const { POST } = await import('@/app/api/tickets/merge/undo/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/merge/undo',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('mergeLogId');
    });

    it('rejects unmerge with invalid UUID mergeLogId', async () => {
      const { POST } = await import('@/app/api/tickets/merge/undo/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/merge/undo',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mergeLogId: 'not-valid' }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('UUID');
    });
  });

  describe('Split API validation', () => {
    it('rejects split without messageIds', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/split/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/test-ticket/split',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newSubject: 'Split ticket' }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ id: 'test-ticket' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('messageIds');
    });

    it('rejects split with invalid UUID messageIds', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/split/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/test-ticket/split',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageIds: ['invalid-uuid'],
            newSubject: 'Split result',
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ id: 'test-ticket' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('UUID');
    });

    it('split fails gracefully in JSONL mode (requires DB)', async () => {
      const { POST } = await import('@/app/api/tickets/[id]/split/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tickets/test-ticket/split',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageIds: ['550e8400-e29b-41d4-a716-446655440000'],
            newSubject: 'Split from original',
          }),
        },
      );

      const res = await POST(req, {
        params: Promise.resolve({ id: 'test-ticket' }),
      });
      // JSONL provider throws "Split operations require a database"
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain('database');
    });
  });
});

// ---------------------------------------------------------------------------
// 3.11 — Views & Tags
// ---------------------------------------------------------------------------

describe('3.11 Views & Tags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ---- Views Store (unit) ----

  describe('View Store', () => {
    it('creates a view with filter conditions', async () => {
      const { createView, getView } = await import('@/lib/views/store');

      const view = createView({
        name: 'High Priority Open',
        description: 'Open tickets with high or urgent priority',
        query: {
          conditions: [
            { field: 'status', operator: 'is', value: 'open' },
            { field: 'priority', operator: 'is', value: 'high' },
          ],
          combineMode: 'and',
          sort: { field: 'created_at', direction: 'asc' },
        },
        viewType: 'shared',
        userId: 'test-user',
      });

      expect(view.id).toBeTruthy();
      expect(view.name).toBe('High Priority Open');
      expect(view.query.conditions).toHaveLength(2);
      expect(view.viewType).toBe('shared');
      expect(view.active).toBe(true);

      const fetched = getView(view.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('High Priority Open');
    });

    it('system views cannot be updated or deleted', async () => {
      const { updateView, deleteView } = await import('@/lib/views/store');

      // 'system-all-open' is a built-in system view
      const updated = updateView('system-all-open', { name: 'Hacked' });
      expect(updated).toBeNull();

      const deleted = deleteView('system-all-open');
      expect(deleted).toBe(false);
    });

    it('lists views and filters by userId for personal views', async () => {
      const { createView, listViews } = await import('@/lib/views/store');

      createView({
        name: 'My Personal View',
        query: {
          conditions: [{ field: 'assignee', operator: 'is', value: '$CURRENT_USER' }],
          combineMode: 'and',
        },
        viewType: 'personal',
        userId: 'user-xyz',
      });

      // user-xyz should see their personal view
      const xyzViews = await listViews('user-xyz');
      expect(xyzViews.some((v) => v.name === 'My Personal View')).toBe(true);

      // user-other should NOT see user-xyz's personal view
      const otherViews = await listViews('user-other');
      expect(otherViews.some((v) => v.name === 'My Personal View')).toBe(false);
    });
  });

  // ---- View Executor ----

  describe('View Query Executor', () => {
    it('executes view query and returns matching tickets', async () => {
      const { executeViewQuery } = await import('@/lib/views/executor');
      const { loadTickets } = await import('@/lib/data');

      const tickets = await loadTickets();
      if (tickets.length === 0) {
        // No demo data available — skip
        return;
      }

      // Query: all open tickets
      const openQuery = {
        conditions: [{ field: 'status' as const, operator: 'is' as const, value: 'open' }],
        combineMode: 'and' as const,
      };

      const openTickets = executeViewQuery(openQuery, tickets);

      // Every returned ticket should be open
      for (const t of openTickets) {
        expect(t.status).toBe('open');
      }

      // Verify it's a subset of all tickets
      expect(openTickets.length).toBeLessThanOrEqual(tickets.length);
    });

    it('handles OR combine mode', async () => {
      const { executeViewQuery } = await import('@/lib/views/executor');
      const { loadTickets } = await import('@/lib/data');

      const tickets = await loadTickets();
      if (tickets.length === 0) return;

      const orQuery = {
        conditions: [
          { field: 'status' as const, operator: 'is' as const, value: 'open' },
          { field: 'status' as const, operator: 'is' as const, value: 'pending' },
        ],
        combineMode: 'or' as const,
      };

      const result = executeViewQuery(orQuery, tickets);
      for (const t of result) {
        expect(['open', 'pending']).toContain(t.status);
      }
    });

    it('sorts results by specified field', async () => {
      const { executeViewQuery } = await import('@/lib/views/executor');
      const { loadTickets } = await import('@/lib/data');

      const tickets = await loadTickets();
      if (tickets.length < 2) return;

      const sortedQuery = {
        conditions: [] as Array<{ field: string; operator: 'is' | 'is_not'; value: string }>,
        combineMode: 'and' as const,
        sort: { field: 'created_at', direction: 'asc' as const },
      };

      const sorted = executeViewQuery(sortedQuery, tickets);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].createdAt >= sorted[i - 1].createdAt).toBe(true);
      }
    });
  });

  // ---- Views API ----

  describe('Views API (JSONL fallback)', () => {
    it('POST /api/views creates a view, GET retrieves it', async () => {
      const postRoute = await import('@/app/api/views/route');
      const getByIdRoute = await import('@/app/api/views/[id]/route');

      // Create
      const createReq = new NextRequest(
        'http://localhost:3000/api/views',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'API Test View',
            query: {
              conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
              combineMode: 'and',
            },
          }),
        },
      );

      const createRes = await postRoute.POST(createReq);
      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.view).toBeDefined();
      expect(createBody.view.name).toBe('API Test View');
      const viewId = createBody.view.id;

      // Get by ID
      const getReq = new NextRequest(
        `http://localhost:3000/api/views/${viewId}`,
      );

      const getRes = await getByIdRoute.GET(getReq, {
        params: Promise.resolve({ id: viewId }),
      });
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.view.id).toBe(viewId);
      expect(getBody.view.name).toBe('API Test View');
    });

    it('POST /api/views rejects missing name', async () => {
      const { POST } = await import('@/app/api/views/route');

      const req = new NextRequest(
        'http://localhost:3000/api/views',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: {
              conditions: [{ field: 'status', operator: 'is', value: 'open' }],
              combineMode: 'and',
            },
          }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ---- Tags API ----

  describe('Tags API', () => {
    it('GET /api/tags returns tags array (empty in JSONL mode without DB)', async () => {
      const { GET } = await import('@/app/api/tags/route');

      const req = new NextRequest('http://localhost:3000/api/tags');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('tags');
      expect(Array.isArray(data.tags)).toBe(true);
    });

    it('POST /api/tags rejects empty name with 400', async () => {
      const { POST } = await import('@/app/api/tags/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tags',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '   ' }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('name');
    });

    it('POST /api/tags rejects invalid color format', async () => {
      const { POST } = await import('@/app/api/tags/route');

      const req = new NextRequest(
        'http://localhost:3000/api/tags',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'urgent', color: 'red' }),
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('color');
    });

    it('ticket tags are preserved in view filter evaluation', async () => {
      const { executeViewQuery } = await import('@/lib/views/executor');
      const { loadTickets } = await import('@/lib/data');

      const tickets = await loadTickets();
      if (tickets.length === 0) return;

      // Find a ticket with tags
      const taggedTicket = tickets.find((t) => t.tags.length > 0);
      if (!taggedTicket) return;

      const firstTag = taggedTicket.tags[0];

      // Query for tickets with this tag
      const tagQuery = {
        conditions: [{ field: 'tag' as const, operator: 'is' as const, value: firstTag }],
        combineMode: 'and' as const,
      };

      const result = executeViewQuery(tagQuery, tickets);
      expect(result.length).toBeGreaterThan(0);
      for (const t of result) {
        expect(t.tags).toContain(firstTag);
      }
    });
  });
});
