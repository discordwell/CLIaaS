import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the data provider
const mockLoadSurveyResponses = vi.fn();
const mockLoadSurveyConfigs = vi.fn();
const mockCreateSurveyResponse = vi.fn();
const mockUpdateSurveyConfig = vi.fn();
const mockLoadTickets = vi.fn();

vi.mock('@/lib/data-provider/index', () => ({
  getDataProvider: vi.fn().mockImplementation(async () => ({
    loadSurveyResponses: mockLoadSurveyResponses,
    loadSurveyConfigs: mockLoadSurveyConfigs,
    createSurveyResponse: mockCreateSurveyResponse,
    updateSurveyConfig: mockUpdateSurveyConfig,
    loadTickets: mockLoadTickets,
    loadMessages: vi.fn().mockResolvedValue([]),
    loadKBArticles: vi.fn().mockResolvedValue([]),
    loadCustomers: vi.fn().mockResolvedValue([]),
    loadOrganizations: vi.fn().mockResolvedValue([]),
    loadRules: vi.fn().mockResolvedValue([]),
    loadCSATRatings: vi.fn().mockResolvedValue([]),
    capabilities: { mode: 'local', supportsWrite: false, supportsSync: false, supportsRag: false },
  })),
}));

// Mock scopes (enable all tools)
vi.mock('../scopes', () => ({
  isToolEnabled: vi.fn().mockReturnValue(true),
  loadScopes: vi.fn().mockReturnValue({
    enabledTools: new Set([
      'survey_config', 'survey_send',
    ]),
    maxBatchSize: 50,
  }),
}));

// Mock confirm
vi.mock('../confirm', () => ({
  withConfirmation: vi.fn().mockImplementation((confirm, action) => {
    if (!confirm) {
      return {
        needsConfirmation: true,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              confirmation_required: true,
              action: action.description,
              preview: action.preview,
            }),
          }],
        },
      };
    }
    return { needsConfirmation: false, value: action.execute() };
  }),
  recordMCPAction: vi.fn(),
}));

// Import after mocks
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSurveyTools } from '../surveys';

// Create a mock MCP server that captures registered tools
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const registeredTools = new Map<string, ToolHandler>();

const mockServer = {
  tool: vi.fn().mockImplementation(
    (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      registeredTools.set(name, handler);
    },
  ),
} as unknown as McpServer;

describe('MCP survey tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    registerSurveyTools(mockServer);
  });

  it('registers 3 tools', () => {
    expect(mockServer.tool).toHaveBeenCalledTimes(3);
    expect(registeredTools.has('survey_stats')).toBe(true);
    expect(registeredTools.has('survey_config')).toBe(true);
    expect(registeredTools.has('survey_send')).toBe(true);
  });

  // ---- survey_stats ----

  describe('survey_stats', () => {
    it('returns empty NPS stats when no responses', async () => {
      mockLoadSurveyResponses.mockResolvedValue([]);

      const handler = registeredTools.get('survey_stats')!;
      const result = await handler({ type: 'nps' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.type).toBe('nps');
      expect(data.totalResponses).toBe(0);
    });

    it('computes NPS stats from responses', async () => {
      mockLoadSurveyResponses.mockResolvedValue([
        { id: '1', surveyType: 'nps', rating: 9, createdAt: '2026-01-01' },
        { id: '2', surveyType: 'nps', rating: 10, createdAt: '2026-01-01' },
        { id: '3', surveyType: 'nps', rating: 5, createdAt: '2026-01-01' },
        { id: '4', surveyType: 'nps', rating: 8, createdAt: '2026-01-01' },
      ]);

      const handler = registeredTools.get('survey_stats')!;
      const result = await handler({ type: 'nps' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.type).toBe('nps');
      expect(data.totalResponses).toBe(4);
      expect(data.npsScore).toBe(25); // (2-1)/4 * 100
      expect(data.promoters).toBe(2);
      expect(data.passives).toBe(1);
      expect(data.detractors).toBe(1);
    });

    it('computes CES stats from responses', async () => {
      mockLoadSurveyResponses.mockResolvedValue([
        { id: '1', surveyType: 'ces', rating: 2, createdAt: '2026-01-01' },
        { id: '2', surveyType: 'ces', rating: 6, createdAt: '2026-01-01' },
        { id: '3', surveyType: 'ces', rating: 4, createdAt: '2026-01-01' },
      ]);

      const handler = registeredTools.get('survey_stats')!;
      const result = await handler({ type: 'ces' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.type).toBe('ces');
      expect(data.totalResponses).toBe(3);
      expect(data.avgEffort).toBe(4); // (2+6+4)/3
      expect(data.lowEffort).toBe(1);
      expect(data.highEffort).toBe(1);
    });

    it('computes CSAT stats from responses', async () => {
      mockLoadSurveyResponses.mockResolvedValue([
        { id: '1', surveyType: 'csat', rating: 5, createdAt: '2026-01-01' },
        { id: '2', surveyType: 'csat', rating: 4, createdAt: '2026-01-01' },
        { id: '3', surveyType: 'csat', rating: 2, createdAt: '2026-01-01' },
      ]);

      const handler = registeredTools.get('survey_stats')!;
      const result = await handler({ type: 'csat' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.type).toBe('csat');
      expect(data.totalResponses).toBe(3);
      expect(data.averageRating).toBeCloseTo(3.67, 1);
      expect(data.satisfactionPercent).toBeCloseTo(66.67, 1);
    });

    it('filters out null ratings', async () => {
      mockLoadSurveyResponses.mockResolvedValue([
        { id: '1', surveyType: 'nps', rating: null, createdAt: '2026-01-01' },
        { id: '2', surveyType: 'nps', rating: 9, createdAt: '2026-01-01' },
      ]);

      const handler = registeredTools.get('survey_stats')!;
      const result = await handler({ type: 'nps' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.totalResponses).toBe(1);
      expect(data.promoters).toBe(1);
    });
  });

  // ---- survey_config ----

  describe('survey_config', () => {
    it('returns current config when no update params', async () => {
      mockLoadSurveyConfigs.mockResolvedValue([
        {
          id: 'cfg-1',
          surveyType: 'nps',
          enabled: true,
          trigger: 'ticket_solved',
          delayMinutes: 30,
          question: 'Custom NPS question',
        },
      ]);

      const handler = registeredTools.get('survey_config')!;
      const result = await handler({ type: 'nps' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.surveyType).toBe('nps');
      expect(data.enabled).toBe(true);
      expect(data.delayMinutes).toBe(30);
    });

    it('returns default config when none exists', async () => {
      mockLoadSurveyConfigs.mockResolvedValue([]);

      const handler = registeredTools.get('survey_config')!;
      const result = await handler({ type: 'ces' }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.surveyType).toBe('ces');
      expect(data.enabled).toBe(false);
    });

    it('requires confirmation for updates', async () => {
      mockLoadSurveyConfigs.mockResolvedValue([]);

      const handler = registeredTools.get('survey_config')!;
      const result = await handler({
        type: 'nps',
        enabled: true,
        confirm: false,
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.confirmation_required).toBe(true);
      expect(data.action).toMatch(/NPS/i);
    });

    it('executes update with confirmation', async () => {
      mockLoadSurveyConfigs.mockResolvedValue([]);
      mockUpdateSurveyConfig.mockResolvedValue(undefined);

      const handler = registeredTools.get('survey_config')!;
      const result = await handler({
        type: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        confirm: true,
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.updated).toBe(true);
    });

    it('calls updateSurveyConfig on the data provider', async () => {
      mockLoadSurveyConfigs.mockResolvedValue([]);
      mockUpdateSurveyConfig.mockResolvedValue(undefined);

      const handler = registeredTools.get('survey_config')!;
      await handler({
        type: 'nps',
        enabled: true,
        trigger: 'ticket_solved',
        delayMinutes: 15,
        confirm: true,
      });

      expect(mockUpdateSurveyConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          surveyType: 'nps',
          enabled: true,
          trigger: 'ticket_solved',
          delayMinutes: 15,
        }),
      );
    });
  });

  // ---- survey_send ----

  describe('survey_send', () => {
    beforeEach(() => {
      mockLoadTickets.mockResolvedValue([
        {
          id: 'tk-1',
          externalId: 'EXT-1',
          subject: 'Test ticket',
          status: 'solved',
          priority: 'normal',
          source: 'zendesk',
          requester: 'test@example.com',
          tags: [],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);
      mockCreateSurveyResponse.mockResolvedValue({ id: 'sr-1' });
    });

    it('returns error for non-existent ticket', async () => {
      const handler = registeredTools.get('survey_send')!;
      const result = await handler({
        ticketId: 'non-existent',
        type: 'nps',
        confirm: true,
      }) as { content: Array<{ text: string }>, isError?: boolean };

      expect(result.isError).toBe(true);
    });

    it('requires confirmation', async () => {
      const handler = registeredTools.get('survey_send')!;
      const result = await handler({
        ticketId: 'tk-1',
        type: 'nps',
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.confirmation_required).toBe(true);
      expect(data.preview.surveyType).toBe('nps');
      expect(data.preview.portalUrl).toMatch(/\/portal\/survey\//);
    });

    it('generates token and portal URL on confirmation', async () => {
      const handler = registeredTools.get('survey_send')!;
      const result = await handler({
        ticketId: 'tk-1',
        type: 'nps',
        confirm: true,
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.sent).toBe(true);
      expect(data.token).toHaveLength(64);
      expect(data.portalUrl).toMatch(/\/portal\/survey\/[a-f0-9]+#nps/);
      expect(data.surveyType).toBe('nps');
    });

    it('creates pending survey response', async () => {
      const handler = registeredTools.get('survey_send')!;
      await handler({
        ticketId: 'tk-1',
        type: 'ces',
        confirm: true,
      });

      expect(mockCreateSurveyResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'tk-1',
          surveyType: 'ces',
          token: expect.any(String),
        }),
      );
    });

    it('finds ticket by external ID', async () => {
      const handler = registeredTools.get('survey_send')!;
      const result = await handler({
        ticketId: 'EXT-1',
        type: 'nps',
        confirm: true,
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.sent).toBe(true);
      expect(data.ticketId).toBe('tk-1');
    });

    it('still succeeds when createSurveyResponse fails', async () => {
      mockCreateSurveyResponse.mockRejectedValue(new Error('DB down'));

      const handler = registeredTools.get('survey_send')!;
      const result = await handler({
        ticketId: 'tk-1',
        type: 'nps',
        confirm: true,
      }) as { content: Array<{ text: string }> };
      const data = JSON.parse(result.content[0].text);

      expect(data.sent).toBe(true);
    });
  });
});
