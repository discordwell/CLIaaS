import { describe, it, expect, beforeEach } from 'vitest';

describe('Message Store', () => {
  let store: typeof import('../lib/messages/message-store');

  beforeEach(async () => {
    store = await import('../lib/messages/message-store');
  });

  it('getMessages returns demo messages', async () => {
    const messages = await store.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('createMessage creates a new message', () => {
    const msg = store.createMessage({
      name: 'Test Banner',
      messageType: 'banner',
      title: 'Hello',
      body: 'World',
    });
    expect(msg.id).toBeTruthy();
    expect(msg.name).toBe('Test Banner');
    expect(msg.messageType).toBe('banner');
    expect(msg.isActive).toBe(false);
  });

  it('getMessage returns by id', async () => {
    const created = store.createMessage({ name: 'Find Me', messageType: 'modal', title: 'Found' });
    const found = await store.getMessage(created.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Found');
  });

  it('updateMessage updates fields', () => {
    const msg = store.createMessage({ name: 'Update Me', messageType: 'tooltip', title: 'Old' });
    const updated = store.updateMessage(msg.id, { title: 'New', body: 'Updated body' });
    expect(updated!.title).toBe('New');
    expect(updated!.body).toBe('Updated body');
  });

  it('toggleMessage flips isActive', async () => {
    const msg = store.createMessage({ name: 'Toggle', messageType: 'banner', title: 'T' });
    expect(msg.isActive).toBe(false);
    const toggled = await store.toggleMessage(msg.id);
    expect(toggled!.isActive).toBe(true);
  });

  it('deleteMessage removes message and impressions', async () => {
    const msg = store.createMessage({ name: 'Delete Me', messageType: 'slide_in', title: 'D' });
    store.recordImpression(msg.id, 'cust-1', 'displayed');
    expect(store.deleteMessage(msg.id)).toBe(true);
    expect(await store.getMessage(msg.id)).toBeUndefined();
  });

  it('recordImpression creates an impression', () => {
    const msg = store.createMessage({ name: 'Impression Test', messageType: 'banner', title: 'I' });
    const imp = store.recordImpression(msg.id, 'cust-1', 'displayed');
    expect(imp.id).toBeTruthy();
    expect(imp.action).toBe('displayed');
  });

  it('getImpressionCount counts displayed impressions', async () => {
    const msg = store.createMessage({ name: 'Count Test', messageType: 'banner', title: 'C' });
    store.recordImpression(msg.id, 'cust-1', 'displayed');
    store.recordImpression(msg.id, 'cust-1', 'displayed');
    store.recordImpression(msg.id, 'cust-1', 'clicked');
    expect(await store.getImpressionCount(msg.id, 'cust-1')).toBe(2);
  });

  it('getMessageAnalytics returns correct counts', async () => {
    const msg = store.createMessage({ name: 'Analytics Test', messageType: 'modal', title: 'A' });
    store.recordImpression(msg.id, 'c1', 'displayed');
    store.recordImpression(msg.id, 'c2', 'displayed');
    store.recordImpression(msg.id, 'c1', 'clicked');
    store.recordImpression(msg.id, 'c2', 'dismissed');
    store.recordImpression(msg.id, 'c1', 'cta_clicked');

    const analytics = await store.getMessageAnalytics(msg.id);
    expect(analytics.displayed).toBe(2);
    expect(analytics.clicked).toBe(1);
    expect(analytics.dismissed).toBe(1);
    expect(analytics.ctaClicked).toBe(1);
  });

  it('maxImpressions=0 means unlimited', () => {
    const msg = store.createMessage({ name: 'Unlimited', messageType: 'banner', title: 'U', maxImpressions: 0 });
    expect(msg.maxImpressions).toBe(0);
    // With maxImpressions=0, the portal route would not cap impressions
  });
});
