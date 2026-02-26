import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dispatcher
vi.mock('@/lib/events/dispatcher', () => ({
  dispatch: vi.fn(),
}));

// Mock data provider
const mockLoadSurveyConfigs = vi.fn();
const mockCreateSurveyResponse = vi.fn();
const mockLoadSurveyResponses = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: vi.fn().mockResolvedValue({
    loadSurveyConfigs: (...args: unknown[]) => mockLoadSurveyConfigs(...args),
    createSurveyResponse: (...args: unknown[]) => mockCreateSurveyResponse(...args),
    loadSurveyResponses: (...args: unknown[]) => mockLoadSurveyResponses(...args),
  }),
}));

import { maybeTriggerSurvey } from '../trigger';
import { dispatch } from '@/lib/events/dispatcher';

describe('maybeTriggerSurvey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSurveyResponse.mockResolvedValue({ id: 'sr-1' });
  });

  it('returns empty array for unrelated events', async () => {
    const results = await maybeTriggerSurvey('tk-1', 'ticket.created');
    expect(results).toEqual([]);
    expect(mockLoadSurveyConfigs).not.toHaveBeenCalled();
  });

  it('returns empty array for ticket.updated', async () => {
    const results = await maybeTriggerSurvey('tk-1', 'ticket.updated');
    expect(results).toEqual([]);
  });

  it('returns empty array when no configs are enabled', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: false,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toEqual([]);
  });

  it('returns empty array when trigger type does not match', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_closed',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toEqual([]);
  });

  it('triggers NPS survey on ticket.resolved when configured', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toHaveLength(1);
    expect(results[0].surveyType).toBe('nps');
    expect(results[0].token).toHaveLength(64); // 32 random bytes → 64 hex chars
    expect(results[0].portalUrl).toMatch(/^\/portal\/survey\/[a-f0-9]+#nps$/);
    expect(results[0].delayMinutes).toBe(0);
  });

  it('triggers CES survey on ticket_closed event', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-2',
        surveyType: 'ces',
        enabled: true,
        trigger: 'ticket_closed',
        delayMinutes: 30,
      },
    ]);

    // We need to map 'ticket.closed' to 'ticket_closed' — this currently isn't
    // in the EVENT_TO_TRIGGER map, but let's check what the trigger returns
    // Actually the trigger module does have ticket.closed mapped
    const results = await maybeTriggerSurvey('tk-2', 'ticket.closed');
    expect(results).toHaveLength(1);
    expect(results[0].surveyType).toBe('ces');
    expect(results[0].delayMinutes).toBe(30);
  });

  it('triggers multiple surveys if multiple configs match', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
      {
        id: 'cfg-2',
        surveyType: 'csat',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 5,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.surveyType).sort()).toEqual(['csat', 'nps']);
  });

  it('creates pending survey response with token', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved', 'cust-1');
    expect(mockCreateSurveyResponse).toHaveBeenCalledWith({
      ticketId: 'tk-1',
      customerId: 'cust-1',
      surveyType: 'nps',
      token: results[0].token,
    });
  });

  it('dispatches survey.sent event (not survey.submitted)', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(dispatch).toHaveBeenCalledWith(
      'survey.sent',
      expect.objectContaining({
        surveyType: 'nps',
        ticketId: 'tk-1',
      }),
    );
  });

  it('still returns results even if createSurveyResponse fails', async () => {
    mockCreateSurveyResponse.mockRejectedValue(new Error('DB unavailable'));
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toHaveLength(1);
    expect(results[0].surveyType).toBe('nps');
  });

  it('generates unique tokens for each triggered survey', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
      {
        id: 'cfg-2',
        surveyType: 'ces',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results[0].token).not.toBe(results[1].token);
  });

  it('only triggers enabled configs', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
      {
        id: 'cfg-2',
        surveyType: 'ces',
        enabled: false,
        trigger: 'ticket_solved',
        delayMinutes: 0,
      },
    ]);

    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toHaveLength(1);
    expect(results[0].surveyType).toBe('nps');
  });

  it('handles manual trigger type — not triggered by events', async () => {
    mockLoadSurveyConfigs.mockResolvedValue([
      {
        id: 'cfg-1',
        surveyType: 'nps',
        enabled: true,
        trigger: 'manual',
        delayMinutes: 0,
      },
    ]);

    // ticket.resolved maps to 'ticket_solved', not 'manual'
    const results = await maybeTriggerSurvey('tk-1', 'ticket.resolved');
    expect(results).toEqual([]);
  });
});
