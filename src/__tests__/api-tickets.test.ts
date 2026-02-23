import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestToken, TEST_USER } from './helpers';

describe('Tickets API routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure demo mode (no database)
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // -- GET /api/tickets --

  describe('GET /api/tickets', () => {
    it('returns 200 with tickets array and pagination metadata', async () => {
      const { GET } = await import('@/app/api/tickets/route');
      const req = new NextRequest('http://localhost:3000/api/tickets');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('tickets');
      expect(Array.isArray(body.tickets)).toBe(true);
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');
      expect(typeof body.total).toBe('number');
    });

    it('respects limit and offset query parameters', async () => {
      const { GET } = await import('@/app/api/tickets/route');
      const req = new NextRequest('http://localhost:3000/api/tickets?limit=2&offset=0');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(0);
      expect(body.tickets.length).toBeLessThanOrEqual(2);
    });

    it('filters tickets by status query parameter', async () => {
      const { GET } = await import('@/app/api/tickets/route');

      // First get all tickets to know what statuses exist
      const allReq = new NextRequest('http://localhost:3000/api/tickets');
      const allRes = await GET(allReq);
      const allBody = await allRes.json();

      if (allBody.total > 0) {
        const firstStatus = allBody.tickets[0].status;
        const filteredReq = new NextRequest(
          `http://localhost:3000/api/tickets?status=${firstStatus}`,
        );
        const filteredRes = await GET(filteredReq);
        const filteredBody = await filteredRes.json();

        // All returned tickets should have the filtered status
        for (const ticket of filteredBody.tickets) {
          expect(ticket.status).toBe(firstStatus);
        }
      }
    });

    it('supports text search via q parameter', async () => {
      const { GET } = await import('@/app/api/tickets/route');
      // Use a query that is unlikely to match anything
      const req = new NextRequest(
        'http://localhost:3000/api/tickets?q=zzz_nonexistent_query_zzz',
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tickets).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  // -- GET /api/tickets/[id] --

  describe('GET /api/tickets/[id]', () => {
    it('returns 404 for a non-existent ticket', async () => {
      const { GET } = await import('@/app/api/tickets/[id]/route');
      const req = new Request('http://localhost:3000/api/tickets/nonexistent-id');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'nonexistent-id' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });

    it('returns ticket and messages for a valid ticket id', async () => {
      // First get a real ticket ID from the list
      const { GET: listGET } = await import('@/app/api/tickets/route');
      const listReq = new NextRequest('http://localhost:3000/api/tickets?limit=1');
      const listRes = await listGET(listReq);
      const listBody = await listRes.json();

      if (listBody.tickets.length > 0) {
        const ticketId = listBody.tickets[0].id;
        const { GET } = await import('@/app/api/tickets/[id]/route');
        const req = new Request(`http://localhost:3000/api/tickets/${ticketId}`);
        const res = await GET(req, {
          params: Promise.resolve({ id: ticketId }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ticket).toBeDefined();
        expect(body.ticket.id).toBe(ticketId);
        expect(body).toHaveProperty('messages');
        expect(Array.isArray(body.messages)).toBe(true);
      }
    });
  });

  // -- PATCH /api/tickets/[id] --

  describe('PATCH /api/tickets/[id]', () => {
    it('returns 400 when no updates are provided', async () => {
      const { PATCH } = await import('@/app/api/tickets/[id]/route');
      const req = new Request('http://localhost:3000/api/tickets/zd-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: 'zd-123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/no updates/i);
    });

    it('returns 400 for invalid status values', async () => {
      const { PATCH } = await import('@/app/api/tickets/[id]/route');
      const req = new Request('http://localhost:3000/api/tickets/zd-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'invalid_status' }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: 'zd-123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid status/i);
    });

    it('returns 400 for invalid priority values', async () => {
      const { PATCH } = await import('@/app/api/tickets/[id]/route');
      const req = new Request('http://localhost:3000/api/tickets/zd-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'mega_urgent' }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: 'zd-123' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid priority/i);
    });

    it('returns 400 when connector is not configured', async () => {
      // Zendesk is not configured in test env, so zd- prefix should fail
      const { PATCH } = await import('@/app/api/tickets/[id]/route');
      const req = new Request('http://localhost:3000/api/tickets/zd-999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'solved' }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: 'zd-999' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });
  });

  // -- POST /api/tickets/create --

  describe('POST /api/tickets/create', () => {
    it('returns 400 when source or message is missing', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const req = new Request('http://localhost:3000/api/tickets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'zendesk' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/required/i);
    });

    it('returns 400 for invalid source', async () => {
      const { POST } = await import('@/app/api/tickets/create/route');
      const req = new Request('http://localhost:3000/api/tickets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'invalid_source', message: 'Help!' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid source/i);
    });
  });
});
