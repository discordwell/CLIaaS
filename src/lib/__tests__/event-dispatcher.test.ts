import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all three delivery channels before importing dispatcher
vi.mock('@/lib/webhooks', () => ({
  dispatchWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/plugins', () => ({
  executePluginHook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/realtime/events', () => ({
  eventBus: { emit: vi.fn() },
}));

import { dispatch } from '@/lib/events/dispatcher';
import { dispatchWebhook } from '@/lib/webhooks';
import { executePluginHook } from '@/lib/plugins';
import { eventBus } from '@/lib/realtime/events';
import {
  ticketCreated,
  ticketUpdated,
  ticketResolved,
  messageCreated,
  slaBreached,
  csatSubmitted,
} from '@/lib/events';

describe('event dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fans out to webhooks, plugins, and SSE', async () => {
    dispatch('ticket.created', { ticketId: 'tk-1' });

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ticket.created',
        data: { ticketId: 'tk-1' },
      }),
    );

    expect(executePluginHook).toHaveBeenCalledWith(
      'ticket.created',
      expect.objectContaining({
        event: 'ticket.created',
        data: { ticketId: 'tk-1' },
      }),
    );

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ticket:created',
        data: { ticketId: 'tk-1' },
      }),
    );
  });

  it('maps SSE event types correctly', async () => {
    dispatch('ticket.updated', { ticketId: 'tk-2' });
    await new Promise((r) => setTimeout(r, 10));
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket:updated' }),
    );

    vi.clearAllMocks();
    dispatch('ticket.resolved', { ticketId: 'tk-3' });
    await new Promise((r) => setTimeout(r, 10));
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket:status_changed' }),
    );

    vi.clearAllMocks();
    dispatch('message.created', { ticketId: 'tk-4' });
    await new Promise((r) => setTimeout(r, 10));
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket:reply' }),
    );
  });

  it('does not emit SSE for events without mapping', async () => {
    dispatch('sla.breached', { ticketId: 'tk-5' });
    await new Promise((r) => setTimeout(r, 10));
    expect(eventBus.emit).not.toHaveBeenCalled();

    dispatch('csat.submitted', { ticketId: 'tk-6' });
    await new Promise((r) => setTimeout(r, 10));
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('isolates errors — webhook failure does not affect plugins or SSE', async () => {
    vi.mocked(dispatchWebhook).mockRejectedValueOnce(new Error('network'));

    dispatch('ticket.created', { ticketId: 'tk-err' });
    await new Promise((r) => setTimeout(r, 10));

    // Plugins and SSE should still fire
    expect(executePluginHook).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalled();
  });

  it('isolates errors — plugin failure does not affect webhooks or SSE', async () => {
    vi.mocked(executePluginHook).mockRejectedValueOnce(new Error('plugin crash'));

    dispatch('ticket.created', { ticketId: 'tk-err2' });
    await new Promise((r) => setTimeout(r, 10));

    expect(dispatchWebhook).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalled();
  });
});

describe('convenience helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ticketCreated dispatches ticket.created', async () => {
    ticketCreated({ id: '1' });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.created' }),
    );
  });

  it('ticketUpdated dispatches ticket.updated', async () => {
    ticketUpdated({ id: '2' });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.updated' }),
    );
  });

  it('ticketResolved dispatches ticket.resolved', async () => {
    ticketResolved({ id: '3' });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.resolved' }),
    );
  });

  it('messageCreated dispatches message.created', async () => {
    messageCreated({ id: '4' });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message.created' }),
    );
  });

  it('slaBreached dispatches sla.breached', async () => {
    slaBreached({ policyId: 'sla-1' });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sla.breached' }),
    );
  });

  it('csatSubmitted dispatches csat.submitted', async () => {
    csatSubmitted({ rating: 5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'csat.submitted' }),
    );
  });
});
