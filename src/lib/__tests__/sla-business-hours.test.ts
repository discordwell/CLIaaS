import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Ticket } from '@/lib/data';

// Mock the business hours module — spread all real exports, override only getBusinessHours
vi.mock('@/lib/wfm/business-hours', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wfm/business-hours')>('@/lib/wfm/business-hours');
  const bhConfig = {
    id: 'bh-test',
    name: 'Test Hours',
    timezone: 'UTC',
    schedule: {
      '1': [{ start: '09:00', end: '17:00' }],
      '2': [{ start: '09:00', end: '17:00' }],
      '3': [{ start: '09:00', end: '17:00' }],
      '4': [{ start: '09:00', end: '17:00' }],
      '5': [{ start: '09:00', end: '17:00' }],
    },
    holidays: [],
    isDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return {
    ...actual,
    getBusinessHours: (id?: string) => id === 'bh-test' ? [bhConfig] : [],
  };
});

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    externalId: 'ext-1',
    subject: 'Test ticket',
    status: 'open',
    priority: 'urgent',
    requester: 'user@example.com',
    assignee: undefined,
    tags: [],
    source: 'zendesk',
    createdAt: '2026-03-06T16:00:00Z', // Friday 4pm UTC
    updatedAt: '2026-03-06T16:00:00Z',
    ...overrides,
  };
}

describe('SLA with business hours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set "now" to Monday 10am UTC
    vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
  });

  it('uses business elapsed minutes when policy has businessHoursId', async () => {
    // Dynamically import after mocks are set up
    const { checkTicketSLA } = await import('@/lib/sla');

    // Ticket created Fri 16:00, checked Mon 10:00
    // Calendar time: ~66 hours = ~3960 minutes
    // Business time: Fri 16:00-17:00 (60 min) + Mon 09:00-10:00 (60 min) = 120 min
    const results = await checkTicketSLA({
      ticket: makeTicket(),
    });

    // With the default urgent policy (no businessHoursId), elapsed should be calendar time
    const urgentResult = results.find(r => r.policyName === 'Urgent Priority');
    expect(urgentResult).toBeDefined();
    // Calendar elapsed should be ~3960 minutes (Fri 16:00 to Mon 10:00)
    expect(urgentResult!.firstResponse.elapsedMinutes).toBeGreaterThan(3000);
  });

  it('returns dueAt when business hours schedule is set', async () => {
    const { checkTicketSLA, createPolicy } = await import('@/lib/sla');

    // Create a policy with business hours
    const policy = await createPolicy({
      name: 'BH Test Policy',
      conditions: { priority: ['urgent'] },
      targets: { firstResponse: 120, resolution: 480 },
      escalation: [],
      businessHoursId: 'bh-test',
      enabled: true,
    });

    const results = await checkTicketSLA({
      ticket: makeTicket(),
    });

    const bhResult = results.find(r => r.policyId === policy.id);
    expect(bhResult).toBeDefined();
    expect(bhResult!.businessHoursId).toBe('bh-test');
    // Business elapsed: Fri 16-17 (60) + Mon 09-10 (60) = 120 min
    expect(bhResult!.firstResponse.businessElapsedMinutes).toBe(120);
    // dueAt should be defined
    expect(bhResult!.firstResponse.dueAt).toBeDefined();
    expect(bhResult!.resolution.dueAt).toBeDefined();
  });

  it('backward compatible — no businessHoursId uses calendar time', async () => {
    const { checkTicketSLA } = await import('@/lib/sla');

    const results = await checkTicketSLA({
      ticket: makeTicket(),
    });

    for (const result of results) {
      if (!result.businessHoursId) {
        expect(result.firstResponse.businessElapsedMinutes).toBeUndefined();
        expect(result.firstResponse.dueAt).toBeUndefined();
      }
    }
  });
});
