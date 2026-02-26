import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock events
vi.mock('@/lib/events', () => ({
  surveySubmitted: vi.fn(),
  dispatch: vi.fn(),
}));

// Mock DB
vi.mock('@/db', () => ({
  db: null,
}));

// Mock data provider
vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: vi.fn().mockResolvedValue({
    loadSurveyResponses: vi.fn().mockResolvedValue([]),
    loadSurveyConfigs: vi.fn().mockResolvedValue([]),
  }),
}));

import { NextRequest } from 'next/server';

function makeRequest(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): NextRequest {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'http://localhost'), init);
}

describe('POST /api/surveys', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear DATABASE_URL to use demo mode
    delete process.env.DATABASE_URL;
    const mod = await import('../route');
    POST = mod.POST;
  });

  it('rejects missing surveyType', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      rating: 5,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/surveyType/);
  });

  it('rejects invalid surveyType', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'invalid',
      rating: 5,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/surveyType/);
  });

  // ---- CSAT validation ----

  it('accepts CSAT rating 1-5', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'csat',
      rating: 3,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects CSAT rating 0', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'csat',
      rating: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/1.*5/);
  });

  it('rejects CSAT rating 6', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'csat',
      rating: 6,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects CSAT float rating', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'csat',
      rating: 3.5,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ---- NPS validation ----

  it('accepts NPS rating 0', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('accepts NPS rating 10', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 10,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('rejects NPS rating 11', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 11,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/0.*10/);
  });

  it('rejects NPS rating -1', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: -1,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ---- CES validation ----

  it('accepts CES rating 1', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'ces',
      rating: 1,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('accepts CES rating 7', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'ces',
      rating: 7,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('rejects CES rating 0', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'ces',
      rating: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/1.*7/);
  });

  it('rejects CES rating 8', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'ces',
      rating: 8,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ---- Comment handling ----

  it('accepts survey with comment', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 9,
      comment: 'Great service!',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('accepts survey without comment', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 5,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('fires surveySubmitted event', async () => {
    const { surveySubmitted } = await import('@/lib/events');
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
      rating: 8,
      ticketId: 'tk-123',
    });
    await POST(req);
    expect(surveySubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyType: 'nps',
        rating: 8,
        ticketId: 'tk-123',
      }),
    );
  });

  it('rejects missing rating', async () => {
    const req = makeRequest('POST', 'http://localhost/api/surveys', {
      surveyType: 'nps',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/surveys', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    vi.resetModules();

    vi.doMock('@/lib/events', () => ({
      surveySubmitted: vi.fn(),
      dispatch: vi.fn(),
    }));
    vi.doMock('@/db', () => ({ db: null }));
    vi.doMock('@/lib/data-provider/index', () => ({
      getDataProvider: vi.fn().mockResolvedValue({
        loadSurveyResponses: vi.fn().mockResolvedValue([]),
        loadSurveyConfigs: vi.fn().mockResolvedValue([]),
      }),
    }));

    const mod = await import('../route');
    GET = mod.GET;
  });

  it('requires type query param', async () => {
    const req = makeRequest('GET', 'http://localhost/api/surveys');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type/);
  });

  it('rejects invalid type', async () => {
    const req = makeRequest('GET', 'http://localhost/api/surveys?type=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns empty NPS stats', async () => {
    const req = makeRequest('GET', 'http://localhost/api/surveys?type=nps');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('nps');
    expect(body.totalResponses).toBe(0);
    expect(body.npsScore).toBe(0);
  });

  it('returns empty CES stats', async () => {
    const req = makeRequest('GET', 'http://localhost/api/surveys?type=ces');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('ces');
    expect(body.totalResponses).toBe(0);
    expect(body.avgEffort).toBe(0);
  });

  it('returns empty CSAT stats', async () => {
    const req = makeRequest('GET', 'http://localhost/api/surveys?type=csat');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('csat');
    expect(body.totalResponses).toBe(0);
  });
});

describe('NPS score computation', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    // Re-import to get fresh demo store
    vi.resetModules();

    // Re-mock after reset
    vi.doMock('@/lib/events', () => ({
      surveySubmitted: vi.fn(),
      dispatch: vi.fn(),
    }));
    vi.doMock('@/db', () => ({ db: null }));
    vi.doMock('@/lib/data-provider/index', () => ({
      getDataProvider: vi.fn().mockResolvedValue({
        loadSurveyResponses: vi.fn().mockResolvedValue([]),
        loadSurveyConfigs: vi.fn().mockResolvedValue([]),
      }),
    }));

    const mod = await import('../route');
    POST = mod.POST;
    GET = mod.GET;
  });

  it('computes NPS score correctly — all promoters = 100', async () => {
    // Submit 3 promoter ratings (9, 10, 10)
    for (const rating of [9, 10, 10]) {
      await POST(makeRequest('POST', 'http://localhost/api/surveys', {
        surveyType: 'nps', rating,
      }));
    }

    const res = await GET(makeRequest('GET', 'http://localhost/api/surveys?type=nps'));
    const body = await res.json();
    expect(body.npsScore).toBe(100);
    expect(body.promoters).toBe(3);
    expect(body.detractors).toBe(0);
  });

  it('computes NPS score correctly — all detractors = -100', async () => {
    for (const rating of [0, 3, 6]) {
      await POST(makeRequest('POST', 'http://localhost/api/surveys', {
        surveyType: 'nps', rating,
      }));
    }

    const res = await GET(makeRequest('GET', 'http://localhost/api/surveys?type=nps'));
    const body = await res.json();
    expect(body.npsScore).toBe(-100);
    expect(body.detractors).toBe(3);
  });

  it('computes NPS score correctly — mixed', async () => {
    // 2 promoters (9, 10), 1 passive (8), 1 detractor (5)
    for (const rating of [9, 10, 8, 5]) {
      await POST(makeRequest('POST', 'http://localhost/api/surveys', {
        surveyType: 'nps', rating,
      }));
    }

    const res = await GET(makeRequest('GET', 'http://localhost/api/surveys?type=nps'));
    const body = await res.json();
    // (2 - 1) / 4 * 100 = 25
    expect(body.npsScore).toBe(25);
    expect(body.promoters).toBe(2);
    expect(body.passives).toBe(1);
    expect(body.detractors).toBe(1);
  });
});

describe('CES score computation', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    vi.resetModules();

    vi.doMock('@/lib/events', () => ({
      surveySubmitted: vi.fn(),
      dispatch: vi.fn(),
    }));
    vi.doMock('@/db', () => ({ db: null }));
    vi.doMock('@/lib/data-provider/index', () => ({
      getDataProvider: vi.fn().mockResolvedValue({
        loadSurveyResponses: vi.fn().mockResolvedValue([]),
        loadSurveyConfigs: vi.fn().mockResolvedValue([]),
      }),
    }));

    const mod = await import('../route');
    POST = mod.POST;
    GET = mod.GET;
  });

  it('computes CES average correctly', async () => {
    for (const rating of [2, 4, 6]) {
      await POST(makeRequest('POST', 'http://localhost/api/surveys', {
        surveyType: 'ces', rating,
      }));
    }

    const res = await GET(makeRequest('GET', 'http://localhost/api/surveys?type=ces'));
    const body = await res.json();
    expect(body.avgEffort).toBe(4); // (2+4+6)/3
    expect(body.lowEffort).toBe(1); // rating 2
    expect(body.highEffort).toBe(1); // rating 6
  });
});
