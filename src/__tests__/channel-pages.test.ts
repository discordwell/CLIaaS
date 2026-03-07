/**
 * Tests for the omnichannel dashboard (C13) and voice admin page (C14).
 * Verifies data functions, mock data integrity, and server component imports.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-channels-' + process.pid;

// ---- C13: Omnichannel Dashboard tests ----

describe('Omnichannel Dashboard — /dashboard/channels', () => {
  it('page module exports a default function component', async () => {
    const mod = await import('../app/dashboard/channels/page');
    expect(typeof mod.default).toBe('function');
  });

  it('layout module exports metadata and a default function', async () => {
    const mod = await import('../app/dashboard/channels/layout');
    expect(typeof mod.default).toBe('function');
    expect(mod.metadata).toBeDefined();
    expect(mod.metadata.title).toContain('Channels');
  });

  it('page has force-dynamic export', async () => {
    const mod = await import('../app/dashboard/channels/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});

// ---- C14: Voice Admin Page tests ----

describe('Voice Admin Page — /dashboard/channels/voice', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset voice store globals for clean state
    delete (global as Record<string, unknown>).__cliaasVoiceCalls;
    delete (global as Record<string, unknown>).__cliaasVoiceCallsLoaded;
    delete (global as Record<string, unknown>).__cliaasVoiceAgents;
    delete (global as Record<string, unknown>).__cliaasVoiceAgentsLoaded;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    delete (global as Record<string, unknown>).__cliaasVoiceCalls;
    delete (global as Record<string, unknown>).__cliaasVoiceCallsLoaded;
    delete (global as Record<string, unknown>).__cliaasVoiceAgents;
    delete (global as Record<string, unknown>).__cliaasVoiceAgentsLoaded;
  });

  it('page module exports a default function component', async () => {
    const mod = await import('../app/dashboard/channels/voice/page');
    expect(typeof mod.default).toBe('function');
  });

  it('page has force-dynamic export', async () => {
    const mod = await import('../app/dashboard/channels/voice/page');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('voice store provides agents after seedDemoData()', async () => {
    const { seedDemoData, getAgents } = await import('../lib/channels/voice-store');
    seedDemoData();
    const agents = getAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty('name');
    expect(agents[0]).toHaveProperty('extension');
    expect(agents[0]).toHaveProperty('phoneNumber');
    expect(agents[0]).toHaveProperty('status');
  });

  it('voice store provides calls after seedDemoData()', async () => {
    const { seedDemoData, getAllCalls } = await import('../lib/channels/voice-store');
    seedDemoData();
    const calls = getAllCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toHaveProperty('callSid');
    expect(calls[0]).toHaveProperty('direction');
    expect(calls[0]).toHaveProperty('status');
  });

  it('IVR config returns default main menu', async () => {
    const { getIVRConfig } = await import('../lib/channels/voice-ivr');
    const config = getIVRConfig();
    expect(config.enabled).toBe(true);
    expect(config.mainMenuId).toBe('main');
    expect(config.menus.length).toBeGreaterThan(0);

    const mainMenu = config.menus.find((m) => m.id === 'main');
    expect(mainMenu).toBeDefined();
    expect(mainMenu!.items.length).toBeGreaterThan(0);
    // Verify all items have required properties
    for (const item of mainMenu!.items) {
      expect(item).toHaveProperty('digit');
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('action');
    }
  });

  it('IVR config has voicemail greeting', async () => {
    const { getIVRConfig } = await import('../lib/channels/voice-ivr');
    const config = getIVRConfig();
    expect(config.voicemailGreeting).toBeTruthy();
    expect(typeof config.voicemailGreeting).toBe('string');
  });

  it('IVR config has business hours schedule', async () => {
    const { getIVRConfig } = await import('../lib/channels/voice-ivr');
    const config = getIVRConfig();
    expect(config.businessHours).toBeDefined();
    expect(config.businessHours.timezone).toBeTruthy();
    expect(config.businessHours.schedule).toBeDefined();
    expect(config.businessHours.schedule.mon).toBeDefined();
  });

  it('seedDemoData is idempotent', async () => {
    const { seedDemoData, getAgents, getAllCalls } = await import('../lib/channels/voice-store');
    seedDemoData();
    const agentsFirst = getAgents().length;
    const callsFirst = getAllCalls().length;

    seedDemoData(); // Second call should not duplicate
    expect(getAgents().length).toBe(agentsFirst);
    expect(getAllCalls().length).toBe(callsFirst);
  });

  it('agent statuses are valid enum values', async () => {
    const { seedDemoData, getAgents } = await import('../lib/channels/voice-store');
    seedDemoData();
    const validStatuses = ['available', 'busy', 'offline', 'wrap-up'];
    for (const agent of getAgents()) {
      expect(validStatuses).toContain(agent.status);
    }
  });

  it('call directions are valid enum values', async () => {
    const { seedDemoData, getAllCalls } = await import('../lib/channels/voice-store');
    seedDemoData();
    const validDirections = ['inbound', 'outbound'];
    for (const call of getAllCalls()) {
      expect(validDirections).toContain(call.direction);
    }
  });
});
