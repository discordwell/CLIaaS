import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../jsonl-store', () => ({
  readJsonlFile: vi.fn().mockReturnValue([]),
  writeJsonlFile: vi.fn(),
}));

// Capture emitted events
const emittedEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
vi.mock('../../realtime/events', () => ({
  eventBus: {
    emit: vi.fn((event: { type: string; data: Record<string, unknown> }) => {
      emittedEvents.push(event);
    }),
  },
}));

describe('availability event type', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    // Reset the module to get a fresh AvailabilityTracker
    vi.resetModules();
  });

  it('emits agent:availability_changed, not ticket:updated', async () => {
    // Re-import after mock setup
    const { availability } = await import('../availability');

    availability.setAvailability('user-1', 'Alice', 'online');

    expect(emittedEvents.length).toBeGreaterThan(0);
    const event = emittedEvents[emittedEvents.length - 1];
    expect(event.type).toBe('agent:availability_changed');
    expect(event.data.userId).toBe('user-1');
    expect(event.data.status).toBe('online');
    // Should NOT have the old _routingEvent workaround
    expect(event.data._routingEvent).toBeUndefined();

    availability.destroy();
  });
});
