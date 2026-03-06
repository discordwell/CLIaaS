import { describe, it, expect, beforeEach } from 'vitest';
import { availability } from '@/lib/routing/availability';
import { writeJsonlFile } from '@/lib/jsonl-store';

describe('heartbeat endpoint (unit)', () => {
  beforeEach(() => {
    writeJsonlFile('routing-availability.jsonl', []);
  });

  it('heartbeat updates lastSeenAt for tracked agent', () => {
    availability.setAvailability('agent-hb', 'Heartbeat Agent', 'online');

    const before = availability.getAllAvailability().find(a => a.userId === 'agent-hb');
    expect(before).toBeDefined();
    expect(before!.status).toBe('online');

    const originalLastSeen = before!.lastSeenAt;

    // Simulate passage of time
    const now = Date.now() + 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    availability.heartbeat('agent-hb');

    const after = availability.getAllAvailability().find(a => a.userId === 'agent-hb');
    expect(after!.lastSeenAt).toBe(now);
    expect(after!.lastSeenAt).toBeGreaterThan(originalLastSeen);

    vi.restoreAllMocks();
  });

  it('heartbeat is no-op for untracked agent', () => {
    availability.heartbeat('unknown-agent');
    const all = availability.getAllAvailability();
    expect(all.find(a => a.userId === 'unknown-agent')).toBeUndefined();
  });
});
