import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the ticket events schema and timeline logic.
 * These test the data structures and merge logic without requiring a DB.
 */

interface TicketEvent {
  id: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType: string;
  actorLabel?: string | null;
  note?: string | null;
  createdAt: string;
}

interface PortalMessage {
  id: string;
  body: string;
  authorType: string;
  isCustomer: boolean;
  createdAt: string;
}

type TimelineItem =
  | { kind: 'message'; data: PortalMessage }
  | { kind: 'event'; data: TicketEvent };

function mergeTimeline(
  messages: PortalMessage[],
  events: TicketEvent[],
): TimelineItem[] {
  return [
    ...messages.map((m): TimelineItem => ({ kind: 'message', data: m })),
    ...events.map((e): TimelineItem => ({ kind: 'event', data: e })),
  ].sort(
    (a, b) =>
      new Date(a.data.createdAt).getTime() -
      new Date(b.data.createdAt).getTime(),
  );
}

describe('ticket events', () => {
  it('opened event has correct shape', () => {
    const event: TicketEvent = {
      id: '1',
      eventType: 'opened',
      toStatus: 'open',
      actorType: 'customer',
      actorLabel: 'alice@example.com',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(event.eventType).toBe('opened');
    expect(event.toStatus).toBe('open');
    expect(event.actorType).toBe('customer');
  });

  it('replied event has correct shape', () => {
    const event: TicketEvent = {
      id: '2',
      eventType: 'replied',
      actorType: 'customer',
      actorLabel: 'alice@example.com',
      createdAt: '2026-01-01T00:01:00Z',
    };
    expect(event.eventType).toBe('replied');
    expect(event.fromStatus).toBeUndefined();
  });

  it('reopened event records fromStatus and toStatus', () => {
    const event: TicketEvent = {
      id: '3',
      eventType: 'reopened',
      fromStatus: 'solved',
      toStatus: 'open',
      actorType: 'customer',
      actorLabel: 'alice@example.com',
      createdAt: '2026-01-01T00:02:00Z',
    };
    expect(event.fromStatus).toBe('solved');
    expect(event.toStatus).toBe('open');
  });
});

describe('timeline merge', () => {
  it('merges messages and events sorted by createdAt', () => {
    const messages: PortalMessage[] = [
      {
        id: 'msg-1',
        body: 'Hello',
        authorType: 'customer',
        isCustomer: true,
        createdAt: '2026-01-01T00:01:00Z',
      },
      {
        id: 'msg-2',
        body: 'We are looking into it',
        authorType: 'user',
        isCustomer: false,
        createdAt: '2026-01-01T00:03:00Z',
      },
    ];

    const events: TicketEvent[] = [
      {
        id: 'evt-1',
        eventType: 'opened',
        toStatus: 'open',
        actorType: 'customer',
        actorLabel: 'alice@example.com',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'evt-2',
        eventType: 'status_changed',
        fromStatus: 'open',
        toStatus: 'pending',
        actorType: 'agent',
        createdAt: '2026-01-01T00:02:00Z',
      },
    ];

    const timeline = mergeTimeline(messages, events);
    expect(timeline).toHaveLength(4);
    // Should be sorted chronologically
    expect(timeline[0].kind).toBe('event');
    expect((timeline[0].data as TicketEvent).eventType).toBe('opened');
    expect(timeline[1].kind).toBe('message');
    expect((timeline[1].data as PortalMessage).body).toBe('Hello');
    expect(timeline[2].kind).toBe('event');
    expect((timeline[2].data as TicketEvent).eventType).toBe('status_changed');
    expect(timeline[3].kind).toBe('message');
    expect((timeline[3].data as PortalMessage).body).toBe('We are looking into it');
  });

  it('handles empty events', () => {
    const messages: PortalMessage[] = [
      {
        id: 'msg-1',
        body: 'Hello',
        authorType: 'customer',
        isCustomer: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    const timeline = mergeTimeline(messages, []);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].kind).toBe('message');
  });

  it('handles empty messages', () => {
    const events: TicketEvent[] = [
      {
        id: 'evt-1',
        eventType: 'opened',
        toStatus: 'open',
        actorType: 'system',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    const timeline = mergeTimeline([], events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].kind).toBe('event');
  });

  it('discriminates by kind property', () => {
    const timeline = mergeTimeline(
      [
        {
          id: 'msg-1',
          body: 'Test',
          authorType: 'customer',
          isCustomer: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      [
        {
          id: 'evt-1',
          eventType: 'opened',
          toStatus: 'open',
          actorType: 'system',
          createdAt: '2026-01-01T00:00:01Z',
        },
      ],
    );

    for (const item of timeline) {
      if (item.kind === 'message') {
        expect('body' in item.data).toBe(true);
      } else {
        expect('eventType' in item.data).toBe(true);
      }
    }
  });
});
